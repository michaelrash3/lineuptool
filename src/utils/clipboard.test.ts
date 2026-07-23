import { copyTextToClipboard } from "./clipboard";

const setClipboard = (impl: unknown) =>
  Object.defineProperty(navigator, "clipboard", {
    value: impl,
    configurable: true,
  });

afterEach(() => {
  // Remove any stubs so tests stay independent (jsdom ships neither).
  delete (navigator as any).clipboard;
  delete (document as any).execCommand;
});

describe("copyTextToClipboard", () => {
  it("uses the async Clipboard API when available", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    setClipboard({
      writeText: jest.fn().mockRejectedValue(new Error("denied")),
    });
    (document as any).execCommand = jest.fn(() => true);
    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    expect((document as any).execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when the Clipboard API is absent", async () => {
    (document as any).execCommand = jest.fn(() => true);
    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
  });

  it("resolves false when no copy mechanism works", async () => {
    // No clipboard API and no execCommand (the jsdom default): the fallback
    // throws internally and the helper reports an honest failure.
    await expect(copyTextToClipboard("hello")).resolves.toBe(false);
  });

  it("never leaves the fallback textarea in the DOM", async () => {
    (document as any).execCommand = jest.fn(() => true);
    await copyTextToClipboard("hello");
    expect(document.querySelector("textarea")).toBeNull();
    delete (document as any).execCommand;
    await copyTextToClipboard("hello"); // failing path
    expect(document.querySelector("textarea")).toBeNull();
  });
});
