# Deploying MenuPilot on Supabase + Vercel

This is the operational runbook: every command, in order, with the decision behind
each step. It assumes a brand-new Supabase project and a Vercel account.

> **Honest status.** Everything in this document is implemented and covered by tests
> running against a real PostgreSQL engine. It has **not** been executed against a
> live Supabase project from this environment: the sandbox has no Supabase
> credentials and filters outbound TLS to `supabase.co`. See the "What is verified"
> table at the end for the precise line between tested and untested.

---

## 0. What you need

| Item | Where it comes from |
|---|---|
| Supabase project | supabase.com → New project |
| Pooler connection string | Project → Settings → Database → Connection pooling (port **6543**) |
| `service_role` key | Project → Settings → API |
| `anon` key | Project → Settings → API |
| JWT secret | Project → Settings → API → JWT Settings |
| Vercel project | vercel.com → New project → import the repository |

---

## 1. Database

### 1.1 Connection string

Use the **transaction pooler** (port 6543), not the direct host (5432):

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Why: serverless functions open a connection per invocation. The direct host allows
a small fixed number of connections and will start refusing them under any real
traffic. The pooler multiplexes.

Append `?sslmode=require` if your network requires it explicitly.

### 1.2 Apply migrations

Migrations are plain SQL, ordered, idempotent, and each runs in its own transaction.

```bash
DATABASE_URL="postgresql://…:6543/postgres" npx tsx scripts/db-migrate.ts
```

What lands:

| Migration | Effect on a Supabase project |
|---|---|
| `001_core_schema.sql` | `public` tables. `auth.users` already exists (GoTrue) — the `create table if not exists` is skipped, which is expected |
| `002_rls.sql` | Enables + **forces** RLS on every tenant table; policies |
| `003_functions.sql` | QR resolution, `create_order`, state machine, aggregates |
| `004_ops.sql` | Password-reset tokens, rate limiting |
| `005_tenant_integrity.sql` | Composite tenant FKs, last-owner guard, immutable order money |
| `006_identity_functions.sql` | `security definer` reads for the locked-down `auth` schema |
| `007_supabase_compat.sql` | `public.user_credentials` + `public.app_sessions`; aligns the local `auth.users` stand-in with GoTrue's nullable column |
| `008_provisioning_checks.sql` | `mp_check_schema()` — verifies the live catalog matches the app |
| `009_email_outbox.sql` | Records every email attempt and its real outcome |
| `010_platform_admin_scoping.sql` | **Security fix**: removes platform-admin RLS bypass |
| `011_tracking_token_hashing.sql` | Hashes guest tracking tokens at rest |

### 1.3 Why `user_credentials` and `app_sessions` exist

On Supabase, GoTrue owns the `auth` schema. `auth.sessions` already exists with a
completely different shape (it stores GoTrue refresh-session ids, not our token
hashes). A `create table if not exists auth.sessions` would be silently skipped and
every login would fail at the first `INSERT`.

Migration 007 moves our identity data into the `public` schema, keyed by the same
uuid as `auth.users`:

* `public.user_credentials(user_id, password_hash, …)` — scrypt hash, never plaintext
* `public.app_sessions(user_id, token_hash, expires_at, …)` — HMAC-SHA256 of the cookie

Both are RLS-enabled with **no policies** and `revoke all` from `anon`/`authenticated`,
so only trusted server code reaches them. On the embedded engine the same two tables
are used, which is why `npm test` exercises the exact production code path.

### 1.4 Verify

```bash
DATABASE_URL="…" npx tsx scripts/supabase-setup.ts --check
```

```
✓ schema complete (Postgres 15.x)
✓ auth schema managed by GoTrue: yes
· tenants: 0 · demo dishes: 0 · demo tables: 0
✓ no platform-admin row-level bypass remains
```

`--check` changes nothing. Drop the flag to also create the Storage buckets.

---

## 2. Storage

```bash
SUPABASE_URL="https://<ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role>" \
DATABASE_URL="…" \
npx tsx scripts/supabase-setup.ts
```

That creates two buckets:

| Bucket | Public read | Max size | MIME types |
|---|---|---|---|
| `menu` | yes | 5 MB | jpeg, png, webp |
| `branding` | yes | 5 MB | jpeg, png, webp |

