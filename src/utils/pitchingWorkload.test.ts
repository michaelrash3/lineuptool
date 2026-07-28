import { describe, expect, it } from "vitest";
import { pitchOutingSeries, relievedArmIds } from "./pitchingWorkload";

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

describe("relievedArmIds", () => {
  const inn = (pId: string | null) => (pId ? { P: { id: pId } } : {});

  it("is empty while one arm has held the mound wire to wire", () => {
    const lineup = [inn("a"), inn("a"), inn("a")];
    expect(relievedArmIds(lineup, 2)).toEqual(new Set());
  });

  it("marks the pulled starter once a reliever takes over", () => {
    // a pitched innings 1-2, b relieved from inning 3.
    const lineup = [inn("a"), inn("a"), inn("b"), inn("b")];
    expect(relievedArmIds(lineup, 3)).toEqual(new Set(["a"]));
    // …and the current arm (b) is never marked relieved.
    expect(relievedArmIds(lineup, 3).has("b")).toBe(false);
  });

  it("only sees innings up to throughInning — before the change nobody is relieved", () => {
    const lineup = [inn("a"), inn("a"), inn("b"), inn("b")];
    expect(relievedArmIds(lineup, 1)).toEqual(new Set());
  });

  it("marks a bounced arm (a→b→a) as having relieved b, not a", () => {
    // Shouldn't happen under the game-long pin, but tolerate stored data:
    // the latest arm is current; everyone else who pitched is done.
    const lineup = [inn("a"), inn("b"), inn("a")];
    expect(relievedArmIds(lineup, 2)).toEqual(new Set(["b"]));
  });

  it("skips innings with no pitcher and tolerates missing lineups", () => {
    const lineup = [inn("a"), inn(null), inn("b")];
    expect(relievedArmIds(lineup, 2)).toEqual(new Set(["a"]));
    expect(relievedArmIds(null, 3)).toEqual(new Set());
    expect(relievedArmIds([], 0)).toEqual(new Set());
    // throughInning past the end clamps to the recorded innings.
    expect(relievedArmIds(lineup, 99)).toEqual(new Set(["a"]));
  });
});
