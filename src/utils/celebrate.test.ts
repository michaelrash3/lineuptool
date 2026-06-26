import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the confetti calls. A file-level mock overrides the global no-op stub
// in setupTests.ts so we can assert on the bursts.
const { confettiSpy } = vi.hoisted(() => ({ confettiSpy: vi.fn() }));
vi.mock("canvas-confetti", () => ({ default: confettiSpy }));

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce") ? reduce : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
};

describe("celebrateWin", () => {
  beforeEach(() => {
    // Fake timers keep the deferred secondary bursts (setTimeout) and the
    // 1500ms re-entrancy reset out of the next test's assertions. resetModules
    // gives each test a fresh `firing` guard.
    vi.useFakeTimers();
    vi.resetModules();
    confettiSpy.mockClear();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("fires a confetti burst", async () => {
    const { celebrateWin } = await import("./celebrate");
    await celebrateWin();
    expect(confettiSpy).toHaveBeenCalledTimes(1);
  });

  it("passes team colors through to confetti when provided", async () => {
    const { celebrateWin } = await import("./celebrate");
    await celebrateWin(["#ff0000", "#00ff00"]);
    expect(confettiSpy).toHaveBeenCalledWith(
      expect.objectContaining({ colors: ["#ff0000", "#00ff00"] }),
    );
  });

  it("no-ops when the user prefers reduced motion", async () => {
    setReducedMotion(true);
    const { celebrateWin } = await import("./celebrate");
    await celebrateWin();
    expect(confettiSpy).not.toHaveBeenCalled();
  });
});
