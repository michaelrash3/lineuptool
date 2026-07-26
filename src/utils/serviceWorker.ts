// The single service-worker registration path for the app.
//
// A service worker registration is keyed by SCOPE, not by script URL: calling
// register() with a different script at the same scope replaces the script on
// the existing registration. So registering two different scripts at "/" never
// produced two workers — it produced one registration that got re-pointed on
// every page load, installing and claiming both scripts in turn, with whichever
// finished last controlling the tab. That is the race this module exists to end:
// there is exactly one script URL, registered from exactly one place.
//
// src/service-worker.js is the worker's source; vite-plugin-pwa (injectManifest)
// emits it to /service-worker.js with the build's precache manifest baked in.
// `injectRegister: null` in vite.config.ts keeps the plugin from also injecting
// its own registerSW.js into index.html — that injection was the second, racing
// registration.

export const SERVICE_WORKER_URL = "/service-worker.js";
export const SERVICE_WORKER_SCOPE = "/";

const workersOf = (registration: ServiceWorkerRegistration): ServiceWorker[] =>
  [registration.installing, registration.waiting, registration.active].filter(
    (worker): worker is ServiceWorker => !!worker,
  );

const runsOurScript = (registration: ServiceWorkerRegistration): boolean =>
  workersOf(registration).some(
    (worker) =>
      typeof worker.scriptURL === "string" &&
      worker.scriptURL.endsWith(SERVICE_WORKER_URL),
  );

// Belt and braces for the migration off the old dual registration. The
// same-scope replacement above covers the ordinary case, so this normally finds
// nothing; it exists for a client left holding a registration that our
// register() call did not subsume (a leftover under a narrower scope, or one
// still pointing at the deleted /sw.js). It runs only AFTER our own
// registration succeeded, so a client is never left with no worker at all.
const dropSupersededRegistrations = async (
  keep: ServiceWorkerRegistration,
): Promise<void> => {
  const container = navigator.serviceWorker;
  if (typeof container.getRegistrations !== "function") return;

  let all: readonly ServiceWorkerRegistration[];
  try {
    all = await container.getRegistrations();
  } catch {
    return;
  }

  await Promise.all(
    all.map(async (registration) => {
      if (registration === keep) return;
      if (runsOurScript(registration)) return;
      try {
        await registration.unregister();
      } catch {
        // A registration we can't remove is not worth breaking startup over.
      }
    }),
  );
};

export const registerServiceWorker =
  async (): Promise<ServiceWorkerRegistration | null> => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
      return null;
    try {
      const registration = await navigator.serviceWorker.register(
        SERVICE_WORKER_URL,
        { scope: SERVICE_WORKER_SCOPE },
      );
      await dropSupersededRegistrations(registration);
      return registration;
    } catch {
      // Registration failures are silent — the app keeps working online; we
      // just don't get the offline shell.
      return null;
    }
  };

// Registration competes with the app's own startup work for the main thread, so
// hold it until load. `once` matters: a second 'load' (or a second call) must
// not fire a second register.
export const registerServiceWorkerOnLoad = (): void => {
  if (typeof window === "undefined") return;
  if (document.readyState === "complete") {
    void registerServiceWorker();
    return;
  }
  window.addEventListener("load", () => void registerServiceWorker(), {
    once: true,
  });
};
