import { defineConfig } from "vitest/config";

// Separate Vitest project for GitHub workflow scripts (see `npm run
// test:workflows`). The scripts under test are embedded in YAML under
// .github/workflows/, not importable modules, so these tests extract and
// execute them against a mock Octokit. Deliberately NOT part of the default
// `npm test` run, whose include glob is scoped to src/ — same precedent as
// firestore-tests/.
export default defineConfig({
  test: {
    include: ["workflow-tests/**/*.test.ts"],
    environment: "node",
  },
});
