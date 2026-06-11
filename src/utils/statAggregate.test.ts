import { describe, it, expect } from "vitest";
import { aggregatePlayerStats, recomputeSeasonStats } from "./statAggregate";

describe("aggregatePlayerStats", () => {
  it("sums counting stats across games", () => {
    const out = aggregatePlayerStats([
      { ab: 3, h: 2, hr: 1, rbi: 2 },
      { ab: 4, h: 1, hr: 0, rbi: 1 },
    ]);
    expect(out.ab).toBe(7);
    expect(out.h).toBe(3);
    expect(out.hr).toBe(1);
    expect(out.rbi).toBe(3);
  });

  it("derives exact AVG from summed H/AB", () => {
    const out = aggregatePlayerStats([
      { ab: 3, h: 2, avg: 0.667 },
      { ab: 5, h: 1, avg: 0.2 },
    ]);
    // 3 / 8 = .375 exactly, regardless of the per-game rounded avgs.
    expect(out.avg).toBeCloseTo(0.375, 6);
  });

  it("sums innings pitched in thirds (5.2 + 1.1 = 7.0)", () => {
    const out = aggregatePlayerStats([{ pIp: 5.2 }, { pIp: 1.1 }]);
    expect(out.pIp).toBeCloseTo(7.0, 6);
  });

  it("weights ERA by innings so the season ERA is exact", () => {
    // Game 1: 9.00 over 1.0 IP (1 ER). Game 2: 0.00 over 2.0 IP (0 ER).
    // Season = 9 ER-equivalent / 3 IP = 3.00.
    const out = aggregatePlayerStats([
      { pIp: 1.0, pEra: 9.0 },
      { pIp: 2.0, pEra: 0.0 },
    ]);
    expect(out.pEra).toBeCloseTo(3.0, 6);
  });

  it("weights FPCT by total chances", () => {
    // .500 over 2 TC (1 good) + 1.000 over 8 TC (8 good) = 9/10 = .900
    const out = aggregatePlayerStats([
      { fTc: 2, fFpct: 0.5 },
      { fTc: 8, fFpct: 1.0 },
    ]);
    expect(out.fFpct).toBeCloseTo(0.9, 6);
  });

  it("takes the max velocity across games", () => {
    const out = aggregatePlayerStats([{ pTopMph: 48 }, { pTopMph: 52 }, { pTopMph: 50 }]);
    expect(out.pTopMph).toBe(52);
  });

  it("returns an empty line for no data", () => {
    expect(aggregatePlayerStats([])).toEqual({});
  });
});

describe("recomputeSeasonStats", () => {
  it("rebuilds each player's season stats from per-game lines", () => {
    const players = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" }, // no game lines → untouched
    ] as any;
    const games = [
      { id: "g1", playerStats: { a: { ab: 3, h: 2 }, b: { ab: 2, h: 0 } } },
      { id: "g2", playerStats: { a: { ab: 1, h: 1 } } },
    ] as any;
    const out = recomputeSeasonStats(games, players);
    expect(out.find((p: any) => p.id === "a").stats).toMatchObject({ ab: 4, h: 3 });
    expect(out.find((p: any) => p.id === "b").stats).toMatchObject({ ab: 2, h: 0 });
    // C had no game lines and keeps whatever it had (no stats key here).
    expect(out.find((p: any) => p.id === "c").stats).toBeUndefined();
  });

  it("is idempotent — replacing one game's line doesn't double-count", () => {
    const players = [{ id: "a", name: "A" }] as any;
    const before = recomputeSeasonStats(
      [{ id: "g1", playerStats: { a: { ab: 3, h: 2 } } }] as any,
      players
    );
    expect(before[0].stats).toMatchObject({ ab: 3, h: 2 });
    // Re-import g1 with a correction → season reflects ONLY the new line.
    const after = recomputeSeasonStats(
      [{ id: "g1", playerStats: { a: { ab: 4, h: 1 } } }] as any,
      players
    );
    expect(after[0].stats).toMatchObject({ ab: 4, h: 1 });
  });
});
