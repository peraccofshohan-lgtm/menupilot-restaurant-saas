# MenuPilot — first Supabase deployment handoff

Everything below is ordered, verified against this repository, and safe to run against
a production project. It supersedes the sequence in `SUPABASE.md` where the two
differ; `SUPABASE.md` remains the long-form reference.

**Status: nothing here has been executed against a live Supabase project.** No
credentials exist and outbound TLS to `supabase.co` is blocked from this environment.
Section 8 states exactly what that leaves unverified.

---

## 1. Repository state (verified, not assumed)

| Item | Value |
|---|---|
| Repository | `https://github.com/peraccofshohan-lgtm/menupilot-restaurant-saas` |
| Branch | `arena/1e9a8a3e-menupilot-restaurant-saas` |
| Commit at time of writing | see `git log --oneline -1` — the `simulate-gotrue` commit |
| Pushed | yes; `git rev-parse HEAD` and `origin/<branch>` are identical, 0 ahead / 0 behind |
| Uncommitted changes | none |
| Demo tenant | MATI Kitchen — 7 categories, 50 dishes, 20 tables, 311 demo orders |

Verify locally before you start:

```bash
git rev-parse --abbrev-ref HEAD          # the branch above
git log --oneline -1                     # the latest commit
git status --porcelain                   # must print nothing
git fetch origin && git rev-list --left-right --count HEAD...origin/arena/1e9a8a3e-menupilot-restaurant-saas
                                         # must print "0	0"
```

---

## 2. Credentials — where they go

**Do not paste secrets into chat, an issue, a commit, or a `.env` file that is
tracked.** Use the platform's secure secrets manager:

| Host | Where |
|---|---|
| Vercel | Project → Settings → Environment Variables (set for **Production and Preview**) |
| Local development | `.env.local` — already git-ignored |
| CI | the CI provider's secret store |

`git check-ignore -v .env.local` should confirm it is ignored. `.env.example` documents
every variable with no values; never commit a filled-in copy.

### Required variables

| Variable | Where to get it | Required |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Connection pooling**, *Transaction* mode, port **6543** | yes |
| `SESSION_SECRET` | generate yourself: `openssl rand -base64 32` | yes |
| `APP_URL` | your production origin, e.g. `https://menu.example.com` (no trailing slash) | yes |
| `STORAGE_DRIVER` | literal `supabase` | yes |
| `SUPABASE_URL` | Project Settings → API → Project URL | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` secret | yes — **server only** |
| `SUPABASE_ANON_KEY` | Project Settings → API → `anon` public key | for realtime |
| `NEXT_PUBLIC_SUPABASE_STORAGE_URL` | `https://<ref>.supabase.co/storage/v1/object/public` | recommended |
| `REALTIME_JWT_SECRET` | Project Settings → API → JWT Settings → JWT Secret | only if realtime is enabled |
| `RESEND_API_KEY` | resend.com → API Keys | for email |
| `EMAIL_FROM` | a sender on a domain verified in Resend, e.g. `MenuPilot <no-reply@example.com>` | with the key above |
| `DATABASE_POOL_MAX` | optional, default `10` | no |

Rules that are enforced in code and tested:

- `NEXT_PUBLIC_*` values are embedded in the browser bundle. **Never** prefix
  `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `RESEND_API_KEY` or
  `REALTIME_JWT_SECRET` with `NEXT_PUBLIC_`.
  The audit suite scans every `"use client"` file for those names and fails if one appears.
- `REALTIME_JWT_SECRET` is only needed if you enable Realtime. Without it the UI polls
  and everything still works.
- Email is optional. Without `RESEND_API_KEY` the app records invitations as `skipped`
  and offers **Copy invite link**; it never claims a message was sent.

**On the connection string.** Use the pooler (6543), not the direct host (5432).
Serverless functions open a connection per invocation and will exhaust direct
connections. Append `?sslmode=require` if your network demands it explicitly.

---

## 3. Deployment sequence

Run these in order. Steps 1–2 are done in a browser; steps 3+ are commands.

### Step 1 — Create the project

Supabase → New project. Choose the region closest to the restaurants (for Dhaka,
`ap-southeast-1` / Singapore is the usual pick). Save the database password somewhere
safe — the pooler string in step 2 needs it.

### Step 2 — Collect the connection details

From the dashboard, record (not in chat): the pooler connection string, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and the JWT secret if you want realtime.

### Step 3 — Configure the environment

Set every required variable from §2 in your secrets manager. For a local dry run first:

```bash
cp .env.example .env.local     # then fill it in; this file is git-ignored
```

### Step 4 — Apply migrations

```bash
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
  npx tsx scripts/db-migrate.ts
