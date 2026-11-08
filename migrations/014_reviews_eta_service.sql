-- ---------------------------------------------------------------------------
-- 014 · Reviews, ETA, service requests, item-level preparation state
--
-- Four additions that the commercial demo needs, all additive. Nothing here
-- rewrites an existing table or drops a column: the 50 dishes, 20 tables, 20 QR
-- tokens and the order history are untouched by this file.
--
--   1. `orders` gains an ETA (minutes + who set it + when). The timer is an
--      *estimate* the owner chooses when accepting; finish time is always
--      driven by the kitchen, never by the clock.
--   2. `orders` gains a revision counter so a guest tracker can ask for
--      "changed since vN" cheaply instead of re-reading the whole order.
--   3. `order_items` gains item-level prep state so the kitchen can tick lines
--      off independently.
--   4. New tables: order_reviews (food + restaurant, in one table with a
--      target discriminator), review_replies, service_requests.
--
-- Review writes happen through SECURITY DEFINER functions that prove order
-- ownership against the guest's tracking token, because the guest is `anon`:
-- they have no session to run RLS as.
-- ---------------------------------------------------------------------------

-- ---- 1 & 2. Order ETA and revision ---------------------------------------
alter table public.orders
  add column if not exists eta_minutes integer
    check (eta_minutes is null or eta_minutes between 1 and 240),
  add column if not exists eta_set_at timestamptz,
  add column if not exists eta_set_by uuid references auth.users(id) on delete set null,
  add column if not exists eta_revisions integer not null default 0
    check (eta_revisions >= 0),
  add column if not exists revision integer not null default 0 check (revision >= 0);

comment on column public.orders.eta_minutes is
  'Owner-chosen estimate in minutes. Never finishes an order; the kitchen does.';
comment on column public.orders.eta_revisions is
  'How many times the ETA was changed after acceptance. Guest sees the latest.';

-- ---- 3. Item-level prep state --------------------------------------------
alter table public.order_items
  add column if not exists prep_status text not null default 'queued'
    check (prep_status in ('queued', 'preparing', 'done')),
  add column if not exists prep_updated_at timestamptz;

comment on column public.order_items.prep_status is
  'Per-line kitchen progress. Order status still gates the guest-facing state.';

