# Setup

## Prerequisites

- Node.js 20+ (developed on 22)
- npm 10+
- No Docker, no local PostgreSQL required — the default engine is embedded

## 1. Install

```bash
npm install
```

## 2. Environment

```bash
cp .env.example .env.local
```

Then generate a session secret:

```bash
openssl rand -base64 32
```

and paste it into `SESSION_SECRET`. The app refuses to start authenticated flows without it.

Everything else has a working default for local development:

| Variable | Default | Meaning |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | Origin embedded in QR payloads |
| `DATABASE_URL` | *(unset)* | If set, uses this PostgreSQL instead of the embedded engine |
| `DATABASE_PGLITE_DIR` | `.data/pglite` | Embedded engine data directory |
| `STORAGE_DRIVER` | `local` | `local` (database-backed) or `supabase` |
| `SESSION_SECRET` | — | **Required.** Session cookie signing material |

## 3. Database

```bash
npm run db:migrate   # creates the schema, policies and functions
npm run db:seed      # creates MATI Kitchen, 50 dishes, 20 QR tables, demo orders
```

Both are idempotent and both work against either engine.

What the seed does:

1. Creates the demo owner (`owner@mati.demo`), a kitchen account and a platform admin.
2. Creates the `MATI Kitchen` tenant with BDT currency, `Asia/Dhaka` time zone, 5% VAT and 5% service charge.
3. Uploads 9 original food photographs through the storage service and attaches them to the menu.
4. Creates 7 categories across 50 dishes with real prices, descriptions and prep times.
5. Creates 20 dining tables across three zones, each with a 192-bit QR token.
6. Generates 4 weeks of realistic order history (~290 orders) with a believable status mix.
7. Writes the generated passwords to `.data/demo-credentials.txt` (git-ignored).

To choose the passwords yourself:

```bash
DEMO_OWNER_PASSWORD='YourStrongPass123' npm run db:seed -- --reset
```

## 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>.

## 5. Verify your install

```bash
npm run typecheck   # strict TypeScript, zero errors expected
npm test            # 70 integration + security tests
npm run build       # production build
```

## Walk the whole product in five minutes

1. Sign in as `owner@mati.demo` → `/dashboard` shows live metrics from the seeded orders.
2. **Tables & QR** → open any table's QR preview, or open the print sheet.
3. Copy a table URL (`/q/<token>`) into a private window → you land on the MATI menu with that table attached.
4. Add two dishes → **Review order** → place it. You land on a private tracking page.
5. Back in the dashboard the order appears under **Incoming orders** as *pending* within a few seconds.
   Accept it → it moves to the kitchen display.
6. Open `/dashboard/kitchen` in a second window → start preparing → mark ready → mark served.
7. The guest tracking page follows along.
8. Register a brand-new account → onboarding wizard → your workspace has its own empty menu,
   its own tables and **none of MATI Kitchen's data**.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing required environment variable: SESSION_SECRET` | `.env.local` not created | Copy `.env.example`, set the secret |
| Empty dashboard after seeding | Seed ran against a different data directory | Check `DATABASE_PGLITE_DIR` matches between commands |
| `The QR code is not valid` | Table deactivated, or QR rotated | Dashboard → Tables & QR → Activate / New QR |
| Login loops back to `/login` | Cookies blocked | Allow cookies for the site; `Secure` is only set in production |
| Port already in use | Another dev server | `npm run dev -- -p 3001` |
