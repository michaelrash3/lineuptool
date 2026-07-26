// The Bench Coach service worker — the only worker this app registers, served
// at /service-worker.js on scope "/". Registration lives in exactly one place:
// src/utils/serviceWorker.ts (called from src/index.tsx).
//
// This file is the SOURCE. vite-plugin-pwa runs in `injectManifest` mode and
// emits the built copy to dist/service-worker.js, replacing `self.__WB_MANIFEST`
// below with the real list of build outputs (every JS/CSS/HTML/PNG/SVG/woff2 in
// dist, each with a revision hash). That is the whole point of using the plugin:
// a hand-maintained URL list silently drifts from the build — content-hashed
// chunk names change every deploy — while a generated manifest cannot.
//
// Strategy:
//   - Navigations (HTML)      → NETWORK FIRST, falling back to the precached
//                               index.html when offline. A returning coach who
//                               has signal always gets the newest deploy; there
//                               is no "one stale load after a deploy" window.
//                               src/index.tsx's `vite:preloadError` recovery
//                               depends on this: it reloads to pull fresh HTML
//                               after a deploy invalidates a lazy chunk hash,
//                               which only works if the reload isn't served a
//                               cached shell pointing at the dead chunk.
//   - Precached assets        → CACHE FIRST. Everything in the manifest is
//                               either content-hashed or revalidated on install,
//                               so serving it from the cache can't go stale.
//   - Other same-origin GETs  → stale-while-revalidate.
//   - Cross-origin            → bypass entirely. Firestore + Auth run their own
//                               offline story through Firebase's IndexedDB
//                               persistence and must never be intercepted.
//   - /api/* and /__/*        → bypass. Runtime API routes (a Vercel
//                               convention) and Firebase's auth helper iframe
//                               must always hit the network.

// Bump either name only when this file's caching *logic* changes. Per-deploy
// invalidation is handled by the manifest revisions, not by the cache name.
const PRECACHE = "bench-coach-precache-v1";
const RUNTIME = "bench-coach-runtime-v1";

// Caches this worker owns. Anything else in the origin's cache storage is a
// leftover from a previous service worker and gets dropped on activate — see
// the migration note at the bottom of this file.
const OWNED_CACHES = [PRECACHE, RUNTIME];

// Synthetic cache entry recording the revision we precached each URL at, so an
// install only re-downloads what actually changed instead of the whole shell.
const REVISIONS_KEY = "/__precache-revisions__";

const absolute = (url) => new URL(url, self.location.href).href;

// Build-time injection point. Entries look like { url, revision }; workbox
// leaves `revision` null for content-hashed files (the name is the version).
// Deduped by URL: the manifest is a concatenation of the glob results and
// `includeAssets`, so the same file can legitimately appear twice, and a
// duplicate would cost a redundant install-time fetch of every copy.
const MANIFEST = [
  ...new Map(
    (self.__WB_MANIFEST || [])
      .map((entry) =>
        typeof entry === "string"
          ? { url: absolute(entry), revision: null }
          : { url: absolute(entry.url), revision: entry.revision || null },
      )
      .map((entry) => [entry.url, entry]),
  ).values(),
];

const PRECACHED_URLS = new Set(MANIFEST.map((entry) => entry.url));
const INDEX_URL = absolute("index.html");

