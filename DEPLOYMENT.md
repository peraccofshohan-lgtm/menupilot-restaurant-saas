# Deployment

Target: any Node host that runs Next.js (Vercel recommended), with Supabase as the managed backend.

> **The complete, current runbook is [`SUPABASE.md`](./SUPABASE.md).** It covers the
> storage buckets, realtime authorization, email, the deployment checklist and the
> precise line between what is tested and what still needs a live project. This file
> is the short version.

## 1. Supabase project

1. Create a project at <https://supabase.com>.
2. Copy the **pooler** connection string (Project Settings → Database → Connection pooling):
   ```
   DATABASE_URL=postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
3. Create the storage buckets — do not do this by hand, the script sets the size and
   MIME limits too:
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DATABASE_URL=… npx tsx scripts/supabase-setup.ts
   ```

## 2. Migrations

Every migration is additive and idempotent, and none of them create or alter columns in
GoTrue's `auth.users` beyond making a local stand-in compatible. Application identity
lives in `public.user_credentials` and `public.app_sessions` (see `DATABASE.md`), so the
same set applies cleanly to a Supabase project. Run:

```bash
DATABASE_URL="postgres://…" npm run db:migrate
```

Then verify what landed rather than assuming:

```bash
DATABASE_URL="postgres://…" npx tsx scripts/supabase-setup.ts --check
```

It prints `schema complete`, whether GoTrue owns `auth`, the tenant/demo counts, and
whether any platform-admin row-level bypass survived.

If you use Supabase Auth instead of the built-in auth module, point your application's sign-in flow at GoTrue and
keep the same `auth.users` id space — the migrations already reference it.

## 3. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase pooler connection string |
| `SESSION_SECRET` | yes | `openssl rand -base64 32` |
| `APP_URL` | yes | Public origin, used in QR payloads (`https://app.yourdomain.com`) |
| `STORAGE_DRIVER` | yes | `supabase` in production |
| `SUPABASE_URL` | if storage=supabase | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | if storage=supabase | Server-only. Never expose to the browser |
| `SUPABASE_STORAGE_PUBLIC_URL` | optional | Public object base for fast CDN reads |
| `NODE_ENV` | yes | `production` (enables `Secure` cookies) |

## 4. Vercel

```bash
vercel link
vercel env add DATABASE_URL production
vercel env add SESSION_SECRET production
vercel env add APP_URL production
vercel env add STORAGE_DRIVER production
vercel --prod
```

Build command `npm run build`, output handled by the Next.js adapter. No cron jobs are required; live screens poll.

> **Important:** set `APP_URL` to the final public domain **before** generating table QR codes. QR payloads embed
> that origin — if it changes later, rotate the tokens and reprint.

## 5. First-run

```bash
DATABASE_URL="…" npm run db:migrate
```

Then sign in, complete onboarding, add dishes, print the QR sheet from **Tables & QR → Print sheet**.

To seed the demo tenant in production (optional, and usually not wanted on a live domain):

```bash
DATABASE_URL="…" DEMO_OWNER_PASSWORD='…' npm run db:seed
```

The demo tenant is a normal tenant: it gets nothing from other restaurants and gives nothing to them.

## 6. Granting platform administrator

Platform admins are rows in `public.platform_admins`. There is deliberately no self-service elevation:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'you@yourdomain.com';
```

## 7. Backups and retention

- Enable Supabase point-in-time recovery for the production project.
- `storage_objects`, `audit_logs` and `rate_limit_buckets` grow over time. `prune_rate_limits()` clears stale
  limiter rows (call it from a daily cron or `pg_cron`).
- Order history is append-only by design; archive old tenants by exporting, not by deleting.

## 8. Health checks after deploy

```bash
curl -I https://app.yourdomain.com/                 # 200
curl -I https://app.yourdomain.com/menu/mati-kitchen # 200 (or 404 if the demo is not seeded)
curl -I https://app.yourdomain.com/dashboard         # 307 → /login
```

Then walk the five-minute checklist in `SETUP.md` against the deployed URL, including a real phone scanning a
printed table code.

## 9. Operational notes

| Concern | Guidance |
|---|---|
| Session secret rotation | Rotating invalidates all sessions (users must sign in again). Do it deliberately. |
| QR rotation | Dashboard → Tables & QR → *New QR*. Old printouts stop working immediately. |
| Suspending a tenant | `/platform/restaurants` → Suspend. Guest access stops at once; the owner can still sign in. |
| Staff removal | Removes dashboard access immediately, including the current session for that restaurant. |
| Log visibility | Server errors are logged with context; they never surface raw SQL to users. |