```

- 12 migrations, each in its own transaction, in filename order.
- **Non-destructive.** Every statement is `create ... if not exists`, `create or
  replace`, `add column if not exists`, or an `alter` guarded by a catalog check.
  Nothing is dropped, truncated, or reset.
- Provably safe against a GoTrue-shaped database: `npm run test:gotrue` builds one
  (auth owned by another role, `auth.users` with GoTrue's columns) and applies all 12.
- **Never** run `npm run db:reset` against a project. It deletes a *local* directory;
  it is not for remote databases, and there is no reason to run it here.

If a migration fails, the transaction rolls back for that file only and earlier files
stay applied. Fix forward — do not edit an already-applied migration.

### Step 5 — Configure authentication

MenuPilot authenticates with its own email + scrypt password flow and stores sessions
in `public.app_sessions`. It does **not** use Supabase Auth to sign users in, so:

- **Do not** enable "Confirm email" or "Email OTP" for a flow you expect to work —
  they belong to Supabase Auth, which this app does not call.
- Users are created through `/register` (or `scripts/db-seed.ts` for the demo), which
  writes `auth.users` (the identity anchor and FK target), `public.user_credentials`
  (the password hash) and `public.profiles`.
- No SMTP configuration in Supabase is required. Password-reset mail goes through
  Resend directly.

### Step 6 — Create the storage buckets

```bash
SUPABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…" DATABASE_URL="…" \
  npx tsx scripts/supabase-setup.ts
```

Creates `menu` and `branding`: public **read**, 5 MB, JPEG/PNG/WebP only. Public read is
deliberate — these objects *are* the published menu and are rendered by anonymous
guests. Writes are not public: uploads run server-side with the service role, after the
caller's tenant has been resolved from their session.

### Step 7 — Apply storage policies

Step 6 does this. The buckets are created with the limits above and no permissive write
policy, so the anon key cannot upload. Verify in the dashboard: Storage → each bucket →
Policies should show no INSERT/UPDATE policy for `anon`/`authenticated`.

### Step 8 — Configure Realtime (optional)

Skip this entirely if you want polling only — the app works either way.

1. Dashboard → Realtime → Settings → enable **Realtime Authorization**
2. Run `scripts/realtime-setup.sql` in the SQL editor
3. Set `REALTIME_JWT_SECRET` to the project JWT secret and `SUPABASE_ANON_KEY`

The channel policy only permits a subscription whose topic equals the `mp_topic` claim
in the server-minted token, so a client cannot subscribe to another tenant's channel by
editing the topic.

### Step 9 — Verify the project

```bash
DATABASE_URL="…" SUPABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…" \
  npx tsx scripts/supabase-setup.ts --check
