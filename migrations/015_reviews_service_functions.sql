-- ---------------------------------------------------------------------------
-- 015 · Business functions for ETA, reviews and service requests
--
-- Same conventions as 003: every privileged operation is a SECURITY DEFINER
-- function that establishes who is calling before it does anything, raises
-- coded `MP:*` errors the UI can translate, and never trusts a value the
-- browser sent (prices, ids, roles, timestamps).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- set_order_eta: the owner's estimate, and the only way to change it.
--
-- Deliberately separate from `orders.status`. The estimate is a promise about
-- time; the status is a fact about cooking. Setting an ETA never advances an
-- order and an expiring ETA never finishes one.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_eta(
  p_order_id uuid,
  p_minutes  integer
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_order public.orders%rowtype;
  v_uid   uuid := public.mp_uid();
  v_role  text;
begin
  if v_uid is null then
    raise exception 'MP:NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 240 then
    raise exception 'MP:INVALID_ETA' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'MP:ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.mp_role(v_order.restaurant_id);
  if v_role is null or v_role not in ('owner', 'manager', 'kitchen') then
    raise exception 'MP:FORBIDDEN_ETA' using errcode = '42501';
  end if;

  -- Only a live, accepted order has a preparation estimate. Pending orders have
  -- not been promised anything yet; a finished order's estimate is history.
  if v_order.status not in ('accepted', 'preparing', 'ready') then
    raise exception 'MP:ETA_NOT_ALLOWED:%', v_order.status using errcode = 'P0001';
  end if;

  update public.orders set
    eta_minutes  = p_minutes,
    eta_set_at   = now(),
    eta_set_by   = v_uid,
    eta_revisions = eta_revisions + 1,
    revision     = revision + 1,
    updated_at   = now()
  where id = v_order.id;

  -- An ETA change is part of the order's story, so it is recorded. The history
  -- table is status-shaped, so the row repeats the current status and carries
  -- the reason; nothing else in the app reads it as a transition.
  insert into public.order_status_history
    (order_id, restaurant_id, from_status, to_status, changed_by, actor_role, note)
  values
    (v_order.id, v_order.restaurant_id, v_order.status, v_order.status, v_uid, v_role,
     format('Preparation time set to %s minutes', p_minutes));

  return jsonb_build_object(
    'order_id', v_order.id,
    'eta_minutes', p_minutes,
    'eta_set_at', now(),
    'eta_revisions', v_order.eta_revisions + 1,
    'status', v_order.status
  );
end $$;

-- ---------------------------------------------------------------------------
-- get_order_tracking: extended with the estimate and review state.
-- ---------------------------------------------------------------------------
create or replace function public.get_order_tracking(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_order record;
  v_rest  record;
  v_table record;
  v_hashed text;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  -- 011 stores tracking tokens as digests, so look up the digest.
  v_hashed := public.mp_sha256(p_token);

  select * into v_order from public.orders
   where tracking_token = v_hashed or tracking_token = p_token
   limit 1;
  if v_order.id is null then
    return null;
  end if;

  select * into v_rest from public.restaurants where id = v_order.restaurant_id;
  select * into v_table from public.dining_tables where id = v_order.table_id;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'placed_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'revision', v_order.revision,
    'accepted_at', v_order.accepted_at,
    'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at,
    'served_at', v_order.served_at,
    'rejected_at', v_order.rejected_at,
    'rejection_reason', v_order.rejection_reason,
    -- The estimate, kept explicitly distinct from the status.
    'eta_minutes', v_order.eta_minutes,
    'eta_set_at', v_order.eta_set_at,
    'eta_revisions', v_order.eta_revisions,
    'subtotal', v_order.subtotal,
    'tax_amount', v_order.tax_amount,
    'service_charge', v_order.service_charge,
    'total', v_order.total,
    'currency', v_order.currency,
    'note', v_order.note,
    'customer_name', v_order.customer_name,
    'table_label', v_table.label,
    'restaurant', jsonb_build_object(
      'name', v_rest.name, 'slug', v_rest.slug,
      'phone', v_rest.phone, 'logo_path', v_rest.logo_path,
      'address', v_rest.address, 'city', v_rest.city
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'menu_item_id', oi.menu_item_id,
        'name', oi.name_snapshot, 'quantity', oi.quantity,
        'unit_price', oi.unit_price, 'line_total', oi.line_total,
        'note', oi.note, 'prep_status', oi.prep_status
      ) order by oi.sort_order)
      from public.order_items oi where oi.order_id = v_order.id
    ), '[]'::jsonb),
    -- What this guest may still review, computed here so the page does not
    -- have to guess at eligibility.
    'reviews', jsonb_build_object(
      'visited', v_order.status = 'served',
      'item_reviewed', coalesce((
        select jsonb_agg(r.menu_item_id)
        from public.order_reviews r
        where r.order_id = v_order.id and r.target_kind = 'item'
      ), '[]'::jsonb),
      'restaurant_reviewed', exists (
        select 1 from public.order_reviews r
        where r.order_id = v_order.id and r.target_kind = 'restaurant'
      )
    ),
    'service_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', s.kind, 'status', s.status, 'created_at', s.created_at
      ) order by s.created_at desc)
      from public.service_requests s where s.order_id = v_order.id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- submit_review: the only way a review enters the system.
