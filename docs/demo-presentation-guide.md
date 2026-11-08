# MATI Kitchen — live client demo guide

Everything a walkthrough needs, and an honest account of what is and is not
wired up. Written for the moment before a client sits down.

## What exists

| | |
| --- | --- |
| Tenant | MATI Kitchen · `1eb6fd7d-ef03-4cdb-afdc-d94f72f33dd4` |
| Categories | 7 |
| Dishes | 50, each with its own photograph (50/50 unique) |
| Tables | 20, each with its own QR token (48 hex chars) |
| Print kit | 6-page A4 PDF — cover overview + five cut-out sheets |
| Staff logins | owner / kitchen / admin |

Pictures are optimised WebP (1200×1200, quality 82, ~129 KiB each) served from
the app's own storage layer. No placeholders, no hotlinks.

## Building the QR kit

```bash
# stop the dev server first — PGlite is single-writer
npm run qr:kit -- --origin https://<public-host>
npm run qr:verify -- artifacts/mati-kitchen-qr-kit.pdf
```

`qr:kit` reads the twenty tokens from `public.qr_tokens` and refuses to run
unless there are exactly twenty, all distinct, all at least 32 characters, with
twenty distinct table labels. It never generates or guesses a token.

`qr:verify` is the check that matters: it renders every page of the finished PDF
to a bitmap, decodes each QR with `jsQR` — the same class of decoder a phone
camera feeds — and asserts that the set of encoded tokens is **exactly** the set
of tokens in the database. A PDF can look perfect and encode the wrong token;
this catches that. Current result: 20/20 decoded, 0 foreign tokens, 0 tables
missing, PASS.

The PDF deliberately is **not in Git**: it embeds twenty live table tokens, which
are credentials. Rebuild it locally when you need it.

## Running the demo

```bash
npx next dev -H 0.0.0.0 -p 3000
```

- Guest: scan a card, or open `/q/<token>` on a table phone.
- Staff: `/login` → `owner@mati.demo` (password in `.data/demo-credentials.txt`).

### The story to walk a client through

1. Guest scans the QR on Table 01 → menu opens already knowing the table.
2. Browse by category, open a dish, add to cart, change quantity, remove a line.
3. Place the order → guest gets an order number and a private tracking link.
4. Owner dashboard shows it under Pending. **The kitchen cannot start it yet** —
   the API returns 422 and the state machine refuses `pending → preparing`.
5. Owner accepts → the order appears on the kitchen display.
6. Kitchen marks Preparing, then Ready.
7. Guest's tracking page shows Ready, with no refresh needed on a fast connection
   and within the poll interval otherwise.
8. Owner marks Served.

Steps 4 and 5 are the ones that demonstrate the product is a real system rather
than a form: try to move the order to Preparing as kitchen before the owner
accepts, and let them watch it be refused.

## Demo reset

`/dashboard/demo` (owner only) clears the orders a walkthrough left behind.

- It shows what would be deleted (orders, line items, status history, guest
  records) and what never will be (dishes, categories, tables, QR codes),
  side by side, before anything happens.
- The button stays disabled until you type `RESET`.
- The server re-checks four things inside the database function:
  the caller is signed in, they are `owner` of this restaurant, the restaurant is
  flagged `is_demo`, and the order count still matches the one on screen. If a
  guest orders in between, nothing is deleted and you are asked to look again.
- The function re-reads the protected counts before returning and raises if any
  moved, so a bug fails loudly instead of quietly deleting a menu.

Covered by five tests in `npm test` (suite: `demo reset`), including
"leaves another tenant's orders alone" and "clears orders but never the menu,
tables, QR tokens or settings".

## Deployment readiness — the honest status

**This demo runs on localhost behind a preview proxy. It is not publicly
deployed.** Nothing below is faked.

| Area | Status | What that means |
| --- | --- | --- |
| Public URL | Preview proxy only | `https://3000-<sandbox>.e2b.app` forwards to the container. A phone on another network reaching it is untested from inside the sandbox. |
| Database | Local PGlite | Embedded Postgres in `.data/`. Single-writer; a deploy target needs a real Postgres `DATABASE_URL`. |
| Storage | `STORAGE_DRIVER=local` | Images live as rows in Postgres and are streamed by `/api/media`. Works, but not a CDN. |
| Supabase | **Not connected** | Zero Supabase environment variables. Auth, storage and realtime all use local drivers. |
| Realtime | Polling | No Supabase Realtime socket. The dashboard polls on a short interval; the code falls back to polling whenever a socket is unavailable, by design. |
| Email | Not configured | Invitations and resets log to the console in development. |
| RLS | Enforced locally | The same policies PostgREST would apply, verified by the 31-test security suite. |

### What is needed to put this in front of a client on their own phone

1. **A public deploy target.** Any Node host works (Vercel, Fly, Render). Set
   `APP_URL` to the public origin — the `/q/<token>` route builds its redirect
   from `x-forwarded-host`, falling back to `APP_URL`, so the QR codes resolve to
   the public host instead of `localhost`.
2. **A Postgres database.** Set `DATABASE_URL` to Supabase or any managed
   Postgres; run `npm run db:migrate`, then seed.
3. **Rebuild the QR kit** with `--origin https://<public-host>`. A kit built
   against localhost prints codes that will not open on a phone — the build
   stamps a warning on the cover page and names the file `-LOCAL-ONLY` so this
   cannot be missed.
4. **Optionally**, Supabase Storage + Realtime: set `STORAGE_DRIVER=supabase` and
   the project URL, anon key and service-role key. The service-role key must stay
   server-side; it is read only by server modules and never reaches the browser.

Until 1–3 are done, treat this as a laptop demo: bring the laptop, put it on the
same Wi-Fi as the phone, and use the LAN address the dev server prints.

## Files

| Path | What |
| --- | --- |
| `artifacts/mati-kitchen-qr-kit.pdf` | The print kit (git-ignored, rebuild with `npm run qr:kit`) |
| `scripts/qr-kit.ts` | Builds the PDF from live tokens |
| `scripts/verify-qr-kit.ts` | Decodes the finished PDF and compares against the database |
| `migrations/013_demo_reset.sql` | `reset_demo_orders()` with all guards in SQL |
| `src/lib/services/demo-reset.ts` | Preview + reset, maps SQL errors to messages |
| `src/app/dashboard/demo/` | The owner-facing reset screen |
| `tests/demo-reset.test.ts` | The five reset safety tests |
| `docs/corrupted-demo-database.md` | Post-mortem of the database that was lost |
