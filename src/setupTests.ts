// Loaded before the test suite (see vite.config.ts `test.setupFiles`).
// Adds the jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.).
import "@testing-library/jest-dom";
import { vi } from "vitest";

// The suite was written against Jest's `jest.*` API. Vitest's `vi` is a drop-in
// for the surface we use (fn/spyOn/clearAllMocks/etc.), so alias it globally to
// avoid churning every call site. Module mocking that must be hoisted
// (vi.mock/doMock/unmock) is converted explicitly in the few files that use it.
// Cast through unknown: the global `jest` is typed by @types/jest (kept for the
// describe/it/expect/jest.* types the suite uses), and vi only implements the
// subset we actually call — so a structural assignment would fail the typecheck.
(globalThis as { jest: unknown }).jest = vi;

// jsdom has no matchMedia. framer-motion's `MotionConfig reducedMotion="user"`
// and src/lib/celebrate.ts both query prefers-reduced-motion through it.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
