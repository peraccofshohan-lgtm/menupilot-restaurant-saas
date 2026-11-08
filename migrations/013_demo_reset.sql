-- ---------------------------------------------------------------------------
-- 013 · Demo reset
--
-- Clearing a demo tenant's orders has to delete rows, and `orders` deliberately
-- has no DELETE policy: RLS makes every order write go through a function so the
-- state machine cannot be bypassed. Rather than weaken that, the reset gets its
-- own SECURITY DEFINER function with the guards inside it.
--
-- The guards, in order, and all enforced in SQL rather than in the caller:
--
--   1. the caller is signed in (auth.uid() is not null),
--   2. the caller's membership of this restaurant is exactly 'owner',
--   3. the restaurant is flagged `is_demo`,
--   4. the caller's expectation of how many orders exist matches reality,
--   5. the phrase is `RESET`.
--
-- Then it deletes orders, order items, status history and the guest rows those
-- orders created — and nothing else. Menu items, categories, dining tables, QR
-- tokens, restaurant settings, members and auth rows are not named anywhere in
-- this function, so they cannot be removed by it.
--
-- Before it commits it re-reads the protected counts and raises if any of them
-- moved. A bug here fails loudly instead of quietly deleting a menu.
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
  v_before jsonb;
  v_after jsonb;
  v_orders int;
  v_items int;
  v_history int;
  v_customers int;
  v_categories int;
  v_menu int;
  v_tables int;
  v_tokens int;
  v_after_categories int;
  v_after_menu int;
  v_after_tables int;
  v_after_tokens int;
begin
  if v_uid is null then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  select is_demo into v_is_demo from public.restaurants where id = p_restaurant_id;
  if v_is_demo is null then
    raise exception 'MP:NOT_FOUND' using errcode = 'P0002';
  end if;

  select role into v_role
    from public.restaurant_members
   where restaurant_id = p_restaurant_id and user_id = v_uid;

  if v_role is distinct from 'owner' then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  if v_is_demo is not true then
    raise exception 'MP:NOT_DEMO' using errcode = '42501';
  end if;

  if upper(btrim(coalesce(p_confirmation, ''))) <> 'RESET' then
    raise exception 'MP:CONFIRM' using errcode = '22023';
  end if;

  select count(*) into v_orders from public.orders where restaurant_id = p_restaurant_id;
  if v_orders <> p_expected_orders then
    raise exception 'MP:CONFIRM' using errcode = '22023';
  end if;

  select
    (select count(*) from public.categories       where restaurant_id = p_restaurant_id),
    (select count(*) from public.menu_items       where restaurant_id = p_restaurant_id),
    (select count(*) from public.dining_tables    where restaurant_id = p_restaurant_id),
    (select count(*) from public.qr_tokens        where restaurant_id = p_restaurant_id),
    (select count(*) from public.order_items      where restaurant_id = p_restaurant_id),
    (select count(*) from public.order_status_history h
       join public.orders o on o.id = h.order_id
      where o.restaurant_id = p_restaurant_id),
    (select count(*) from public.customers        where restaurant_id = p_restaurant_id)
  into v_categories, v_menu, v_tables, v_tokens, v_items, v_history, v_customers;

  v_before := jsonb_build_object(
    'orders', v_orders, 'orderItems', v_items, 'statusHistory', v_history,
    'customers', v_customers, 'categories', v_categories, 'menuItems', v_menu,
    'diningTables', v_tables, 'qrTokens', v_tokens
  );

  delete from public.order_status_history h
    using public.orders o
    where h.order_id = o.id and o.restaurant_id = p_restaurant_id;

  delete from public.order_items where restaurant_id = p_restaurant_id;
  delete from public.orders      where restaurant_id = p_restaurant_id;
  delete from public.customers   where restaurant_id = p_restaurant_id;

  select
    (select count(*) from public.categories    where restaurant_id = p_restaurant_id),
    (select count(*) from public.menu_items    where restaurant_id = p_restaurant_id),
    (select count(*) from public.dining_tables where restaurant_id = p_restaurant_id),
    (select count(*) from public.qr_tokens     where restaurant_id = p_restaurant_id),
    (select count(*) from public.orders        where restaurant_id = p_restaurant_id),
    (select count(*) from public.order_items   where restaurant_id = p_restaurant_id)
  into v_after_categories, v_after_menu, v_after_tables, v_after_tokens, v_orders, v_items;

  if v_after_categories <> v_categories or v_after_menu <> v_menu
     or v_after_tables <> v_tables or v_after_tokens <> v_tokens then
    raise exception 'MP:PROTECTED_CHANGED';
  end if;
  if v_orders <> 0 or v_items <> 0 then
    raise exception 'MP:NOT_EMPTY';
  end if;

  v_after := jsonb_build_object(
    'categories', v_after_categories, 'menuItems', v_after_menu,
    'diningTables', v_after_tables, 'qrTokens', v_after_tokens
  );

  return jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

revoke all on function public.reset_demo_orders(uuid, integer, text) from public;
grant execute on function public.reset_demo_orders(uuid, integer, text) to authenticated;

comment on function public.reset_demo_orders(uuid, integer, text) is
  'Owner-only, demo-tenant-only order reset. Deletes orders, order items, status history and guest rows; never menu, tables, QR tokens, settings or auth.';
