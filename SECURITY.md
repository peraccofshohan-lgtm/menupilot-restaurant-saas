# Security

## Threat model

| Adversary | Capability assumed |
|---|---|
| Guest with a table QR | Can call public endpoints, modify URLs, replay requests |
| Malicious tenant (owner of restaurant B) | Valid account, valid session, can craft any request |
| Compromised browser session | Can act as that user until expiry |
| Operator error | A developer writing a query without a tenant filter |

The design assumes the browser is hostile and that application code will eventually contain a bug. Isolation is
therefore enforced in the database, not in the application.

## Tenant isolation — three independent layers

**1. Row Level Security (every tenant table).**
The `authenticated` role sees only rows where `mp_is_member(restaurant_id)` is true. `anon` sees only active,
published menu content. `service_role` bypasses RLS and is used only in trusted seeding/migration code.

**2. Composite foreign keys.**
`(restaurant_id, parent_id)` references make a cross-tenant relationship impossible even for raw SQL with RLS
disabled — e.g. a dish cannot point at another restaurant's category.

**3. Server-side tenancy resolution.**
No endpoint accepts a restaurant id from the browser as authority. `resolveAuthorizedRestaurant()` maps the
session to a membership; the `mp_restaurant` cookie only selects *which* of the caller's own restaurants is
active, and it is validated against membership on every request.

Tests that prove it: `multi-tenancy (RLS)` — 12 tests including cross-tenant order reads, writes, staff
enumeration, and role escalation.

## Reading the auth schema without weakening it

The `auth` schema is revoked from `anon` and `authenticated` outright, so page and service code cannot join
`auth.users` to resolve an email address. Rather than granting a table away, four narrow
`security definer` functions in `006_identity_functions.sql` expose exactly what the UI needs:

| Function | Who may call it | What it returns |
|---|---|---|
| `staff_directory(restaurant_id)` | any member of that restaurant | team list with names, emails, roles |
| `member_id_by_email(restaurant_id, email)` | owners and managers of that restaurant | one membership id, or null |
| `platform_user_directory()` | platform admins | account list, ≤200 rows |
| `platform_restaurants()` | platform admins | tenant accounts with owner email and 30-day aggregates |

Each function re-checks the caller with `mp_is_member` / `mp_is_platform_admin` and raises `MP:FORBIDDEN`
otherwise, so the grant widens *reach within a tenant*, never *access across tenants*. Three tests cover this:
members can read their own team, a tenant owner is refused another tenant's directory, and a non-admin is
refused the account directory.

## Authentication

- Passwords hashed with **scrypt** (Node core), 16-byte random salt, 64-byte derived key, constant-time compare.
  Stored as `scrypt$<salt>$<hash>`.
- Session tokens are 256-bit random values; only their **HMAC-SHA256 hash** is stored, so a database leak cannot
  be replayed as a cookie.
- Cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day expiry, path `/`.
- Sign-in always runs the KDF even for unknown emails, so response timing does not reveal account existence.
- Password reset: single-use tokens, stored hashed, 60-minute expiry; a successful reset deletes all sessions for
  that user. The request endpoint returns an identical message whether or not the account exists.
- Logout destroys the session row server-side, not just the cookie.

## Authorization

Roles are checked in **two** places:

1. UI: navigation items are filtered per role (convenience only).
2. Database: `transition_order()` contains the transition/role matrix; RLS policies contain the read/write rules.

| Action | owner | manager | kitchen | waiter |
|---|---|---|---|---|
| Accept / reject order | ✅ | ✅ | — | — |
| Start preparing / mark ready | ✅ | ✅ | ✅ | — |
| Mark served | ✅ | ✅ | ✅ | ✅ |
| Cancel an active order | ✅ | ✅ | — | — |
| Menu, tables, categories | ✅ | ✅ | — | — |
| Analytics | ✅ | ✅ | — | — |
| Settings | ✅ | ✅ | — | — |
| Staff, roles, invitations | ✅ | — | — | — |
| Platform console | platform admins only | | | |

## Order integrity

- Prices and totals are computed **only** by `create_order()` from database values.
- `order_items` snapshots name and price per line.
- A trigger rejects any later change to `subtotal`, `tax_amount`, `service_charge`, `total`, `order_number`,
  `restaurant_id` or `tracking_token`.
- Authenticated users have **no** insert policy on `orders`; all creation goes through the function. Column-level
  grants allow only `note` and `payment_status` to be updated directly.
- The state machine refuses invalid or backwards transitions (`pending → ready`, `rejected → preparing`, etc.).

## QR codes

- 192-bit token from `gen_random_uuid()`; the URL is `/q/<token>`, never `?table=1`.
- Lookup is by SHA-256 of the token; the plaintext token is stored once for reprinting and is readable only by the
  tenant's owner/manager under RLS.
- Tokens are revocable and rotatable; deactivating a table immediately invalidates its code.
- Unknown, revoked, inactive-table and suspended-restaurant cases are indistinguishable to the caller.

## Public endpoint protection

- **Rate limiting:** 8 order submissions per device per minute, enforced by an atomic PostgreSQL function.
  Limiter keys are SHA-256 hashes of the scope + identity, so raw IPs and emails are never stored.
- **Idempotency:** `(restaurant_id, idempotency_key)` is unique; a retried submission returns the original order.
- **Input bounds:** max 50 lines per order, quantity clamped to 1–99, notes truncated, phone format validated.
- **Server-side validation of every field** that reaches a mutation; client validation is a convenience only.

## File uploads

- Routed through authenticated server endpoints; the restaurant folder comes from the session.
- MIME type allow-list (JPEG/PNG/WebP), 5 MB cap, **and** magic-byte verification — a renamed `.exe` is rejected.
- Served with `X-Content-Type-Options: nosniff` and a restrictive `Content-Security-Policy` on the media route.
- The database storage table has RLS enabled with **no policies**, so only service-role code can read raw bytes.

## Secrets

- `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` are read only in server modules; nothing in `src/app` or
  `src/components` imports them into a client bundle.
- Demo passwords are generated at seed time and written to a git-ignored file. No credential appears in source.
- `.env`, `.env.*` and `.data/` are git-ignored; `.env.example` contains no real values.

## Error handling

Customer-facing errors are friendly sentences; stack traces and SQL errors are logged server-side only. The
`AuthError`/`MP:*` exception codes from PostgreSQL are mapped to human messages before they reach a page.
The global error boundary shows a calm recovery screen and logs the digest.

## Known limitations (stated, not hidden)

1. **No email delivery configured.** Password reset and staff invitation links are recorded server-side; in
   production you must connect a mail provider (see `DEPLOYMENT.md`). Local development logs the link.
2. **Rate limiting is per-process-database, not global edge.** It is atomic within one database, which is correct
   for a single Postgres, but a multi-region edge limiter (Upstash/Cloudflare) should sit in front in production.
3. **CSRF relies on `SameSite=Lax` plus `POST`-only mutations.** There is no double-submit token. If you expose the
   app on a domain that also hosts untrusted sub-apps, add an origin check in middleware.
4. **No 2FA** for owners or platform admins.
5. **Platform admins can suspend tenants but cannot read service data** — this is intentional, and means a support
   request about a specific order must go through the restaurant.
