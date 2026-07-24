// Covers the pure sheet builder only — the jspdf rendering path is exercised
// manually and mocked at module level in the screen test, same as the stats
// report and roster directory.

import { buildTryoutRankingSheet } from "./tryoutRankingPdf";

const candidate = (over: Record<string, unknown> = {}) => ({
  kind: "tryout",
  id: "s1",
  name: "Tryout Kid",
  baseScore: 20,
  fitBonus: 4,
  fitReasons: ["fills SS"],
  score: 24,
  ...over,
});

describe("buildTryoutRankingSheet", () => {
  it("returns null with no projection and with no candidates anywhere", () => {
    expect(buildTryoutRankingSheet(null)).toBeNull();
    expect(
      buildTryoutRankingSheet({
        rosterCap: 12,
        recommended: [],
        nextBest: [],
        belowLine: [],
        needsEvaluation: [],
        tooOld: [],
      }),
    ).toBeNull();
  });

  it("numbers the three buckets into one sheet in board order", () => {
    const data = buildTryoutRankingSheet({
      slotsRemaining: 1,
      recommended: [candidate({ id: "a", name: "Ace", score: 30 })],
      nextBest: [candidate({ id: "b", name: "Bubble", score: 20 })],
      belowLine: [candidate({ id: "c", name: "Cut", score: 10 })],
    });
    expect(data!.rows.map((r) => [r.rank, r.name, r.bucket])).toEqual([
      [1, "Ace", "Recommended"],
      [2, "Bubble", "Next Best"],
      [3, "Cut", "Below Line"],
    ]);
    // The cut rule goes after the recommended bucket.
    expect(data!.aboveLineCount).toBe(1);
  });

  it("formats scores the way the board shows them", () => {
    const data = buildTryoutRankingSheet({
      recommended: [
        candidate({
          baseScore: 20.4,
          fitBonus: 4,
          score: 24.4,
          fitReasons: ["fills SS", "thin at C"],
        }),
      ],
    });
    const row = data!.rows[0];
    expect(row.evalScore).toBe("20");
    expect(row.total).toBe("24");
    expect(row.fitBonus).toBe("+4");
    expect(row.fitReasons).toBe("fills SS, thin at C");
  });

  it("labels a current-roster candidate apart from a tryout, with its tag", () => {
    const data = buildTryoutRankingSheet({
      recommended: [
        candidate({ id: "t", signup: { tryoutNumber: "14" } }),
        candidate({
          id: "u",
          kind: "unknown",
          name: "Returner",
          signup: undefined,
        }),
      ],
    });
    expect(data!.rows[0].source).toBe("Tryout");
    expect(data!.rows[0].number).toBe("14");
    expect(data!.rows[1].source).toBe("Current roster");
    expect(data!.rows[1].number).toBe("");
  });

  it("carries the ungraded and too-old lists even with nothing ranked", () => {
    const data = buildTryoutRankingSheet({
      recommended: [],
      needsEvaluation: [
        candidate({ id: "n", name: "Ungraded", score: null, baseScore: null }),
      ],
      tooOld: [
        { id: "o", firstName: "Old", lastName: "Kid", tryoutNumber: "9" },
      ],
    });
    expect(data!.rows).toEqual([]);
    expect(data!.ungraded[0]).toEqual(
      expect.objectContaining({ name: "Ungraded", source: "Tryout" }),
    );
    expect(data!.tooOld[0]).toEqual(
      expect.objectContaining({ name: "Old Kid", number: "9" }),
    );
  });

  it("passes the roster math through with missing counts as zero", () => {
    const data = buildTryoutRankingSheet({
      rosterCap: 12,
      lockedCount: 9,
      slotsRemaining: 3,
      returningYesCount: 8,
      recommended: [candidate()],
    });
    expect(data!.rosterCap).toBe(12);
    expect(data!.slotsRemaining).toBe(3);
    expect(data!.returningYesCount).toBe(8);
    expect(data!.returningUnknownCount).toBe(0);
    expect(data!.acceptedCount).toBe(0);
  });
});
