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

// jsdom has no ResizeObserver. recharts' ResponsiveContainer observes its
// wrapper to size the chart (it stays 0x0 in tests — aria assertions live on
// the ChartFrame wrapper div instead of the SVG).
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom can't navigate. Several components call window.location.reload() after
// destructive actions (sign-out, team reset — see ErrorBoundary, Chrome,
// WelcomeChooser, SettingsTab). Under jsdom that logs a noisy "Not implemented:
// navigation to another Document" stack on every run and, in some CI sandboxes,
// stalls the worker waiting on a navigation that never resolves. The Location
// instance's methods are non-configurable, so swap the whole `window.location`
// for a Proxy that no-ops the navigation methods and forwards everything else
// (href, pathname, search, ...) to the real object.
const NAV_NOOPS = new Set(["reload", "assign", "replace"]);
const realLocation = window.location;
const stubbedLocation = new Proxy(realLocation, {
  get(target, prop, receiver) {
    if (typeof prop === "string" && NAV_NOOPS.has(prop)) return () => {};
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
try {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: stubbedLocation,
  });
} catch {
  // Environment locks window.location; the navigation warning is harmless noise.
}

// Native <form> submission also makes jsdom attempt a navigation (same warning).
// A capture-phase guard cancels only the navigation default — it runs before
// React's onSubmit, and preventDefault does not stop propagation, so component
// submit handlers still fire normally.
window.addEventListener("submit", (event) => event.preventDefault(), true);

// Programmatic download links (a CSV/PDF export builds a detached <a download>
// and calls a.click() — e.g. FinancesTab's ledger export). The detached anchor
// never reaches the window listener above, and its click makes jsdom attempt a
// navigation. There is nothing to download under jsdom, so short-circuit the
// click for download anchors; regular links keep their default behavior.
const realAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
  if (this.hasAttribute("download")) return;
  return realAnchorClick.apply(this);
};

// canvas-confetti fires requestAnimationFrame callbacks that outlive the test
// and then crash when jsdom's canvas is torn down (clearRect on null). The
// celebration is cosmetic; stub the whole module so the RAF loop never starts.
vi.mock("canvas-confetti", () => ({ default: () => {} }));

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
