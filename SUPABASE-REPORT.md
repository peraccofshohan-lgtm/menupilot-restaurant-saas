# Supabase readiness report

What was implemented across the seven phases, what was actually tested, what needs
credentials, what the audit found, and the exact steps to deploy.

- **Branch:** `arena/1e9a8a3e-menupilot-restaurant-saas`
- **Gate:** `npm test` → **122 passed, 0 failed** · `npx tsc --noEmit` clean ·
  `npm run build` compiles · `npm run smoke` → **29 passed, 0 failed**
- **Not claimed:** that Supabase is connected. It is not. No credentials exist in this
  environment and outbound TLS to `supabase.co` is filtered. Everything below marked
  "needs a live project" is written to the contract but unexecuted.

---

## 1. Implemented

### Database (phase 1)

| # | Migration | Purpose |
|---|---|---|
| 001–006 | existing | schema, RLS, business functions, ops, integrity, identity reads |
| 007 | `007_supabase_compat.sql` | Identity moved out of GoTrue's schema |
| 008 | `008_provisioning_checks.sql` | `mp_check_schema()` — verifies the live catalog |
| 009 | `009_email_outbox.sql` | Every email attempt and its real outcome |
| 010 | `010_platform_admin_scoping.sql` | Removes platform-admin RLS bypass |
| 011 | `011_tracking_token_hashing.sql` | Guest tokens hashed at rest; `status_changed_at` |

**The change that makes Supabase work at all (007).** On a real project GoTrue owns
`auth.sessions`, and it already contains GoTrue refresh-session ids. A
`create table if not exists auth.sessions` is therefore *silently skipped*, and every
login would fail at the first `INSERT`. Application identity now lives in
`public.user_credentials` (scrypt hash) and `public.app_sessions` (token digest),
keyed by the same uuid as `auth.users`, so `profiles` / `restaurant_members` /
`platform_admins` and all their foreign keys are untouched. The same migration set
now runs unchanged on a self-managed Postgres and on Supabase.

Tenant isolation is enforced by **forced** RLS on all 14 tenant tables plus composite
foreign keys, so a cross-tenant reference is impossible even from trusted code.

### Storage (phase 2)

`src/lib/services/storage.ts` — one interface, two drivers, identical path layout
`<restaurantId>/<kind>/<file>`:

| Driver | Bytes live in | Browser gets them via |
|---|---|---|
| `local` | Postgres `storage_objects` | `/api/media/<bucket>/<path>` (streamed) |
| `supabase` | buckets `menu` / `branding` | public CDN URL; `/api/media/...` 308-redirects |

Four gates before a byte is stored: declared MIME + 5 MB cap → file signature →
`sharp` decode and re-encode (proves it is an image, strips EXIF) → path composed
from the **session** tenant, never the request.

`replaceObject()` uploads, commits the row, *then* deletes the old object — so a swap
never shows a broken image, and a failed commit rolls the new object back.
`scripts/storage-gc.ts` reports (or deletes) unreferenced objects. Deleted dishes
delete their files; archived dishes keep theirs because they appear in order history.

### Email (phase 3)

`src/lib/services/email.ts` — Resend over HTTPS, 10 s timeout, env-var credentials
only. Every attempt is written to `public.email_outbox` with the real verdict:
`sent`, `failed`, or `skipped`. Bodies and provider response bodies are never stored,
and bodies are not logged in production.

When no key is configured the invitation still works: the link is generated, recorded
as `skipped`, and the UI shows **Copy invite link** with the text "email delivery is
not configured". It never claims a message was sent.

### Realtime (phase 4)

Server-minted 1 h JWTs carrying an `mp_topic` claim. The topic is derived from the
session's membership, never from the query string:

```
/api/realtime/token  →  mp_topic: "restaurant:<their own id>"
/api/realtime/order  →  mp_topic: "order:<hmac of their tracking token>"
```

`scripts/realtime-setup.sql` installs a `realtime.messages` policy that permits a
subscription only when the requested topic equals the signed claim. The channel
carries no rows — it is a "something changed, re-read your feed" signal, and the data
still comes from a route that re-derives tenancy per request.

**Polling remains the correctness guarantee.** No project, no secret, a refused
subscription, or a dead socket all fall back to the existing poller (6–45 s). Nothing
in the UI depends on the socket.

