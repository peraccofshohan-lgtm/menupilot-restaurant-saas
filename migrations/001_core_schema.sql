-- ============================================================================
-- MenuPilot · Migration 001 · Core schema
-- ----------------------------------------------------------------------------
-- Portable between Supabase Postgres and the embedded Postgres engine used for
-- local/CI runs. Only core extensions (gen_random_uuid) are required.
-- All monetary values use NUMERIC (never float).
-- Every tenant-owned row carries restaurant_id.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Roles. Supabase already defines these; the guards make this migration safe
-- to run on both engines.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Request context helpers. Mirrors Supabase's `auth.uid()` but reads the JWT
-- claims that any PostgREST/pg connection sets, so the same policies work on
-- Supabase, on a plain Postgres and on the embedded engine.
-- ---------------------------------------------------------------------------
create or replace function public.mp_claims() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function public.mp_uid() returns uuid
language sql stable as $$
  select nullif(public.mp_claims() ->> 'sub', '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Users (auth). Additive and non-destructive: on a real Supabase project this
-- table already exists and is managed by GoTrue, so nothing is dropped.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  encrypted_password text not null,
  full_name text,
  phone text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists auth_users_email_key on auth.users (lower(email));

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists auth_sessions_user_idx on auth.sessions (user_id);

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- restaurants (tenants)
-- ---------------------------------------------------------------------------
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  tagline text,
  description text,
  logo_path text,
  cover_path text,
  phone text,
  email text,
  address text,
  city text,
  currency text not null default 'BDT' check (currency ~ '^[A-Z]{3}$'),
  time_zone text not null default 'Asia/Dhaka',
  status text not null default 'active' check (status in ('pending', 'active', 'suspended')),
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists restaurants_slug_key on public.restaurants (lower(slug));
create index if not exists restaurants_status_idx on public.restaurants (status);

-- ---------------------------------------------------------------------------
-- restaurant_settings (1:1 with restaurants)
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  tax_rate numeric(5, 2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  tax_label text not null default 'VAT',
  service_charge_rate numeric(5, 2) not null default 0 check (service_charge_rate >= 0 and service_charge_rate <= 100),
  service_charge_label text not null default 'Service charge',
  prices_include_tax boolean not null default false,
  accept_orders boolean not null default true,
  auto_accept_orders boolean not null default false,
  require_customer_name boolean not null default false,
  order_prefix text not null default 'MP' check (order_prefix ~ '^[A-Z0-9]{1,4}$'),
  operating_hours jsonb not null default '{}'::jsonb,
  receipt_note text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- restaurant_members (RBAC + tenant membership, the tenant-isolation anchor)
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'kitchen', 'waiter')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);
create index if not exists restaurant_members_user_idx on public.restaurant_members (user_id);

-- ---------------------------------------------------------------------------
-- staff_invitations
-- ---------------------------------------------------------------------------
create table if not exists public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager', 'kitchen', 'waiter')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_invitations_restaurant_idx on public.staff_invitations (restaurant_id);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists categories_restaurant_name_key
  on public.categories (restaurant_id, lower(btrim(name)));