**Public read is deliberate.** These objects *are* the published menu and the
restaurant logo — they are rendered by anonymous guests on `/menu/<slug>`. Public
read also keeps image caching and the printed QR sheets working.

**Writes are not public.** The application uploads with the `service_role` key from
a server route that has already verified the caller is owner/manager of the tenant
whose id prefixes the path (`<restaurantId>/menu/<file>.jpg`).

### Upload pipeline

Every upload passes four gates before a byte is stored:

1. declared MIME type ∈ {jpeg, png, webp} and size ≤ 5 MB
2. **file signature** matches the declared type (a renamed `.sh` is rejected)
3. **sharp decodes and re-encodes** the image — this both proves it is a real image
   and strips EXIF metadata
4. path is composed from the **session** tenant id, never from the request

Replacement deletes the previous object only after the new one is live, so the guest
menu never shows a broken image mid-swap. Deleting a dish deletes its files; an
*archived* dish (one that appears in past orders) keeps its picture.

Orphan sweep (dry run by default):

```bash
npx tsx scripts/storage-gc.ts                # report
npx tsx scripts/storage-gc.ts --delete       # remove orphans older than 24h
```

---

## 3. Realtime

Optional. Without it the UI polls; with it, updates arrive in well under a second.

1. Supabase Dashboard → **Realtime → Settings → Enable Realtime Authorization**
2. Run `scripts/realtime-setup.sql` in the SQL editor
3. Set `REALTIME_JWT_SECRET` to the project's JWT secret (Settings → API)
4. Set `SUPABASE_ANON_KEY`

### How tenant isolation survives a hostile client

The browser gets a short-lived (1 h) JWT whose `mp_topic` claim is computed
**server-side** from the caller's membership:

```
/api/realtime/token   →  mp_topic: "restaurant:<their restaurant id>"
/api/realtime/order   →  mp_topic: "order:<hmac of their tracking token>"
```

The RLS policy on `realtime.messages` only permits a subscription when the requested
topic equals `mp_topic`. So editing the topic in devtools gets you refused, not
someone else's orders.

Even if it did not, the channel carries no row data: it is a "something changed,
re-read your feed" signal. The data still comes from `/api/orders/feed`, which
re-derives the tenant from the session on every request.

---

## 4. Email

Set both variables to enable delivery:

```
RESEND_API_KEY=re_…
EMAIL_FROM="MenuPilot <no-reply@yourdomain.com>"
```

Without them the application still works: invitations and reset links are generated,
every attempt is recorded in `public.email_outbox` with status `skipped`, and the UI
says *"Email delivery is not configured, so nothing was sent — use 'Copy invite
link'"*. It never claims a message was delivered when it was not.

Verify what the system actually attempted:

```sql
select kind, status, count(*), max(created_at)
  from public.email_outbox
 group by 1, 2 order by 1, 2;
```

---

## 5. Vercel

### 5.1 Environment variables

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | pooler string, port 6543 |
| `SESSION_SECRET` | yes | `openssl rand -base64 32` |
| `APP_URL` | yes | `https://your-domain.com`, no trailing slash |
| `STORAGE_DRIVER` | yes | `supabase` |
| `SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server only |
| `SUPABASE_ANON_KEY` | for realtime | |
| `NEXT_PUBLIC_SUPABASE_STORAGE_URL` | recommended | `https://<ref>.supabase.co/storage/v1/object/public` |
| `REALTIME_JWT_SECRET` | for realtime | |
| `RESEND_API_KEY` / `EMAIL_FROM` | for email | |
| `DATABASE_POOL_MAX` | optional | 10 is fine |

