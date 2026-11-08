-- ===========================================================================
-- 022 — Bangla content for the menu, categories and restaurant profile
--
-- MenuPilot now presents a Bengali interface. The interface strings live in the
-- application dictionary, but dish names, dish descriptions and category names
-- are *restaurant data*, so they need columns.
--
-- Design notes:
--
--   * Every column is nullable and defaults to null. Nothing existing is
--     rewritten, no row is deleted, and a tenant that never fills these in keeps
--     working exactly as before — the read layer falls back to the English
--     value. That makes this migration safe to apply to the live demo database.
--
--   * Bangla fields are additive rather than a translation table. A restaurant
--     has one name per dish in one language, sorted and pooled by category; a
--     join table would add a join to the hottest read path in the product (the
--     public menu) for no benefit.
--
--   * Check constraints mirror their English counterparts so a blank string can
--     never be stored where the UI expects text, and so the length limits the
--     dashboard reports hold in Bangla too. Bengali grapheme clusters are longer
--     than the Latin equivalent, hence the same generous limits.
--
--   * menu_for_qr() and menu_by_slug() are recreated *identically* to 003 except
--     for the added Bangla fields. Only the JSON payload grows; every rule about
--     which rows are visible is untouched — an inactive category still hides its
--     dishes, a revoked token still returns null, and menu_by_slug still refuses
--     to accept orders.
-- ===========================================================================

-- ---------------------------------------------------------------- categories
alter table public.categories
  add column if not exists name_bn text,
  add column if not exists description_bn text;

alter table public.categories
  drop constraint if exists categories_name_bn_len,
  add constraint categories_name_bn_len
    check (name_bn is null or length(btrim(name_bn)) between 1 and 60);

-- ------------------------------------------------------------------ menu items
alter table public.menu_items
  add column if not exists name_bn text,
  add column if not exists description_bn text;

alter table public.menu_items
  drop constraint if exists menu_items_name_bn_len,
  add constraint menu_items_name_bn_len
    check (name_bn is null or length(btrim(name_bn)) between 1 and 120);

-- ------------------------------------------------------------------ restaurant
alter table public.restaurants
  add column if not exists tagline_bn text,
  add column if not exists description_bn text,
  add column if not exists address_bn text;

comment on column public.categories.name_bn is
  'Bengali category name shown when the interface language is bn. Null falls back to name.';
comment on column public.menu_items.name_bn is
  'Bengali dish name shown when the interface language is bn. Null falls back to name.';
comment on column public.menu_items.description_bn is
  'Bengali dish description. Null falls back to description.';
comment on column public.restaurants.description_bn is
  'Bengali restaurant description for the guest menu header. Null falls back to description.';

-- ----------------------------------------------------------------------------
-- menu_for_qr: unchanged contract, Bengali fields added to the payload.
-- ----------------------------------------------------------------------------
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
      'tagline_bn', v_rest.tagline_bn, 'description_bn', v_rest.description_bn,
      'address_bn', v_rest.address_bn,
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
        'id', c.id, 'name', c.name, 'name_bn', c.name_bn,
        'description', c.description, 'description_bn', c.description_bn,
        'sort_order', c.sort_order
      ) order by c.sort_order, c.name)
      from public.categories c
      where c.restaurant_id = v_rest.id and c.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mi.id, 'category_id', mi.category_id, 'name', mi.name, 'name_bn', mi.name_bn,
        'slug', mi.slug,
        'description', mi.description, 'description_bn', mi.description_bn,
        'price', mi.price, 'image_path', mi.image_path,
        'is_available', mi.is_available, 'is_featured', mi.is_featured,
        'sort_order', mi.sort_order, 'prep_minutes', mi.prep_minutes
      ) order by mi.sort_order, mi.name)
      from public.menu_items mi
      join public.categories c on c.id = mi.category_id
      where mi.restaurant_id = v_rest.id and not mi.is_archived and c.is_active
    ), '[]'::jsonb)
  );
end $$;

-- ----------------------------------------------------------------------------
-- menu_by_slug: same, and still `accept_orders = false` by design — browsing
-- without a table code must never be able to place an order.
-- ----------------------------------------------------------------------------
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
      'tagline_bn', v_rest.tagline_bn, 'description_bn', v_rest.description_bn,
      'address_bn', v_rest.address_bn,
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
        'id', c.id, 'name', c.name, 'name_bn', c.name_bn,
        'description', c.description, 'description_bn', c.description_bn,
        'sort_order', c.sort_order
      ) order by c.sort_order, c.name)
      from public.categories c where c.restaurant_id = v_rest.id and c.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mi.id, 'category_id', mi.category_id, 'name', mi.name, 'name_bn', mi.name_bn,
        'slug', mi.slug,
        'description', mi.description, 'description_bn', mi.description_bn,
        'price', mi.price, 'image_path', mi.image_path,
        'is_available', mi.is_available, 'is_featured', mi.is_featured,
        'sort_order', mi.sort_order, 'prep_minutes', mi.prep_minutes
      ) order by mi.sort_order, mi.name)
      from public.menu_items mi
      join public.categories c on c.id = mi.category_id
      where mi.restaurant_id = v_rest.id and not mi.is_archived and c.is_active
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.menu_for_qr(text) to anon, authenticated;
grant execute on function public.menu_by_slug(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- get_order_tracking: adds the Bengali dish name so the tracker and the receipt
-- read in the guest's language too.
--
-- This body is 021's verbatim, with exactly two additions:
--   * each line item also returns `name_bn`
--   * the restaurant block also returns `description_bn`
-- Every hint, scope rule and column name from 021 is preserved — including
-- `visited` being gated on status = 'served' and a hidden review keeping its
-- reply, both of which have tests.
-- ----------------------------------------------------------------------------
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
      'address', v_rest.address, 'city', v_rest.city,
      'description_bn', v_rest.description_bn
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'menu_item_id', oi.menu_item_id,
        'name', oi.name_snapshot,
        'name_bn', (select mi.name_bn from public.menu_items mi where mi.id = oi.menu_item_id),
        'quantity', oi.quantity,
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
      ),
      -- What the guest wrote, and what came back. A hidden review keeps its
      -- reply: moderation hides the rating from the public menu, it does not
      -- erase the conversation the guest had with the restaurant.
      'mine', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'kind', r.target_kind,
          'rating', r.rating,
          'comment', r.comment,
          'item_name', (
            select mi.name from public.menu_items mi where mi.id = r.menu_item_id
          ),
          'created_at', r.created_at,
          'reply', (
            select rr.body from public.review_replies rr where rr.review_id = r.id
          ),
          'reply_at', (
            select rr.updated_at from public.review_replies rr where rr.review_id = r.id
          )
        ) order by r.created_at)
        from public.order_reviews r
        where r.order_id = v_order.id
      ), '[]'::jsonb)
    ),
    'service_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', s.kind, 'status', s.status, 'created_at', s.created_at
      ) order by s.created_at desc)
      from public.service_requests s where s.order_id = v_order.id
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.get_order_tracking(text) to anon, authenticated;
