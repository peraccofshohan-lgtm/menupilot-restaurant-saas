# MenuPilot

**A multi-tenant restaurant management SaaS platform.** Guests scan a table QR code, order from a live menu,
the restaurant approves the order, and only then does it reach the kitchen. Every restaurant is an isolated
tenant with its own menu, tables, staff, orders and analytics.

This is a working full-stack product, not a prototype: real PostgreSQL, real authentication, real Row Level
Security, real order state machine, real storage.

```
Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4
PostgreSQL (Supabase-compatible migrations + RLS) · Lucide icons
```

---

## What is actually implemented

| Area | Status |
|---|---|
| Public marketing site (`/`, `/features`, `/pricing`, `/contact`) | Done |
| Registration, login, logout, password reset, sessions | Done |
| Restaurant onboarding wizard → isolated tenant workspace | Done |
| Owner dashboard with live metrics (real SQL aggregates) | Done |
| Order management: pending → accepted → preparing → ready → served / rejected / cancelled | Done |
| Kitchen Display System (3 columns, live feed, ticket ageing) | Done |
| Menu + category CRUD, image upload, availability, ordering | Done |
| Tables, cryptographic QR tokens, rotation, PNG/SVG export, print sheet | Done |
| Guest menu, dish detail, cart, server-priced checkout | Done |
| Guest order tracking via private token | Done |
| Staff invitations, roles, role-enforced navigation and authorization | Done |
| Analytics: daily revenue, top dishes, category performance, status mix | Done |
| Customer book (per tenant) | Done |
| Platform admin console (tenant status, users, aggregate analytics) | Done |
| Multi-tenant RLS + composite foreign keys | Done, tested |
| Idempotent order submission, per-device rate limiting | Done |
| Demo tenant **MATI Kitchen**: 50 dishes, 20 QR tables, 4 weeks of orders | Done |
| Automated test suite (100 tests: 70 product + 30 security audit) | Done |
| Supabase-ready: GoTrue-compatible identity tables, Storage driver, Realtime, email | Done (see status note) |
| Deployment tooling: schema check, bucket setup, health probe, storage GC | Done |

### Deliberately not implemented

These are **not** in the product and the UI does not pretend otherwise:

- **Online payments.** Guests pay at the counter, as stated on the cart and the tracking page.
- **Food variants and add-ons.** Dishes have a single price and an optional per-line note. There is no variant
  editor, so none is shown.
- **Email delivery without a provider.** The integration is complete (Resend over HTTPS, `email_outbox` audit
  trail, honest UI copy) but ships unconfigured. Without `RESEND_API_KEY` the app says
  "email delivery is not configured" and offers **Copy invite link**; it never claims a message was sent.
- **Billing/subscriptions.** The pricing page is marketing copy; no plan limits are enforced in the database.
- **Realtime without a Supabase project.** The tenant-scoped token endpoint, claim-verified channel policy and
  client are implemented, and live screens fall back to polling (6–45 s) whenever realtime is unavailable.

---

## Quick start

```bash
npm install
cp .env.example .env.local          # then set SESSION_SECRET
npm run db:migrate                  # apply migrations to the embedded PostgreSQL
npm run db:seed                     # create MATI Kitchen + demo accounts
npm run dev                         # http://localhost:3000
```

The demo seed prints the generated credentials and writes them to `.data/demo-credentials.txt`
(git-ignored). **No password is ever committed.** Set `DEMO_OWNER_PASSWORD` before seeding to choose your own.

Demo accounts:

| Account | Role | Where |
|---|---|---|
| `owner@mati.demo` | Restaurant owner — MATI Kitchen | `/dashboard` |
| `kitchen@mati.demo` | Kitchen staff — kitchen display only | `/dashboard/kitchen` |
| `admin@menupilot.demo` | Platform administrator | `/platform` |

Guest flows to try:

- `/menu/mati-kitchen` — public menu, browse only
- `/q/<token>` — scan-equivalent entry (tokens are in **Dashboard → Tables & QR**)
- `/order/<token>` — the private tracking link a guest gets after ordering

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on `0.0.0.0:3000` |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Full integration + security suite against real PostgreSQL |
| `npm run db:migrate` | Apply pending migrations (idempotent) |
| `npm run db:seed` | Create the demo tenant (idempotent) |
| `npm run db:seed -- --reset` | Rebuild the demo tenant from scratch |
| `npm run db:reset` | Delete the embedded database directory |
| `npm run test:security` | Security audit suite only (pre-deploy gate) |
| `npm run storage:setup` | Create Supabase buckets and verify schema (needs credentials) |
| `npm run db:status` | Verify a Supabase project without changing it |
| `npm run storage:gc` | Report (or `--delete`) unreferenced media objects |

---

## Architecture at a glance

```
Browser ──► Next.js App Router (server components + server actions + route handlers)
                │
                ├─ src/lib/auth        sessions, password KDF, tenant resolution
                ├─ src/lib/services    domain queries (orders, menu, tables, staff, analytics)
                ├─ src/lib/actions     server actions (validated mutations)
                ├─ src/lib/db          engine-agnostic PostgreSQL access + RLS session context
                └─ src/lib/seed        MATI Kitchen demo data
                        │
                        ▼
              PostgreSQL: schema · RLS policies · business functions
              (Supabase Postgres in production, embedded PGlite locally)
```

Full detail: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · schema: [`DATABASE.md`](./DATABASE.md) ·
security model: [`SECURITY.md`](./SECURITY.md) · setup: [`SETUP.md`](./SETUP.md) ·
deployment: [`SUPABASE.md`](./SUPABASE.md) (Supabase + Vercel runbook) and [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## A note on the database in this build

The production target is **Supabase** (PostgreSQL + Storage + Realtime). This sandbox has **no Supabase
credentials** and filters TLS to `supabase.co`, so the suite runs on **embedded PostgreSQL 18** (PGlite) — a real
PostgreSQL engine with the same migrations, the same RLS policies and the same functions.

What that means precisely:

- **Tested here:** all 11 migrations from scratch, every RLS policy, the order workflow, storage validation and
  replacement, session handling, and the isolation guarantees — 100 tests.
- **Written to the Supabase contract but not executed against a live project:** GoTrue-managed `auth` schema
  compatibility, Storage bucket policies, Realtime subscriptions, and email delivery.
- **Not claimed:** that Supabase is connected. It is not.

`SUPABASE.md` lists exactly which rows need a live project, and the command that closes them
(`DATABASE_URL=… npm run test:security`). Nothing about tenant isolation or the order workflow is simulated.
