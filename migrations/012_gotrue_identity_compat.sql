-- ===========================================================================
-- 012_gotrue_identity_compat.sql
--
-- FIX FOUND BY SIMULATING A REAL SUPABASE PROJECT.
--
-- `public.staff_directory()` and `public.platform_users()` read
-- `coalesce(p.full_name, u.full_name)` from `auth.users`. That works on this
-- repository's local stand-in for the auth schema, but a real Supabase project has
-- no `full_name` (or `phone`) column on `auth.users` — GoTrue keeps those in
-- `raw_user_meta_data`. On such a project every call to the team list and the
-- platform user list fails with:
--
--     column u.full_name does not exist
--
-- No test here could catch it, because the local `auth.users` is created by
-- migration 001 and therefore has whatever columns we gave it. The only reliable
-- way to find it is to run the migrations against a database shaped like the real
-- thing, which is exactly what `scripts/simulate-gotrue.ts` now does.
--
-- The fix makes the functions read the right source on either shape:
--
--   display name  public.user_credentials.full_name   (the app's own table, always present)
--                 → public.profiles.full_name          (legacy rows)
--                 → auth.users.raw_user_meta_data      (GoTrue sign-up metadata)
--                 → auth.users.full_name               (local stand-in only)
--
-- The last two need a compile-time decision, because PL/pgSQL resolves column
-- references when the function is created. The label is read once into a variable
-- and each function is emitted with a body that matches the shape actually present.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The application records sign-ins in its own table, never in auth.users.
--
-- `signIn()` used to run `update auth.users set last_sign_in_at = now()`. Real
-- GoTrue's `auth.users` has `last_sign_in_at`, but it is *GoTrue's* bookkeeping: on
-- a project where the app cannot write to that table the statement fails, and where
-- it can, the app is silently competing with GoTrue over the same column. Either
-- way it is the wrong table.
-- ---------------------------------------------------------------------------
alter table public.user_credentials add column if not exists last_sign_in_at timestamptz;

do $$
declare
  v_has_full_name    boolean;
  v_has_raw_meta     boolean;
  v_meta_name        text;
  v_meta_phone       text;
  v_src              text;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'full_name'
  ) into v_has_full_name;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data'
  ) into v_has_raw_meta;

  -- Expressions, chosen once, for the two shapes. `user_credentials` always exists
  -- from migration 007 onward and is the application's own record, so it is first.
  v_meta_name := case
    when v_has_raw_meta then
      'coalesce(c.full_name, p.full_name, u.raw_user_meta_data ->> ''full_name'')'
    when v_has_full_name then
      'coalesce(c.full_name, p.full_name, u.full_name)'
    else 'coalesce(c.full_name, p.full_name)'
  end;

  v_meta_phone := case
    when v_has_raw_meta then 'coalesce(c.phone, p.phone, u.raw_user_meta_data ->> ''phone'')'
    else 'coalesce(c.phone, p.phone)'
  end;

  -- -------------------------------------------------------------------------
  -- staff_directory
  -- -------------------------------------------------------------------------
  execute format($f$
    create or replace function public.staff_directory(p_restaurant_id uuid)
    returns jsonb
    language plpgsql stable security definer set search_path = public, auth as $body$
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
                   'full_name', %1$s,
                   'phone', %2$s,
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
            left join public.user_credentials c on c.user_id = m.user_id
           where m.restaurant_id = p_restaurant_id
        ) s;

      return v_rows;
    end $body$;
  $f$, v_meta_name, v_meta_phone);

  -- -------------------------------------------------------------------------
  -- platform_users (last_sign_in_at on the local stand-in only)
  -- -------------------------------------------------------------------------
  execute format($f$
    create or replace function public.platform_users()
    returns jsonb
    language plpgsql stable security definer set search_path = public, auth as $body$
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
                   'full_name', %1$s,
                   'phone', %2$s,
                   'created_at', u.created_at,
                   'last_sign_in_at', %3$s,
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
            left join public.user_credentials c on c.user_id = u.id
           where u.email is not null
        ) s;

      return v_rows;
    end $body$;
  $f$,
  v_meta_name,
  v_meta_phone,
  'c.last_sign_in_at');

  raise notice 'staff_directory/platform_users rebuilt for % auth.users shape',
    case when v_has_raw_meta then 'GoTrue' else 'local' end;
end $$;

-- ---------------------------------------------------------------------------
-- Carry-over of credential material must not depend on a `full_name` column that
-- a real project does not have.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data'
  ) then
    -- Local stand-in: it has full_name and phone.
    execute $q$
      insert into public.user_credentials (user_id, password_hash, full_name, phone, created_at, updated_at)
      select u.id, u.encrypted_password, u.full_name, u.phone, u.created_at, u.updated_at
        from auth.users u
       where u.encrypted_password is not null
         and length(u.encrypted_password) > 0
      on conflict (user_id) do nothing
    $q$;
  end if;
end $$;

comment on function public.staff_directory(uuid) is
  'Tenant staff list. Reads display names from public.user_credentials / profiles, never from an auth.users column that GoTrue may not have.';