-- ---- 4a. Reviews ----------------------------------------------------------
-- One row per (order, target). `target_kind` is 'item' (one dish) or
-- 'restaurant' (the whole visit). The duplicate constraints below are what make
-- "review this dish twice" impossible even under a replay.
create table if not exists public.order_reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  target_kind text not null check (target_kind in ('item', 'restaurant')),
  menu_item_id uuid references public.menu_items(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  -- Item reviews: the three sub-scores the brief asks for. Restaurant reviews:
  -- service, staff, cleanliness. One nullable set of columns serves both so the
  -- table stays honest about what each kind means.
  score_taste smallint check (score_taste between 1 and 5),
  score_quality smallint check (score_quality between 1 and 5),
  score_presentation smallint check (score_presentation between 1 and 5),
  score_service smallint check (score_service between 1 and 5),
  score_staff smallint check (score_staff between 1 and 5),
  score_cleanliness smallint check (score_cleanliness between 1 and 5),
  comment text check (comment is null or length(comment) <= 2000),
  photo_path text,
  -- Moderation: the owner may hide a review from public view, but the row is
  -- never deleted and `hidden_*` records who did it and why.
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by uuid references auth.users(id) on delete set null,
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists order_reviews_restaurant_idx
  on public.order_reviews (restaurant_id, created_at desc);
create index if not exists order_reviews_item_idx
  on public.order_reviews (menu_item_id) where target_kind = 'item';

-- An order may review each dish at most once…
create unique index if not exists order_reviews_one_per_item
  on public.order_reviews (order_id, menu_item_id)
  where target_kind = 'item';
-- …and the visit as a whole at most once.
create unique index if not exists order_reviews_one_per_order
  on public.order_reviews (order_id)
  where target_kind = 'restaurant';
-- A dish review must name a dish; a restaurant review must not.
alter table public.order_reviews drop constraint if exists order_reviews_target_check;
alter table public.order_reviews add constraint order_reviews_target_check check (
  (target_kind = 'item' and menu_item_id is not null)
  or (target_kind = 'restaurant' and menu_item_id is null)
);

-- ---- 4b. Owner replies ----------------------------------------------------
create table if not exists public.review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.order_reviews(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One reply per review, editable. Threads are a later problem.
create unique index if not exists review_replies_one_per_review
  on public.review_replies (review_id);

-- ---- 4c. Service requests -------------------------------------------------
create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.dining_tables(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  kind text not null check (kind in ('waiter', 'water', 'plate', 'bill', 'other')),
  body text check (body is null or length(body) <= 300),
  status text not null default 'pending'
    check (status in ('pending', 'acknowledged', 'completed', 'cancelled')),
  -- The guest's tracking token, hashed. Required so one table cannot spam the
  -- board and so a request can be traced to the order that raised it.
  tracking_token_sha256 text not null,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists service_requests_board_idx
  on public.service_requests (restaurant_id, status, created_at desc);
create index if not exists service_requests_table_idx
  on public.service_requests (table_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS. Reviews are written by functions only (guests are anonymous); reads are
-- public for visible reviews, full for the owning tenant.
-- ---------------------------------------------------------------------------
alter table public.order_reviews    enable row level security;
alter table public.review_replies   enable row level security;
alter table public.service_requests enable row level security;

drop policy if exists reviews_public_read on public.order_reviews;
create policy reviews_public_read on public.order_reviews for select to anon, authenticated
  using (not is_hidden and public.mp_is_public_restaurant(restaurant_id));

drop policy if exists reviews_member_read on public.order_reviews;
create policy reviews_member_read on public.order_reviews for select to authenticated
  using (public.mp_is_member(restaurant_id));

-- Owners and managers moderate. There is deliberately no INSERT policy: guest
-- reviews go through submit_review(), which is where ownership is proven.
drop policy if exists reviews_manager_update on public.order_reviews;
create policy reviews_manager_update on public.order_reviews for update to authenticated
  using (public.mp_is_member(restaurant_id, array['owner', 'manager']))
  with check (public.mp_is_member(restaurant_id, array['owner', 'manager']));

drop policy if exists replies_public_read on public.review_replies;
create policy replies_public_read on public.review_replies for select to anon, authenticated
  using (public.mp_is_public_restaurant(restaurant_id));

drop policy if exists replies_member_all on public.review_replies;
create policy replies_member_all on public.review_replies for all to authenticated
  using (public.mp_is_member(restaurant_id, array['owner', 'manager']))
  with check (public.mp_is_member(restaurant_id, array['owner', 'manager']));

-- Service requests: staff read and act; guests never read the board directly.
drop policy if exists service_requests_member_read on public.service_requests;
create policy service_requests_member_read on public.service_requests for select to authenticated
  using (public.mp_is_member(restaurant_id));

drop policy if exists service_requests_member_update on public.service_requests;
create policy service_requests_member_update on public.service_requests for update to authenticated
  using (public.mp_is_member(restaurant_id, array['owner', 'manager', 'waiter', 'kitchen']))
  with check (public.mp_is_member(restaurant_id, array['owner', 'manager', 'waiter', 'kitchen']));

grant select on public.order_reviews to anon, authenticated;
grant select on public.review_replies to anon, authenticated;
grant select, update on public.service_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Item prep state: same audience as the order it belongs to.
-- ---------------------------------------------------------------------------
drop policy if exists order_items_kitchen_update on public.order_items;
create policy order_items_kitchen_update on public.order_items for update to authenticated
  using (public.mp_is_member(restaurant_id, array['owner', 'manager', 'kitchen']))
  with check (public.mp_is_member(restaurant_id, array['owner', 'manager', 'kitchen']));

-- ---------------------------------------------------------------------------
-- Kitchen feed carries the estimate and line-level prep state.
--
-- The kitchen is where "are we on time?" actually gets answered, so the ticket
-- needs the promise (`eta_minutes`, `eta_set_at`) alongside the line states.
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_feed(p_restaurant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.mp_is_member(p_restaurant_id, array['owner', 'manager', 'kitchen', 'waiter']) then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(t order by (t ->> 'accepted_at')::timestamptz) from (
      select jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'table_label', d.label,
        'created_at', o.created_at,
        'accepted_at', coalesce(o.accepted_at, o.created_at),
        'preparing_at', o.preparing_at,
        'ready_at', o.ready_at,
        'eta_minutes', o.eta_minutes,
        'eta_set_at', o.eta_set_at,
        'note', o.note,
        'customer_name', o.customer_name,
        'item_count', o.item_count,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', oi.id, 'name', oi.name_snapshot, 'quantity', oi.quantity,
            'note', oi.note, 'prep_status', oi.prep_status
          ) order by oi.sort_order)
          from public.order_items oi where oi.order_id = o.id
        ), '[]'::jsonb)
      ) as t
      from public.orders o
      left join public.dining_tables d on d.id = o.table_id
      where o.restaurant_id = p_restaurant_id and o.status in ('accepted', 'preparing', 'ready')
    ) s
  ), '[]'::jsonb);
end $$;
