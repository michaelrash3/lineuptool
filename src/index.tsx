import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
// @ts-ignore - App.jsx is plain JS without type declarations
import App from "./App";
import { initErrorReporting } from "./utils/errorReporter";
import { initSentry } from "./utils/sentry";

// Capture errors thrown outside React's render path (async, promise rejections).
initErrorReporting();
// Forward reported errors to Sentry when REACT_APP_SENTRY_DSN is configured
// (no-ops and pulls in no SDK otherwise).
initSentry();

const rootElement = document.getElementById("root")!;
const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Register the offline-shell service worker in production builds only.
// Development bundles change with every HMR push, so caching them just
// gets in the way. See public/service-worker.js for the strategy.
if (
  process.env.NODE_ENV === "production" &&
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