---

## 2. Tested

`npm test` — **122 tests**, all against a real PostgreSQL engine, applying all 11
migrations from scratch:

| Suite | Count | Covers |
|---|---|---|
| Product | 70 | auth, tenancy, QR, ordering, lifecycle, metrics, menu CRUD, staff, platform, error copy |
| Security audit | 31 | the attack surface listed in §4 |
| Supabase subsystems | 21 | storage drivers, replacement ordering, email outcomes, realtime topics |

`npm run smoke` — **29 checks** driving a *running* deployment over HTTP: health,
security headers, public menu render, image loading, QR → menu → order → tracker,
tampered-token refusal, idempotent replay, anonymous refusal on every protected
route, path traversal, unknown buckets, realtime guards.

Verified live in this session:

- All 7 owner dashboard surfaces `200`; 6 kitchen/waiter-restricted ones `307`
- Platform admin reaches `/platform*` (200) and is redirected away from `/dashboard`
- Forged `?restaurant=<other tenant>` on the realtime endpoint → `403 forbidden`
- Upload: 401 anonymous, PNG accepted and re-encoded (799 KB source → 157 B thumbnail),
  script renamed `.png` → `422`, PDF → `422`, traversal in filename stripped
- Guest order → 48-char token → tracker `200`; digest and tampered token → `404`;
  replay returns the same order number and **no token**
- Demo tenant intact: MATI Kitchen, 7 categories, 50 dishes, 20 tables, 311 orders

## 3. Credentials-dependent (not tested here)

| Item | Why it is blocked | What closes it |
|---|---|---|
| Migrations on GoTrue's `auth` schema | no project reached | `DATABASE_URL=… npx tsx scripts/db-migrate.ts` |
| Tenant isolation on real Supabase | same | `DATABASE_URL=… npm run test:security` |
| Storage bucket creation + policies + CDN URLs | same | `npx tsx scripts/supabase-setup.ts` |
| Realtime over a live socket | same | enable Realtime Authorization, run `scripts/realtime-setup.sql` |
| Email actually delivered | no Resend key | set `RESEND_API_KEY` + `EMAIL_FROM` |
| Transaction-pooler vs `set local role` | needs port 6543 | covered by the same migration run |

The boundary is stated in the product too: `SUPABASE.md` §8 is a table of exactly
which rows are verified and which are not.

## 4. Security issues found

Two real defects, both now fixed and covered by regression tests.

**1. High — platform administrators could read every tenant's orders.**
`migrations/002_rls.sql:230` read
`using (mp_is_member(restaurant_id) or mp_is_platform_admin())`. Any account flagged
as a platform admin could read all orders, guest names and phone numbers of every
restaurant, directly contradicting the documented promise that the console sees
aggregate health only. Fixed by `010_platform_admin_scoping.sql`: the bypass is
dropped on `orders` and `restaurants`, every other SELECT policy mentioning
`mp_is_platform_admin` is swept, and `mp_check_admin_scoping()` asserts the invariant
so CI and `/api/health` can catch a reintroduction.

**2. Medium — guest tracking tokens were stored in plaintext.**
`orders.tracking_token` is the only credential a guest holds. A database dump or a
leaked backup therefore allowed following live orders. `011` hashes it on insert via
trigger and hashes the presented value on read; the raw token exists exactly once, in
the response to the device that placed the order. Legacy plaintext tokens are
retired, not migrated — the digest cannot be derived from the value we have.

**Also fixed: the harness that hid both.** `tests/harness.ts` used a temporary
database while the code under test called `getDb()`, which silently resolved to
`.data/pglite`. Those integration tests could pass while exercising a different
database. `setup()` now installs the test database as the application handle; the two
findings above surfaced within minutes of that change.

**Verified as *not* vulnerable** (details in `SECURITY.md`): cross-tenant read/write,
role escalation, forged/truncated/revoked/replayed QR tokens, duplicate submission,
client-supplied pricing (server ignores it: `unit_price` stays 500 when the payload
says 1), negative quantities, illegal state transitions, upload traversal and magic
bytes, session token handling (sha256 at rest, identical error for wrong password and
unknown email), and no secret in any `"use client"` file.

---

## 5. Deploy instructions

Full runbook: **`SUPABASE.md`**. The short version:

