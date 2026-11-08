# Database

PostgreSQL. Every tenant-owned row carries `restaurant_id`; isolation is enforced twice — by RLS policies and
by composite foreign keys — so a cross-tenant reference is impossible at the storage layer.

## Migrations

| File | Contents |
|---|---|
| `001_core_schema.sql` | Roles, `auth` schema, every table, indexes, constraints, grants, `updated_at` triggers |
| `002_rls.sql` | Authorization helper functions and all Row Level Security policies |
| `003_functions.sql` | Business functions: QR resolution, order creation, tracking, state machine, aggregates |
| `004_ops.sql` | Password-reset tokens and the rate-limit bucket |
| `005_tenant_integrity.sql` | Composite tenant foreign keys, last-owner guard, immutable order money |
| `006_identity_functions.sql` | Checked `security definer` reads for the auth schema: staff directory, account directory, platform tenant list |
| `007_supabase_compat.sql` | `user_credentials` + `app_sessions` (GoTrue-compatible identity), nullable `encrypted_password` parity, data carry-over |
| `008_provisioning_checks.sql` | `mp_check_schema()` — verifies the live catalog matches what the app needs |
| `009_email_outbox.sql` | Every email attempt with its real outcome (`sent` / `failed` / `skipped`) |
| `010_platform_admin_scoping.sql` | **Security fix**: removes platform-admin row-level bypass from RLS |
| `011_tracking_token_hashing.sql` | Hashes guest tracking tokens at rest; adds `orders.status_changed_at` |

Applied in filename order inside one transaction each, recorded in `schema_migrations`. Safe to re-run.

## Entity relationships

```
auth.users 1──1 profiles
auth.users 1──1 user_credentials          (scrypt hash; separate from GoTrue's auth.users)
auth.users 1──* restaurant_members *──1 restaurants
auth.users 1──* app_sessions              (opaque token hashes)
auth.users 1──* platform_admins
auth.users 1──* password_reset_tokens

restaurants 1──1 restaurant_settings
restaurants 1──* categories 1──* menu_items 1──* menu_item_images
restaurants 1──* dining_tables 1──1 qr_tokens
restaurants 1──* customers
restaurants 1──* orders 1──* order_items
                     orders 1──* order_status_history
restaurants 1──* staff_invitations
restaurants 1──* audit_logs
restaurants 1──* storage_objects (bucket + path, unique; local driver only)
restaurants 1──* email_outbox
orders    1──1 (restaurant, idempotency_key) unique  ──► duplicate submissions collapse
```

## Identity tables (Supabase compatibility)

On a Supabase project GoTrue owns the `auth` schema, so the application never stores
its own columns there. Two `public` tables hold what MenuPilot needs, keyed by the
same uuid as `auth.users`:

| Table | Holds | Access |
|---|---|---|
| `user_credentials` | scrypt password hash, display name, phone | RLS on, no policies, `revoke all` from browser roles |
| `app_sessions` | HMAC-SHA256 of the session cookie, expiry | same |

`auth.users` remains the identity anchor and the target of every foreign key, so
`profiles`, `restaurant_members` and `platform_admins` are unchanged. This is what
makes the same migration set work on a self-managed Postgres and on Supabase without
a conditional schema per engine.

Two values are never stored in plaintext: the session cookie (`app_sessions.token_hash`),
the guest tracking token (`orders.tracking_token`, SHA-256), QR tokens
(`qr_tokens.token_sha256`) and reset/invitation tokens.

## Table reference

### `restaurants` — the tenant
`id`, `name`, `slug` (unique, case-insensitive), `tagline`, `description`, `logo_path`, `cover_path`, `phone`,
`email`, `address`, `city`, `currency` (ISO-4217, 3 chars), `time_zone`, `status` (`pending|active|suspended`),
`is_demo`, `created_by`, timestamps.

### `restaurant_settings` — 1:1 with a restaurant
`tax_rate`, `tax_label`, `service_charge_rate`, `service_charge_label`, `prices_include_tax`, `accept_orders`,
`auto_accept_orders`, `require_customer_name`, `order_prefix`, `operating_hours` (jsonb), `receipt_note`.

