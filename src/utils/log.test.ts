import { describe, it, expect, vi, afterEach } from "vitest";
import { log, __isDevForTest } from "./log";

describe("log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always emits warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.warn("boom", { a: 1 });
    expect(spy).toHaveBeenCalledWith("boom", { a: 1 });
  });

  it("always emits error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("bad");
    expect(spy).toHaveBeenCalledWith("bad");
  });

  it("gates info on dev mode", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    log.info("hi");
    // Under Vitest, import.meta.env.DEV is truthy, so info should pass through.
    if (__isDevForTest) {
      expect(spy).toHaveBeenCalledWith("hi");
    } else {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("gates debug on dev mode", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    log.debug("trace");
    if (__isDevForTest) {
      expect(spy).toHaveBeenCalledWith("trace");
    } else {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
