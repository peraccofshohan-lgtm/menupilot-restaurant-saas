-- ===========================================================================
-- 008_provisioning_checks.sql
--
-- Deploy-time verification. Reading a migration file and assuming it matched the
-- target project is how a deploy "succeeds" and then breaks at the first login:
-- `create table if not exists auth.sessions` silently keeps GoTrue's table, and
-- nothing complains until an INSERT fails in production.
--
-- `public.mp_check_schema()` inspects the live catalog and reports exactly what
-- the application needs. `/api/health` runs it, so a deployment can be verified
-- before real users touch it. It is safe on any engine and never mutates data.
-- ===========================================================================

create or replace function public.mp_check_schema()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_missing text[] := array[]::text[];
  v_notes   jsonb  := '{}'::jsonb;
  v_tbl     text;
  v_col     text;
begin
  -- Tables the application queries directly (not via a helper function).
  foreach v_tbl in array array[
    'profiles', 'restaurants', 'restaurant_settings', 'restaurant_members',
    'categories', 'menu_items', 'menu_item_images', 'dining_tables', 'qr_tokens',
    'customers', 'orders', 'order_items', 'order_status_history',
    'staff_invitations', 'platform_admins', 'password_reset_tokens',
    'app_sessions', 'user_credentials', 'schema_migrations'
  ] loop
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = v_tbl
    ) then
      v_missing := v_missing || v_tbl;
    end if;
  end loop;

  -- Columns whose absence breaks a specific feature.
  foreach v_col in array array[
    'app_sessions.token_hash', 'app_sessions.user_id', 'app_sessions.expires_at',
    'user_credentials.password_hash', 'orders.idempotency_key',
    'menu_items.image_path', 'restaurants.logo_path', 'restaurants.cover_path'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = split_part(v_col, '.', 1)
         and column_name = split_part(v_col, '.', 2)
    ) then
      v_missing := v_missing || v_col;
    end if;
  end loop;

  -- RLS must be on for every tenant table, or isolation is a promise not a fact.
  v_notes := jsonb_build_object(
    'rls_disabled', coalesce((
      select jsonb_agg(c.relname order by c.relname)
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and not c.relrowsecurity
         and c.relname in (
           'restaurants','restaurant_settings','restaurant_members','categories',
           'menu_items','menu_item_images','dining_tables','qr_tokens','customers',
           'orders','order_items','order_status_history','staff_invitations',
           'platform_admins','password_reset_tokens','app_sessions','user_credentials'
         )
    ), '[]'::jsonb),
    'identity_tables', jsonb_build_object(
      'app_sessions', to_regclass('public.app_sessions') is not null,
      'user_credentials', to_regclass('public.user_credentials') is not null
    ),
    'engine', jsonb_build_object(
      'server_version', current_setting('server_version'),
      -- True when the auth schema is managed by GoTrue (a Supabase project).
      'gotrue_managed', exists (
        select 1 from information_schema.columns
         where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id'
      )
    ),
    'tenants', (select count(*) from public.restaurants),
    'demo_items', (select count(*) from public.menu_items mi
                     join public.restaurants r on r.id = mi.restaurant_id
                    where r.is_demo and not mi.is_archived),
    'demo_tables', (select count(*) from public.dining_tables t
                      join public.restaurants r on r.id = t.restaurant_id
                     where r.is_demo)
  );

  return jsonb_build_object(
    'ok', cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing),
    'detail', v_notes
  );
end $$;

grant execute on function public.mp_check_schema() to anon, authenticated;
