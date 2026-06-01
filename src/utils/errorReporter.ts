// Centralized client error reporting.
//
// Today this just logs to the console (where the app already scattered
// `console.error`s), but routing everything through one entry point means a
// real backend — Sentry, LogRocket, a custom endpoint — can be plugged in
// later via `setErrorSink` without touching every call site. It also installs
// global handlers so errors thrown *outside* React (async callbacks, promise
// rejections) are captured, not just render-time errors the ErrorBoundary sees.
//
// No external dependency and no-ops safely when no sink is configured, so it's
// free to ship now and wire to a provider when one is chosen.

export type ErrorContext = Record<string, unknown>;
export type ErrorSink = (error: unknown, context?: ErrorContext) => void;

let sink: ErrorSink | null = null;

// Register the destination for reported errors (e.g. Sentry.captureException).
// Passing null detaches it.
export const setErrorSink = (next: ErrorSink | null): void => {
  sink = next;
};

export const reportError = (error: unknown, context?: ErrorContext): void => {
  // Always keep a console trail for local debugging / support.
  // eslint-disable-next-line no-console
  console.error("[reportError]", error, context ?? "");
  if (sink) {
    try {
      sink(error, context);
    } catch {
      // A failing sink must never cascade into the app or re-enter reporting.
    }
  }
};

let initialized = false;

// Attach window-level handlers once. Idempotent so it's safe to call from the
// app entry without guarding at the call site.
export const initErrorReporting = (): void => {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("error", (event: ErrorEvent) => {
    reportError(event.error ?? event.message, { source: "window.onerror" });
  });
  window.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      reportError(event.reason, { source: "unhandledrejection" });
    }
  );
};

// Test seam: reset module state between tests.
export const __resetErrorReportingForTest = (): void => {
  sink = null;
  initialized = false;
};
