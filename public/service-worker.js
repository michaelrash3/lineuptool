// Coach's Card offline cache.
//
// Strategy:
//   - Navigations (HTML)      → network first, fall back to cached
//                                index.html when offline. Deploys still
//                                land the moment the network returns.
//   - Same-origin static GETs → stale-while-revalidate. The cached copy
//                                returns instantly; a fresh copy is
//                                fetched in the background and swapped
//                                in for the next request.
//   - Anything cross-origin   → bypass the SW entirely. Firestore + Auth
//                                manage their own offline behaviour via
//                                Firebase's IndexedDB persistence.
//
// Versioned cache name. Bumping it forces every old cache entry to be
// dropped on the next activate cycle (use when the SW logic itself
// changes — static asset hashes already handle per-deploy invalidation).
const CACHE_NAME = "coachs-card-shell-v1";

// Pre-cached on install so a brand-new visitor can still cold-start
// the SPA on a flight or a no-signal field after their first online
// load. Per-deploy asset hashes are picked up by the fetch handler.
const PRECACHE_URLS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {})
  );
  // Skip waiting so a new SW takes over as soon as the current page closes.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Bypass cross-origin: Firestore, Auth, fonts, etc. handle themselves.
  if (url.origin !== self.location.origin) return;

  // Bypass anything that looks like a runtime API call — we only want to
  // cache the static shell. /api/* is a Vercel convention; the app
  // doesn't ship any today, but keep the guard for future routes.
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests: prefer network so the user gets the latest
  // deploy when online; fall back to cached index.html when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/index.html").then((res) => res || Response.error())
      )
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          // Only cache successful, basic (same-origin, full) responses.
          if (res && res.status === 200 && res.type === "basic") {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
