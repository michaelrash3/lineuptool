/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional Sentry DSN. When set at build time, src/utils/sentry.ts forwards
  // reported errors to Sentry; unset, no SDK is loaded. (Was REACT_APP_SENTRY_DSN
  // under Create React App.)
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
