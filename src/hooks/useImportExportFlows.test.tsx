import { csvEscape } from "./useImportExportFlows";

describe("csvEscape", () => {
  it("passes through plain values untouched", () => {
    expect(csvEscape("Rivera")).toBe("Rivera");
    expect(csvEscape(12)).toBe("12");
  });

  it("renders null/undefined as an empty field", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("quotes values containing commas, quotes, or newlines", () => {
    expect(csvEscape("Smith, Jr.")).toBe('"Smith, Jr."');
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
    // Embedded quotes are doubled per RFC 4180.
    expect(csvEscape('He said "go"')).toBe('"He said ""go"""');
  });
});
