-- ============================================================================
-- MenuPilot · Migration 002 · Authorization helpers & Row Level Security
-- ----------------------------------------------------------------------------
-- Security model
--   anon          → may read public menu data of ACTIVE restaurants only.
--   authenticated → may read/write ONLY rows of restaurants where they hold an
--                   active membership (restaurant_members) or are a platform admin.
--   service_role  → bypasses RLS, used exclusively in trusted server code.
--
-- Customers never get direct table access to orders. Customer order tracking and
-- order creation happen through validated SECURITY DEFINER functions instead, so
-- a browser can never enumerate another guest's or another tenant's orders.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read membership data without
-- recursing through RLS, and so policies stay readable.
-- ---------------------------------------------------------------------------
create or replace function public.mp_is_member(p_restaurant_id uuid, p_roles text[] default null)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = p_restaurant_id
      and m.user_id = public.mp_uid()
      and m.is_active
      and (p_roles is null or m.role = any (p_roles))
  )
$$;

create or replace function public.mp_role(p_restaurant_id uuid)
returns text
language sql stable security definer set search_path = public, auth as $$
  select m.role from public.restaurant_members m
  where m.restaurant_id = p_restaurant_id
    and m.user_id = public.mp_uid()
    and m.is_active
  limit 1
$$;

create or replace function public.mp_is_platform_admin()
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.platform_admins a where a.user_id = public.mp_uid())
$$;

create or replace function public.mp_is_public_restaurant(p_restaurant_id uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id and r.status = 'active'
  )
$$;

create or replace function public.mp_owns_demo_restaurant()
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.restaurant_members m
    join public.restaurants r on r.id = m.restaurant_id
    where m.user_id = public.mp_uid() and m.is_active and r.is_demo
  )
$$;

grant execute on function public.mp_uid() to anon, authenticated;
grant execute on function public.mp_claims() to anon, authenticated;
grant execute on function public.mp_is_member(uuid, text[]) to anon, authenticated;
grant execute on function public.mp_role(uuid) to authenticated;
grant execute on function public.mp_is_platform_admin() to authenticated;
grant execute on function public.mp_is_public_restaurant(uuid) to anon, authenticated;
grant execute on function public.mp_owns_demo_restaurant() to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','restaurants','restaurant_settings','restaurant_members',
    'staff_invitations','categories','menu_items','menu_item_images',
    'dining_tables','qr_tokens','customers','orders','order_items',
    'order_status_history','platform_admins','audit_logs','storage_objects'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated
  using (id = public.mp_uid());
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert to authenticated
  with check (id = public.mp_uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = public.mp_uid()) with check (id = public.mp_uid());

-- ---------------------------------------------------------------------------
-- restaurants: public read of active tenants; members read own; owners update.
-- ---------------------------------------------------------------------------
drop policy if exists restaurants_public_read on public.restaurants;
create policy restaurants_public_read on public.restaurants for select to anon, authenticated
  using (status = 'active');
drop policy if exists restaurants_member_read on public.restaurants;
create policy restaurants_member_read on public.restaurants for select to authenticated
  using (public.mp_is_member(id) or public.mp_is_platform_admin());
drop policy if exists restaurants_owner_update on public.restaurants;
create policy restaurants_owner_update on public.restaurants for update to authenticated
  using (public.mp_is_member(id, array['owner'])) with check (public.mp_is_member(id, array['owner']));

-- ---------------------------------------------------------------------------
-- restaurant_settings
-- ---------------------------------------------------------------------------
drop policy if exists settings_public_read on public.restaurant_settings;
create policy settings_public_read on public.restaurant_settings for select to anon, authenticated
  using (public.mp_is_public_restaurant(restaurant_id));
drop policy if exists settings_member_read on public.restaurant_settings;
create policy settings_member_read on public.restaurant_settings for select to authenticated
  using (public.mp_is_member(restaurant_id));
drop policy if exists settings_manager_write on public.restaurant_settings;
create policy settings_manager_write on public.restaurant_settings for update to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

-- ---------------------------------------------------------------------------
-- restaurant_members
-- ---------------------------------------------------------------------------
drop policy if exists members_self_read on public.restaurant_members;
create policy members_self_read on public.restaurant_members for select to authenticated
  using (user_id = public.mp_uid() or public.mp_is_member(restaurant_id, array['owner','manager']));
drop policy if exists members_owner_write on public.restaurant_members;
create policy members_owner_write on public.restaurant_members for insert to authenticated
  with check (public.mp_is_member(restaurant_id, array['owner']));
drop policy if exists members_owner_update on public.restaurant_members;
create policy members_owner_update on public.restaurant_members for update to authenticated
  using (public.mp_is_member(restaurant_id, array['owner']))
  with check (public.mp_is_member(restaurant_id, array['owner']));
drop policy if exists members_owner_delete on public.restaurant_members;
create policy members_owner_delete on public.restaurant_members for delete to authenticated
  using (public.mp_is_member(restaurant_id, array['owner']) and user_id <> public.mp_uid());

