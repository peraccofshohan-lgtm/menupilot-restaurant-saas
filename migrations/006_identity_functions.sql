-- ===========================================================================
-- 006_identity_functions.sql
--
-- The auth schema is deliberately locked down: `revoke all on auth.users from
-- anon, authenticated` (002). That is the correct privilege boundary, but it
-- means page/server code running under the `authenticated` role cannot join
-- `auth.users` to resolve an email address.
--
-- The fix is not to widen the grant — it is to expose the two narrow,
-- authorization-checked reads the UI actually needs:
--
--   * staff_directory(restaurant_id)  → team list for one tenant, for members
--   * platform_user_directory()       → account list, for platform admins only
--
-- Both are SECURITY DEFINER so they can read the auth schema, and both verify
-- the caller before returning a single row. Email addresses are the only
-- personal data exposed and they are scoped to the caller's own tenant
-- (or to a platform admin acting on account metadata).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tenant staff directory
-- ---------------------------------------------------------------------------
create or replace function public.staff_directory(p_restaurant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_rows jsonb;
begin
  if p_restaurant_id is null or not public.mp_is_member(p_restaurant_id) then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by role_rank, created_at), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id', m.id,
               'user_id', m.user_id,
               'full_name', coalesce(p.full_name, u.full_name),
               'email', u.email,
               'role', m.role,
               'is_active', m.is_active,
               'created_at', m.created_at,
               'order_actions', (
                 select count(*) from public.order_status_history h
                  where h.changed_by = m.user_id and h.restaurant_id = m.restaurant_id
               )
             ) as row,
             case m.role when 'owner' then 0 when 'manager' then 1 when 'kitchen' then 2 else 3 end as role_rank,
             m.created_at
        from public.restaurant_members m
        join auth.users u on u.id = m.user_id
        left join public.profiles p on p.id = m.user_id
       where m.restaurant_id = p_restaurant_id
    ) s;

  return v_rows;
end $$;

-- Used by staff invitations: is this email already on the team?
create or replace function public.member_id_by_email(p_restaurant_id uuid, p_email text)
returns uuid
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_id uuid;
begin
  if not public.mp_is_member(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  select m.id into v_id
    from public.restaurant_members m
    join auth.users u on u.id = m.user_id
   where m.restaurant_id = p_restaurant_id
     and lower(u.email) = lower(btrim(coalesce(p_email, '')))
   limit 1;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Platform account directory (admins only)
-- ---------------------------------------------------------------------------
create or replace function public.platform_user_directory()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_rows jsonb;
begin
  if not public.mp_is_platform_admin() then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id', u.id,
               'email', u.email,
               'full_name', coalesce(p.full_name, u.full_name),
               'created_at', u.created_at,
               'last_sign_in_at', u.last_sign_in_at,
               'is_admin', exists (select 1 from public.platform_admins a where a.user_id = u.id),
               'restaurants', (
                 select string_agg(r.name || ' (' || m.role || ')', ', ')
                   from public.restaurant_members m
                   join public.restaurants r on r.id = m.restaurant_id
                  where m.user_id = u.id
               )
             ) as row,
             u.created_at
        from auth.users u
        left join public.profiles p on p.id = u.id
       order by u.created_at desc
       limit 200
    ) s;

  return v_rows;
end $$;

-- ---------------------------------------------------------------------------
-- Platform restaurant list (admins only). Included here so the console no
-- longer needs to join auth.users to display an owner email.
-- ---------------------------------------------------------------------------
create or replace function public.platform_restaurants()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_rows jsonb;
begin
  if not public.mp_is_platform_admin() then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id', r.id, 'name', r.name, 'slug', r.slug, 'status', r.status,
               'is_demo', r.is_demo, 'city', r.city, 'currency', r.currency,
               'created_at', r.created_at,
               'owner_email', (
                 select u.email from public.restaurant_members m
                 join auth.users u on u.id = m.user_id
                  where m.restaurant_id = r.id and m.role = 'owner' limit 1
               ),
               'members', (select count(*) from public.restaurant_members m where m.restaurant_id = r.id),
               'items', (select count(*) from public.menu_items i where i.restaurant_id = r.id and not i.is_archived),
               'tables', (select count(*) from public.dining_tables t where t.restaurant_id = r.id),
               'orders_30d', (
                 select count(*) from public.orders o
                  where o.restaurant_id = r.id and o.created_at >= now() - interval '30 days'
               ),
               'gmv_30d', coalesce((
                 select sum(o.total) from public.orders o
                  where o.restaurant_id = r.id and o.status in ('ready', 'served')
                    and o.created_at >= now() - interval '30 days'
               ), 0)
             ) as row,
             r.created_at
        from public.restaurants r
       order by r.created_at desc
    ) s;

  return v_rows;
end $$;

grant execute on function public.staff_directory(uuid) to authenticated;
grant execute on function public.member_id_by_email(uuid, text) to authenticated;
grant execute on function public.platform_user_directory() to authenticated;
grant execute on function public.platform_restaurants() to authenticated;
