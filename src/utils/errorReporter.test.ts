import {
  reportError,
  setErrorSink,
  initErrorReporting,
  __resetErrorReportingForTest,
} from "./errorReporter";

describe("errorReporter", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetErrorReportingForTest();
    consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("logs to the console and forwards to the configured sink", () => {
    const sink = jest.fn();
    setErrorSink(sink);
    const err = new Error("boom");
    reportError(err, { source: "test" });
    expect(consoleSpy).toHaveBeenCalled();
    expect(sink).toHaveBeenCalledWith(err, { source: "test" });
  });

  it("does not throw when no sink is configured", () => {
    expect(() => reportError(new Error("x"))).not.toThrow();
  });

  it("swallows errors thrown by the sink", () => {
    setErrorSink(() => {
      throw new Error("sink failed");
    });
    expect(() => reportError(new Error("x"))).not.toThrow();
  });

  it("installs global handlers once and forwards unhandled rejections", () => {
    const addSpy = jest.spyOn(window, "addEventListener");
    initErrorReporting();
    initErrorReporting(); // idempotent — second call is a no-op
    const errorHandlers = addSpy.mock.calls.filter((c) => c[0] === "error");
    const rejectionHandlers = addSpy.mock.calls.filter(
      (c) => c[0] === "unhandledrejection"
    );
    expect(errorHandlers).toHaveLength(1);
    expect(rejectionHandlers).toHaveLength(1);

    const sink = jest.fn();
    setErrorSink(sink);
    const reason = new Error("rejected");
    (rejectionHandlers[0][1] as (e: any) => void)({ reason });
    expect(sink).toHaveBeenCalledWith(reason, { source: "unhandledrejection" });
    addSpy.mockRestore();
  });
});
