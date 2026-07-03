import { describe, it, expect } from "vitest";
import { isValidIsoDate } from "./dates";

describe("isValidIsoDate", () => {
  it("accepts real calendar dates in strict YYYY-MM-DD form", () => {
    expect(isValidIsoDate("2026-07-03")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap day
    expect(isValidIsoDate("2026-12-31")).toBe(true);
  });

  it("rejects blanks, malformed strings, and non-strings", () => {
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("undefined")).toBe(false);
    expect(isValidIsoDate("2026-7-3")).toBe(false); // unpadded
    expect(isValidIsoDate("2026-07-03T12:00:00Z")).toBe(false); // datetime
    expect(isValidIsoDate(undefined)).toBe(false);
    expect(isValidIsoDate(20260703)).toBe(false);
  });

  it("rejects impossible calendar dates the regex alone would accept", () => {
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2025-02-29")).toBe(false); // not a leap year
  });
});
