import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Builds the browser-check harness (see e2e/harness/main.tsx): the real app
// with src/providers/TeamProvider swapped for an in-memory stand-in. A real
// production-mode build served by `vite preview`, not the dev server — the dev
// server re-optimizes dependencies and reloads the page the first time each
// lazy screen is opened, which would make the check flaky.
const here = __dirname;
const mockProvider = path.resolve(here, "harness/MockTeamProvider.tsx");

export default defineConfig({
  root: here,
  publicDir: path.resolve(here, "../public"),
  plugins: [
    react(),
    {
      name: "swap-team-provider",
      enforce: "pre",
      resolveId(source, importer) {
        // The stand-in itself reads the real provider's source as text.
        if (!importer || importer.startsWith(path.resolve(here, "harness")))
          return null;
        return /(^|\/)providers\/TeamProvider$/.test(source)
          ? mockProvider
          : null;
      },
    },
  ],
  build: {
    outDir: path.resolve(here, "dist"),
    emptyOutDir: true,
    // Nothing ships from here; skip the work that only matters for shipping.
    minify: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 5000,
  },
  preview: { port: 4174, strictPort: true },
});
