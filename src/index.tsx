import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./fonts";
import "./styles.css";
import App from "./App";
import { initErrorReporting } from "./utils/errorReporter";
import { initSentry } from "./utils/sentry";

// Capture errors thrown outside React's render path (async, promise rejections).
initErrorReporting();
// Forward reported errors to Sentry when VITE_SENTRY_DSN is configured
// (no-ops and pulls in no SDK otherwise).
initSentry();

// Recover from stale lazy-chunk loads after a deploy. The PDF/Directory exports
// (and other code-split screens) pull their dependencies in with dynamic
// `import()`. When a new build ships while this tab stays open, the old hashed
// chunk it asks for no longer exists on the server, so the import 404s with
// "Failed to fetch dynamically imported module." Vite raises `vite:preloadError`
// for exactly this; reload once to pull the fresh build (the network-first shell
// serves the new index.html and its new chunk hashes). The timestamp guard keeps
// a genuinely-missing chunk from triggering a reload loop.
window.addEventListener("vite:preloadError", () => {
  const KEY = "vite-preload-reloaded-at";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) || 0);
  } catch {
    // sessionStorage can throw in private mode — fall through and reload.
  }
  if (Date.now() - last < 10_000) return;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // ignore — reloading without the guard is still better than a dead button.
  }
  window.location.reload();
});

const rootElement = document.getElementById("root")!;
const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Register the offline-shell service worker in production builds only.
// Development bundles change with every HMR push, so caching them just
// gets in the way. See public/service-worker.js for the strategy.
if (
  import.meta.env.PROD &&
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // Registration failures are silent — the app keeps working
      // online; we just don't get the offline cache.
    });
  });
}
