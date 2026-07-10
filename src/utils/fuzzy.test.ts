import { fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("returns 0 for an empty needle", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
    expect(fuzzyScore("", "")).toBe(0);
  });

  it("returns the match index for a substring hit", () => {
    expect(fuzzyScore("lineup generator", "lineup")).toBe(0);
    expect(fuzzyScore("the lineup", "lineup")).toBe(4);
  });

  it("ranks an earlier substring hit better (lower) than a later one", () => {
    expect(fuzzyScore("bench equity", "bench")).toBeLessThan(
      fuzzyScore("the bench coach", "bench"),
    );
  });

  it("scores ordered loose matches above 1000, worse than any substring hit", () => {
    // l..u..p appear in order in "lineup" but not adjacently.
    const loose = fuzzyScore("lineup", "lup");
    expect(loose).toBeGreaterThan(1000);
    // Even a substring hit buried deep in a long haystack beats a loose match.
    const deepSubstring = fuzzyScore(`${"x".repeat(500)}lup`, "lup");
    expect(deepSubstring).toBe(500);
    expect(deepSubstring).toBeLessThan(loose);
  });

  it("returns -1 when a needle char is missing or out of order", () => {
    expect(fuzzyScore("lineup", "z")).toBe(-1);
    expect(fuzzyScore("ab", "ba")).toBe(-1);
    expect(fuzzyScore("", "a")).toBe(-1);
  });

  it("matches case-insensitively", () => {
    expect(fuzzyScore("Big Game", "big game")).toBe(0);
    expect(fuzzyScore("lineup", "LINE")).toBe(0);
    expect(fuzzyScore("LINEUP", "lup")).toBe(fuzzyScore("lineup", "lup"));
  });
});
