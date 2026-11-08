-- ===========================================================================
-- 011_tracking_token_hashing.sql
--
-- SECURITY HARDENING (found by the production audit).
--
-- `orders.tracking_token` is the only credential a guest holds: it unlocks that
-- order's status, table label and item notes via `/order/<token>` and
-- `get_order_tracking()`. It was stored in plaintext, so it was a bearer secret
-- sitting in readable rows — anyone with SQL access, or a leaked backup, could
-- follow live guest orders.
--
-- Tokens are now stored as SHA-256, the same way QR tokens and session tokens are:
--
--   write path   a BEFORE INSERT/UPDATE trigger replaces the plaintext value with
--                its digest, so `create_order()` and the seed need no changes and
--                the guest still receives the raw token in the function's result
--   read path    `get_order_tracking()` hashes whatever was presented and matches
--
-- Existing plaintext tokens cannot be hashed retroactively (we only have the
-- value, not the intent to keep it), so legacy rows are retired rather than
-- silently accepting a plaintext key.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A per-order clock for the guest's status timeline.
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists status_changed_at timestamptz;

update public.orders
   set status_changed_at = coalesce(served_at, ready_at, preparing_at, accepted_at, rejected_at, cancelled_at, created_at)
 where status_changed_at is null;

alter table public.orders alter column status_changed_at set default now();
alter table public.orders alter column status_changed_at set not null;

create or replace function public.mp_orders_touch_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_touch_status on public.orders;
create trigger trg_orders_touch_status before update on public.orders
  for each row execute function public.mp_orders_touch_status();

-- ---------------------------------------------------------------------------
-- Hash the tracking token on write.
--
-- INSERT only. `orders.tracking_token` is immutable after creation (005), and it
-- should be: rewriting a guest's live credential on an unrelated update would break
-- their tracker. Idempotent by construction — a 64-character lowercase hex value is
-- already a digest, so a replayed INSERT never hashes a hash.
-- ---------------------------------------------------------------------------
create or replace function public.mp_orders_hash_tracking() returns trigger
language plpgsql as $$
begin
  if new.tracking_token is null then
    return new;
  end if;
  if new.tracking_token !~ '^[0-9a-f]{64}$' then
    new.tracking_token := public.mp_sha256(new.tracking_token);
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_hash_tracking on public.orders;
create trigger trg_orders_hash_tracking before insert on public.orders
  for each row execute function public.mp_orders_hash_tracking();

-- Retire plaintext tokens from before this migration: they can never be looked up
-- again, which is the correct outcome for a value we should not be storing.
-- The immutability guard (005) is disabled for this one statement only.
alter table public.orders disable trigger trg_orders_immutable_money;
update public.orders
   set tracking_token = 'retired-' || id::text
 where tracking_token is not null
   and tracking_token !~ '^[0-9a-f]{64}$';
alter table public.orders enable trigger trg_orders_immutable_money;

-- ---------------------------------------------------------------------------
-- Read path: match the presented token against its digest.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_order_tracking';

  if v_src is null then
    raise exception 'get_order_tracking() is missing; apply 003_functions.sql first';
  end if;

  v_new := v_src;

  if v_new ~ 'where tracking_token = p_token' then
    v_new := replace(v_new, 'where tracking_token = p_token', 'where tracking_token = public.mp_sha256(p_token)');
  end if;
  if v_new !~ 'tracking_token = public\.mp_sha256\(p_token\)' then
    raise exception 'get_order_tracking() did not match the expected body; refusing to patch silently';
  end if;

  if v_new <> v_src then
    execute v_new;
  else
    raise notice 'get_order_tracking() already current';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Idempotent replay must not hand back the stored digest.
--
-- `create_order` returns the raw token so the guest can open the tracker. On a
-- replayed submission it used to return `orders.tracking_token` — which, now that
-- the column holds a digest, would be a URL that resolves to nothing. The digest is
-- also not a credential, so returning it was pointless even before.
--
-- The correct answer is "no token": the raw value existed exactly once, on the
-- device that placed the order. Applied here (not only in 003) so databases created
-- before this migration are corrected too.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';

  if v_src is null then
    return;
  end if;
  if v_src !~ 'v_existing\.tracking_token' then
    raise notice 'create_order() already withholds the replay token';
    return;
  end if;

  -- Dollar-quoted so the single quotes inside the needle are unambiguous.
  v_new := replace(
    v_src,
    $needle$'tracking_token', v_existing.tracking_token,$needle$,
    $replacement$'tracking_token', null,$replacement$
  );
  execute v_new;
end $$;

comment on column public.orders.tracking_token is
  'SHA-256 of the guest tracking token. The raw token is returned once by create_order(); only the digest is stored.';
