import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Runtime coverage for src/service-worker.js. The wiring tests next door assert
// that exactly one worker is registered; this asserts what that worker DOES —
// specifically the offline-repair behavior, which is the part that can strand a
// user and the part no static check can see.
//
// The worker is a classic script written against `self`, and it is the SOURCE
// copy: `self.__WB_MANIFEST` is a build-time injection point, so it is
// substituted here the way vite-plugin-pwa substitutes it at build. The file is
// evaluated inside a synthetic ServiceWorkerGlobalScope so handlers can be
// invoked directly.

const SOURCE = resolve(__dirname, "service-worker.js");
const ORIGIN = "https://app.test";
const INDEX = `${ORIGIN}/index.html`;

type Handler = (event: Record<string, unknown>) => void;

class FakeCache {
  store = new Map<string, { body: string; ok: boolean }>();
  async match(key: unknown) {
    const url = new URL(String(key), ORIGIN).href;
    const hit = this.store.get(url);
    return hit ? { ...hit, clone: () => ({ ...hit }) } : undefined;
  }
  async put(key: unknown, res: { body?: string }) {
    this.store.set(new URL(String(key), ORIGIN).href, {
      body: res?.body ?? "",
      ok: true,
    });
  }
  async delete(key: unknown) {
    return this.store.delete(new URL(String(key), ORIGIN).href);
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
}

const loadWorker = (opts: {
  manifest: Array<{ url: string; revision: string | null }>;
  // Which asset fetches succeed during install.
  fetchOk: (url: string) => boolean;
  seedCaches?: Record<string, string[]>;
}) => {
  const caches = new Map<string, FakeCache>();
  for (const [name, urls] of Object.entries(opts.seedCaches || {})) {
    const c = new FakeCache();
    urls.forEach((u) =>
      c.store.set(new URL(u, ORIGIN).href, {
        body: new URL(u, ORIGIN).href,
        ok: true,
      }),
    );
    caches.set(name, c);
  }
  const handlers = new Map<string, Handler>();
  const cacheStorage = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new FakeCache());
      return caches.get(name)!;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  };
  const fetchMock = vi.fn(async (req: unknown) => {
    const url = new URL(
      typeof req === "string" ? req : String((req as { url: string }).url),
      ORIGIN,
    ).href;
    if (!opts.fetchOk(url)) throw new Error("offline");
    return {
      ok: true,
      status: 200,
      type: "basic",
      body: url,
      clone: () => ({ ok: true, status: 200, type: "basic", body: url }),
    };
  });
  const scope = {
    __WB_MANIFEST: opts.manifest,
    location: { href: `${ORIGIN}/service-worker.js`, origin: ORIGIN },
    addEventListener: (name: string, fn: Handler) => handlers.set(name, fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}), matchAll: async () => [] },
    registration: {},
  };
  const code = readFileSync(SOURCE, "utf8");
  // eslint-disable-next-line no-new-func
  new Function("self", "caches", "fetch", "Request", "Response", "URL", code)(
    scope,
    cacheStorage,
    fetchMock,
    class {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
    { error: () => ({ ok: false, status: 0, body: "ERROR" }) },
    URL,
  );

  const run = async (name: string, event: Record<string, unknown> = {}) => {
    const waits: Array<Promise<unknown>> = [];
    let responded: unknown;
    const fn = handlers.get(name);
    if (!fn) throw new Error(`no ${name} handler`);
    fn({
      ...event,
      waitUntil: (p: Promise<unknown>) => waits.push(Promise.resolve(p)),
      respondWith: (p: unknown) => {
        responded = p;
      },
    });
    await Promise.all(waits);
    return responded ? await responded : undefined;
  };
  return { run, caches, cacheStorage, fetchMock, scope };
};

const MANIFEST = [
  { url: "/index.html", revision: "r1" },
  { url: "/assets/app-abc.js", revision: null },
];

describe("service worker lifecycle", () => {
  let allOnline: Parameters<typeof loadWorker>[0];
  beforeEach(() => {
    allOnline = { manifest: MANIFEST, fetchOk: () => true };
  });

  it("precaches the manifest on install and serves the shell offline", async () => {
    const w = loadWorker(allOnline);
    await w.run("install");
    await w.run("activate");
    // Online, a navigation is served from the NETWORK, not the shell — that is
    // the whole point of network-first, and what keeps a returning coach off a
    // stale deploy.
    const res = (await w.run("fetch", {
      request: { method: "GET", url: `${ORIGIN}/schedule`, mode: "navigate" },
    })) as { body: string };
    expect(res.body).toBe(`${ORIGIN}/schedule`);

    // Now offline: the navigation falls back to the precached shell.
    const offline = loadWorker({
      ...allOnline,
      seedCaches: { "bench-coach-precache-v1": ["/index.html"] },
      fetchOk: () => false,
    });
    const off = (await offline.run("fetch", {
      request: { method: "GET", url: `${ORIGIN}/roster`, mode: "navigate" },
    })) as { body: string };
    expect(off.body).toBe(INDEX);
  });

  // The gap this guards: install swallows precache failures by design (one dead
  // asset must not abort it) and install does NOT re-run until the worker's
  // bytes change. Without a repair path, a worker that installed during a
  // network blip has no shell and cannot open offline until the next deploy —
  // and activate would meanwhile have deleted the previous worker's caches, so
  // the app would go from working offline to not working offline.
  it("keeps the previous worker's caches when its own precache failed", async () => {
    const w = loadWorker({
      manifest: MANIFEST,
      fetchOk: () => false, // every install fetch fails
      seedCaches: { "coachs-card-shell-v2": ["/index.html"] },
    });
    await w.run("install");
    await w.run("activate");
    // The legacy cache is NOT evicted, because this worker cannot serve a
    // navigation yet — throwing it away would remove offline support outright.
    expect(w.caches.has("coachs-card-shell-v2")).toBe(true);
  });

  it("evicts the previous worker's caches once its own shell is cached", async () => {
    const w = loadWorker({
      ...allOnline,
      seedCaches: { "coachs-card-shell-v2": ["/index.html"] },
    });
    await w.run("install");
    await w.run("activate");
    expect(w.caches.has("coachs-card-shell-v2")).toBe(false);
  });

  it("repairs a missing shell from the next successful navigation", async () => {
    // Install with the network down: nothing precached.
    const w = loadWorker({
      manifest: MANIFEST,
      fetchOk: (url) => !url.includes("/index.html"),
    });
    await w.run("install");
    const pre = await (
      await w.cacheStorage.open("bench-coach-precache-v1")
    ).match(INDEX);
    expect(pre).toBeUndefined();

    // Network returns. One ordinary navigation restores the offline shell —
    // no deploy required.
    await w.run("fetch", {
      request: { method: "GET", url: `${ORIGIN}/schedule`, mode: "navigate" },
    });
    const repaired = await (
      await w.cacheStorage.open("bench-coach-precache-v1")
    ).match(INDEX);
    expect(repaired).toBeDefined();
  });

  it("never intercepts cross-origin, /api/ or non-GET requests", async () => {
    const w = loadWorker(allOnline);
    await w.run("install");
    for (const request of [
      {
        method: "GET",
        url: "https://firestore.googleapis.com/x",
        mode: "cors",
      },
      { method: "GET", url: `${ORIGIN}/api/gc-schedule`, mode: "cors" },
      { method: "POST", url: `${ORIGIN}/index.html`, mode: "navigate" },
    ]) {
      expect(await w.run("fetch", { request })).toBeUndefined();
    }
  });
});
