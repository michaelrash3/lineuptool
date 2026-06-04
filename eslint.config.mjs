import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Deliberately minimal. The Vite migration dropped Create React App's built-in
// lint pass; this restores the part that actually caught bugs — the Rules of
// Hooks — without layering a whole style regime over an existing 30k-line
// codebase (which would flood and block CI on day one).
//   - rules-of-hooks  → error  (conditional/early-return hooks are real bugs)
//   - exhaustive-deps → warn   (advisory; surfaces stale closures, won't fail CI)
//   - no-explicit-any → warn   (advisory; makes the ~800 `any` escapes visible
//                               so they can be chipped away — `eslint .` does not
//                               pass --max-warnings, so this never fails CI)
// Widen the ruleset (or promote these to error) later if desired.
export default [
  {
    // The codebase still carries Create-React-App-era `eslint-disable` comments
    // for rules this minimal config doesn't run yet (no-console, no-alert, …).
    // They encode real intent and stay valid if the ruleset is widened, so
    // don't flag them as unused in the meantime.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    ignores: [
      "build/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "**/*.config.{js,mjs,ts}",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