--
-- The caller is a guest with no session, so ownership is proven the same way
-- the tracker proves it: by holding the order's tracking token. Everything
-- else is checked server-side:
--
--   * the order exists and the token matches,
--   * the order is `served` (the brief: reviews come from completed visits),
--   * an item review names a dish that was actually on that order,
--   * the dish has not already been reviewed on this order,
--   * the visit has not already been reviewed,
--   * the rating is 1–5 and the free text is bounded.
-- ---------------------------------------------------------------------------
create or replace function public.submit_review(
  p_token        text,
  p_kind         text,
  p_menu_item_id uuid    default null,
  p_rating       integer default null,
  p_comment      text    default null,
  p_taste        integer default null,
  p_quality      integer default null,
  p_presentation integer default null,
  p_service      integer default null,
  p_staff        integer default null,
  p_cleanliness  integer default null,
  p_photo_path   text    default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_order public.orders%rowtype;
  v_id    uuid;
  v_name  text;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'MP:INVALID_TRACKING' using errcode = '42501';
  end if;
  if p_kind not in ('item', 'restaurant') then
    raise exception 'MP:INVALID_REVIEW_KIND' using errcode = '22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'MP:INVALID_RATING' using errcode = '22023';
  end if;
  if p_comment is not null and length(p_comment) > 2000 then
    raise exception 'MP:REVIEW_TOO_LONG' using errcode = '22023';
  end if;

  select * into v_order from public.orders
   where tracking_token = public.mp_sha256(p_token) or tracking_token = p_token
   limit 1;
  if v_order.id is null then
    raise exception 'MP:INVALID_TRACKING' using errcode = '42501';
  end if;

  -- The brief is explicit: served orders only. An order that is merely ready is
  -- not yet an experience the guest has had.
  if v_order.status <> 'served' then
    raise exception 'MP:REVIEW_NOT_ELIGIBLE:%', v_order.status using errcode = 'P0001';
  end if;

  if p_kind = 'item' then
    if p_menu_item_id is null then
      raise exception 'MP:INVALID_ITEM' using errcode = '22023';
    end if;
    -- The dish must have been on this order. This is what stops a guest
    -- reviewing a dish they never bought.
    select oi.name_snapshot into v_name
      from public.order_items oi
     where oi.order_id = v_order.id and oi.menu_item_id = p_menu_item_id
     limit 1;
    if v_name is null then
      raise exception 'MP:ITEM_NOT_ON_ORDER' using errcode = '42501';
    end if;

    insert into public.order_reviews
      (restaurant_id, order_id, target_kind, menu_item_id, rating, comment,
       score_taste, score_quality, score_presentation, photo_path)
    values
      (v_order.restaurant_id, v_order.id, 'item', p_menu_item_id, p_rating,
       nullif(btrim(coalesce(p_comment, '')), ''),
       p_taste, p_quality, p_presentation,
       nullif(btrim(coalesce(p_photo_path, '')), ''))
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      raise exception 'MP:REVIEW_DUPLICATE_ITEM' using errcode = '23505';
    end if;
  else
    insert into public.order_reviews
      (restaurant_id, order_id, target_kind, rating, comment,
       score_service, score_staff, score_cleanliness, photo_path)
    values
      (v_order.restaurant_id, v_order.id, 'restaurant', p_rating,
       nullif(btrim(coalesce(p_comment, '')), ''),
       p_service, p_staff, p_cleanliness,
       nullif(btrim(coalesce(p_photo_path, '')), ''))
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      raise exception 'MP:REVIEW_DUPLICATE_RESTAURANT' using errcode = '23505';
    end if;
    v_name := null;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'kind', p_kind,
    'menu_item_id', p_menu_item_id,
    'item_name', v_name,
    'rating', p_rating,
    'order_number', v_order.order_number
  );