`NEXT_PUBLIC_*` values are embedded in the browser bundle. **Never** prefix
`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `RESEND_API_KEY` or
`REALTIME_JWT_SECRET` with `NEXT_PUBLIC_`. A test in the audit suite scans every
`"use client"` file for those names and fails the build if one appears.

### 5.2 Deploy

```bash
git push origin <branch>        # Vercel builds automatically once linked
# or
vercel --prod
```

`vercel.json` pins the region, the 30 s API timeout and baseline security headers.

### 5.3 Demo tenant

The seed is **not** part of the build. Run it deliberately, once:

```bash
DATABASE_URL="…" DEMO_OWNER_PASSWORD="<strong password>" npx tsx scripts/db-seed.ts
```

It creates MATI Kitchen (7 categories, 50 dishes, 20 tables, ~293 orders) plus
`owner@mati.demo`, `kitchen@mati.demo` and `admin@menupilot.demo`, and uploads the
seed images through the configured storage driver — so with `STORAGE_DRIVER=supabase`
they land in the bucket and render from the CDN.

For a production tenant rollout, skip the seed entirely and register through
`/register` → `/onboarding`, which creates a fresh, fully isolated workspace.

---

## 6. Backups

Supabase takes automatic daily backups and keeps 7 days of PITR on Pro plans.
Two things to add:

**Verify restores, don't just take backups.** Monthly, restore into a scratch
project and run:

```bash
DATABASE_URL="<scratch project>" npx tsx scripts/supabase-setup.ts --check
DATABASE_URL="<scratch project>" npm run test:security
```

**Storage is separate from the database.** Bucket objects are not in Postgres
backups. Either enable Supabase's Storage backup, or mirror the buckets:

```bash
# nightly, to any S3-compatible target
rclone sync supabase-menu:/menu     s3:your-bucket/menu
rclone sync supabase-branding:/branding s3:your-bucket/branding
```

The database stores paths, so a restored database with missing objects renders
broken images rather than corrupt data — recoverable, but only if you notice.

---

## 7. Deployment checklist

Copy this into the release PR.

**Before the first deploy**

- [ ] Supabase project created; region close to the restaurants
- [ ] Pooler connection string recorded (port 6543)
- [ ] `npx tsx scripts/db-migrate.ts` applied all 11 migrations
- [ ] `npx tsx scripts/supabase-setup.ts --check` prints `schema complete`
- [ ] "auth schema managed by GoTrue: **yes**" (proves 007 ran against real GoTrue)
- [ ] "no platform-admin row-level bypass remains"
- [ ] Buckets `menu` and `branding` exist with 5 MB / image-mime limits
- [ ] `SESSION_SECRET` generated fresh; not reused from development
- [ ] No `NEXT_PUBLIC_` prefix on any secret

**Deploy**

- [ ] `npm run build` passes locally
- [ ] `npm test` passes (product + audit)
- [ ] `npm run test:security` passes
- [ ] All Vercel env vars set for Production **and** Preview
- [ ] `/api/health` returns `200` with `"status": "ok"`
- [ ] `/api/realtime/token` returns `{"configured": false}` or a token — never an error page

**After deploy**

- [ ] `/menu/mati-kitchen` renders with photos from the CDN
- [ ] A dish photo uploads, replaces, and the old object is gone from Storage
- [ ] Guest order placed from a real phone on `/q/<token>`
- [ ] Owner accepts → kitchen prepares → waiter serves; guest tracker updates
- [ ] A second restaurant registered at `/register` sees **zero** MATI Kitchen rows
- [ ] `/dashboard/staff` lists the real team with emails
- [ ] Platform console refuses a non-admin account
- [ ] Suspending a tenant removes its menu from the public surface
- [ ] `email_outbox` shows the real status of any invitation sent
- [ ] Uptime monitor pointed at `/api/health`, alerting on non-200

---

## 8. What is verified, and what is not

| Area | Verified here | Needs real Supabase |
|---|---|---|
| 11 migrations apply from scratch | yes (embedded PG 18) | — |
| Migrations apply on GoTrue's `auth` schema | by construction (007 guards on `information_schema`) | **yes** |
| RLS tenant isolation | yes, 12 tests + 30 audit tests | — |
| Tenant isolation on Supabase | — | **yes** |
| Auth (sign-up, sign-in, sessions, reset) | yes | — |
| New restaurant gets an isolated workspace | yes | — |
| Storage upload / replace / delete / validation | yes (local driver) | **yes** (bucket policies, CDN URLs) |
| Storage bucket creation + limits | script written, not executed | **yes** |
| Email delivery | status recorded correctly; no provider key here | **yes** (provider account) |
| Realtime subscription | token minting + tenant claims tested | **yes** (live socket) |
| Production build (45 routes) | yes | — |

Anything marked **yes** in the last column is untested today. Running section 1.4
followed by `npm run test:security` with `DATABASE_URL` set closes the three
database rows in one command.
