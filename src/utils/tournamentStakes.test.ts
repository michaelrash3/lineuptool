import {
  DEFAULT_TIEBREAKERS,
  normalizeTiebreakers,
  runDiffCapOf,
  tiebreakerLabel,
  summarizeStructure,
  describeStructure,
  poolPlayLedger,
  tiebreakerGuidance,
  opponentStrengthGuidance,
  gameStakes,
  tournamentForGame,
} from "./tournamentStakes";
import type { TiebreakerRule, Tournament } from "../types";

describe("normalizeTiebreakers", () => {
  it("falls back to the USSSA default ladder when absent or empty", () => {
    expect(normalizeTiebreakers(undefined)).toEqual(DEFAULT_TIEBREAKERS);
    expect(normalizeTiebreakers([])).toEqual(DEFAULT_TIEBREAKERS);
    // The default ladder order IS the verified USSSA D-3 ladder.
    expect(DEFAULT_TIEBREAKERS.map((r) => r.id)).toEqual([
      "h2h",
      "runsAllowed",
      "runDiff",
      "runsScored",
      "coinFlip",
    ]);
    expect(DEFAULT_TIEBREAKERS[2].cap).toBe(8);
  });

  it("drops unknown ids and keeps the first position of duplicates", () => {
    const out = normalizeTiebreakers([
      { id: "runsScored" },
      { id: "recordPct" as any },
      { id: "h2h" },
      { id: "runsScored" },
    ]);
    expect(out.map((r) => r.id)).toEqual(["runsScored", "h2h"]);
  });

  it("keeps caps only on runDiff and only when positive", () => {
    const out = normalizeTiebreakers([
      { id: "runsAllowed", cap: 5 } as TiebreakerRule,
      { id: "runDiff", cap: 10.9 },
      { id: "h2h" },
    ]);
    expect(out[0]).toEqual({ id: "runsAllowed" });
    expect(out[1]).toEqual({ id: "runDiff", cap: 10 });

    const uncapped = normalizeTiebreakers([{ id: "runDiff", cap: 0 }]);
    expect(uncapped[0]).toEqual({ id: "runDiff" });
  });
});

describe("runDiffCapOf / tiebreakerLabel", () => {
  it("reads the ladder's run-diff cap (default ladder → 8)", () => {
    expect(runDiffCapOf(undefined)).toBe(8);
    expect(runDiffCapOf([{ id: "runDiff", cap: 12 }])).toBe(12);
    expect(runDiffCapOf([{ id: "runsAllowed" }])).toBeUndefined();
    expect(runDiffCapOf([{ id: "runDiff" }])).toBeUndefined();
  });

  it("labels rules, annotating a capped run differential", () => {
    expect(tiebreakerLabel({ id: "h2h" })).toBe("Head-to-head");
    expect(tiebreakerLabel({ id: "runDiff", cap: 8 })).toBe(
      "Run differential (cap +8)",
    );
    expect(tiebreakerLabel({ id: "runDiff" })).toBe("Run differential");
  });
});

