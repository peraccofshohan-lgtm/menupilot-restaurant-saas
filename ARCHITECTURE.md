# Architecture

## Interfaces

One application, one backend, five surfaces:

| Surface | Routes | Rendering |
|---|---|---|
| Marketing site | `/`, `/features`, `/pricing`, `/contact` | Server components |
| Authentication | `/login`, `/register`, `/forgot-password`, `/reset-password` | Server components + server actions |
| Restaurant workspace | `/dashboard/*`, `/onboarding/*` | Server components, client islands for live data |
| Guest experience | `/menu/[slug]`, `/menu/[slug]/cart`, `/q/[token]`, `/order/[token]` | Server-rendered shell, client cart |
| Platform console | `/platform/*` | Server components, admin-gated |
| Staff screens | `/dashboard/kitchen`, `/dashboard/orders` | Client components polling authorized APIs |

They share the same database, the same services and the same authorization rules. There is no mock data path.

## Layering

```
app/            routing, layouts, page composition only
components/     presentation; no SQL, no direct DB access
lib/actions/    server actions — parse, validate, delegate, revalidate
lib/services/   domain logic and queries; the only place SQL lives
lib/db/         engine adapters, session/RLS context, migration runner
migrations/     schema, policies, functions
tests/          integration + security suite against a real engine
```

Rules that are actually enforced in the code:

- UI components never issue SQL. They receive plain data from a server component or call an API route.
- Services never read cookies or headers; they take an explicit user + restaurant context.
- No service trusts a restaurant id from the request body. Tenancy is resolved from `restaurant_members`.
- Every mutation re-validates on the server, even if the form already validated it.

## Request flow: approving an order

```
POST /api/orders/transition  { orderId, next: "accepted", restaurantId }
  │
  ├─ getCurrentUser()                       session cookie → auth.sessions → auth.users
  ├─ resolveAuthorizedRestaurant(user, …)   restaurantId must be one of the caller's memberships
  └─ transitionOrder(user, orderId, "accepted")
        └─ withSession(user)                BEGIN; set role authenticated; set request.jwt.claims
              └─ select public.transition_order(...)
                    ├─ mp_role(restaurant)  re-checks membership inside the database
                    ├─ state machine        pending → accepted only, owner/manager only
                    ├─ UPDATE orders        RLS allows it (member) + column grants
                    └─ INSERT history       audit row with actor + role
```

Both layers check. Even if the route handler were bypassed entirely, the function and the policies still refuse.

## Request flow: a guest order

```
GET /q/<token>
  └─ menu_for_qr(token)  →  redirect /menu/<slug>?t=<token>

POST /api/orders/create  { qrToken, items: [{ menu_item_id, quantity, note }] }
  ├─ consume_rate_limit("order", clientIdentity, 8, 60)
  └─ create_order(token, items, name, phone, note, idempotencyKey)   [runs as anon]
        ├─ token → qr_tokens → table → restaurant (must be active)
        ├─ existing row with this idempotency key? return it unchanged
        ├─ for each line: item must belong to THIS restaurant, not archived, available, category active
        ├─ subtotal = Σ(price × qty)                    ← database prices, not client prices
        ├─ service = round(subtotal × service_rate/100, 2)
        ├─ tax     = round(subtotal × tax_rate/100, 2)
        ├─ INSERT orders + order_items + order_status_history + customer upsert
        └─ return { order_number, tracking_token, total, … }
```

The browser never sends a price, a total, a restaurant id or a table id.

## Database engine abstraction

`src/lib/db/types.ts` defines a five-method contract (`query`, `exec`, `transaction`, `close`, `engine`).
Two adapters implement it:

- `pglite.ts` — embedded PostgreSQL 18 (WASM). Used locally, in CI and in the preview sandbox.
- `postgres.ts` — a real connection pool, for Supabase or any PostgreSQL.

`withSession()` reproduces exactly what PostgREST does: `SET LOCAL ROLE` plus `request.jwt.claims`. The same
policies therefore decide access on every engine, and application code cannot accidentally widen it.

`mp_uid()` reads `request.jwt.claims->>'sub'` rather than `auth.uid()`, so nothing depends on Supabase-specific
GUCs while remaining compatible with them.

## Live data

Polling is the correctness guarantee; realtime (when a Supabase project provides it) is an accelerator.

| Screen | Fallback (always on) | With realtime |
|---|---|---|
| Overview "Incoming orders" | `GET /api/orders/feed`, 6 s visible / 20 s hidden | socket pushes → 45 s / 60 s |
| Orders list | `router.refresh()` via `AutoRefresh`, 15 s | unchanged |
| Kitchen display | `GET /api/kitchen/feed`, 7 s visible / 25 s hidden | socket pushes → 30 s / 60 s |
| Guest tracking | `router.refresh()`, 10 s, stops once closed | socket pushes → 45 s |