end $$;

-- ---------------------------------------------------------------------------
-- Owner reply to a review. One reply, editable in place.
-- ---------------------------------------------------------------------------
create or replace function public.reply_to_review(
  p_review_id uuid,
  p_body      text
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_uid  uuid := public.mp_uid();
  v_rev  public.order_reviews%rowtype;
  v_role text;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'MP:NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 1000 then
    raise exception 'MP:INVALID_REPLY' using errcode = '22023';
  end if;

  select * into v_rev from public.order_reviews where id = p_review_id;
  if v_rev.id is null then
    raise exception 'MP:REVIEW_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.mp_role(v_rev.restaurant_id);
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.review_replies (review_id, restaurant_id, body, created_by)
  values (v_rev.id, v_rev.restaurant_id, btrim(p_body), v_uid)
  on conflict (review_id) do update
    set body = excluded.body, updated_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'review_id', v_rev.id, 'body', btrim(p_body));
end $$;

-- ---------------------------------------------------------------------------
-- set_review_hidden: moderation. Hides, never deletes.
-- ---------------------------------------------------------------------------
create or replace function public.set_review_hidden(
  p_review_id uuid,
  p_hidden    boolean,
  p_reason    text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_uid  uuid := public.mp_uid();
  v_rev  public.order_reviews%rowtype;
  v_role text;
begin
  if v_uid is null then
    raise exception 'MP:NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_rev from public.order_reviews where id = p_review_id for update;
  if v_rev.id is null then
    raise exception 'MP:REVIEW_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.mp_role(v_rev.restaurant_id);
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  update public.order_reviews set
    is_hidden     = coalesce(p_hidden, false),
    hidden_reason = case when coalesce(p_hidden, false)
                      then nullif(btrim(coalesce(p_reason, '')), '') else null end,
    hidden_by     = case when coalesce(p_hidden, false) then v_uid else null end,
    hidden_at     = case when coalesce(p_hidden, false) then now() else null end
  where id = v_rev.id;

  return jsonb_build_object('id', v_rev.id, 'is_hidden', coalesce(p_hidden, false));
end $$;

-- ---------------------------------------------------------------------------
-- request_service: guest raises a request against their own order.
--
-- Duplicate protection is a partial unique index rather than a timer: one open
-- request of each kind per order at a time. A guest can ask for water, and can
-- ask again once it has been completed, but cannot stack five.
-- ---------------------------------------------------------------------------
create unique index if not exists service_requests_one_open_per_kind
  on public.service_requests (order_id, kind)
  where status in ('pending', 'acknowledged');

create or replace function public.request_service(
  p_token text,
  p_kind  text,
  p_body  text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_order public.orders%rowtype;
  v_id    uuid;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'MP:INVALID_TRACKING' using errcode = '42501';
  end if;
  if p_kind not in ('waiter', 'water', 'plate', 'bill', 'other') then
    raise exception 'MP:INVALID_REQUEST_KIND' using errcode = '22023';
  end if;

  select * into v_order from public.orders
   where tracking_token = public.mp_sha256(p_token) or tracking_token = p_token
   limit 1;
  if v_order.id is null then
    raise exception 'MP:INVALID_TRACKING' using errcode = '42501';
  end if;
  if v_order.status in ('rejected', 'cancelled') then
    raise exception 'MP:ORDER_CLOSED' using errcode = 'P0001';
  end if;

  insert into public.service_requests
    (restaurant_id, table_id, order_id, kind, body, tracking_token_sha256)
  values
    (v_order.restaurant_id, v_order.table_id, v_order.id, p_kind,
     nullif(btrim(coalesce(p_body, '')), ''), public.mp_sha256(p_token))
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'MP:REQUEST_ALREADY_OPEN' using errcode = '23505';
  end if;

  return jsonb_build_object('id', v_id, 'kind', p_kind, 'status', 'pending');
end $$;

-- ---------------------------------------------------------------------------
-- Service board for staff: open requests first, oldest first.
-- ---------------------------------------------------------------------------
create or replace function public.service_board(p_restaurant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.mp_is_member(p_restaurant_id, array['owner', 'manager', 'waiter', 'kitchen']) then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(x order by x ->> 'created_at') from (
      select jsonb_build_object(
        'id', s.id,
        'kind', s.kind,
        'body', s.body,
        'status', s.status,
        'table_label', d.label,
        'order_number', o.order_number,
        'created_at', s.created_at,
        'acknowledged_at', s.acknowledged_at,
        'completed_at', s.completed_at
      ) as x
      from public.service_requests s
      left join public.dining_tables d on d.id = s.table_id
      left join public.orders o on o.id = s.order_id
      where s.restaurant_id = p_restaurant_id
        and s.created_at > now() - interval '12 hours'
    ) t
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- set_service_status: acknowledge / complete / cancel, with role checks.
-- ---------------------------------------------------------------------------
create or replace function public.set_service_status(
  p_request_id uuid,
  p_status     text
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_uid  uuid := public.mp_uid();
  v_req  public.service_requests%rowtype;
  v_role text;
begin
  if v_uid is null then
    raise exception 'MP:NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_status not in ('acknowledged', 'completed', 'cancelled') then
    raise exception 'MP:INVALID_STATUS' using errcode = '22023';
  end if;

  select * into v_req from public.service_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'MP:REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.mp_role(v_req.restaurant_id);
  if v_role is null or v_role not in ('owner', 'manager', 'waiter', 'kitchen') then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;
  if v_req.status in ('completed', 'cancelled') then
    raise exception 'MP:REQUEST_CLOSED:%', v_req.status using errcode = 'P0001';
  end if;

  update public.service_requests set
    status = p_status,
    acknowledged_by = case when p_status = 'acknowledged' then v_uid else acknowledged_by end,
    acknowledged_at = case when p_status = 'acknowledged' then now() else acknowledged_at end,
    completed_by = case when p_status = 'completed' then v_uid else completed_by end,
    completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = v_req.id;

  return jsonb_build_object('id', v_req.id, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------------
-- set_item_prep: tick a single line off in the kitchen.
-- ---------------------------------------------------------------------------
create or replace function public.set_item_prep(
  p_item_id uuid,
  p_status  text
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_uid  uuid := public.mp_uid();
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_role text;
begin
  if v_uid is null then
    raise exception 'MP:NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_status not in ('queued', 'preparing', 'done') then
    raise exception 'MP:INVALID_STATUS' using errcode = '22023';
  end if;

  select * into v_item from public.order_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'MP:ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders where id = v_item.order_id;

  v_role := public.mp_role(v_item.restaurant_id);
  if v_role is null or v_role not in ('owner', 'manager', 'kitchen') then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  -- Lines belong to an order that is being cooked. Ticking a pending order's
  -- lines would let the kitchen work around the owner's approval.
  if v_order.status not in ('accepted', 'preparing') then
    raise exception 'MP:PREP_NOT_ALLOWED:%', v_order.status using errcode = 'P0001';
  end if;

  update public.order_items set prep_status = p_status, prep_updated_at = now()
   where id = v_item.id;

  update public.orders set revision = revision + 1, updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('id', v_item.id, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------------
-- Review analytics for the owner dashboard.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_reviews(p_restaurant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_staff boolean;
begin
  v_staff := public.mp_is_member(p_restaurant_id);

  return jsonb_build_object(
    'restaurant', (
      select jsonb_build_object(
        'average', coalesce(round(avg(r.rating)::numeric, 2), 0),
        'count', count(*),
        'service', coalesce(round(avg(r.score_service)::numeric, 2), 0),
        'staff', coalesce(round(avg(r.score_staff)::numeric, 2), 0),
        'cleanliness', coalesce(round(avg(r.score_cleanliness)::numeric, 2), 0),
        'five_star', count(*) filter (where r.rating = 5),
        'low_star', count(*) filter (where r.rating <= 2)
      )
      from public.order_reviews r
      where r.restaurant_id = p_restaurant_id and r.target_kind = 'restaurant'
        and (v_staff or not r.is_hidden)
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'menu_item_id', x.menu_item_id,
        'name', x.name,
        'average', x.average,
        'count', x.count
      ) order by x.count desc, x.average desc)
      from (
        select r.menu_item_id, mi.name as name,
               round(avg(r.rating)::numeric, 2) as average,
               count(*) as count
        from public.order_reviews r
        join public.menu_items mi on mi.id = r.menu_item_id
        where r.restaurant_id = p_restaurant_id and r.target_kind = 'item'
          and (v_staff or not r.is_hidden)
        group by r.menu_item_id, mi.name
      ) x
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', y.id,
        'kind', y.target_kind,
        'rating', y.rating,
        'comment', y.comment,
        'item_name', y.item_name,
        'order_number', y.order_number,
        'table_label', y.table_label,
        'guest_name', y.guest_name,
        'is_hidden', y.is_hidden,
        'hidden_reason', y.hidden_reason,
        'created_at', y.created_at,
        'scores', y.scores,
        'reply', y.reply,
        'reply_at', y.reply_at
      ) order by y.created_at desc)
      from (
        select r.*, mi.name as item_name, o.order_number, o.customer_name as guest_name,
               d.label as table_label,
               jsonb_strip_nulls(jsonb_build_object(
                 'taste', r.score_taste, 'quality', r.score_quality,
                 'presentation', r.score_presentation, 'service', r.score_service,
                 'staff', r.score_staff, 'cleanliness', r.score_cleanliness
               )) as scores,
               rr.body as reply, rr.updated_at as reply_at
        from public.order_reviews r
        left join public.menu_items mi on mi.id = r.menu_item_id
        left join public.orders o on o.id = r.order_id
        left join public.dining_tables d on d.id = o.table_id
        left join public.review_replies rr on rr.review_id = r.id
        where r.restaurant_id = p_restaurant_id
          and (v_staff or not r.is_hidden)
        order by r.created_at desc
        limit 50
      ) y
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants. Guests call exactly four things: tracking, review, request, menu.
-- ---------------------------------------------------------------------------
grant execute on function public.set_order_eta(uuid, integer) to authenticated;
grant execute on function public.get_order_tracking(text) to anon, authenticated;
grant execute on function public.submit_review(text, text, uuid, integer, text, integer, integer, integer, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.reply_to_review(uuid, text) to authenticated;
grant execute on function public.set_review_hidden(uuid, boolean, text) to authenticated;
grant execute on function public.request_service(text, text, text) to anon, authenticated;
grant execute on function public.service_board(uuid) to authenticated;
grant execute on function public.set_service_status(uuid, text) to authenticated;
grant execute on function public.set_item_prep(uuid, text) to authenticated;
grant execute on function public.restaurant_reviews(uuid) to anon, authenticated;
