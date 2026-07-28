import {
  assessWeekPlan,
  groupGamesByWeek,
  mondayOf,
  planForGame,
  tournamentForGame,
} from "./weekPlanning";
import { resolvePitchRuleSet } from "../lineupEngine";
import type { Game, Player, Tournament } from "../types";

// Little League defaults: 9U daily max 75; rest tiers 66+→4d, 51+→3d,
// 36+→2d, 21+→1d, else 0d — same pins as tournamentPitching.test.ts.
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

// 2026-06-01 is a Monday; 2026-06-03 Wednesday; 2026-06-06 Saturday;
// 2026-06-07 Sunday; 2026-06-08 the next Monday.
const WED = {
  id: "wed",
  date: "2026-06-03",
  leagueRuleSet: "NKB",
  opponent: "Rec Rivals",
} as Game;
const SAT = {
  id: "sat",
  date: "2026-06-06",
  leagueRuleSet: "USSSA",
  opponent: "Bracket Bandits",
} as Game;
const SUN = { id: "sun", date: "2026-06-07", leagueRuleSet: "USSSA" } as Game;
const NEXT_MON = { id: "mon2", date: "2026-06-08" } as Game;

describe("mondayOf", () => {
  it("maps every day of a Mon–Sun week to that week's Monday", () => {
    expect(mondayOf("2026-06-01")).toBe("2026-06-01"); // Monday itself
    expect(mondayOf("2026-06-03")).toBe("2026-06-01"); // Wednesday
    expect(mondayOf("2026-06-06")).toBe("2026-06-01"); // Saturday
    expect(mondayOf("2026-06-07")).toBe("2026-06-01"); // Sunday closes the week
    expect(mondayOf("2026-06-08")).toBe("2026-06-08"); // next Monday opens a new one
  });
});

describe("groupGamesByWeek", () => {
  it("groups rec AND tournament games into Mon–Sun weeks, chronologically", () => {
    const weeks = groupGamesByWeek([NEXT_MON, SUN, WED, SAT]);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-06-01", "2026-06-08"]);
    expect(weeks[0].weekEnd).toBe("2026-06-07");
    // The rec Wednesday game sits in the same week as the tournament weekend.
    expect(weeks[0].games.map((g) => g.id)).toEqual(["wed", "sat", "sun"]);
    expect(weeks[1].games.map((g) => g.id)).toEqual(["mon2"]);
  });

  it("excludes scrimmages and undated games", () => {
    const weeks = groupGamesByWeek([
      WED,
      { ...SAT, isScrimmage: true } as Game,
      { id: "tbd" } as Game,
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].games.map((g) => g.id)).toEqual(["wed"]);
  });
});

describe("planForGame / tournamentForGame", () => {
  const t: Tournament = {
    id: "t1",
    name: "Memorial Bash",
    gameIds: ["sat", "sun"],
    pitchPlan: { sat: [{ playerId: "p1", role: "start", plannedPitches: 40 }] },
  };

  it("a stored tournament's pitchPlan wins for its games", () => {
    expect(tournamentForGame([t], "sat")?.id).toBe("t1");
    // Even if the game somehow carries its own entries, the tournament's are
    // the source of truth (the tournament panel writes there).
    const shadowed = {
      ...SAT,
      pitchPlan: [{ playerId: "p2", role: "relief" }],
    } as Game;
    expect(planForGame(shadowed, [t])).toEqual([
      { playerId: "p1", role: "start", plannedPitches: 40 },
    ]);
    // A claimed game with no entries yet reads empty, not the game field.
    expect(planForGame({ ...SUN } as Game, [t])).toEqual([]);
  });

  it("a standalone game carries its own pitchPlan", () => {
    const rec = {
      ...WED,
      pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 25 }],
    } as Game;
    expect(planForGame(rec, [t])).toEqual([
      { playerId: "p1", role: "start", plannedPitches: 25 },
    ]);
    expect(planForGame(WED, [t])).toEqual([]);
    expect(planForGame({ ...WED, pitchPlan: null } as Game, undefined)).toEqual(
      [],
    );
  });
});

describe("assessWeekPlan", () => {
  const players = [pitcher("p1", "Ace"), pitcher("p2", "Lefty")];

  it("Wednesday burns Saturday: a rec-game plan folds into the weekend", () => {
    // 60 planned pitches Wednesday → 3 rest days → not ready until Sunday.
    const wed = {
      ...WED,
      pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
    } as Game;
    const [aWed, aSat, aSun] = assessWeekPlan({
      weekGames: [SUN, SAT, wed], // deliberately unordered
      tournaments: [],
      players,
      teamAge: AGE,
      ruleSet: RULES,
    });
    expect(aWed.gameId).toBe("wed");
    expect(aWed.violations).toEqual([]);
    // Saturday: Ace is resting because of Wednesday's PLANNED outing.
    expect(aSat.arms.find((a) => a.id === "p1")?.status).toBe("resting");
    expect(aSat.arms.find((a) => a.id === "p2")?.status).toBe("ready");
    // Sunday (4th day after 60p): ready again.
    expect(aSun.arms.find((a) => a.id === "p1")?.status).toBe("ready");
  });

  it("planning the burned arm for Saturday anyway surfaces insufficientRest", () => {
    const wed = {
      ...WED,
      pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
    } as Game;
    const sat = {
      ...SAT,
      pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 20 }],
    } as Game;
    const [, aSat] = assessWeekPlan({
      weekGames: [wed, sat],
      tournaments: [],
      players,
      teamAge: AGE,
      ruleSet: RULES,
    });
    expect(aSat.violations).toHaveLength(1);
    expect(aSat.violations[0]).toMatchObject({
      playerId: "p1",
      kind: "insufficientRest",
    });
  });

  it("folds tournament-stored and game-stored plans together across the week", () => {
    // Wednesday rec plan on the game (55p → 3 rest days: Thu/Fri/Sat);
    // Saturday plan inside the stored tournament (default 75p budget → 4
    // rest days). Sunday sees BOTH folds.
    const wed = {
      ...WED,
      pitchPlan: [{ playerId: "p2", role: "start", plannedPitches: 55 }],
    } as Game;
    const t: Tournament = {
      id: "t1",
      name: "Memorial Bash",
      gameIds: ["sat", "sun"],
      pitchPlan: { sat: [{ playerId: "p1", role: "start" }] },
    };
    const [aWed, aSat, aSun] = assessWeekPlan({
      weekGames: [wed, SAT, SUN],
      tournaments: [t],
      players,
      teamAge: AGE,
      ruleSet: RULES,
    });
    // Saturday: Lefty resting from Wednesday's 55p (3rd rest day).
    expect(aSat.arms.find((a) => a.id === "p2")?.status).toBe("resting");
    // Sunday: Ace off the board from Saturday's full-budget tournament plan
    // (75p reads as maxed); Lefty is past his 3 rest days and back.
    expect(aSun.arms.find((a) => a.id === "p1")?.status).toBe("maxed");
    expect(aSun.arms.find((a) => a.id === "p2")?.status).toBe("ready");
    expect(aWed.violations).toEqual([]);
  });
});
