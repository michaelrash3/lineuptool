import { setErrorSink } from "./errorReporter";

// Optional Sentry integration. It activates ONLY when VITE_SENTRY_DSN is
// set at build time, and the SDK is dynamically imported so it never enters the
// bundle for builds without a DSN. When active, Sentry is registered as the
// errorReporter sink, so every reportError (ErrorBoundary catches + global
// handlers) is forwarded as an exception. Idempotent and safe to call always.
let started = false;

export const initSentry = async (): Promise<boolean> => {
  if (started) return false;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return false;
  started = true;
  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // Error reporting only by default — no performance tracing overhead.
      tracesSampleRate: 0,
    });
    setErrorSink((error, context) => {
      Sentry.captureException(
        error,
        context ? { extra: context } : undefined
      );
    });
    return true;
  } catch {
    // Never let telemetry setup break app startup.
    started = false;
    return false;
  }
};
