import { describe, it, expect } from "vitest";
import { buildTeamTrendSeries } from "./teamTrends";
import type { Game } from "../types";

const finalGame = (
  id: string,
  date: string,
  teamScore: number,
  opponentScore: number,
  extra: Partial<Game> = {},
): Game => ({
  id,
  date,
  opponent: `Opp ${id}`,
  status: "final",
  teamScore,
  opponentScore,
  ...extra,
});

describe("buildTeamTrendSeries", () => {
  it("returns an empty series (with the stable bucket shape) for null/empty games", () => {
    for (const games of [null, undefined, []]) {
      const series = buildTeamTrendSeries(games as Game[] | null | undefined);
      expect(series.points).toEqual([]);
      expect(series.summary.gamesPlayed).toBe(0);
      expect(series.marginBuckets).toHaveLength(7);
      expect(series.marginBuckets.every((b) => b.count === 0)).toBe(true);
    }
  });

  it("excludes scrimmages and unfinalized games", () => {
    const series = buildTeamTrendSeries([
      finalGame("a", "2026-04-01", 5, 2),
      finalGame("b", "2026-04-08", 20, 0, { isScrimmage: true }),
      {
        id: "c",
        date: "2026-04-15",
        opponent: "Not Played",
        status: "scheduled",
        teamScore: null,
        opponentScore: null,
      } as unknown as Game,
    ]);
    expect(series.points).toHaveLength(1);
    expect(series.points[0].id).toBe("a");
    expect(series.summary.gamesPlayed).toBe(1);
  });

  it("orders points chronologically and accumulates cumRunDiff", () => {
    // Deliberately shuffled input; margins +5, -2, +1 in date order.
    const series = buildTeamTrendSeries([
      finalGame("g3", "2026-04-15", 4, 3),
      finalGame("g1", "2026-04-01", 8, 3),
      finalGame("g2", "2026-04-08", 1, 3),
    ]);
    expect(series.points.map((p) => p.id)).toEqual(["g1", "g2", "g3"]);
    expect(series.points.map((p) => p.margin)).toEqual([5, -2, 1]);
    expect(series.points.map((p) => p.cumRunDiff)).toEqual([5, 3, 4]);
    expect(series.points.map((p) => p.result)).toEqual(["W", "L", "W"]);
    expect(series.points[0].runsFor).toBe(8);
    expect(series.points[0].runsAgainst).toBe(3);
    expect(series.points[0].opponent).toBe("Opp g1");
  });

  it("keeps rollingWinPct null until 3 games, then slides a 5-game window", () => {
    // W W W L L L
    const series = buildTeamTrendSeries([
      finalGame("g1", "2026-04-01", 3, 0),
      finalGame("g2", "2026-04-02", 3, 0),
      finalGame("g3", "2026-04-03", 3, 0),
      finalGame("g4", "2026-04-04", 0, 3),
      finalGame("g5", "2026-04-05", 0, 3),
      finalGame("g6", "2026-04-06", 0, 3),
    ]);
    const pct = series.points.map((p) => p.rollingWinPct);
    expect(pct[0]).toBeNull();
    expect(pct[1]).toBeNull();
    expect(pct[2]).toBe(1); // first computed value: 3 wins in 3 games
    expect(pct[3]).toBe(3 / 4);
    expect(pct[4]).toBe(3 / 5);
    // Point 6: window is games 2-6 (W W L L L) — game 1 has slid out.
    expect(pct[5]).toBe(2 / 5);
  });

  it("counts a tie as half a win in the rolling window", () => {
    // W T T → (1 + 0.5 + 0.5) / 3
    const series = buildTeamTrendSeries([
      finalGame("g1", "2026-04-01", 3, 0),
      finalGame("g2", "2026-04-02", 2, 2),
      finalGame("g3", "2026-04-03", 4, 4),
    ]);
    expect(series.points[2].result).toBe("T");
    expect(series.points[2].rollingWinPct).toBeCloseTo(2 / 3, 10);
  });

  it("builds all 7 margin buckets, including zero-count ones, with ties as close", () => {
    // Margins: -10, -1, 0, +2, +4, +9 — nothing lands in "-6 to -3".
    const series = buildTeamTrendSeries([
      finalGame("g1", "2026-04-01", 0, 10),
      finalGame("g2", "2026-04-02", 2, 3),
      finalGame("g3", "2026-04-03", 5, 5),
      finalGame("g4", "2026-04-04", 6, 4),
      finalGame("g5", "2026-04-05", 7, 3),
      finalGame("g6", "2026-04-06", 12, 3),
    ]);
    expect(series.marginBuckets).toEqual([
      { label: "≤ -7", kind: "loss", count: 1 },
      { label: "-6 to -3", kind: "loss", count: 0 },
      { label: "-2 to -1", kind: "close", count: 1 },
      { label: "Tie", kind: "close", count: 1 },
      { label: "+1 to +2", kind: "close", count: 1 },
      { label: "+3 to +6", kind: "win", count: 1 },
      { label: "≥ +7", kind: "win", count: 1 },
    ]);
  });

  it("puts boundary margins in the right buckets", () => {
    // Margins: -7, -6, -3, -2, +1, +3, +6, +7
    const series = buildTeamTrendSeries([
      finalGame("g1", "2026-04-01", 0, 7),
      finalGame("g2", "2026-04-02", 0, 6),
      finalGame("g3", "2026-04-03", 0, 3),
      finalGame("g4", "2026-04-04", 0, 2),
      finalGame("g5", "2026-04-05", 1, 0),
      finalGame("g6", "2026-04-06", 3, 0),
      finalGame("g7", "2026-04-07", 6, 0),
      finalGame("g8", "2026-04-08", 7, 0),
    ]);
    expect(series.marginBuckets.map((b) => b.count)).toEqual([
      1, 2, 1, 0, 1, 2, 1,
    ]);
  });
});
