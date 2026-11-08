-- ============================================================================
-- MenuPilot · Migration 003 · Secure business functions
-- ----------------------------------------------------------------------------
-- Everything that must be atomic, cross-tenant-safe or customer-facing without
-- a login lives here. These functions are SECURITY DEFINER and perform their
-- own authorization, so they never rely on the caller having table access.
--
-- Public (anon) surface:
--   menu_for_qr(qr_token)           -> resolves table + public menu, read-only
--   create_order(...)               -> validates QR, prices, availability
--   get_order_tracking(token)       -> status timeline for the guest holding it
--
-- Staff surface (authenticated):
--   transition_order(...)           -> lifecycle state machine + RBAC
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Cryptographic helpers (built on Postgres' CSPRNG-backed gen_random_uuid)
-- ---------------------------------------------------------------------------
create or replace function public.mp_random_hex(p_bytes integer)
returns text
language plpgsql volatile as $$
declare
  result text := '';
begin
  while length(coalesce(result, '')) < p_bytes * 2 loop
    result := coalesce(result, '') || replace(gen_random_uuid()::text, '-', '');
  end loop;
  return substr(result, 1, p_bytes * 2);
end $$;

create or replace function public.mp_sha256(p_value text)
returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_value, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- Order numbering: readable, collision-free, monotonic.
-- ---------------------------------------------------------------------------
create sequence if not exists public.order_number_seq start 1000;

-- ---------------------------------------------------------------------------
-- menu_for_qr: the ONLY way a guest learns which restaurant/table they are at.
-- Returns null for unknown, revoked, or inactive targets — never leaks why.
-- ---------------------------------------------------------------------------
create or replace function public.menu_for_qr(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_qr       record;
  v_rest     record;
  v_settings record;
  v_table    record;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select q.* into v_qr
  from public.qr_tokens q
  where q.token_sha256 = public.mp_sha256(p_token) and q.is_active and q.revoked_at is null
  limit 1;

  if v_qr.id is null then
    return null;
  end if;

  select * into v_rest from public.restaurants where id = v_qr.restaurant_id;
  if v_rest.id is null or v_rest.status <> 'active' then
    return null;
  end if;

  select * into v_table from public.dining_tables where id = v_qr.table_id;
  if v_table.id is null or not v_table.is_active then
    return null;
  end if;

  select * into v_settings from public.restaurant_settings where restaurant_id = v_rest.id;

  return jsonb_build_object(
    'table', jsonb_build_object('id', v_table.id, 'label', v_table.label, 'zone', v_table.zone),
    'restaurant', jsonb_build_object(
      'id', v_rest.id, 'name', v_rest.name, 'slug', v_rest.slug,
      'tagline', v_rest.tagline, 'description', v_rest.description,
      'logo_path', v_rest.logo_path, 'cover_path', v_rest.cover_path,
      'currency', v_rest.currency, 'time_zone', v_rest.time_zone,
      'phone', v_rest.phone, 'address', v_rest.address, 'city', v_rest.city
    ),
    'settings', jsonb_build_object(
      'tax_rate', coalesce(v_settings.tax_rate, 0),
      'tax_label', coalesce(v_settings.tax_label, 'VAT'),
      'service_charge_rate', coalesce(v_settings.service_charge_rate, 0),
      'service_charge_label', coalesce(v_settings.service_charge_label, 'Service charge'),
      'prices_include_tax', coalesce(v_settings.prices_include_tax, false),
      'accept_orders', coalesce(v_settings.accept_orders, true),
      'require_customer_name', coalesce(v_settings.require_customer_name, false)
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description, 'sort_order', c.sort_order
      ) order by c.sort_order, c.name)
      from public.categories c
      where c.restaurant_id = v_rest.id and c.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mi.id, 'category_id', mi.category_id, 'name', mi.name, 'slug', mi.slug,
        'description', mi.description, 'price', mi.price, 'image_path', mi.image_path,
        'is_available', mi.is_available, 'is_featured', mi.is_featured,
        'sort_order', mi.sort_order, 'prep_minutes', mi.prep_minutes
      ) order by mi.sort_order, mi.name)
      from public.menu_items mi
      join public.categories c on c.id = mi.category_id
      where mi.restaurant_id = v_rest.id and not mi.is_archived and c.is_active
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- create_order: server-side pricing, availability, idempotency, atomicity.
-- Client-supplied prices, totals, restaurant ids and table ids are ignored.
-- ---------------------------------------------------------------------------
create or replace function public.create_order(
  p_qr_token        text,
  p_items           jsonb,
  p_customer_name   text default null,
  p_customer_phone  text default null,
  p_note            text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_qr         record;
  v_rest       record;
  v_settings   record;
  v_table      record;
  v_existing   public.orders%rowtype;
  v_item       record;
  v_line       record;
  v_subtotal   numeric(12,2) := 0;
  v_tax        numeric(12,2) := 0;
  v_service    numeric(12,2) := 0;
  v_total      numeric(12,2) := 0;
  v_item_count integer := 0;
  v_customer   uuid;
  v_order      uuid;
  v_number     text;
  v_tracking   text;
  v_seen       uuid[] := '{}';
  v_status     text;
  v_biz_at     timestamptz;
begin
  if p_qr_token is null or length(p_qr_token) < 16 then
    raise exception 'MP:INVALID_QR' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'MP:EMPTY_CART' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'MP:CART_TOO_LARGE' using errcode = 'P0001';
  end if;

  select q.* into v_qr
  from public.qr_tokens q
  where q.token_sha256 = public.mp_sha256(p_qr_token) and q.is_active and q.revoked_at is null
  limit 1;
  if v_qr.id is null then
    raise exception 'MP:INVALID_QR' using errcode = 'P0001';
  end if;

  select * into v_rest from public.restaurants where id = v_qr.restaurant_id;
  if v_rest.id is null or v_rest.status <> 'active' then
    raise exception 'MP:RESTAURANT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_table from public.dining_tables where id = v_qr.table_id;
  if v_table.id is null or not v_table.is_active then
    raise exception 'MP:TABLE_INACTIVE' using errcode = 'P0001';
  end if;

  select * into v_settings from public.restaurant_settings where restaurant_id = v_rest.id;
  if v_settings.restaurant_id is null or not v_settings.accept_orders then
    raise exception 'MP:ORDERING_DISABLED' using errcode = 'P0001';
  end if;

  -- Idempotency: replaying the same submission returns the original order.
  if p_idempotency_key is not null and length(p_idempotency_key) >= 8 then
    select * into v_existing from public.orders
    where restaurant_id = v_rest.id and idempotency_key = p_idempotency_key
    limit 1;
    if v_existing.id is not null then
      return jsonb_build_object(
        'order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'tracking_token', v_existing.tracking_token,
        'status', v_existing.status,
        'subtotal', v_existing.subtotal,
        'tax_amount', v_existing.tax_amount,
        'service_charge', v_existing.service_charge,
        'total', v_existing.total,
        'currency', v_existing.currency,
        'item_count', v_existing.item_count,
        'table_label', v_table.label,
        'created_at', v_existing.created_at,
        'idempotent_replay', true
      );
    end if;
  end if;

  -- ---- Pass 1: validate + price -------------------------------------------
  for v_line in
    select
      (elem ->> 'menu_item_id')::uuid as menu_item_id,
      greatest(1, least(99, coalesce((elem ->> 'quantity')::int, 1))) as quantity
    from jsonb_array_elements(p_items) with ordinality as t(elem, ord)
  loop
    if v_line.menu_item_id is null then
      raise exception 'MP:INVALID_ITEM' using errcode = 'P0001';
    end if;
    if v_line.menu_item_id = any (v_seen) then
      raise exception 'MP:DUPLICATE_ITEM' using errcode = 'P0001';
    end if;
    v_seen := array_append(v_seen, v_line.menu_item_id);

    select mi.id, mi.price into v_item
    from public.menu_items mi
    join public.categories c on c.id = mi.category_id
    where mi.id = v_line.menu_item_id
      and mi.restaurant_id = v_rest.id
      and not mi.is_archived
      and mi.is_available
      and c.is_active;
    if v_item.id is null then
      raise exception 'MP:ITEM_UNAVAILABLE:%', v_line.menu_item_id using errcode = 'P0001';
    end if;

    v_subtotal := v_subtotal + (v_item.price * v_line.quantity);
    v_item_count := v_item_count + v_line.quantity;
  end loop;

  -- Single rounding point, straight from restaurant configuration.
  v_service := round(v_subtotal * coalesce(v_settings.service_charge_rate, 0) / 100.0, 2);
  v_tax := round(v_subtotal * coalesce(v_settings.tax_rate, 0) / 100.0, 2);
  v_total := v_subtotal + v_service + v_tax;

  v_biz_at := now();
  v_number := coalesce(nullif(v_settings.order_prefix, ''), 'MP') || '-' ||
              to_char(v_biz_at at time zone coalesce(v_rest.time_zone, 'UTC'), 'YYMMDD') || '-' ||
              lpad(nextval('public.order_number_seq')::text, 4, '0');
  v_tracking := public.mp_random_hex(24);
  v_status := case when v_settings.auto_accept_orders then 'accepted' else 'pending' end;

  -- ---- Customer record (per tenant, deduplicated on phone) ----------------
  if (p_customer_name is not null and btrim(p_customer_name) <> '')
     or (p_customer_phone is not null and btrim(p_customer_phone) <> '') then
    if p_customer_phone is not null and btrim(p_customer_phone) <> '' then
      select id into v_customer from public.customers
      where restaurant_id = v_rest.id and phone = btrim(p_customer_phone) limit 1;
    end if;
    if v_customer is null then
      insert into public.customers (restaurant_id, name, phone, first_order_at)
      values (v_rest.id, nullif(btrim(coalesce(p_customer_name, '')), ''), nullif(btrim(coalesce(p_customer_phone, '')), ''), now())
      returning id into v_customer;
    else
      update public.customers set
        name = coalesce(nullif(btrim(coalesce(p_customer_name, '')), ''), name)
      where id = v_customer;
    end if;
  end if;

  -- ---- Order -------------------------------------------------------------
  insert into public.orders (
    restaurant_id, table_id, qr_token_id, customer_id, order_number, status,
    subtotal, tax_amount, service_charge, total, currency, item_count,
    customer_name, customer_phone, note, source, tracking_token, idempotency_key,
    accepted_at
  ) values (
    v_rest.id, v_table.id, v_qr.id, v_customer, v_number, v_status,
    v_subtotal, v_tax, v_service, v_total, v_rest.currency, v_item_count,
    nullif(btrim(coalesce(p_customer_name, '')), ''),
    nullif(btrim(coalesce(p_customer_phone, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    'qr', v_tracking,
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    case when v_status = 'accepted' then now() else null end
  ) returning id into v_order;

  -- ---- Pass 2: persist lines with snapshotted price ----------------------
  for v_line in
    select
      (elem ->> 'menu_item_id')::uuid as menu_item_id,
      greatest(1, least(99, coalesce((elem ->> 'quantity')::int, 1))) as quantity,
      nullif(btrim(coalesce(elem ->> 'note', '')), '') as note,
      (ord - 1) as sort_order
    from jsonb_array_elements(p_items) with ordinality as t(elem, ord)
  loop
    select mi.id, mi.name, mi.price into v_item
    from public.menu_items mi
    where mi.id = v_line.menu_item_id and mi.restaurant_id = v_rest.id;

    insert into public.order_items (
      order_id, restaurant_id, menu_item_id, name_snapshot, unit_price,
      quantity, line_total, note, sort_order
    ) values (
      v_order, v_rest.id, v_item.id, v_item.name, v_item.price,
      v_line.quantity, v_item.price * v_line.quantity, v_line.note, v_line.sort_order
    );
  end loop;

  insert into public.order_status_history (order_id, restaurant_id, from_status, to_status, note)
  values (v_order, v_rest.id, null, 'pending', 'Order placed by guest via QR'),
         (v_order, v_rest.id, 'pending', v_status, 'Auto-accepted by restaurant settings')
  ;

  -- Auto-accepted orders should not record a pending->accepted history row.
  if v_status = 'pending' then
    delete from public.order_status_history
    where order_id = v_order and to_status = 'pending' and from_status = 'pending';
  end if;

  if v_customer is not null then
    update public.customers set
      total_orders = total_orders + 1,
      total_spend = total_spend + v_total,
      last_order_at = now(),
      first_order_at = coalesce(first_order_at, now())
    where id = v_customer;
  end if;

  return jsonb_build_object(
    'order_id', v_order,
    'order_number', v_number,
    'tracking_token', v_tracking,
    'status', v_status,
    'subtotal', v_subtotal,
    'tax_amount', v_tax,
    'service_charge', v_service,
    'total', v_total,
    'currency', v_rest.currency,
    'item_count', v_item_count,
    'table_label', v_table.label,
    'created_at', v_biz_at,
    'idempotent_replay', false
  );
end $$;

-- ---------------------------------------------------------------------------
-- get_order_tracking: possession of the 48-char token is the credential.
-- Returns only customer-safe fields — no internal ids, no tenant data.
-- ---------------------------------------------------------------------------
create or replace function public.get_order_tracking(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_order record;
  v_rest record;
  v_table record;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into v_order from public.orders where tracking_token = p_token limit 1;
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
    'accepted_at', v_order.accepted_at,
    'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at,
    'served_at', v_order.served_at,
    'rejected_at', v_order.rejected_at,
    'rejection_reason', v_order.rejection_reason,
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
      'phone', v_rest.phone, 'logo_path', v_rest.logo_path
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.name_snapshot, 'quantity', oi.quantity,
        'unit_price', oi.unit_price, 'line_total', oi.line_total, 'note', oi.note
      ) order by oi.sort_order)
      from public.order_items oi where oi.order_id = v_order.id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- transition_order: the single write path for the lifecycle.
-- ---------------------------------------------------------------------------
create or replace function public.transition_order(
  p_order_id  uuid,
  p_next      text,
  p_reason    text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_order   public.orders%rowtype;
  v_uid     uuid := public.mp_uid();
  v_role    text;
  v_allowed text[];
  v_now     timestamptz := now();
begin
  if v_uid is null then
    raise exception 'MP:NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'MP:ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.mp_role(v_order.restaurant_id);
  if v_role is null then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  -- permitted transitions per current status and acting role
  case v_order.status
    when 'pending' then
      if p_next in ('accepted', 'rejected') then
        v_allowed := array['owner', 'manager'];
      end if;
    when 'accepted' then
      if p_next = 'preparing' then v_allowed := array['owner', 'manager', 'kitchen']; end if;
      if p_next = 'cancelled' then v_allowed := array['owner', 'manager']; end if;
    when 'preparing' then
      if p_next = 'ready' then v_allowed := array['owner', 'manager', 'kitchen']; end if;
      if p_next = 'cancelled' then v_allowed := array['owner', 'manager']; end if;
    when 'ready' then
      if p_next = 'served' then v_allowed := array['owner', 'manager', 'kitchen', 'waiter']; end if;
      if p_next = 'cancelled' then v_allowed := array['owner', 'manager']; end if;
    else
      v_allowed := null;
  end case;

  if v_allowed is null then
    raise exception 'MP:INVALID_TRANSITION:%->%', v_order.status, p_next using errcode = 'P0001';
  end if;
  if not (v_role = any (v_allowed)) then
    raise exception 'MP:FORBIDDEN_TRANSITION:%->%', v_role, p_next using errcode = '42501';
  end if;

  update public.orders set
    status = p_next,
    accepted_at  = case when p_next = 'accepted'  then v_now else accepted_at end,
    accepted_by  = case when p_next = 'accepted'  then v_uid else accepted_by end,
    preparing_at = case when p_next = 'preparing' then v_now else preparing_at end,
    ready_at     = case when p_next = 'ready'     then v_now else ready_at end,
    served_at    = case when p_next = 'served'    then v_now else served_at end,
    rejected_at  = case when p_next = 'rejected'  then v_now else rejected_at end,
    rejected_by  = case when p_next = 'rejected'  then v_uid else rejected_by end,
    cancelled_at = case when p_next = 'cancelled' then v_now else cancelled_at end,
    rejection_reason = case when p_next = 'rejected'
      then nullif(btrim(coalesce(p_reason, '')), '') else rejection_reason end
  where id = v_order.id;

  insert into public.order_status_history (order_id, restaurant_id, from_status, to_status, changed_by, actor_role, note)
  values (v_order.id, v_order.restaurant_id, v_order.status, p_next, v_uid, v_role, nullif(btrim(coalesce(p_reason, '')), ''));

  return jsonb_build_object('order_id', v_order.id, 'status', p_next, 'previous_status', v_order.status);
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard aggregates — one round trip, time-zone aware business day.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_overview(p_restaurant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_tz    text;
  v_start timestamptz;
  v_today date;
  v_out   jsonb;
begin
  if not public.mp_is_member(p_restaurant_id) then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(time_zone, 'UTC') into v_tz from public.restaurants where id = p_restaurant_id;
  v_today := (now() at time zone v_tz)::date;
  v_start := (v_today::timestamp) at time zone v_tz;

  select jsonb_build_object(
    'today', (
      select jsonb_build_object(
        'orders', count(*) filter (where status <> 'cancelled'),
        'pending', count(*) filter (where status = 'pending'),
        'accepted', count(*) filter (where status = 'accepted'),
        'preparing', count(*) filter (where status = 'preparing'),
        'ready', count(*) filter (where status = 'ready'),
        'served', count(*) filter (where status = 'served'),
        'rejected', count(*) filter (where status = 'rejected'),
        'revenue', coalesce(sum(total) filter (where status in ('served', 'ready')), 0),
        'avg_order_value', coalesce(round(avg(total) filter (where status in ('served', 'ready')), 2), 0)
      )
      from public.orders
      where restaurant_id = p_restaurant_id and created_at >= v_start
    ),
    'pending_orders', coalesce((
      select count(*) from public.orders
      where restaurant_id = p_restaurant_id and status = 'pending'
    ), 0),
    'active_kitchen', coalesce((
      select count(*) from public.orders
      where restaurant_id = p_restaurant_id and status in ('accepted', 'preparing')
    ), 0),
    'table_count', coalesce((
      select count(*) from public.dining_tables where restaurant_id = p_restaurant_id and is_active
    ), 0),
    'menu_item_count', coalesce((
      select count(*) from public.menu_items where restaurant_id = p_restaurant_id and not is_archived
    ), 0),
    'unavailable_item_count', coalesce((
      select count(*) from public.menu_items where restaurant_id = p_restaurant_id and not is_archived and not is_available
    ), 0),
    'popular_items', coalesce((
      select jsonb_agg(t) from (
        select oi.name_snapshot as name, sum(oi.quantity)::int as quantity,
               sum(oi.line_total) as revenue
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where oi.restaurant_id = p_restaurant_id
          and o.status in ('served', 'ready', 'preparing', 'accepted')
          and o.created_at >= v_start - interval '30 days'
        group by oi.name_snapshot
        order by sum(oi.quantity) desc
        limit 5
      ) t
    ), '[]'::jsonb),
    'recent_orders', coalesce((
      select jsonb_agg(t) from (
        select o.id, o.order_number, o.status, o.total, o.currency, o.created_at,
               o.item_count, d.label as table_label, o.customer_name
        from public.orders o
        left join public.dining_tables d on d.id = o.table_id
        where o.restaurant_id = p_restaurant_id
        order by o.created_at desc
        limit 6
      ) t
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(t) from (
        select d.id, d.label, d.zone, d.is_active,
          (select count(*) from public.orders o
            where o.table_id = d.id and o.status in ('pending', 'accepted', 'preparing', 'ready')) as open_orders
        from public.dining_tables d
        where d.restaurant_id = p_restaurant_id and d.is_active
        order by d.sort_order, d.label
        limit 24
      ) t
    ), '[]'::jsonb)
  ) into v_out;

  return v_out || jsonb_build_object('business_date', v_today, 'time_zone', v_tz);
end $$;

-- ---------------------------------------------------------------------------
-- Analytics series — revenue counts only realised orders (ready|served).
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_analytics(
  p_restaurant_id uuid,
  p_from date,
  p_to   date
)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_tz    text;
  v_from  timestamptz;
  v_to    timestamptz;
begin
  if not public.mp_is_member(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'MP:INVALID_RANGE' using errcode = 'P0001';
  end if;

  select coalesce(time_zone, 'UTC') into v_tz from public.restaurants where id = p_restaurant_id;
  v_from := (p_from::timestamp) at time zone v_tz;
  v_to   := ((p_to + 1)::timestamp) at time zone v_tz;

  return jsonb_build_object(
    'time_zone', v_tz,
    'from', p_from,
    'to', p_to,
    'totals', (
      select jsonb_build_object(
        'orders', count(*),
        'completed_orders', count(*) filter (where status in ('ready', 'served')),
        'rejected_orders', count(*) filter (where status = 'rejected'),
        'cancelled_orders', count(*) filter (where status = 'cancelled'),
        'revenue', coalesce(sum(total) filter (where status in ('ready', 'served')), 0),
        'avg_order_value', coalesce(round(avg(total) filter (where status in ('ready', 'served')), 2), 0),
        'items_sold', coalesce(sum(item_count) filter (where status in ('ready', 'served')), 0)
      ) from public.orders
      where restaurant_id = p_restaurant_id and created_at >= v_from and created_at < v_to
    ),
    'daily', coalesce((
      select jsonb_agg(t) from (
        select d::date as day,
          coalesce(count(o.id), 0)::int as orders,
          coalesce(sum(o.total) filter (where o.status in ('ready', 'served')), 0) as revenue
        from generate_series(p_from, p_to, interval '1 day') d
        left join public.orders o
          on o.restaurant_id = p_restaurant_id
         and (o.created_at at time zone v_tz)::date = d::date
        group by d::date order by d::date
      ) t
    ), '[]'::jsonb),
    'status_breakdown', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select status, count(*)::int as cnt from public.orders
        where restaurant_id = p_restaurant_id and created_at >= v_from and created_at < v_to
        group by status
      ) s
    ), '{}'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(t) from (
        select oi.name_snapshot as name, sum(oi.quantity)::int as quantity, sum(oi.line_total) as revenue
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where oi.restaurant_id = p_restaurant_id
          and o.status in ('ready', 'served')
          and o.created_at >= v_from and o.created_at < v_to
        group by oi.name_snapshot
        order by sum(oi.quantity) desc limit 10
      ) t
    ), '[]'::jsonb),
    'category_performance', coalesce((
      select jsonb_agg(t) from (
        select coalesce(c.name, 'Uncategorised') as name, sum(oi.quantity)::int as quantity, sum(oi.line_total) as revenue
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        left join public.menu_items mi on mi.id = oi.menu_item_id
        left join public.categories c on c.id = mi.category_id
        where oi.restaurant_id = p_restaurant_id
          and o.status in ('ready', 'served')
          and o.created_at >= v_from and o.created_at < v_to
        group by coalesce(c.name, 'Uncategorised')
        order by sum(oi.line_total) desc
      ) t
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Kitchen feed: accepted-and-onward only. Never exposes pending/rejected.
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
        'note', o.note,
        'customer_name', o.customer_name,
        'item_count', o.item_count,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', oi.id, 'name', oi.name_snapshot, 'quantity', oi.quantity, 'note', oi.note
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

-- ---------------------------------------------------------------------------
-- Public restaurant menu (by slug) — for /menu/[slug] without a QR token.
-- ---------------------------------------------------------------------------
create or replace function public.menu_by_slug(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_rest record;
  v_settings record;
begin
  select * into v_rest from public.restaurants
  where lower(slug) = lower(btrim(coalesce(p_slug, ''))) and status = 'active';
  if v_rest.id is null then
    return null;
  end if;
  select * into v_settings from public.restaurant_settings where restaurant_id = v_rest.id;

  return jsonb_build_object(
    'table', null,
    'restaurant', jsonb_build_object(
      'id', v_rest.id, 'name', v_rest.name, 'slug', v_rest.slug,
      'tagline', v_rest.tagline, 'description', v_rest.description,
      'logo_path', v_rest.logo_path, 'cover_path', v_rest.cover_path,
      'currency', v_rest.currency, 'time_zone', v_rest.time_zone,
      'phone', v_rest.phone, 'address', v_rest.address, 'city', v_rest.city
    ),
    'settings', jsonb_build_object(
      'tax_rate', coalesce(v_settings.tax_rate, 0),
      'tax_label', coalesce(v_settings.tax_label, 'VAT'),
      'service_charge_rate', coalesce(v_settings.service_charge_rate, 0),
      'service_charge_label', coalesce(v_settings.service_charge_label, 'Service charge'),
      'prices_include_tax', coalesce(v_settings.prices_include_tax, false),
      'accept_orders', false,
      'require_customer_name', false
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description, 'sort_order', c.sort_order
      ) order by c.sort_order, c.name)
      from public.categories c where c.restaurant_id = v_rest.id and c.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mi.id, 'category_id', mi.category_id, 'name', mi.name, 'slug', mi.slug,
        'description', mi.description, 'price', mi.price, 'image_path', mi.image_path,
        'is_available', mi.is_available, 'is_featured', mi.is_featured,
        'sort_order', mi.sort_order, 'prep_minutes', mi.prep_minutes
      ) order by mi.sort_order, mi.name)
      from public.menu_items mi
      join public.categories c on c.id = mi.category_id
      where mi.restaurant_id = v_rest.id and not mi.is_archived and c.is_active
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Platform admin aggregates
-- ---------------------------------------------------------------------------
create or replace function public.platform_overview()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.mp_is_platform_admin() then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'restaurants', (select count(*) from public.restaurants),
    'active_restaurants', (select count(*) from public.restaurants where status = 'active'),
    'suspended_restaurants', (select count(*) from public.restaurants where status = 'suspended'),
    'users', (select count(*) from public.restaurant_members),
    'orders', (select count(*) from public.orders),
    'orders_30d', (select count(*) from public.orders where created_at >= now() - interval '30 days'),
    'gmv_30d', coalesce((select sum(total) from public.orders
      where status in ('ready','served') and created_at >= now() - interval '30 days'), 0)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants: public functions to anon, staff functions to authenticated only.
-- ---------------------------------------------------------------------------
grant execute on function public.mp_random_hex(integer) to authenticated;
grant execute on function public.mp_sha256(text) to anon, authenticated;
grant execute on function public.menu_for_qr(text) to anon, authenticated;
grant execute on function public.menu_by_slug(text) to anon, authenticated;
grant execute on function public.create_order(text, jsonb, text, text, text, text) to anon, authenticated;
grant execute on function public.get_order_tracking(text) to anon, authenticated;
grant execute on function public.transition_order(uuid, text, text) to authenticated;
grant execute on function public.restaurant_overview(uuid) to authenticated;
grant execute on function public.restaurant_analytics(uuid, date, date) to authenticated;
grant execute on function public.kitchen_feed(uuid) to authenticated;
grant execute on function public.platform_overview() to authenticated;

revoke all on function public.create_order(text, jsonb, text, text, text, text) from public;
grant execute on function public.create_order(text, jsonb, text, text, text, text) to anon, authenticated;
