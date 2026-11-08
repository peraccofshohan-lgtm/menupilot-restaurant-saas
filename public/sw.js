/*
 * MenuPilot service worker.
 *
 * Purpose, stated plainly because this is where "offline" apps usually lie:
 *
 *   ✔ Cache the app shell, fonts and menu photographs so a phone that has
 *     visited once renders instantly, and so the menu is still *viewable* if
 *     the local server is briefly unreachable.
 *   ✔ Show an honest Bangla "cannot reach the restaurant server" page instead
 *     of a browser error when the server is down.
 *
 *   ✘ NEVER serve a cached response for an order, review, service request or
 *     any other mutation. Those must fail loudly if the server is unreachable —
 *     a guest must never believe an order was placed when it was not.
 *   ✘ NEVER cache HTML for authenticated dashboard pages, so a stale order
 *     queue can never be shown to staff as if it were current.
 *
 * There is no background sync and no queued-order replay: an order that could
 * not reach the server is reported to the guest, not stored on the device.
 */

const VERSION = "menupilot-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const IMAGE_CACHE = `${VERSION}-images`;
const FONT_CACHE = `${VERSION}-fonts`;

/** The minimum needed to render the offline notice itself. */
const SHELL_ASSETS = ["/offline", "/icons/icon-192.png"];

/** Request paths that must always hit the network — writes and live data. */
const NEVER_CACHE = [
  "/api/",
  "/dashboard",
  "/platform",
  "/onboarding",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/dashboard/tables/print",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload` bypasses the HTTP cache so an update is not seeded from stale bytes.
      .then((cache) => cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("menupilot-") && !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isNeverCached(url) {
  return NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix));
}

/** True when this request could change data — POST/PATCH/PUT/DELETE. */
function isMutation(request) {
  return request.method !== "GET" && request.method !== "HEAD";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never intercept cross-origin requests. Nothing in this app should make one,
  // and if something does, it must fail visibly rather than be cached.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Mutations: straight to the network, no cache, no replay. If the server is
  // down the caller gets a network error and the UI shows the Bangla notice.
  if (isMutation(request)) return;

  // Live data and authenticated pages: network only.
  if (isNeverCached(url)) return;

  // Menu photographs: cache-first is right. A dish photo does not change during
  // service, and this is the bulk of the bytes a guest downloads.
  if (url.pathname.startsWith("/api/media/") || url.pathname.startsWith("/seed-images/")) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Fonts: cache-first, and they are tiny. Without them Bangla renders in a
  // fallback face, which is ugly but still readable — so a failed fetch is safe.
  if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch (error) {
          const fallback = await cache.match(request);
          if (fallback) return fallback;
          throw error;
        }
      }),
    );
    return;
  }

  // Navigations: network first (so the menu is never stale), cached copy as a
  // last resort, and finally the Bangla offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = await cache.match(request);
          if (cached) return cached;
          const offline = await cache.match("/offline");
          if (offline) return offline;
          return new Response(
            "<!doctype html><meta charset='utf-8'><title>সার্ভার নেই</title><p style='font-family:sans-serif;padding:24px;line-height:1.7'>রেস্টুরেন্টের সার্ভারের সঙ্গে সংযোগ পাওয়া যাচ্ছে না। অনুগ্রহ করে কর্মচারীকে জানান।</p>",
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
  }
});

/** Lets the page ask the worker to activate an update immediately. */
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
