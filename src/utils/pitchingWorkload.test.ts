import { describe, expect, it } from "vitest";
import { pitchOutingSeries } from "./pitchingWorkload";

describe("pitchOutingSeries", () => {
  it("sums same-day entries and returns counts oldest → newest", () => {
    const series = pitchOutingSeries({
      log: [
        { date: "2026-05-10", pitches: 20 },
        { date: "2026-05-03", pitches: 15 },
        { date: "2026-05-10", pitches: 25 }, // doubleheader, same day → summed
      ],
    });
    expect(series).toEqual([15, 45]);
  });

  it("trims to the most recent maxPoints outings", () => {
    const log = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      pitches: i + 1,
    }));
    expect(pitchOutingSeries({ log }, 3)).toEqual([8, 9, 10]);
  });

  it("ignores entries without a date and handles empty/missing logs", () => {
    expect(pitchOutingSeries({ log: [{ pitches: 30 }] })).toEqual([]);
    expect(pitchOutingSeries(undefined)).toEqual([]);
    expect(pitchOutingSeries({})).toEqual([]);
  });
});