```
Browser ──► GET /api/realtime/token ──► short-lived JWT, mp_topic from the session
                ▼
        private channel restaurant:<id> ── change signal ──► re-read the authorized feed
```

Three properties make the socket safe:

1. **The server chooses the topic.** The client receives `restaurant:<id>`; it cannot
   ask for another tenant's channel. The `realtime.messages` policy compares the
   requested topic with the signed `mp_topic` claim and refuses anything else.
2. **The channel carries no rows.** It is a "something changed" ping; the data still
   comes from a route that re-derives tenancy from the session on every request.
3. **Failure is silent.** No project, no secret, a refused subscription or a dead
   socket all fall back to the poller. Nothing in the UI depends on the socket.

Guest tracking uses the same mechanism with a narrower topic, `order:<hmac of the
tracking token>`, so a guest watches exactly one ticket.

Polling was kept rather than replaced because it works on every host, recovers from
sleep and network drops without reconnection logic, and every request is re-authorized.

## Storage

`StorageService` (`src/lib/services/storage.ts`) exposes one interface with two
drivers and an identical path layout:

```
<restaurantId>/menu/<slug>-<stamp>.jpg
<restaurantId>/logo/logo-<stamp>.png
<restaurantId>/cover/cover-<stamp>.jpg
```

| Driver | Where bytes live | How the browser gets them |
|---|---|---|
| `local` | Postgres table `storage_objects` | `/api/media/<bucket>/<path>`, streamed by a route |
| `supabase` | Storage buckets `menu` / `branding` | public CDN URL; `/api/media/...` 308-redirects there |

The first path segment is always the tenant id and always comes from the session,
never from the request — so a bucket policy can pin writes to the caller's own folder,
and a mistyped path cannot reach another restaurant's media.

Uploads pass four gates before a byte is stored: declared MIME + size, file
signature, a `sharp` decode-and-re-encode (which also strips EXIF), and a path built
from the session tenant. `replaceObject()` writes the new object, commits the row,
then deletes the old one, so a swap never leaves a broken image; if the commit fails
the new object is removed instead. `npm run storage:gc` reports objects nothing
references — the only way orphans accumulate is a dish form abandoned after picking a
photo.

Image URLs resolve through one isomorphic helper (`src/lib/media.ts`), so both
drivers render identically in server and client components.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Database query fails | Page renders an explicit error panel; technical detail goes to the server log only |
| Feed unreachable | Badge switches to "Reconnecting", retries automatically, no data is faked |
| Session expires | API returns 401 → redirect to `/login?next=…` |
| QR invalid/revoked | `/q/invalid` explains the situation without disclosing whether the restaurant exists |
| Dish sold out mid-cart | Server rejects with a friendly message; cart highlights the item |
| Duplicate submit | Idempotency key returns the original order instead of creating a second |
| Upload rejected | Specific reason (type, size, corrupt file) shown next to the field |
| Realtime unavailable | Silent fallback to polling; no error shown, no data faked |
| Email provider not configured | Invitation created with a copyable link; the message says nothing was sent |
| Supabase misconfigured | `/api/health` returns 503 with the failing check named |
| Invalid state transition | Rejected with a human sentence (`"An order that is pending cannot move to ready."`) |

## Testing strategy

`npm test` starts a fresh embedded PostgreSQL, applies every migration from scratch and runs **100 tests**:
70 product tests plus a 30-test production audit (`tests/security.test.ts`) covering cross-tenant access,
unauthorized staff actions, QR validation, duplicate submission, price integrity, state-machine abuse, upload
security, platform permissions, secret exposure and session handling.

The harness installs its database as the application's shared handle, so service code
(`signIn`, `getSessionUser`, storage) runs against the same database the assertions
query. Before that, those integration tests could pass while exercising a different
database — a false pass that hid two real defects. RLS is tested by running the same SQL as different identities and asserting what each one may
see — the database is the subject of the test, not a mock.

## Decisions worth knowing

1. **Approval is mandatory by default.** `auto_accept_orders` exists for restaurants that want it, but the default
   path is pending → accepted, because that is the requirement that makes a QR menu safe for a kitchen.
2. **Archiving instead of deleting ordered dishes.** `order_items` snapshots the name and price, and hard deletes
   are refused for dishes that appear in history.
3. **Soft-deleted QR tokens.** Rotating a QR revokes the old token rather than deleting the row, so an audit of
   which code was on which table is possible.
4. **Money is immutable.** A trigger blocks any post-creation change to an order's totals.
5. **Platform admins see aggregates, not operations.** They can suspend a tenant; they cannot read its guests.