### `restaurant_members` — membership + role
`(restaurant_id, user_id)` unique, `role ∈ {owner, manager, kitchen, waiter}`, `is_active`.
A trigger guarantees **at least one active owner** always remains.

### `categories`, `menu_items`, `menu_item_images`
`menu_items.price numeric(12,2) ≥ 0`, `slug` unique per restaurant, `is_available`, `is_featured`, `is_archived`
(soft delete keeps historic receipts intact), `sort_order`, `prep_minutes`.

### `dining_tables`, `qr_tokens`
One active token per table. `token` is 48 hex characters from `gen_random_uuid()`; lookups use
`token_sha256 = sha256(token)`, which is uniquely indexed. Tokens are revocable (`is_active`, `revoked_at`) and
rotatable (`rotated_at`).

### `orders`, `order_items`, `order_status_history`
`orders.status ∈ {pending, accepted, preparing, ready, served, rejected, cancelled}`.
Money columns are `numeric(12,2)`. `order_items` snapshots `name_snapshot`, `unit_price` and `line_total` at order
time, so later menu edits never rewrite history. `tracking_token` is unique and 48 hex characters.
`order_status_history` records every transition with actor, role and timestamp.

### `customers`
Per-tenant guest book, deduplicated on phone within a restaurant, with `total_orders`, `total_spend`,
`first_order_at`, `last_order_at`.

### `rate_limit_buckets`, `password_reset_tokens`, `storage_objects`, `audit_logs`
Fixed-window counters (keys are hashed), single-use reset tokens (hashed), stored media, and an operations trail.
None of these are readable by `anon` or `authenticated`.

## Composite tenant foreign keys

A single-column FK is not enough to keep tenants apart: a dish could reference a category in another restaurant
while both FKs are individually satisfied. Migration 005 replaces the important references with composite keys:

```sql
foreign key (restaurant_id, category_id) references categories (restaurant_id, id)
```

Applied to: `menu_items → categories`, `menu_item_images → menu_items`, `qr_tokens → dining_tables`,
`orders → dining_tables`, `order_items → orders`, `order_items → menu_items`,
`order_status_history → orders`.

## Money

- All monetary values are `numeric(12,2)` (never floating point).
- Prices, tax and service charge are computed **inside** `create_order()`; the client never supplies a total.
- `order_items.unit_price` is snapshotted, so revenue reporting stays accurate after menu edits.
- Rounding happens once per component: `round(subtotal * rate / 100, 2)`.
- Revenue counts only `ready` and `served` orders. `rejected` and `cancelled` never contribute.

## Business-day reporting

`restaurant_overview()` and `restaurant_analytics()` cut business days in the restaurant's own `time_zone`
(`(created_at at time zone tz)::date`), not the server's.

## Key functions

| Function | Caller | Guarantees |
|---|---|---|
| `menu_for_qr(token)` | anon | Resolves restaurant + table from a token; returns `null` for anything invalid |
| `menu_by_slug(slug)` | anon | Read-only public menu, ordering disabled |
| `create_order(token, items, …)` | anon | Validates token/table/restaurant, prices lines, computes tax/service, dedupes by idempotency key |
| `get_order_tracking(token)` | anon | Returns a customer-safe projection only |
| `transition_order(id, next, reason)` | authenticated | Enforces the state machine and role matrix |
| `restaurant_overview(restaurant_id)` | member | Dashboard aggregates; refuses non-members |
| `restaurant_analytics(id, from, to)` | owner/manager | Date-ranged reporting in tenant time zone |
| `kitchen_feed(restaurant_id)` | staff | Accepted/preparing/ready tickets only |
| `platform_overview()` | platform admin | Aggregate platform figures only |
| `consume_rate_limit(key, limit, window)` | anon/authenticated | Atomic fixed-window limiter |

## Schema evolution

1. Add a new file to `migrations/` with the next number prefix.
2. Never edit an applied migration — write a new one.
3. Run `npm run db:migrate`.
4. Run `npm test`; the suite applies every migration from scratch, so a broken policy fails immediately.
