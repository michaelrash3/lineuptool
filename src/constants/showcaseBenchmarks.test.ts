import { describe, it, expect } from "vitest";
import {
  basepathForAge,
  scoreMeasurement,
  scorePitchAccuracy,
  measurementGrades,
  EXPECTED_STRIKES_OF_10,
} from "./showcaseBenchmarks";

describe("basepathForAge", () => {
  it("maps age groups to their basepath distance", () => {
    expect(basepathForAge("8U")).toBe(60);
    expect(basepathForAge("7U")).toBe(60);
    expect(basepathForAge("9U")).toBe(65);
    expect(basepathForAge("10U")).toBe(65);
    expect(basepathForAge("11U")).toBe(70);
    expect(basepathForAge("12U")).toBe(70);
    expect(basepathForAge("13U")).toBe(90);
    expect(basepathForAge("14U")).toBe(90);
  });
});

describe("scoreMeasurement — the coach's charts, verbatim", () => {
  it("home-to-first grades against the age's chart row (lower = better)", () => {
    // Age 10 (65 ft): 5.0+ →1, 4.7–4.9 →2, 4.4–4.6 →3, 4.1–4.3 →4, ≤4.0 →5.
    expect(scoreMeasurement("runToFirstSec", 5.0, "10U")).toBe(1);
    expect(scoreMeasurement("runToFirstSec", 4.8, "10U")).toBe(2);
    expect(scoreMeasurement("runToFirstSec", 4.5, "10U")).toBe(3);
    expect(scoreMeasurement("runToFirstSec", 4.2, "10U")).toBe(4);
    expect(scoreMeasurement("runToFirstSec", 4.0, "10U")).toBe(5);
    // Age 13 (90 ft) expectations relax with the longer basepath.
    expect(scoreMeasurement("runToFirstSec", 5.3, "13U")).toBe(3);
  });

  it("exit velo grades against the age's chart row (higher = better)", () => {
    // Age 12: ≤50 →1, 51–55 →2, 56–60 →3, 61–65 →4, ≥66 →5.
    expect(scoreMeasurement("exitVeloMph", 50, "12U")).toBe(1);
    expect(scoreMeasurement("exitVeloMph", 53, "12U")).toBe(2);
    expect(scoreMeasurement("exitVeloMph", 58, "12U")).toBe(3);
    expect(scoreMeasurement("exitVeloMph", 63, "12U")).toBe(4);
    expect(scoreMeasurement("exitVeloMph", 66, "12U")).toBe(5);
  });

  it("max throw velo uses its own chart, not the exit-velo one", () => {
    // Age 8: exit-velo 3-band starts at 39, but throw-velo 3-band starts at 38.
    expect(scoreMeasurement("maxThrowVeloMph", 38, "8U")).toBe(3);
    expect(scoreMeasurement("exitVeloMph", 38, "8U")).toBe(2);
  });

  it("clamps ages outside the chart to the nearest row", () => {
    expect(scoreMeasurement("exitVeloMph", 45, "6U")).toBe(
      scoreMeasurement("exitVeloMph", 45, "7U"),
    );
    expect(scoreMeasurement("exitVeloMph", 81, "16U")).toBe(
      scoreMeasurement("exitVeloMph", 81, "14U"),
    );
  });

  it("returns null for missing/invalid values — unrecorded never penalizes", () => {
    expect(scoreMeasurement("exitVeloMph", null, "10U")).toBeNull();
    expect(scoreMeasurement("exitVeloMph", 0, "10U")).toBeNull();
    expect(scoreMeasurement("runToFirstSec", NaN, "10U")).toBeNull();
  });
});

describe("scorePitchAccuracy — strikes of 10, age-adjusted", () => {
  it("hitting the age's expected count grades 3 (average)", () => {
    // 8U expects 5/10; 12U expects 7/10 — same grade for age-equivalent work.
    expect(scorePitchAccuracy(5, 10, "8U")).toBe(3);
    expect(scorePitchAccuracy(7, 10, "12U")).toBe(3);
    expect(scorePitchAccuracy(5, 10, "8U")).toBe(
      scorePitchAccuracy(7, 10, "12U"),
    );
  });

  it("steps grades by distance from the expectation", () => {
    const expected = EXPECTED_STRIKES_OF_10[10]; // 6
    expect(scorePitchAccuracy(expected - 2, 10, "10U")).toBe(1);
    expect(scorePitchAccuracy(expected - 1, 10, "10U")).toBe(2);
    expect(scorePitchAccuracy(expected + 1, 10, "10U")).toBe(4);
    expect(scorePitchAccuracy(expected + 2, 10, "10U")).toBe(5);
  });

  it("scales non-10 attempt counts to a strikes-of-10 equivalent", () => {
    // 3 of 5 = 6 of 10 → grade 3 for a 10U (expects 6).
    expect(scorePitchAccuracy(3, 5, "10U")).toBe(3);
  });

  it("rejects impossible counts", () => {
    expect(scorePitchAccuracy(11, 10, "10U")).toBeNull();
    expect(scorePitchAccuracy(-1, 10, "10U")).toBeNull();
    expect(scorePitchAccuracy(null, 10, "10U")).toBeNull();
  });
});

describe("measurementGrades — the definitive overlay", () => {
  it("maps every recorded station to its EXISTING eval category id", () => {
    const grades = measurementGrades(
      {
        runToFirstSec: 4.0, // 10U → 5
        exitVeloMph: 57, // 10U → 5
        maxThrowVeloMph: 41, // 10U → 2
        pitchStrikes: 6,
        pitchAttempts: 10, // 10U expects 6 → 3
        fieldingGround: 4,
        fieldingFly: 2, // avg 3
        pitchMph: 48, // raw mph passthrough for the pitchVelo radar row
      },
      "10U",
    );
    expect(grades).toEqual({
      speed: 5,
      power: 5,
      armStrength: 2,
      armAccuracy: 3,
      glove: 3,
      pitchVelo: 48,
    });
  });

  it("includes ONLY recorded stations — missing data never grades", () => {
    expect(measurementGrades({ exitVeloMph: 57 }, "10U")).toEqual({
      power: 5,
    });
    expect(measurementGrades(undefined, "10U")).toEqual({});
  });

  it("averages whichever fielding grades exist", () => {
    expect(measurementGrades({ fieldingGround: 4 }, "10U")).toEqual({
      glove: 4,
    });
  });
});