```bash
# 1. Database
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
  npx tsx scripts/db-migrate.ts

# 2. Verify the project (changes nothing)
DATABASE_URL="…" npx tsx scripts/supabase-setup.ts --check
#   → "schema complete", "auth schema managed by GoTrue: yes",
#     "no platform-admin row-level bypass remains"

# 3. Storage buckets (menu, branding: 5 MB, jpeg/png/webp)
SUPABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…" DATABASE_URL="…" npx tsx scripts/supabase-setup.ts

# 4. Realtime (optional): enable Realtime Authorization in the dashboard,
#    then run scripts/realtime-setup.sql

# 5. Demo tenant (optional, once — not part of the build)
DATABASE_URL="…" DEMO_OWNER_PASSWORD="<strong>" npx tsx scripts/db-seed.ts
```

Vercel environment variables (Production **and** Preview):

| Name | Required |
|---|---|
| `DATABASE_URL` | yes — pooler, port **6543** |
| `SESSION_SECRET` | yes — `openssl rand -base64 32` |
| `APP_URL` | yes — `https://your-domain.com`, no trailing slash |
| `STORAGE_DRIVER` | yes — `supabase` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | yes |
| `SUPABASE_ANON_KEY`, `REALTIME_JWT_SECRET` | for realtime |
| `NEXT_PUBLIC_SUPABASE_STORAGE_URL` | recommended — renders from the CDN |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email |
| `DATABASE_POOL_MAX` | optional (default 10) |

Use the pooler: serverless functions open a connection per invocation and exhaust
direct connections under load.

Then verify the deployment:

```bash
npx tsx scripts/smoke.ts https://your-domain.com <a-real-table-qr-token>
```

The 20-point checklist (before deploy / deploy / after deploy) is in `SUPABASE.md` §7.

---

## 6. Files added

```
migrations/007_supabase_compat.sql      identity out of GoTrue's schema
migrations/008_provisioning_checks.sql  mp_check_schema()
migrations/009_email_outbox.sql         email audit trail
migrations/010_platform_admin_scoping.sql  security fix #1
migrations/011_tracking_token_hashing.sql  security fix #2

src/lib/media.ts                        one URL helper, both drivers
src/lib/services/storage.ts             StorageService, replaceObject, validation
src/lib/services/email.ts               sendEmail + templates
src/lib/realtime/client.ts              Phoenix-protocol socket, no deps
src/lib/env.ts                          supabase / realtime / email config
src/components/dashboard/realtime-bridge.tsx  useRealtimePulse, useOrderRealtimePulse
src/app/api/health/route.ts             readiness probe
src/app/api/realtime/{token,order}/route.ts   tenant- and guest-scoped tokens
src/app/api/uploads/{menu,branding}/route.ts  validated uploads
src/app/api/media/[...path]/route.ts    local streaming, CDN redirect

scripts/supabase-setup.ts               buckets + verification (--check)
scripts/realtime-setup.sql              channel authorization policy
scripts/storage-gc.ts                   orphan sweep (dry run by default)
scripts/smoke.ts                        29 checks against a live deployment

tests/assert.ts                         assertion + collector helpers
tests/subsystems.test.ts                21 storage / email / realtime tests
tests/security.test.ts                  31 security audit assertions
tests/security-run.ts                   audit only (pre-deploy gate)

SUPABASE.md                             deployment runbook
vercel.json                             region, timeouts, headers
.env.example                            every variable, documented
```

Docs updated: `README.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`,
`DEPLOYMENT.md`.

---

## 7. What to do next

The three untested database rows in §3 all close with one command, once a project
exists:

```bash
DATABASE_URL="<pooler string>" npx tsx scripts/db-migrate.ts
DATABASE_URL="<pooler string>" npm run test:security
```

If any of those 31 assertions fail on real Supabase, it will almost certainly be a
pooler interaction (`set local role` across a transaction boundary) rather than an
RLS logic error — that is the one thing this environment cannot exercise.

To go live I need from you:

1. The **pooler** connection string for the Supabase project
2. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
3. The project's **JWT secret** (for realtime), or confirmation to skip realtime
4. A **Resend API key** and the verified `EMAIL_FROM` sender, or confirmation to ship
   with email disabled (the UI handles it honestly)
