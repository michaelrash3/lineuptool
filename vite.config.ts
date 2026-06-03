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
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    // Match CRA: only our own source is under test; node_modules excluded.
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
  },
});
