import { afterEach, describe, it, expect, vi } from "vitest";

// Each test re-imports the modules fresh (vi.resetModules) so the module-level
// `started` flag and the errorReporter sink don't leak between cases. The DSN
// is read from import.meta.env at call time, which Vitest exposes as a mutable
// object we can set per-test.
const env = import.meta.env as Record<string, string | undefined>;
const ORIGINAL_DSN = env.VITE_SENTRY_DSN;

afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete env.VITE_SENTRY_DSN;
  else env.VITE_SENTRY_DSN = ORIGINAL_DSN;
  vi.resetModules();
  vi.unmock("@sentry/react");
});

describe("initSentry", () => {
  it("no-ops when no DSN is configured", async () => {
    vi.resetModules();
    delete env.VITE_SENTRY_DSN;
    const { initSentry } = await import("./sentry");
    await expect(initSentry()).resolves.toBe(false);
  });

  it("initializes Sentry and wires it as the error sink when a DSN is set", async () => {
    vi.resetModules();
    env.VITE_SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    const init = vi.fn();
    const captureException = vi.fn();
    vi.doMock("@sentry/react", () => ({ init, captureException }));

    const { initSentry } = await import("./sentry");
    const { reportError } = await import("./errorReporter");

    const ok = await initSentry();
    expect(ok).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: env.VITE_SENTRY_DSN })
    );

    // The reporter now forwards to Sentry.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    reportError(err, { source: "test" });
    expect(captureException).toHaveBeenCalledWith(err, { extra: { source: "test" } });
  });

  it("is idempotent (second call is a no-op)", async () => {
    vi.resetModules();
    env.VITE_SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    vi.doMock("@sentry/react", () => ({ init: vi.fn(), captureException: vi.fn() }));
    const { initSentry } = await import("./sentry");
    expect(await initSentry()).toBe(true);
    expect(await initSentry()).toBe(false);
  });
});
