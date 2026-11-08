-- ============================================================================
-- MenuPilot · Migration 005 · Tenant referential integrity
-- ----------------------------------------------------------------------------
-- A single `restaurant_id` column on every table is not enough: two independent
-- foreign keys would allow a dish in restaurant A to point at a category that
-- belongs to restaurant B (both FKs satisfied, data still corrupt).
--
-- This migration makes every tenant-owned reference a COMPOSITE key on
-- (restaurant_id, <parent_id>) so a cross-tenant reference is impossible at the
-- storage layer — independently of RLS, of the application code, and of whoever
-- writes SQL by hand later.
-- ============================================================================

-- Parent-side unique targets (id is already unique; the composite is the target).
create unique index if not exists categories_tenant_id_key on public.categories (restaurant_id, id);
create unique index if not exists menu_items_tenant_id_key on public.menu_items (restaurant_id, id);
create unique index if not exists dining_tables_tenant_id_key on public.dining_tables (restaurant_id, id);
create unique index if not exists orders_tenant_id_key on public.orders (restaurant_id, id);

-- ---- menu_items → categories ---------------------------------------------
alter table public.menu_items drop constraint if exists menu_items_category_id_fkey;
alter table public.menu_items
  add constraint menu_items_tenant_category_fkey
  foreign key (restaurant_id, category_id)
  references public.categories (restaurant_id, id)
  on delete restrict
  not valid;
alter table public.menu_items validate constraint menu_items_tenant_category_fkey;

-- ---- menu_item_images → menu_items ---------------------------------------
alter table public.menu_item_images drop constraint if exists menu_item_images_menu_item_id_fkey;
alter table public.menu_item_images
  add constraint menu_item_images_tenant_item_fkey
  foreign key (restaurant_id, menu_item_id)
  references public.menu_items (restaurant_id, id)
  on delete cascade
  not valid;
alter table public.menu_item_images validate constraint menu_item_images_tenant_item_fkey;

-- ---- qr_tokens → dining_tables -------------------------------------------
alter table public.qr_tokens drop constraint if exists qr_tokens_table_id_fkey;
alter table public.qr_tokens
  add constraint qr_tokens_tenant_table_fkey
  foreign key (restaurant_id, table_id)
  references public.dining_tables (restaurant_id, id)
  on delete cascade
  not valid;
alter table public.qr_tokens validate constraint qr_tokens_tenant_table_fkey;

-- ---- orders → dining_tables (nullable table is allowed) -------------------
alter table public.orders drop constraint if exists orders_table_id_fkey;
alter table public.orders
  add constraint orders_tenant_table_fkey
  foreign key (restaurant_id, table_id)
  references public.dining_tables (restaurant_id, id)
  on delete set null
  not valid;
alter table public.orders validate constraint orders_tenant_table_fkey;

-- ---- order_items → orders and → menu_items -------------------------------
alter table public.order_items drop constraint if exists order_items_order_id_fkey;
alter table public.order_items
  add constraint order_items_tenant_order_fkey
  foreign key (restaurant_id, order_id)
  references public.orders (restaurant_id, id)
  on delete cascade
  not valid;
alter table public.order_items validate constraint order_items_tenant_order_fkey;

alter table public.order_items drop constraint if exists order_items_menu_item_id_fkey;
alter table public.order_items
  add constraint order_items_tenant_item_fkey
  foreign key (restaurant_id, menu_item_id)
  references public.menu_items (restaurant_id, id)
  on delete set null
  not valid;
alter table public.order_items validate constraint order_items_tenant_item_fkey;

-- ---- order_status_history → orders --------------------------------------
alter table public.order_status_history drop constraint if exists order_status_history_order_id_fkey;
alter table public.order_status_history
  add constraint order_status_history_tenant_order_fkey
  foreign key (restaurant_id, order_id)
  references public.orders (restaurant_id, id)
  on delete cascade
  not valid;
alter table public.order_status_history validate constraint order_status_history_tenant_order_fkey;

-- ============================================================================
-- Owners are protected from locking themselves out of their own tenant:
-- at least one active owner must remain per restaurant.
-- ============================================================================
create or replace function public.mp_ensure_owner_remains() returns trigger
language plpgsql as $$
begin
  -- A whole-tenant delete (cascade) must not be blocked by this guard: the
  -- restaurant row is already gone by the time the cascade reaches members.
  if not exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
    return coalesce(new, old);
  end if;

  if (TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and (new.role <> 'owner' or not new.is_active))) then
    if not exists (
      select 1 from public.restaurant_members m
      where m.restaurant_id = coalesce(old.restaurant_id, new.restaurant_id)
        and m.role = 'owner' and m.is_active
        and m.id <> old.id
    ) then
      raise exception 'MP:LAST_OWNER' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_members_keep_owner on public.restaurant_members;
create trigger trg_members_keep_owner
  before update or delete on public.restaurant_members
  for each row execute function public.mp_ensure_owner_remains();

-- ============================================================================
-- Guard: an order can only be created through create_order() or by trusted
-- server code. Authenticated users have no insert policy at all (already true),
-- and order money columns are immutable once written.
-- ============================================================================
create or replace function public.mp_orders_immutable_money() returns trigger
language plpgsql as $$
begin
  if new.subtotal is distinct from old.subtotal
     or new.tax_amount is distinct from old.tax_amount
     or new.service_charge is distinct from old.service_charge
     or new.total is distinct from old.total
     or new.order_number is distinct from old.order_number
     or new.restaurant_id is distinct from old.restaurant_id
     or new.tracking_token is distinct from old.tracking_token then
    raise exception 'MP:IMMUTABLE_ORDER_FIELD' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_immutable_money on public.orders;
create trigger trg_orders_immutable_money
  before update on public.orders
  for each row execute function public.mp_orders_immutable_money();
