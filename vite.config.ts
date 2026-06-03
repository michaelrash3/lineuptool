import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vite replaces Create React App (react-scripts). Static assets continue to
// live in public/ and are copied to the build output as-is. Tests run under
// Vitest (jsdom) with the same setup file CRA used.
export default defineConfig({
  plugins: [react()],
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
