import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

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
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false,
      includeAssets: [
        "favicon-16.png",
        "favicon-32.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-192.png",
        "icon-maskable-512.png",
      ],
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // SPA: unknown routes load the shell. Firebase auth/API endpoints
        // must never be intercepted by the fallback.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/__\//],
        // The firebase vendor chunk pushes past workbox's 2MB default.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
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
  },
});
