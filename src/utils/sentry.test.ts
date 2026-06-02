export {};
// Each test re-imports the modules fresh (jest.resetModules) so the module-level
// `started` flag and the errorReporter sink don't leak between cases.
const ORIGINAL_DSN = process.env.REACT_APP_SENTRY_DSN;

afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.REACT_APP_SENTRY_DSN;
  else process.env.REACT_APP_SENTRY_DSN = ORIGINAL_DSN;
  jest.resetModules();
  jest.unmock("@sentry/react");
});

describe("initSentry", () => {
  it("no-ops when no DSN is configured", async () => {
    jest.resetModules();
    delete process.env.REACT_APP_SENTRY_DSN;
    const { initSentry } = require("./sentry");
    await expect(initSentry()).resolves.toBe(false);
  });

  it("initializes Sentry and wires it as the error sink when a DSN is set", async () => {
    jest.resetModules();
    process.env.REACT_APP_SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    const init = jest.fn();
    const captureException = jest.fn();
    jest.doMock("@sentry/react", () => ({ init, captureException }), { virtual: false });

    const { initSentry } = require("./sentry");
    const { reportError } = require("./errorReporter");

    const ok = await initSentry();
    expect(ok).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: process.env.REACT_APP_SENTRY_DSN })
    );

    // The reporter now forwards to Sentry.
    jest.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    reportError(err, { source: "test" });
    expect(captureException).toHaveBeenCalledWith(err, { extra: { source: "test" } });
  });

  it("is idempotent (second call is a no-op)", async () => {
    jest.resetModules();
    process.env.REACT_APP_SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    jest.doMock("@sentry/react", () => ({ init: jest.fn(), captureException: jest.fn() }));
    const { initSentry } = require("./sentry");
    expect(await initSentry()).toBe(true);
    expect(await initSentry()).toBe(false);
  });
});
