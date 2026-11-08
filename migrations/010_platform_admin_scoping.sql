-- ===========================================================================
-- 010_platform_admin_scoping.sql
--
-- SECURITY FIX (found by the production audit).
--
-- Migrations 001/002 let a platform admin read any tenant's row through RLS:
--
--   using (mp_is_member(restaurant_id) or mp_is_platform_admin())
--   using (mp_is_member(id)            or mp_is_platform_admin())
--
-- That contradicts the product's own promise. `src/lib/services/platform.ts`
-- states: "Tenant-owned operational detail (orders, guests, menu) is never
-- returned here — only account metadata and aggregate health." In practice an
-- operator account could `select * from orders` and read every restaurant's
-- revenue, guest names and phone numbers. Aggregate-only access is not the same
-- as row-level access, and an operator console does not need the latter.
--
-- The console gets what it legitimately needs from SECURITY DEFINER functions
-- that return *aggregates* (platform_overview, platform_restaurants,
-- platform_user_directory) — those still work, because they run as the owner.
--
-- After this migration platform admins have NO ambient row-level access. They can
-- read their own memberships like anyone else, and nothing more.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- orders: members only
-- ---------------------------------------------------------------------------
drop policy if exists orders_member_read on public.orders;
create policy orders_member_read on public.orders for select to authenticated
  using (public.mp_is_member(restaurant_id));

-- ---------------------------------------------------------------------------
-- restaurants: members, plus the public published-menu surface (status = active
-- is already enforced by any function that exposes a menu). Platform admins read
-- account metadata through platform_restaurants(), not through this policy.
-- ---------------------------------------------------------------------------
drop policy if exists restaurants_member_read on public.restaurants;
create policy restaurants_member_read on public.restaurants for select to authenticated
  using (public.mp_is_member(id));

-- Any other table whose read policy included platform admin bypass is aligned
-- here so the rule is uniform: operators see aggregates, members see rows.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and cmd = 'SELECT'
       and qual like '%mp_is_platform_admin%'
       and tablename not in ('restaurants', 'orders')
  loop
    execute format('drop policy if exists %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
    raise notice 'dropped platform-admin read policy % on %', v_policy.policyname, v_policy.tablename;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Verify the promise, so a future policy cannot quietly reintroduce the bypass.
-- ---------------------------------------------------------------------------
create or replace function public.mp_check_admin_scoping()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname))
                   filter (where tablename is not null), '[]'::jsonb) = '[]'::jsonb,
    'bypassing_policies', coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname))
                   filter (where tablename is not null), '[]'::jsonb)
  )
  from pg_policies
  where schemaname = 'public'
    and cmd in ('SELECT', 'ALL')
    and (qual like '%mp_is_platform_admin%' or with_check like '%mp_is_platform_admin%')
$$;

grant execute on function public.mp_check_admin_scoping() to anon, authenticated;