describe("summarizeStructure / describeStructure", () => {
  it("computes pool size and wildcard arithmetic for the 16/4/6 case", () => {
    const s = summarizeStructure({
      teamCount: 16,
      poolCount: 4,
      advanceCount: 6,
      poolWinnersAdvance: true,
    });
    expect(s).toEqual({
      teamCount: 16,
      poolCount: 4,
      poolSize: 4,
      advanceCount: 6,
      autoBids: 4,
      wildcards: 2,
    });
    expect(
      describeStructure({
        teamCount: 16,
        poolCount: 4,
        advanceCount: 6,
        poolWinnersAdvance: true,
      }),
    ).toBe(
      "16 teams · 4 pools of 4 · top 6 advance — 4 pool winners + 2 wildcards",
    );
  });

  it("describes pool-winners-only advancement", () => {
    expect(
      describeStructure({
        teamCount: 12,
        poolCount: 4,
        advanceCount: 4,
        poolWinnersAdvance: true,
      }),
    ).toBe("12 teams · 4 pools of 3 · top 4 advance — pool winners only");
  });

  it("describes straight seeding when pool winners get no automatic bid", () => {
    expect(
      describeStructure({ teamCount: 16, poolCount: 4, advanceCount: 6 }),
    ).toBe("16 teams · 4 pools of 4 · top 6 advance");
  });

  it("renders partial knowledge and returns null for nothing", () => {
    expect(describeStructure({ teamCount: 16 })).toBe("16 teams");
    expect(describeStructure({ teamCount: 10, poolCount: 3 })).toBe(
      "10 teams · 3 pools",
    ); // uneven split → no pool size claimed
    expect(describeStructure({})).toBeNull();
    expect(describeStructure(undefined)).toBeNull();
    expect(describeStructure({ teamCount: 0, poolCount: -2 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const games = [
  {
    id: "g1",
    date: "2099-06-05",
    opponent: "Rays",
    status: "final",
    teamScore: 15,
    opponentScore: 2, // +13 margin, counted +8 under the default cap
  },
  {
    id: "g2",
    date: "2099-06-06",
    opponent: "Cubs",
    status: "final",
    teamScore: 3,
    opponentScore: 5, // -2
  },
  { id: "g3", date: "2099-06-06", opponent: "Mets" }, // pool, not played yet
  {
    id: "g4",
    date: "2099-06-07",
    opponent: "Sharks",
    gameType: "bracket",
    status: "final",
    teamScore: 4,
    opponentScore: 2,
  },
] as any[];

const tournament: Tournament = {
  id: "t1",
  name: "June Bash",
  gameIds: ["g1", "g2", "g3", "g4"],
  structure: {
    teamCount: 16,
    poolCount: 4,
    advanceCount: 6,
    poolWinnersAdvance: true,
  },
};

describe("poolPlayLedger", () => {
  it("caps per-game run differential, excludes bracket games, counts remaining", () => {
    const ledger = poolPlayLedger(tournament, games);
    expect(ledger.played).toBe(2);
    expect(ledger.wins).toBe(1);
    expect(ledger.losses).toBe(1);
    expect(ledger.runsScored).toBe(18);
    expect(ledger.runsAllowed).toBe(7);
    // +13 counted as +8, then -2: capped diff +6 (raw would be +11).
    expect(ledger.runDiff).toBe(6);
    expect(ledger.runDiffLostToCap).toBe(5);
    expect(ledger.remaining).toBe(1);
  });

  it("caps losing margins symmetrically and honors a custom cap", () => {
    const blowoutLoss = [
      {
        id: "g1",
        date: "2099-06-05",
        opponent: "Rays",
        status: "final",
        teamScore: 0,
        opponentScore: 14,
      },
    ] as any[];
    const t: Tournament = { id: "t", name: "T", gameIds: ["g1"] };
    expect(poolPlayLedger(t, blowoutLoss).runDiff).toBe(-8);
    expect(
      poolPlayLedger(t, blowoutLoss, [{ id: "runDiff", cap: 12 }]).runDiff,
    ).toBe(-12);
    // No runDiff rung in the ladder → margin counts raw.
    expect(
      poolPlayLedger(t, blowoutLoss, [{ id: "runsAllowed" }]).runDiff,
    ).toBe(-14);
  });

  it("ignores scrimmages entirely", () => {
    const withScrimmage = [
      {
        id: "g1",
        date: "2099-06-05",
        opponent: "Rays",
        isScrimmage: true,
        status: "final",
        teamScore: 9,
        opponentScore: 0,
      },
    ] as any[];
    const t: Tournament = { id: "t", name: "T", gameIds: ["g1"] };
    const ledger = poolPlayLedger(t, withScrimmage);
    expect(ledger.played).toBe(0);
    expect(ledger.remaining).toBe(0);
  });
});

describe("tiebreakerGuidance", () => {
  it("returns one line per rung in ladder order, cap-aware", () => {
    const lines = tiebreakerGuidance(undefined);
    expect(lines.map((l) => l.id)).toEqual([
      "h2h",
      "runsAllowed",
      "runDiff",
      "runsScored",
      "coinFlip",
    ]);
    expect(lines[2].detail).toMatch(/\+8/);
    expect(lines[0].detail).toMatch(/two-team/i);
  });

  it("uses uncapped copy when run differential has no cap", () => {
    const lines = tiebreakerGuidance([{ id: "runDiff" }]);
    expect(lines[0].detail).toMatch(/no cap/i);
  });
});

describe("opponentStrengthGuidance", () => {
  it("is null without a scouting read", () => {
    expect(opponentStrengthGuidance(undefined, undefined)).toBeNull();
  });

  it("tells a coach where margin stops paying against a weaker team", () => {
    expect(opponentStrengthGuidance("weaker", undefined)).toMatch(/\+8/);
    expect(opponentStrengthGuidance("weaker", [{ id: "runsAllowed" }])).toMatch(
      /uncapped/i,
    );
  });

  it("frames runs allowed against a stronger team and the win for even", () => {
    expect(opponentStrengthGuidance("stronger", undefined)).toMatch(
      /runs allowed/i,
    );
    expect(opponentStrengthGuidance("even", undefined)).toMatch(/win/i);
  });
});

describe("gameStakes", () => {
  it("is null for a game outside the tournament", () => {
    expect(
      gameStakes({
        tournament,
        game: { id: "elsewhere" } as any,
        games,
      }),
    ).toBeNull();
  });

  it("frames a pool game: numbering, structure, wildcard scramble, ledger", () => {
    const stakes = gameStakes({ tournament, game: games[1], games });
    expect(stakes?.phase).toBe("pool");
    expect(stakes?.headline).toBe("Pool game 2 of 3");
    expect(stakes?.lines[0]).toMatch(/16 teams · 4 pools of 4/);
    expect(stakes?.lines[1]).toMatch(/wildcard scramble for 2 spots/);
    expect(stakes?.ledger?.runDiff).toBe(6);
  });

  it("adds the scouting line when the game carries an opponent-strength read", () => {
    const readGame = { ...games[1], opponentStrength: "stronger" };
    const stakes = gameStakes({ tournament, game: readGame as any, games });
    expect(stakes?.lines.some((l) => /Stronger opponent/.test(l))).toBe(true);
  });

  it("frames a bracket game as single elimination with no ledger", () => {
    const stakes = gameStakes({ tournament, game: games[3], games });
    expect(stakes?.phase).toBe("bracket");
    expect(stakes?.headline).toBe("Bracket game 1 of 1");
    expect(stakes?.lines.some((l) => /win or go home/i.test(l))).toBe(true);
    expect(stakes?.ledger).toBeUndefined();
  });

  it("notes pool-winners-only stakes when there are no wildcards", () => {
    const winnersOnly: Tournament = {
      ...tournament,
      structure: {
        teamCount: 12,
        poolCount: 4,
        advanceCount: 4,
        poolWinnersAdvance: true,
      },
    };
    const stakes = gameStakes({
      tournament: winnersOnly,
      game: games[0],
      games,
    });
    expect(stakes?.lines.some((l) => /Only pool winners advance/.test(l))).toBe(
      true,
    );
  });
});

describe("tournamentForGame", () => {
  it("finds the stored tournament claiming a game id", () => {
    expect(tournamentForGame([tournament], "g2")?.id).toBe("t1");
    expect(tournamentForGame([tournament], "nope")).toBeUndefined();
    expect(tournamentForGame(undefined, "g1")).toBeUndefined();
  });
});
