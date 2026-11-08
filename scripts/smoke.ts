/**
 * Deployment smoke test.
 *
 * Drives a *running* MenuPilot over HTTP, the way a browser does. This is the check
 * that answers "is the deployment actually working", as opposed to `npm test`, which
 * proves the code is correct against a throwaway database.
 *
 *   npx tsx scripts/smoke.ts                                   # http://localhost:3000
 *   npx tsx scripts/smoke.ts https://menu.example.com          # production
 *   npx tsx scripts/smoke.ts https://menu.example.com <qrToken>
 *
 * Without a QR token the guest-order checks are skipped (a token is a physical code
 * on a table, not something the script can guess). Pass one to include them.
 *
 * Exit code 0 = every check passed. Non-zero = at least one failure, printed.
 */

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const QR_TOKEN = process.argv[3] ?? process.env.SMOKE_QR_TOKEN ?? "";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
  skipped?: boolean;
}

const results: Check[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${mark} ${name}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
}

function skip(name: string, reason: string) {
  results.push({ name, ok: true, skipped: true, detail: reason });
  console.log(`  \x1b[90m·\x1b[0m ${name} \x1b[90m— skipped: ${reason}\x1b[0m`);
}

async function get(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  return res;
}

async function json<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */

async function health() {
  const res = await get("/api/health");
  const body = await json<{ status: string; checks: Record<string, { status: string; detail: string }> }>(res);
  record("/api/health responds", res.status === 200 || res.status === 503, `HTTP ${res.status}`);

  if (!body?.checks) {
    record("/api/health returns a report", false, "body was not JSON");
    return;
  }
  for (const [name, check] of Object.entries(body.checks)) {
    record(`health: ${name} is ok`, check.status === "ok", check.detail);
  }
  const cache = res.headers.get("cache-control") ?? "";
  record("/api/health is not cached", cache.includes("no-store"), cache || "(no header)");
}

async function securityHeaders() {
  const res = await get("/login");
  record("pages send nosniff", (res.headers.get("x-content-type-options") ?? "") === "nosniff");
  record("pages send a referrer policy", Boolean(res.headers.get("referrer-policy")));
}

async function publicMenu() {
  // The demo tenant ships in every seeded deployment; skip cleanly if it is absent.
  const res = await get("/menu/mati-kitchen");
  if (res.status === 404) {
    skip("public menu renders", "no MATI Kitchen tenant on this deployment");
    return;
  }
  const html = await res.text();
  record("public menu renders", res.status === 200, `HTTP ${res.status}`);
  record("public menu lists dishes", /[0-9a-f-]{36}/.test(html), "dish data present");
  const img = html.match(/src="(\/api\/media\/[^"]+)"/);
  if (img) {
    const image = await get(img[1]!);
    record(
      "menu images load",
      image.ok,
      `${img[1]!.split("/").slice(2, 4).join("/")} → HTTP ${image.status} ${image.headers.get("content-type") ?? ""}`,
    );
  } else {
    record("menu images load", false, "no image referenced on the menu page");
  }
}

