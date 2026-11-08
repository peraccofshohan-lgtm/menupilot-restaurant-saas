-- ---------------------------------------------------------------------------
-- 017 · Demo reset covers the tables added in 014
--
-- Reviews and service requests arrived after the reset was written, and they
-- hang off orders a reset removes. Without this they would survive as orphans
-- pointing at deleted orders (the FKs are `on delete cascade`, so they would
-- actually be removed silently — but a reset should name what it clears, and
-- the preview screen should be able to show it).
--
-- The protected set is unchanged and still re-verified before commit: menu
-- items, categories, dining tables, QR tokens, restaurant settings, members.
-- ---------------------------------------------------------------------------

create or replace function public.reset_demo_orders(
  p_restaurant_id uuid,
  p_expected_orders integer,
  p_confirmation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := public.mp_uid();
  v_is_demo boolean;
  v_role text;
  v_orders int;
  v_items int;
  v_history int;
  v_customers int;
  v_reviews int;
  v_requests int;
  v_categories int;
  v_menu int;
  v_tables int;
  v_tokens int;
  v_settings int;
  v_members int;
  v_after_categories int;
  v_after_menu int;
  v_after_tables int;
  v_after_tokens int;
  v_after_settings int;
  v_after_members int;
begin
  if v_uid is null then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  select is_demo into v_is_demo from public.restaurants where id = p_restaurant_id;
  if v_is_demo is null then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  v_role := public.mp_role(p_restaurant_id);
  if v_role is distinct from 'owner' then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  if not v_is_demo then
    raise exception 'MP:NOT_DEMO' using errcode = 'P0001';
  end if;

  if p_confirmation is distinct from 'RESET' then
    raise exception 'MP:CONFIRM' using errcode = 'P0001';
  end if;

  select count(*) into v_orders from public.orders where restaurant_id = p_restaurant_id;
  if v_orders <> p_expected_orders then
    raise exception 'MP:NOT_EMPTY:%', v_orders using errcode = 'P0001';
  end if;

  select
    (select count(*) from public.categories where restaurant_id = p_restaurant_id),
    (select count(*) from public.menu_items where restaurant_id = p_restaurant_id),
    (select count(*) from public.dining_tables where restaurant_id = p_restaurant_id),
    (select count(*) from public.qr_tokens where restaurant_id = p_restaurant_id),
    (select count(*) from public.restaurant_settings where restaurant_id = p_restaurant_id),
    (select count(*) from public.restaurant_members where restaurant_id = p_restaurant_id)
  into v_categories, v_menu, v_tables, v_tokens, v_settings, v_members;

  select
    (select count(*) from public.order_items where restaurant_id = p_restaurant_id),
    (select count(*) from public.order_status_history where restaurant_id = p_restaurant_id),
    (select count(*) from public.customers where restaurant_id = p_restaurant_id),
    (select count(*) from public.order_reviews where restaurant_id = p_restaurant_id),
    (select count(*) from public.service_requests where restaurant_id = p_restaurant_id)
  into v_items, v_history, v_customers, v_reviews, v_requests;

  -- Order: children before parents. Reviews and requests first, because they
  -- reference orders; then the order graph.
  delete from public.review_replies rr
   using public.order_reviews r
   where rr.review_id = r.id and r.restaurant_id = p_restaurant_id;

  delete from public.order_reviews where restaurant_id = p_restaurant_id;
  delete from public.service_requests where restaurant_id = p_restaurant_id;
  delete from public.order_status_history where restaurant_id = p_restaurant_id;
  delete from public.order_items where restaurant_id = p_restaurant_id;
  delete from public.orders where restaurant_id = p_restaurant_id;
  delete from public.customers where restaurant_id = p_restaurant_id;

  -- Prove the protected set survived, inside the same transaction.
  select
    (select count(*) from public.categories where restaurant_id = p_restaurant_id),
    (select count(*) from public.menu_items where restaurant_id = p_restaurant_id),
    (select count(*) from public.dining_tables where restaurant_id = p_restaurant_id),
    (select count(*) from public.qr_tokens where restaurant_id = p_restaurant_id),
    (select count(*) from public.restaurant_settings where restaurant_id = p_restaurant_id),
    (select count(*) from public.restaurant_members where restaurant_id = p_restaurant_id)
  into v_after_categories, v_after_menu, v_after_tables, v_after_tokens, v_after_settings, v_after_members;

  if (v_after_categories, v_after_menu, v_after_tables, v_after_tokens, v_after_settings, v_after_members)
     is distinct from
     (v_categories, v_menu, v_tables, v_tokens, v_settings, v_members) then
    raise exception 'MP:PROTECTED_CHANGED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'deleted', jsonb_build_object(
      'orders', v_orders,
      'orderItems', v_items,
      'statusHistory', v_history,
      'customers', v_customers,
      'reviews', v_reviews,
      'serviceRequests', v_requests
    ),
    'kept', jsonb_build_object(
      'categories', v_after_categories,
      'menuItems', v_after_menu,
      'diningTables', v_after_tables,
      'qrTokens', v_after_tokens,
      'settings', v_after_settings,
      'members', v_after_members
    )
  );
end $$;

grant execute on function public.reset_demo_orders(uuid, integer, text) to authenticated;
