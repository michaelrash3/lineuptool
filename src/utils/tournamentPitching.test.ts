import {
  assessTournamentPlan,
  orderedTournamentGames,
  planEntryStatus,
  plannedPitchesOf,
  priorPlannedOutingsForGame,
  unclaimedTournamentSuggestions,
  withPlannedOutings,
} from "./tournamentPitching";
import { maxPitchesForAge, resolvePitchRuleSet } from "../lineupEngine";
import type { Game, Player, Tournament } from "../types";

// Little League defaults: 9U daily max 75; rest tiers 66+→4d, 51+→3d,
// 36+→2d, 21+→1d, else 0d. All tests pin against these published numbers.
const RULES = resolvePitchRuleSet(null);
const AGE = "9U";

const pitcher = (id: string, name: string, over: any = {}): Player =>
  ({
    id,
    name,
    comfortablePositions: ["P"],
    pitching: {},
    ...over,
  }) as Player;

// A Saturday doubleheader + Sunday bracket game.
const G1 = {
  id: "g1",
  date: "2026-06-06",
  startUtc: "2026-06-06T13:00:00Z",
} as Game;
const G2 = {
  id: "g2",
  date: "2026-06-06",
  startUtc: "2026-06-06T18:00:00Z",
} as Game;
const G3 = { id: "g3", date: "2026-06-07" } as Game;
const GAMES = [G3, G1, G2]; // deliberately unordered

const tournament = (pitchPlan: Tournament["pitchPlan"]): Tournament => ({
  id: "t1",
  name: "Memorial Bash",
  gameIds: ["g1", "g2", "g3"],
  pitchPlan,
});

describe("plannedPitchesOf", () => {
  it("uses the explicit budget when set, else the age daily max", () => {
    expect(
      plannedPitchesOf(
        { playerId: "p1", role: "start", plannedPitches: 40 },
        AGE,
        RULES,
      ),
    ).toBe(40);
    expect(
      plannedPitchesOf({ playerId: "p1", role: "start" }, AGE, RULES),
    ).toBe(maxPitchesForAge(AGE, RULES));
  });

  it("respects a custom rule set's daily max as the default budget", () => {
    const custom = resolvePitchRuleSet({
      pitchRuleSet: "custom",
      customPitchLimit: 30,
    });
    expect(
      plannedPitchesOf({ playerId: "p1", role: "start" }, AGE, custom),
    ).toBe(30);
  });
});

describe("withPlannedOutings", () => {
  it("returns the same player when there is nothing to fold", () => {
    const p = pitcher("p1", "Ace");
    expect(withPlannedOutings(p, [])).toBe(p);
  });

  it("appends hypothetical outings without mutating the real player", () => {
    const p = pitcher("p1", "Ace", {
      pitching: { log: [{ date: "2026-06-01", pitches: 30 }] },
    });
    const hyp = withPlannedOutings(p, [{ date: "2026-06-06", pitches: 40 }]);
    expect(hyp.pitching?.log).toHaveLength(2);
    expect(p.pitching?.log).toHaveLength(1);
  });

  it("materializes legacy recentPitches/lastPitchDate so folding can't hide a real outing", () => {
    const legacy = pitcher("p1", "Ace", {
      pitching: { recentPitches: 70, lastPitchDate: "2026-06-05" },
    });
    const hyp = withPlannedOutings(legacy, [
      { date: "2026-06-06", pitches: 10 },
    ]);
    expect(hyp.pitching?.log).toEqual([
      { date: "2026-06-05", pitches: 70 },
      { date: "2026-06-06", pitches: 10 },
    ]);
  });
});

describe("planEntryStatus", () => {
  const entry = { playerId: "p1", role: "start" as const };

  it("is planned for an upcoming game with no logged outing", () => {
    expect(planEntryStatus(entry, G1, pitcher("p1", "Ace"))).toBe("planned");
  });

  it("is consumed once the game is finalized", () => {
    const final = { ...G1, status: "final" } as Game;
    expect(planEntryStatus(entry, final, pitcher("p1", "Ace"))).toBe(
      "consumed",
    );
  });

  it("is consumed once the real log carries an outing for that game", () => {
    const p = pitcher("p1", "Ace", {
      pitching: { log: [{ date: "2026-06-06", pitches: 20, gameId: "g1" }] },
    });
    expect(planEntryStatus(entry, G1, p)).toBe("consumed");
  });
});

