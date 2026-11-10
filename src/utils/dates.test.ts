import { describe, it, expect } from "vitest";
import { formatLongDate, isValidIsoDate } from "./dates";

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

describe("formatLongDate", () => {
  const now = new Date(2026, 4, 1); // May 1, 2026, local

  it("writes the weekday and month out, and drops this year", () => {
    expect(formatLongDate("2026-05-22", now)).toBe("Friday, May 22");
  });

  it("keeps the year when it isn't this year", () => {
    expect(formatLongDate("2027-01-09", now)).toBe("Saturday, January 9, 2027");
  });

  it("never shifts a day across time zones", () => {
    // Parsed as calendar parts, so a western zone can't roll it back to the
    // 21st the way `new Date("2026-05-22")` (UTC midnight) would.
    expect(formatLongDate("2026-05-22", now)).toMatch(/May 22/);
  });

  it("returns blanks and unparseable input unchanged", () => {
    expect(formatLongDate("", now)).toBe("");
    expect(formatLongDate(undefined, now)).toBe("");
    expect(formatLongDate("TBD", now)).toBe("TBD");
  });
});