create index if not exists categories_restaurant_sort_idx
  on public.categories (restaurant_id, sort_order);

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  price numeric(12, 2) not null check (price >= 0),
  image_path text,
  is_available boolean not null default true,
  is_featured boolean not null default false,
  is_archived boolean not null default false,
  sort_order integer not null default 0,
  prep_minutes integer not null default 15 check (prep_minutes between 0 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists menu_items_restaurant_slug_key
  on public.menu_items (restaurant_id, slug);
create index if not exists menu_items_restaurant_category_idx
  on public.menu_items (restaurant_id, category_id);
create index if not exists menu_items_restaurant_available_idx
  on public.menu_items (restaurant_id, is_available);

-- ---------------------------------------------------------------------------
-- menu_item_images (gallery, superset of the primary image_path)
-- ---------------------------------------------------------------------------
create table if not exists public.menu_item_images (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists menu_item_images_item_idx on public.menu_item_images (menu_item_id);

-- ---------------------------------------------------------------------------
-- dining_tables
-- ---------------------------------------------------------------------------
create table if not exists public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 40),
  zone text,
  seats integer not null default 4 check (seats between 1 and 40),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists dining_tables_restaurant_label_key
  on public.dining_tables (restaurant_id, lower(btrim(label)));

-- ---------------------------------------------------------------------------
-- qr_tokens — one active token per table, rotatable/revocable.
-- `token_sha256` is the lookup key; `token` is kept so the owner can re-print
-- the same QR. Both live behind tenant RLS; only the token holder can use it.
-- ---------------------------------------------------------------------------
create table if not exists public.qr_tokens (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.dining_tables(id) on delete cascade,
  token text not null check (length(token) >= 32),
  token_sha256 text not null unique,
  is_active boolean not null default true,
  revoked_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists qr_tokens_table_idx on public.qr_tokens (table_id);

-- ---------------------------------------------------------------------------
-- customers (per-tenant CRM, never shared across restaurants)
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text,
  phone text,
  email text,
  note text,
  total_orders integer not null default 0,
  total_spend numeric(12, 2) not null default 0,
  first_order_at timestamptz,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_restaurant_phone_idx on public.customers (restaurant_id, phone);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid references public.dining_tables(id) on delete set null,
  qr_token_id uuid references public.qr_tokens(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  order_number text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'preparing', 'ready', 'served', 'rejected', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  service_charge numeric(12, 2) not null default 0 check (service_charge >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  currency text not null default 'BDT',
  item_count integer not null default 0 check (item_count >= 0),
  customer_name text,
  customer_phone text,
  note text,
  source text not null default 'qr' check (source in ('qr', 'counter', 'dashboard')),
  tracking_token text not null,
  idempotency_key text,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  preparing_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  rejected_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists orders_restaurant_number_key
  on public.orders (restaurant_id, order_number);
create unique index if not exists orders_restaurant_idempotency_key
  on public.orders (restaurant_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists orders_tracking_token_key on public.orders (tracking_token);
create index if not exists orders_restaurant_created_idx
  on public.orders (restaurant_id, created_at desc);
create index if not exists orders_restaurant_status_idx on public.orders (restaurant_id, status);
create index if not exists orders_restaurant_table_idx on public.orders (restaurant_id, table_id);

-- ---------------------------------------------------------------------------
-- order_items (price and name are snapshotted at order time)
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name_snapshot text not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 99),
  line_total numeric(12, 2) not null check (line_total >= 0),
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_restaurant_item_idx on public.order_items (restaurant_id, menu_item_id);

-- ---------------------------------------------------------------------------
-- order_status_history (audit of every lifecycle transition)
-- ---------------------------------------------------------------------------
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  actor_role text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx
  on public.order_status_history (order_id, created_at);

-- ---------------------------------------------------------------------------
-- platform_admins + audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_restaurant_idx on public.audit_logs (restaurant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- storage_objects — the local storage adapter. On Supabase this is replaced by
-- the `storage` schema; the application talks to a StorageService either way.
-- ---------------------------------------------------------------------------
create table if not exists public.storage_objects (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  mime_type text not null,
  byte_size integer not null check (byte_size >= 0),
  content bytea not null,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_restaurants_touch on public.restaurants;
create trigger trg_restaurants_touch before update on public.restaurants
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_members_touch on public.restaurant_members;
create trigger trg_members_touch before update on public.restaurant_members
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_categories_touch on public.categories;
create trigger trg_categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_menu_items_touch on public.menu_items;
create trigger trg_menu_items_touch before update on public.menu_items
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_tables_touch on public.dining_tables;
create trigger trg_tables_touch before update on public.dining_tables
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_customers_touch on public.customers;
create trigger trg_customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_orders_touch on public.orders;
create trigger trg_orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Grants (RLS is the authorization layer; grants are the coarse gate)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

grant select on public.restaurants, public.categories, public.menu_items,
  public.menu_item_images, public.restaurant_settings
  to anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.profiles, public.restaurant_members to anon;
revoke select on public.profiles from anon;
revoke select on public.restaurant_members from anon;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