```

`--check` is **read-only**: it does not apply migrations, create buckets, or write rows.
It asserts:

```
✓ all 12 migrations applied
✓ schema complete (Postgres 15.x)
✓ auth schema managed by GoTrue: yes
✓ no platform-admin row-level bypass remains
✓ credential material is closed to browser roles
✓ RLS enabled on N public tables and forced
```

"auth schema managed by GoTrue: **yes**" is the single most important line: it proves
the app detected a real Supabase project and kept its hands off the `auth` schema.

Optionally, prove tenant isolation on the real project (this *does* write fixtures, and
removes them afterwards):

```bash
DATABASE_URL="…" MENUPILOT_TEST_EXTERNAL=1 npm run test:security:remote
```

It refuses to run against an unmigrated database, never applies DDL to a target it did
not create, and prints `fixtures removed from the target database` when done.

### Step 10 — Run the smoke test against the deployment

Only after Vercel has deployed (step 5 of §4):

```bash
npx tsx scripts/smoke.ts https://your-domain.com <a-real-table-qr-token>
```

Pass a QR token from a real table to include the guest-order path (scan → menu → order →
tracker → tampered token → replay). Without one those checks are skipped and the rest
still run.

**The demo tenant is never touched by any of the above.** No step resets MATI Kitchen,
regenerates its QR tokens, or reseeds it. If you want the demo on production, run
`DEMO_OWNER_PASSWORD="<strong>" npx tsx scripts/db-seed.ts` once — deliberately, not as
part of a build.

---

## 4. Vercel

| Setting | Value |
|---|---|
| Framework preset | Next.js (auto-detected) |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output | `.next` (default) |
| Node version | 20 or 22 |
| Region | `sin1` (pinned in `vercel.json`) |

`vercel.json` also pins a 30 s ceiling for API routes and no-store on `/api/health`.
Security headers (`nosniff`, referrer policy, permissions policy) are set in
`next.config.ts`, so they apply on **every** host — not only Vercel, and not only when
the `vercel.json` rules are in play.

### Production URL and auth redirects

- Set `APP_URL` to the final origin. It is used to build absolute links in emails
  (invitations, password resets). A trailing slash is trimmed, but set it without one.
- Add the domain in Vercel → Settings → Domains, then set `APP_URL` again if the
  canonical host differs from the `*.vercel.app` URL.
- No OAuth or Supabase-Auth redirect URLs need configuring — MenuPilot's own session
  cookie is the only mechanism, and it is `httpOnly`, `sameSite=lax`, `secure` in
  production.
- Set every variable for **Preview** as well as Production, or preview deployments will
  503 at `/api/health`.

### After deploy

```bash
curl -s https://your-domain.com/api/health | jq
```

Expect `"status": "ok"` and each check `ok`. A 503 names the failing check in its
`detail` — that is the fastest way to spot a bad `DATABASE_URL` or a missing bucket.

---

## 5. Verifying real production security

Each row below is either **verified here** (against a real PostgreSQL engine, all 12
migrations, real RLS) or **unverified** (needs the live project). Nothing is called
verified without a passing assertion.

| Area | What is asserted | Status |
|---|---|---|
| RLS enabled + forced | 14 tenant tables `FORCE ROW LEVEL SECURITY`; asserted in the suite and in `--check` | **verified** |
| Tenant isolation (read) | owner A sees 0 rows of B's orders/customers/tables/members | **verified** |
| Tenant isolation (write) | cross-tenant insert/update raises an RLS error or affects 0 rows | **verified** |
| Forged restaurant id | a client-supplied id is ignored; tenancy comes from the session | **verified** |
| Guest order creation | `create_order` prices server-side, rejects sold-out/foreign items | **verified** |
| Owner approval | `transition_order` accepts `pending→accepted` for an owner | **verified** |
| Kitchen authorization | kitchen role cannot accept/reject/serve; refusal is explicit | **verified** |
| Tracking token hashing | stored value is a 64-char sha256; the digest itself is not a working token | **verified** |
| Platform admin limits | admins get aggregates only, and no ambient row access | **verified** |
| Storage upload + render | validation chain, tenant-prefixed paths, replace/rollback | **verified** (local driver) |
| Realtime tenant isolation | topic must equal the signed claim; forged topic refused | **verified** (claim logic) |
| Auth + sessions | sha256 at rest, expiry/revoke, identical error for unknown email | **verified** |
| Migrations on GoTrue's auth schema | all 12 apply to a faithful simulation | **verified** (simulated) |
| Staff/platform name resolution on GoTrue | reads `raw_user_meta_data` | **verified** (simulated) |
| Real project: migrations | — | **unverified** — run §3 step 4 |
| Real project: RLS behaviour | — | **unverified** — run §3 step 9's `test:security:remote` |
| Real bucket policies + CDN URLs | — | **unverified** — run §3 step 6, then upload a dish image |
| Live websocket subscription | — | **unverified** — open the kitchen display with realtime on |
| Actual email delivery | — | **unverified** — send one invitation and read `email_outbox` |

### Known residual risk

The pooler runs in **transaction mode**, where a connection may serve different
sessions between statements. The app's tenancy model depends on `SET LOCAL ROLE` +
`request.jwt.claims` inside a single transaction, which is the supported pattern, but
this has never been exercised against a real pooler. If any assertion in
`test:security:remote` fails, check that first — it is far more likely than an RLS logic
error. The fallback is the session-mode pooler on port 5432 with a small pool.

---

## 6. Not doing / do not do

- No destructive migration, no `truncate`, no `drop table` anywhere in the 12 files.
- The demo tenant and its QR tokens are not reset by any deployment step.
- No secret is committed; `.env.example` holds names only.
- The site is **not** live and **not** connected to Supabase. It cannot be until the
  credentials in §2 exist.

---

## 7. Blockers to going live

1. **Supabase project + pooler connection string** — nothing can be applied without it.
2. **Supabase API keys** (`SUPABASE_URL`, service role, anon) — storage and realtime.
3. **JWT secret** — only if realtime is wanted; otherwise say "skip realtime".
4. **Resend API key + verified sender** — only if invitation/reset email must actually
   arrive; otherwise say "ship with email disabled" and the UI will report it honestly.
5. **Vercel project linked to the repository**, with the variables set for Production
   and Preview.
6. **Your explicit approval to deploy.**

---

## 8. Exact next steps

```bash
# 0. confirm the state you are deploying
git log --oneline -1 && git status --porcelain

# 1. local gate (all must pass)
npm ci
npm run typecheck
npm test                  # 122 tests
npm run test:gotrue       # 11 checks against a GoTrue-shaped database
npm run build

# 2. against the real project (needs DATABASE_URL)
DATABASE_URL="…" npx tsx scripts/db-migrate.ts
DATABASE_URL="…" SUPABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…" \
  npx tsx scripts/supabase-setup.ts --check

# 3. prove isolation on the real project
DATABASE_URL="…" MENUPILOT_TEST_EXTERNAL=1 npm run test:security:remote

# 4. after Vercel deploys
curl -s https://your-domain.com/api/health
npx tsx scripts/smoke.ts https://your-domain.com <table-qr-token>
```

Then report back with the output of step 2 and step 4. Those two outputs are what turn
every "unverified" row in §5 into a verified one.
