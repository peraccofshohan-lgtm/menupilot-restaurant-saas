-- ============================================================================
-- MenuPilot · Migration 004 · Account recovery + abuse protection
-- ============================================================================

-- Password reset tokens (stored hashed; single use; short lived).
create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_user_idx on public.password_reset_tokens (user_id);

alter table public.password_reset_tokens enable row level security;
-- No policies: only service_role (trusted server code) may touch reset tokens.
revoke all on public.password_reset_tokens from anon, authenticated;

-- Fixed-window rate limiter for public endpoints (order submission, QR lookups).
create table if not exists public.rate_limit_buckets (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_row public.rate_limit_buckets%rowtype;
begin
  insert into public.rate_limit_buckets (key, window_start, hits)
  values (p_key, now(), 0)
  on conflict (key) do nothing;

  select * into v_row from public.rate_limit_buckets where key = p_key for update;

  if v_row.window_start < now() - make_interval(secs => p_window_seconds) then
    update public.rate_limit_buckets
       set window_start = now(), hits = 1
     where key = p_key;
    return jsonb_build_object('allowed', true, 'remaining', p_limit - 1, 'reset_at', now() + make_interval(secs => p_window_seconds));
  end if;

  if v_row.hits >= p_limit then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'retry_after', greatest(1, ceil(extract(epoch from (v_row.window_start + make_interval(secs => p_window_seconds) - now())))::int)
    );
  end if;

  update public.rate_limit_buckets set hits = hits + 1 where key = p_key;
  return jsonb_build_object('allowed', true, 'remaining', p_limit - v_row.hits - 1, 'reset_at', v_row.window_start + make_interval(secs => p_window_seconds));
end $$;

grant execute on function public.consume_rate_limit(text, integer, integer) to anon, authenticated;

-- Housekeeping: allow pruning expired buckets.
create or replace function public.prune_rate_limits()
returns void language sql volatile security definer set search_path = public as $$
  delete from public.rate_limit_buckets where window_start < now() - interval '1 day';
$$;
