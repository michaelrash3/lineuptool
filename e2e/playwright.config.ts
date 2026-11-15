import { defineConfig } from "@playwright/test";

// The browser check: every screen of the real app, in a real browser, at
// phone, tablet and desktop widths (npm run test:browser). The unit suite runs
// in a simulated DOM with no layout and no real router, so it cannot see a
// screen that scrolls sideways, a refresh that loops, or a component that
// only crashes once it is actually mounted — all of which have shipped.
//
// The harness it drives is built by e2e/vite.config.ts.
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  // A screen either passes or it doesn't; a retry would only hide a flake.
  retries: 0,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:4174",
    // Entrance animations would put elements mid-slide when measured.
    reducedMotion: "reduce",
    trace: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    // Layout and behaviour, at three widths.
    {
      name: "phone",
      testIgnore: "**/contrast.e2e.ts",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet",
      testIgnore: "**/contrast.e2e.ts",
      use: { viewport: { width: 820, height: 1180 } },
    },
    {
      name: "desktop",
      testIgnore: "**/contrast.e2e.ts",
      use: { viewport: { width: 1440, height: 900 } },
    },
    // Colour, in light and dark. Width doesn't change it, so once is enough.
    {
      name: "themes",
      testMatch: "**/contrast.e2e.ts",
      use: { viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command:
      "npx vite build --config e2e/vite.config.ts && npx vite preview --config e2e/vite.config.ts",
    url: "http://localhost:4174",
    cwd: "..",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