async function guestOrdering() {
  if (!QR_TOKEN) {
    skip("guest ordering", "pass a table QR token as the second argument");
    return;
  }

  // Follow the QR through to the menu, exactly as a guest would.
  const scan = await get(`/q/${QR_TOKEN}`);
  const location = scan.headers.get("location") ?? "";
  record("QR resolves to a menu", scan.status === 307 || scan.status === 200, location.split("?")[0]);

  const menu = await get(location.startsWith("http") ? location.replace(BASE, "") : location || `/q/${QR_TOKEN}`);
  const menuHtml = await menu.text();
  // Dish ids travel in the page's serialized props (React escapes the quotes), so
  // match either form rather than a link that does not exist.
  const itemId =
    menuHtml.match(/\\"id\\":\\"([0-9a-f-]{36})\\"/)?.[1] ?? menuHtml.match(/"id":"([0-9a-f-]{36})"/)?.[1];
  if (!itemId) {
    record("menu exposes an orderable dish", false);
    return;
  }

  const key = `smoke-${Date.now()}`;
  const place = () =>
    get("/api/orders/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        qrToken: QR_TOKEN,
        items: [{ menu_item_id: itemId, quantity: 1 }],
        customerName: "Smoke Test",
        idempotencyKey: key,
      }),
    });

  const first = await place();
  const created = await json<{
    ok: boolean;
    order?: { orderNumber: string; trackingToken: string | null; total: number };
    error?: string;
  }>(first);
  record("guest can place an order", first.status === 200 && created?.ok === true, created?.error ?? created?.order?.orderNumber);

  const token = created?.order?.trackingToken;
  if (!token) {
    record("order returns a tracking token", false, created?.error);
    return;
  }
  record("order returns a tracking token", token.length >= 32, `${token.length} chars`);

  const tracker = await get(`/order/${token}`);
  record("guest tracker renders", tracker.status === 200, `HTTP ${tracker.status}`);

  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  const bad = await get(`/order/${tampered}`);
  record("a tampered tracking token is refused", bad.status === 404, `HTTP ${bad.status}`);

  const replay = await place();
  const replayed = await json<{ order?: { orderNumber: string; idempotentReplay?: boolean; trackingToken: string | null } }>(
    replay,
  );
  record("a duplicate submission collapses to one order", replayed?.order?.idempotentReplay === true);
  record(
    "a replay does not leak a token",
    replayed?.order?.trackingToken === null || replayed?.order?.trackingToken === undefined,
  );
}

async function authorization() {
  const anonymous = [
    ["/api/orders/feed", "order feed"],
    ["/api/kitchen/feed", "kitchen feed"],
    ["/api/realtime/token", "realtime token"],
    ["/dashboard", "dashboard page"],
  ] as const;

  for (const [path, label] of anonymous) {
    const res = await get(path);
    const refused = res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400);
    record(`${label} refuses anonymous callers`, refused, `HTTP ${res.status}`);
  }

  const upload = await get("/api/uploads/menu", {
    method: "POST",
    headers: { "content-type": "multipart/form-data" },
    body: "",
  });
  record("upload endpoint refuses anonymous callers", upload.status === 401 || upload.status === 403, `HTTP ${upload.status}`);

  const platform = await get("/platform");
  record("platform console refuses anonymous callers", platform.status >= 300 && platform.status < 400, `HTTP ${platform.status}`);
}

async function mediaSafety() {
  const traversal = await get("/api/media/menu/..%2f..%2f..%2fetc%2fpasswd");
  record("media route rejects path traversal", traversal.status === 400 || traversal.status === 404, `HTTP ${traversal.status}`);

  const privateBucket = await get("/api/media/private/anything.png");
  record("media route rejects unknown buckets", privateBucket.status >= 400, `HTTP ${privateBucket.status}`);

  const missing = await get("/api/media/menu/00000000-0000-0000-0000-000000000000/menu/none.png");
  record("missing media 404s rather than erroring", missing.status === 404, `HTTP ${missing.status}`);
}

async function realtime() {
  const token = await get("/api/realtime/token");
  record("realtime token endpoint is guarded", token.status === 401 || token.status === 403, `HTTP ${token.status}`);

  const order = await get(`/api/realtime/order?token=${"0".repeat(48)}`);
  const body = await json<{ configured?: boolean; error?: string }>(order);
  record(
    "guest realtime refuses an unknown token",
    order.status === 403 || order.status === 401 || order.status === 404 || body?.configured === false,
    `HTTP ${order.status}${body?.error ? ` (${body.error})` : ""}`,
  );
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`\n  MenuPilot smoke test — ${BASE}\n`);
  try {
    await health();
    await securityHeaders();
    await publicMenu();
    await guestOrdering();
    await authorization();
    await mediaSafety();
    await realtime();
  } catch (error) {
    record("smoke run completed", false, error instanceof Error ? error.message : String(error));
  }

  const run = results.filter((r) => !r.skipped);
  const failed = run.filter((r) => !r.ok);
  console.log(
    `\n  ${run.length - failed.length} passed, ${failed.length > 0 ? `\x1b[31m${failed.length} failed\x1b[0m` : "0 failed"}` +
      `${results.length - run.length > 0 ? `, ${results.length - run.length} skipped` : ""}\n`,
  );

  if (failed.length > 0) {
    console.log("  Failures:");
    for (const f of failed) console.log(`   · ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    console.log();
    process.exit(1);
  }
}

void main();
