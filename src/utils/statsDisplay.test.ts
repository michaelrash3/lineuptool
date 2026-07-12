import { describe, it, expect } from "vitest";
import { finiteStat, readStat, formatStatDisplay } from "./stats";

describe("stat display readers", () => {
  it("finiteStat filters non-numbers", () => {
    expect(finiteStat(0.312)).toBe(0.312);
    expect(finiteStat("0.312")).toBeUndefined();
    expect(finiteStat(NaN)).toBeUndefined();
    expect(finiteStat(undefined)).toBeUndefined();
  });

  it("readStat takes the first finite value among key spellings", () => {
    expect(readStat({ fFpct: 0.95, fpct: 0.5 }, "fFpct", "fpct")).toBe(0.95);
    expect(readStat({ fpct: 0.5 }, "fFpct", "fpct")).toBe(0.5);
    expect(readStat({ fFpct: null }, "fFpct", "fpct")).toBeUndefined();
    expect(readStat(undefined, "avg")).toBeUndefined();
  });

  it("formats each kind", () => {
    expect(formatStatDisplay(3.6, "int")).toBe("4");
    expect(formatStatDisplay(2.345, "dec2")).toBe("2.35");
    // Batting-average style strips the leading zero…
    expect(formatStatDisplay(0.312, "dec3")).toBe(".312");
    // …but a value >= 1 keeps its integer part.
    expect(formatStatDisplay(1.1, "dec3")).toBe("1.100");
    // pct accepts both 0-1 rates and already-scaled numbers.
    expect(formatStatDisplay(0.42, "pct")).toBe("42.0%");
    expect(formatStatDisplay(42, "pct")).toBe("42.0%");
    expect(formatStatDisplay(12.34, "ip")).toBe("12.3");
  });

  it("renders missing values with the caller's empty token", () => {
    expect(formatStatDisplay(undefined, "dec3")).toBe("");
    expect(formatStatDisplay(undefined, "dec3", "—")).toBe("—");
  });
});