describe("orderedTournamentGames", () => {
  it("sorts by date then start time and drops dangling ids", () => {
    const t = {
      ...tournament({}),
      gameIds: ["g3", "gone", "g2", "g1"],
    };
    expect(orderedTournamentGames(t, GAMES).map((g) => g.id)).toEqual([
      "g1",
      "g2",
      "g3",
    ]);
  });
});

describe("assessTournamentPlan", () => {
  it("a planned Saturday outing blocks the same arm for Saturday-PM and Sunday", () => {
    const players = [pitcher("p1", "Ace"), pitcher("p2", "Lefty")];
    const t = tournament({
      g1: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
      g3: [{ playerId: "p1", role: "start", plannedPitches: 20 }],
    });
    const [a1, a2, a3] = assessTournamentPlan({
      tournament: t,
      games: GAMES,
      players,
      teamAge: AGE,
      ruleSet: RULES,
    });

    // Game 1: empty log, no violations; both arms ready.
    expect(a1.violations).toEqual([]);
    expect(a1.arms.map((a) => a.status)).toEqual(["ready", "ready"]);

    // Game 2 (same day, Ace not planned): the folded 60 still takes him off
    // the ready list — the core flaw this module fixes.
    expect(a2.arms.find((a) => a.id === "p1")?.status).not.toBe("ready");
    expect(a2.violations).toEqual([]);

    // Game 3 (next day): 60 pitches → 3 rest days → not rested by Sunday.
    const aceG3 = a3.arms.find((a) => a.id === "p1");
    expect(aceG3?.status).toBe("resting");
    expect(a3.violations).toHaveLength(1);
    expect(a3.violations[0]).toMatchObject({
      playerId: "p1",
      kind: "insufficientRest",
    });
    expect(a3.violations[0].message).toContain("2026-06-10"); // 60p → 4th day after
    // Lefty is untouched by Ace's plan.
    expect(a3.arms.find((a) => a.id === "p2")?.status).toBe("ready");
  });

  it("flags a same-day double assignment that would blow the daily max", () => {
    const players = [pitcher("p1", "Ace")];
    const t = tournament({
      g1: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
      g2: [{ playerId: "p1", role: "start" }], // default budget 75 → 60+75 > 75
    });
    const [a1, a2] = assessTournamentPlan({
      tournament: t,
      games: GAMES,
      players,
      teamAge: AGE,
      ruleSet: RULES,
    });
    expect(a1.violations).toEqual([]);
    expect(a2.violations).toHaveLength(1);
    expect(a2.violations[0]).toMatchObject({
      playerId: "p1",
      kind: "dailyMax",
    });
  });

  it("a small same-day repeat under the daily max still violates (one appearance per day)", () => {
    const players = [pitcher("p1", "Ace")];
    const t = tournament({
      g1: [{ playerId: "p1", role: "start", plannedPitches: 20 }],
      g2: [{ playerId: "p1", role: "relief", plannedPitches: 20 }],
    });
    const [, a2] = assessTournamentPlan({
      tournament: t,
      games: GAMES,
      players,
      teamAge: AGE,
      ruleSet: RULES,
    });
    expect(a2.violations).toHaveLength(1);
    expect(a2.violations[0].kind).toBe("notEligibleToday");
  });

  it("consumed entries are not double-counted against the real log", () => {
    // Plan said 75 (default) but the real outing was only 20 pitches — the
    // import wrote the log entry with the gameId. Sunday must reflect the
    // real 20 (0 rest days → ready), not 20 real + 75 planned.
    const players = [
      pitcher("p1", "Ace", {
        pitching: { log: [{ date: "2026-06-06", pitches: 20, gameId: "g1" }] },
      }),
    ];
    const t = tournament({
      g1: [{ playerId: "p1", role: "start" }],
      g3: [{ playerId: "p1", role: "start", plannedPitches: 30 }],
    });
    const [a1, , a3] = assessTournamentPlan({
      tournament: t,
      games: GAMES,
      players,
      teamAge: AGE,
      ruleSet: RULES,
    });
    expect(a1.violations).toEqual([]); // consumed → no violation math
    expect(a3.arms.find((a) => a.id === "p1")?.status).toBe("ready");
    expect(a3.violations).toEqual([]);
  });

  it("respects a custom rule set's tighter daily max", () => {
    const custom = resolvePitchRuleSet({
      pitchRuleSet: "custom",
      customPitchLimit: 30,
      customRestTiers: [{ min: 20, days: 2 }],
    });
    const players = [pitcher("p1", "Ace")];
    const t = tournament({
      g1: [{ playerId: "p1", role: "start", plannedPitches: 25 }],
      g3: [{ playerId: "p1", role: "start", plannedPitches: 10 }],
    });
    const [, , a3] = assessTournamentPlan({
      tournament: t,
      games: GAMES,
      players,
      teamAge: AGE,
      ruleSet: custom,
    });
    // 25 planned Saturday ≥ tier min 20 → 2 rest days → Sunday violates.
    expect(a3.violations).toHaveLength(1);
    expect(a3.violations[0].kind).toBe("insufficientRest");
  });

  it("ignores plan entries for players no longer on the roster", () => {
    const t = tournament({
      g1: [{ playerId: "ghost", role: "start" }],
    });
    const [a1] = assessTournamentPlan({
      tournament: t,
      games: GAMES,
      players: [pitcher("p1", "Ace")],
      teamAge: AGE,
      ruleSet: RULES,
    });
    expect(a1.violations).toEqual([]);
  });
});

