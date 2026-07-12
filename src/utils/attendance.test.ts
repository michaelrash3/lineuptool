import { describe, it, expect } from "vitest";
import { attIsPresent, attIsAbsent } from "./attendance";

// Both stored shapes are live: game attendance writes booleans, practice
// attendance writes strings. "excused" and unmarked count neither way.
describe("attendance predicates", () => {
  it("accepts both present shapes", () => {
    expect(attIsPresent(true)).toBe(true);
    expect(attIsPresent("present")).toBe(true);
    expect(attIsPresent(false)).toBe(false);
    expect(attIsPresent("absent")).toBe(false);
  });

  it("accepts both absent shapes", () => {
    expect(attIsAbsent(false)).toBe(true);
    expect(attIsAbsent("absent")).toBe(true);
    expect(attIsAbsent(true)).toBe(false);
    expect(attIsAbsent("present")).toBe(false);
  });

  it("counts excused and unmarked as neither", () => {
    for (const v of ["excused", undefined, null, ""]) {
      expect(attIsPresent(v)).toBe(false);
      expect(attIsAbsent(v)).toBe(false);
    }
  });
});
