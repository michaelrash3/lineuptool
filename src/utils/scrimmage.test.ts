import { describe, it, expect } from "vitest";
import { countsTowardStats, buildSeasonSummary } from "./helpers";

const finalWin = { status: "final", teamScore: 7, opponentScore: 3 };

describe("countsTowardStats", () => {
  it("counts a finalized non-scrimmage game", () => {
    expect(countsTowardStats(finalWin)).toBe(true);
  });

  it("excludes a scrimmage even when finalized", () => {
    expect(countsTowardStats({ ...finalWin, isScrimmage: true })).toBe(false);
  });

  it("excludes an unfinalized game", () => {
    expect(countsTowardStats({ status: "scheduled", teamScore: null, opponentScore: null })).toBe(
      false
    );
  });
});

describe("buildSeasonSummary excludes scrimmages from the record", () => {
  it("a scrimmage win does not add to W-L or runs", () => {
    const games = [
      { id: "a", date: "2026-04-01", opponent: "A", status: "final", teamScore: 5, opponentScore: 2 },
      // Scrimmage blowout that must NOT count.
      {
        id: "b",
        date: "2026-04-08",
        opponent: "B",
        status: "final",
        teamScore: 20,
        opponentScore: 0,
        isScrimmage: true,
      },
    ] as any;
    const summary = buildSeasonSummary(games);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(0);
    expect(summary.runsFor).toBe(5);
    expect(summary.runsAgainst).toBe(2);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].id).toBe("a");
  });
});
