import { defineConfig } from "vitest/config";

// Separate Vitest project for Firestore security-rule tests. These run against
// the Firestore emulator (see `npm run test:rules`) and are intentionally NOT
// part of the default `npm test` run, which is a pure jsdom unit suite with no
// emulator dependency.
export default defineConfig({
  test: {
    include: ["firestore-tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
    // The emulator is a shared, stateful resource — keep the file serial.
    fileParallelism: false,
  },
});
