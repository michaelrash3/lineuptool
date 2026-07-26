import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

// Vite replaces Create React App (react-scripts). Static assets continue to
// live in public/ and are copied to the build output as-is. Tests run under
// Vitest (jsdom) with the same setup file CRA used.
export default defineConfig({
  plugins: [
    react(),
    // Service worker: makes the app truly installable and able to OPEN
    // offline at the field (Firestore's persistentLocalCache already serves
    // the data offline — this caches the app shell that reads it). The
    // hand-written public/manifest.json stays the source of truth.
    //
    // `injectManifest`, not `generateSW`: the plugin's job here is to produce
    // the precache manifest (which cannot drift from the build output the way a
    // hand-maintained URL list does), while src/service-worker.js owns the
    // caching strategy — network-first navigations and the notificationclick
    // handler that game-day reminders depend on, neither of which generateSW
    // can express.
    //
    // `injectRegister: null` is load-bearing: with "auto" the plugin injected
    // its own registerSW.js into <head>, which registered a SECOND script at
    // scope "/" alongside src/index.tsx's registration and re-pointed the
    // registration on every page load. Registration now happens in exactly one
    // place, src/utils/serviceWorker.ts.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.js",
      injectRegister: null,
      manifest: false,
      // Only what globPatterns below cannot match. The icons that used to be
      // listed here are already covered by `**/*.png`, and listing them twice
      // put seven duplicate entries in the precache manifest.
      includeAssets: [
        // globPatterns carries no .json, so the web-app manifest reaches the
        // precache only because it is named here — without it an installed
        // PWA's first offline launch has no manifest.
        "manifest.json",
      ],
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // The firebase vendor chunk pushes past workbox's 2MB default.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
    // Bundle treemap. Only emits during a real `vite build` (no-op for the dev
    // server / vitest), writing bundle-stats.html at the repo root (gitignored).
    // gzip + brotli sizes match what the CDN actually ships, so a chunk creeping
    // into the startup graph is visible instead of silent. Open it after a build:
    //   npm run build && open bundle-stats.html
    visualizer({
      filename: "bundle-stats.html",
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  // Vite's default output dir is ./dist (see vercel.json, which pins the
  // framework so the deploy doesn't fall back to the old CRA preset).
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      output: {
        // Split the big, slow-moving vendors into their own chunks. They still
        // load at startup (so no offline/lazy regression), but their content
        // hashes stay stable across app-code deploys — so returning coaches
        // re-download only the small app chunk on each update instead of the
        // whole bundle (Firebase alone is the bulk of it).
        // NOTE: recharts and framer-motion are intentionally NOT grouped
        // here. rolldown-vite's manualChunks compat reassigns shared deps
        // (react itself!) into whichever manual group touches them first,
        // which dragged the whole chart stack into the startup graph.
        // Natural chunking puts recharts in a shared lazy chunk loaded only
        // by the screens that draw charts.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/firebase/") || id.includes("/@firebase/"))
            return "firebase";
          if (
            id.includes("/react-dom/") ||
            id.includes("/react-router") ||
            id.includes("/@remix-run/") ||
            id.includes("/scheduler/")
          )
            return "react-vendor";
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    // Match CRA: only our own source is under test; node_modules excluded.
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    // Fail fast instead of hanging. CI auto-merges any green run, so a wedged
    // test (e.g. an unresolved navigation or a never-settling promise) must turn
    // the run RED quickly rather than burning to the job's wall-clock cap. These
    // bound a single test, a hook, and per-suite teardown respectively.
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 10000,
  },
});
