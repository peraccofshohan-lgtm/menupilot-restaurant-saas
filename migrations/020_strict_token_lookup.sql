-- ---------------------------------------------------------------------------
-- 020 · Store lookup by digest only
--
-- 015 wrote the guest-facing functions as
--     where tracking_token = mp_sha256(p_token) or tracking_token = p_token
-- to tolerate data from before 011 hashed tracking tokens. That second clause
-- is a security regression: it means whoever presents the *stored* digest —
-- a value that leaks from a backup, a log or a support screenshot — is treated
-- as the guest. The audit suite caught it.
--
-- 011 already retired the plaintext tokens and hashes on insert, so the
-- digest is the only form that can exist. Drop the fallback from all four
-- guest-facing functions and keep the lookup strict.
-- ---------------------------------------------------------------------------

create or replace function public.get_order_tracking(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_order record;
  v_rest  record;
  v_table record;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into v_order from public.orders
   where tracking_token = public.mp_sha256(p_token)
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
   where tracking_token = public.mp_sha256(p_token)
   limit 1;
  if v_order.id is null then
    raise exception 'MP:INVALID_TRACKING' using errcode = '42501';
  end if;

  if v_order.status <> 'served' then
    raise exception 'MP:REVIEW_NOT_ELIGIBLE:%', v_order.status using errcode = 'P0001';
  end if;

  if p_kind = 'item' then
    if p_menu_item_id is null then
      raise exception 'MP:INVALID_ITEM' using errcode = '22023';
    end if;
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
   where tracking_token = public.mp_sha256(p_token)
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

grant execute on function public.get_order_tracking(text) to anon, authenticated;
grant execute on function public.submit_review(text, text, uuid, integer, text, integer, integer, integer, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.request_service(text, text, text) to anon, authenticated;
