// Lightweight leveled console logger.
//
// The app scatters diagnostic `console.info`/`console.warn` calls (auth and
// Firebase bootstrap traces, persistence fallbacks) that fire unconditionally —
// so end users see them in their browser console in production. Routing those
// through one place lets us:
//   - debug / info  → dev only (gated on import.meta.env.DEV) so production
//                     consoles stay quiet
//   - warn  / error → always emitted (operationally meaningful in the field)
//
// This is intentionally separate from utils/errorReporter.ts: reportError() is
// the centralized *error* path (it also fans out to a configurable sink such as
// Sentry and installs global handlers), whereas this is just a thin console
// wrapper for routine leveled logging. Reach for reportError() when something
// genuinely went wrong and should be captured; reach for log.* for diagnostics.

type Args = unknown[];

// import.meta.env.DEV is injected by Vite (and Vitest). Guard the access so the
// module never throws if evaluated in a context without import.meta.env; when
// undefined we err toward verbose (treat it as dev) rather than swallowing logs.
const isDev: boolean = (() => {
  try {
    const env = (import.meta as ImportMeta).env;
    return env ? Boolean(env.DEV) : true;
  } catch {
    return true;
  }
})();

export const log = {
  // Verbose tracing; dev only.
  debug: (...args: Args): void => {
    if (isDev) console.debug(...args);
  },
  // Informational diagnostics; dev only.
  info: (...args: Args): void => {
    if (isDev) console.info(...args);
  },
  // Recoverable problems / fallbacks; always emitted.
  warn: (...args: Args): void => {
    console.warn(...args);
  },
  // Errors; always emitted. For failures that should be *captured* (not just
  // logged), prefer reportError() from utils/errorReporter.ts.
  error: (...args: Args): void => {
    console.error(...args);
  },
};

// Exposed for tests that need to assert dev-gating behavior.
export const __isDevForTest = isDev;