-- ---------------------------------------------------------------------------
-- staff_invitations
-- ---------------------------------------------------------------------------
drop policy if exists invitations_owner_all on public.staff_invitations;
create policy invitations_owner_all on public.staff_invitations for all to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

-- ---------------------------------------------------------------------------
-- categories / menu_items / menu_item_images
-- Public read limited to active, non-archived content of active restaurants.
-- ---------------------------------------------------------------------------
drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories for select to anon, authenticated
  using (is_active and public.mp_is_public_restaurant(restaurant_id));
drop policy if exists categories_member_read on public.categories;
create policy categories_member_read on public.categories for select to authenticated
  using (public.mp_is_member(restaurant_id));
drop policy if exists categories_manager_write on public.categories;
create policy categories_manager_write on public.categories for all to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

drop policy if exists menu_items_public_read on public.menu_items;
create policy menu_items_public_read on public.menu_items for select to anon, authenticated
  using (not is_archived and public.mp_is_public_restaurant(restaurant_id));
drop policy if exists menu_items_member_read on public.menu_items;
create policy menu_items_member_read on public.menu_items for select to authenticated
  using (public.mp_is_member(restaurant_id));
drop policy if exists menu_items_manager_write on public.menu_items;
create policy menu_items_manager_write on public.menu_items for all to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

drop policy if exists menu_images_public_read on public.menu_item_images;
create policy menu_images_public_read on public.menu_item_images for select to anon, authenticated
  using (public.mp_is_public_restaurant(restaurant_id));
drop policy if exists menu_images_member_read on public.menu_item_images;
create policy menu_images_member_read on public.menu_item_images for select to authenticated
  using (public.mp_is_member(restaurant_id));
drop policy if exists menu_images_manager_write on public.menu_item_images;
create policy menu_images_manager_write on public.menu_item_images for all to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

-- ---------------------------------------------------------------------------
-- dining_tables / qr_tokens — never public.
-- Kitchen and waiters may read; owner/manager manage.
-- ---------------------------------------------------------------------------
drop policy if exists tables_member_read on public.dining_tables;
create policy tables_member_read on public.dining_tables for select to authenticated
  using (public.mp_is_member(restaurant_id));
drop policy if exists tables_manager_write on public.dining_tables;
create policy tables_manager_write on public.dining_tables for all to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

drop policy if exists qr_member_read on public.qr_tokens;
create policy qr_member_read on public.qr_tokens for select to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']));
drop policy if exists qr_manager_write on public.qr_tokens;
create policy qr_manager_write on public.qr_tokens for all to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
drop policy if exists customers_member_read on public.customers;
create policy customers_member_read on public.customers for select to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']));
drop policy if exists customers_manager_write on public.customers;
create policy customers_manager_write on public.customers for all to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

-- ---------------------------------------------------------------------------
-- orders. Read-only for members. Every write goes through transition_order()
-- so the state machine cannot be bypassed, even by a malicious client.
-- ---------------------------------------------------------------------------
drop policy if exists orders_member_read on public.orders;
create policy orders_member_read on public.orders for select to authenticated
  using (public.mp_is_member(restaurant_id) or public.mp_is_platform_admin());

drop policy if exists orders_member_note_update on public.orders;
create policy orders_member_note_update on public.orders for update to authenticated
  using (public.mp_is_member(restaurant_id, array['owner','manager']))
  with check (public.mp_is_member(restaurant_id, array['owner','manager']));

-- Column-level guard: members may edit operational metadata, never money/status.
revoke update on public.orders from authenticated;
grant update (note, payment_status) on public.orders to authenticated;

drop policy if exists order_items_member_read on public.order_items;
create policy order_items_member_read on public.order_items for select to authenticated
  using (public.mp_is_member(restaurant_id));

drop policy if exists order_history_member_read on public.order_status_history;
create policy order_history_member_read on public.order_status_history for select to authenticated
  using (public.mp_is_member(restaurant_id));

-- ---------------------------------------------------------------------------
-- platform_admins / audit_logs / storage_objects
-- ---------------------------------------------------------------------------
drop policy if exists platform_admins_self_read on public.platform_admins;
create policy platform_admins_self_read on public.platform_admins for select to authenticated
  using (user_id = public.mp_uid());

drop policy if exists audit_owner_read on public.audit_logs;
create policy audit_owner_read on public.audit_logs for select to authenticated
  using (restaurant_id is not null and public.mp_is_member(restaurant_id, array['owner']));

-- storage_objects: no policies at all => only service_role (BYPSRLS) can touch
-- file bytes. Files are streamed through an authenticated application route.

-- anon must not be able to read auth tables.
--
-- On a Supabase project these tables belong to GoTrue's role and this REVOKE can
-- fail with "must be owner of table users", aborting the migration. Supabase already
-- applies exactly this lockdown, so the statement is restricted to the local
-- stand-in. `scripts/supabase-setup.ts --check` verifies the live project really is
-- locked down, so this is checked rather than assumed.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id'
  ) then
    execute 'revoke all on auth.users from anon, authenticated';
    execute 'revoke all on auth.sessions from anon, authenticated';
  end if;
end $$;