const readPreviousRevisions = async (cache) => {
  try {
    const res = await cache.match(REVISIONS_KEY);
    if (!res) return {};
    const parsed = await res.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const precache = async () => {
  const cache = await caches.open(PRECACHE);
  const previous = await readPreviousRevisions(cache);
  const next = {};
  for (const entry of MANIFEST) next[entry.url] = entry.revision;

  await Promise.all(
    MANIFEST.map(async (entry) => {
      // Unchanged revision and still in the cache → nothing to fetch. This is
      // what keeps a deploy from re-downloading the (large, stable-hashed)
      // firebase and react-vendor chunks; see the manualChunks note in
      // vite.config.ts.
      if (
        previous[entry.url] === entry.revision &&
        (await cache.match(entry.url))
      )
        return;
      // Revisioned URLs (index.html, manifest.json …) keep the same URL across
      // deploys, so the HTTP cache must be bypassed to see the new bytes.
      const request = new Request(entry.url, {
        cache: entry.revision ? "reload" : "default",
      });
      const res = await fetch(request);
      if (res && res.ok) await cache.put(entry.url, res.clone());
    }),
  ).catch(() => {
    // A single failed asset must not abort the install — the app still works
    // online. Note install does NOT re-run until this script's bytes change,
    // so this is not "retried next install"; the repair paths are the
    // navigation handler (refreshes the shell) and cacheFirst (repopulates a
    // missing asset from the network on first use).
  });

  await cache.put(
    REVISIONS_KEY,
    new Response(JSON.stringify(next), {
      headers: { "content-type": "application/json" },
    }),
  );

  // Drop precache entries this build no longer ships.
  for (const request of await cache.keys()) {
    if (request.url.endsWith(REVISIONS_KEY)) continue;
    if (!PRECACHED_URLS.has(request.url)) await cache.delete(request);
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => {}));
  // Take over as soon as this worker is installed. Safe here because
  // navigations are network first: an already-open tab can't be pinned to a
  // stale shell by the swap, and stale lazy chunks are handled by the
  // `vite:preloadError` reload in src/index.tsx.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Only evict the PREVIOUS worker's caches once this one can actually
      // serve an offline navigation. If the install raced a network blip and
      // never cached the shell, dropping the old caches too would take the
      // app's existing offline support with it and leave nothing in its place.
      // Re-precache first — this is the one place a failed install gets a
      // second chance before anything is thrown away.
      const cache = await caches.open(PRECACHE);
      if (!(await cache.match(INDEX_URL))) await precache().catch(() => {});
      if (await cache.match(INDEX_URL)) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => !OWNED_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        );
      }
      await self.clients.claim();
    })().catch(() => {}),
  );
});

// Game-day reminders post notifications through the SW (see
// src/hooks/useScheduleReminders.ts). Clicking one focuses an existing app
// window when possible, otherwise opens the Schedule tab.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow)
          return self.clients.openWindow("/schedule");
        return undefined;
      }),
  );
});

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const fromNetwork = fetch(request)
    .then((res) => {
      // Only cache successful, basic (same-origin, full) responses.
      if (res && res.status === 200 && res.type === "basic")
        cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fromNetwork;
};

const cacheFirst = async (request) => {
  const cache = await caches.open(PRECACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) await cache.put(request.url, res.clone());
  return res;
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin (Firestore, Auth, analytics) handles itself.
  if (url.origin !== self.location.origin) return;
  // Runtime API routes and Firebase's auth helper iframe must hit the network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/__/"))
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Refresh the offline shell from any successful navigation. This is
          // what makes offline SELF-HEALING: install swallows precache
          // failures (a single dead asset must not abort the install), and
          // install does NOT re-run until the worker's bytes change — so an
          // install that happened during a network blip would otherwise leave
          // this client with no shell to fall back on until the next deploy.
          // Every online navigation now repairs that.
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            event.waitUntil(
              caches
                .open(PRECACHE)
                .then((cache) => cache.put(INDEX_URL, copy))
                .catch(() => {}),
            );
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(PRECACHE);
          return (await cache.match(INDEX_URL)) || Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    PRECACHED_URLS.has(url.href)
      ? cacheFirst(request)
      : staleWhileRevalidate(request),
  );
});

// MIGRATION (see src/utils/serviceWorker.ts for the client half).
//
// Before this worker existed the app registered TWO scripts at scope "/":
// /sw.js (workbox, generated by vite-plugin-pwa's generateSW + injected
// registerSW.js) and /service-worker.js (hand written). A scope has exactly one
// registration, so registering a different script URL at the same scope
// *replaces* the previous script rather than adding a second registration —
// which is why the fix is simply "register one URL, always". Clients last
// controlled by /sw.js pick this up on their next load; their caches
// (workbox-precache-*, coachs-card-shell-v2) are deleted by the activate
// handler above, which drops every cache not in OWNED_CACHES.
//
// One detail worth stating precisely, because the obvious assumption is wrong:
// /sw.js and /registerSW.js are no longer emitted, but requests for them do
// NOT 404. vercel.json rewrites /((?!api/).*) to /index.html and Vercel applies
// rewrites after the filesystem check, so those URLs now answer 200 with HTML.
// A stranded /sw.js client's update check therefore fails on MIME type rather
// than status. The outcome is the same either way — per the SW update
// algorithm a registration is only cleared when newestWorker is null, which it
// is not — but nothing here should be justified by a 404 that never happens.