describe("priorPlannedOutingsForGame", () => {
  const players = [pitcher("p1", "Ace")];

  it("collects only outings from games strictly before the target", () => {
    const t = tournament({
      g1: [{ playerId: "p1", role: "start", plannedPitches: 40 }],
      g2: [{ playerId: "p1", role: "relief", plannedPitches: 15 }],
      g3: [{ playerId: "p1", role: "start", plannedPitches: 50 }],
    });
    const acc = priorPlannedOutingsForGame(
      [t],
      GAMES,
      players,
      "g3",
      AGE,
      RULES,
    );
    expect(acc.get("p1")).toEqual([
      { date: "2026-06-06", pitches: 40 },
      { date: "2026-06-06", pitches: 15 },
    ]);
    // The first game has nothing before it.
    expect(
      priorPlannedOutingsForGame([t], GAMES, players, "g1", AGE, RULES).size,
    ).toBe(0);
  });

  it("returns an empty map for a game outside any tournament", () => {
    const t = tournament({ g1: [{ playerId: "p1", role: "start" }] });
    expect(
      priorPlannedOutingsForGame(
        [t],
        [...GAMES, { id: "solo", date: "2026-06-20" } as Game],
        players,
        "solo",
        AGE,
        RULES,
      ).size,
    ).toBe(0);
  });

  it("skips consumed entries — the real log already carries them", () => {
    const logged = [
      pitcher("p1", "Ace", {
        pitching: { log: [{ date: "2026-06-06", pitches: 20, gameId: "g1" }] },
      }),
    ];
    const t = tournament({ g1: [{ playerId: "p1", role: "start" }] });
    expect(
      priorPlannedOutingsForGame([t], GAMES, logged, "g3", AGE, RULES).size,
    ).toBe(0);
  });
});

describe("unclaimedTournamentSuggestions", () => {
  // deriveTournaments clusters USSSA games ≤2 days apart, needs 2+ games.
  const games = [
    { id: "g1", date: "2026-06-06" },
    { id: "g2", date: "2026-06-07" },
    { id: "g4", date: "2026-07-11" },
    { id: "g5", date: "2026-07-12" },
  ] as Game[];

  it("returns derived clusters when nothing is stored", () => {
    const s = unclaimedTournamentSuggestions(games, "USSSA", []);
    expect(s.map((c) => c.id)).toEqual(["tour-2026-06-06", "tour-2026-07-11"]);
  });

  it("excludes clusters claimed by gameId overlap or seedKey", () => {
    const byOverlap: Tournament = {
      id: "t1",
      name: "June Bash",
      gameIds: ["g2"],
    };
    const bySeed: Tournament = {
      id: "t2",
      name: "July Classic",
      gameIds: [],
      seedKey: "tour-2026-07-11",
    };
    expect(
      unclaimedTournamentSuggestions(games, "USSSA", [byOverlap, bySeed]),
    ).toEqual([]);
  });
});
