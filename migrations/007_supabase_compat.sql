-- ===========================================================================
-- 007_supabase_compat.sql
--
-- MenuPilot keeps its own identity layer (scrypt password hashes, opaque HMAC
-- session tokens). On a real Supabase project GoTrue already owns the `auth`
-- schema, which means:
--
--   * `auth.users` exists with GoTrue's columns. Our migration 001 used
--     `create table if not exists`, so nothing was added — and any code writing
--     `encrypted_password` / `full_name` would fail on a missing column.
--   * `auth.sessions` exists with a completely different shape (GoTrue stores
--     JWT ids, not our token hashes), so inserting our session rows would fail
--     even though the table name matched.
--
-- This migration makes the relationship explicit and safe on both engines:
--
--   * `public.user_credentials` holds the scrypt hash and the optional extra
--     profile fields, keyed by the same uuid as `auth.users`.
--   * `public.app_sessions` holds our opaque token hashes, with the same
--     columns 001 gave `auth.sessions`.
--   * data written by earlier versions is copied across, so existing local
--     databases keep their logins.
--
-- On a plain/embedded Postgres the two `auth.*` tables still exist (001 creates
-- them and they are no longer referenced by application code). They are left in
-- place deliberately: they are what a fresh Supabase project provides, so both
-- engines now hold identical public-schema structures.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Credentials: the hash MenuPilot authenticates with.
-- ---------------------------------------------------------------------------
create table if not exists public.user_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_hash text not null,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_credentials is
  'MenuPilot-owned credential material. Kept separate from auth.users so the app works identically on a self-managed Postgres and on a Supabase project where GoTrue owns the auth schema.';

-- ---------------------------------------------------------------------------
-- Sessions: opaque 256-bit tokens stored as HMAC hashes.
-- ---------------------------------------------------------------------------
create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists app_sessions_user_idx on public.app_sessions (user_id);
create index if not exists app_sessions_expiry_idx on public.app_sessions (expires_at);

alter table public.app_sessions enable row level security;
alter table public.user_credentials enable row level security;

-- No policies on either table: they are reachable only by trusted server code
-- running as the table owner (or service_role). A browser session can never read
-- another user's hash, and RLS keeps that true even if a grant is ever widened.
revoke all on public.app_sessions from anon, authenticated;
revoke all on public.user_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Align the local stand-in for `auth.users` with GoTrue's shape.
--
-- 001 declared `encrypted_password NOT NULL` because it was the only credential
-- store at the time. GoTrue allows NULL (it also hosts OAuth and magic-link
-- users), and credentials now live in `public.user_credentials`. Without this the
-- schema would reject the same INSERT on one engine and accept it on the other.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users'
       and column_name = 'encrypted_password' and is_nullable = 'NO'
  ) then
    execute 'alter table auth.users alter column encrypted_password drop not null';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Carry over data written by previous versions (idempotent).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'sessions' and column_name = 'token_hash'
  ) then
    execute $q$
      insert into public.app_sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
      select s.id, s.user_id, s.token_hash, s.expires_at, s.created_at, s.last_used_at
        from auth.sessions s
       where exists (select 1 from auth.users u where u.id = s.user_id)
      on conflict (id) do nothing
    $q$;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'
  ) then
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

drop trigger if exists trg_user_credentials_touch on public.user_credentials;
create trigger trg_user_credentials_touch before update on public.user_credentials
  for each row execute function public.touch_updated_at();
