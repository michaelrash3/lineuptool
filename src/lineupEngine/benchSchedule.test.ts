// Module-level tests for the fairness / bench-rotation core. The big engine
// suites (src/lineupEngine*.test.ts) drive this code through generateLineup,
// where a fairness regression shows up only as an odd final lineup — these
// call the exported pieces directly so the properties a coach actually gets
// asked about (nobody sits twice in a row, the bench spread stays flat,
// everyone clears the minimum-play floor) are asserted where they're decided.
import type { Inning, SlimPlayer } from "../types";
import type {
  BenchScheduleOpts,
  PickBestOpts,
  ProfiledPlayer,
  TryBuildCtx,
} from "./types";
import { POS_10 } from "./eligibility";
import { mulberry32 } from "./prng";
import {
  AUTO_CATCHER_CAP,
  PENALTY_WEIGHTS,
  PREMIUM_POSITIONS_KID_PITCH,
  maxPositionMatching,
  pickBestForPosition,
  precomputeBenchSchedule,
  tryBuildLineup,
} from "./benchSchedule";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALL_POSITIONS = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "LCF",
  "CF",
  "RCF",
  "RF",
];

// A profiled attendee. Only the fields the bench/scoring code reads are set;
// the cast keeps the fixtures small without loosening the functions' types.
const makePlayer = (
  id: string,
  opts: {
    comfortablePositions?: string[];
    primaryPosition?: string;
    defensiveScore?: number;
    overallScore?: number;
    throws?: string;
  } = {},
): ProfiledPlayer =>
  ({
    id,
    name: `Player ${id}`,
    number: id,
    primaryPosition: opts.primaryPosition ?? "",
    restrictions: [],
    comfortablePositions: opts.comfortablePositions ?? ALL_POSITIONS,
    throws: opts.throws ?? "R",
    profile: {
      grades: {},
      leadoffScore: 50,
      powerScore: 50,
      contactScore: 50,
      overallScore: opts.overallScore ?? 50,
      defensiveScore: opts.defensiveScore ?? 50,
    },
  }) as unknown as ProfiledPlayer;

// Descending defensive scores (p0 strongest) so "weakest defender" is
// unambiguous in the competitive-floor test.
const makeRoster = (n: number, opts: { comfort?: string[] } = {}) =>
  Array.from({ length: n }, (_, i) =>
    makePlayer(`p${i}`, {
      comfortablePositions: opts.comfort,
      defensiveScore: 90 - i * 3,
      overallScore: 90 - i * 3,
    }),
  );

// Mirrors tryBuildLineup's own top-half computation (the pairing rule's input).
const topHalfOf = (profiled: ProfiledPlayer[]) =>
  new Set(
    [...profiled]
      .sort((a, b) => b.profile.defensiveScore - a.profile.defensiveScore)
      .slice(0, Math.ceil(profiled.length / 2))
      .map((p) => p.id),
  );

const benchOpts = (
  profiled: ProfiledPlayer[],
  overrides: Partial<BenchScheduleOpts> = {},
): BenchScheduleOpts => ({
  profiled,
  totalInnings: 6,
  numToBench: Math.max(0, profiled.length - POS_10.length),
  priorExtraSits: new Map(),
  firstInningBenchHx: new Map(),
  topHalfIds: topHalfOf(profiled),
  catcherInningBlocks: null,
  catcherCap: Infinity,
  enforceCatcherCap: false,
  positionsToFill: [...POS_10],
  rand: mulberry32(1),
  forcedBenchInning0: null,
  firstInningOverridesById: {},
  ...overrides,
});

const buildCtx = (
  profiled: ProfiledPlayer[],
  overrides: Partial<TryBuildCtx> = {},
): TryBuildCtx => ({
  profiled,
  positionsToFill: [...POS_10],
  numToBench: Math.max(0, profiled.length - POS_10.length),
  totalInnings: 6,
  isStarter: new Set(profiled.map((p) => p.id)),
  firstInningOverridesById: {},
  positionHistory: new Map(),
  firstInningBenchHx: new Map(),
  benchHistory: new Map(),
  headGrades: {},
  defenseSize: "10",
  leagueRuleSet: "NKB",
  teamAge: "10U",
  targetDateStr: "2026-05-01",
  leftyPenalty: 25,
  rand: mulberry32(1),
  ...overrides,
});

const pickOpts = (
  profiled: ProfiledPlayer[],
  overrides: Partial<PickBestOpts> = {},
): PickBestOpts => ({
  pos: "LF",
  inn: 3,
  profiled,
  used: new Set(),
  benchedSet: new Set(),
  state: new Map(
    profiled.map((p) => [
      p.id,
      { bench: 0, positions: {} as Record<string, number>, history: [] },
    ]),
  ),
  positionHistory: new Map(),
  headGrades: {},
  defenseSize: "10",
  leagueRuleSet: "NKB",
  teamAge: "10U",
  targetDateStr: "2026-05-01",
  leftyPenalty: 25,
  isLockInning: false,
  isBigGame: false,
  competitive: false,
  // Fixed so score comparisons are exact — jitter is what the engine's own
  // seeded rand supplies in production.
  rand: () => 0,
  premiumPositions: PREMIUM_POSITIONS_KID_PITCH,
  positionFlexibility: new Map(profiled.map((p) => [p.id, 5])),
  ...overrides,
});

const schedule = (opts: BenchScheduleOpts) => {
  const res = precomputeBenchSchedule(opts);
  if (!res) throw new Error("precomputeBenchSchedule returned infeasible");
  return res;
};

const lineupOf = (ctx: TryBuildCtx) => {
  const res = tryBuildLineup(ctx);
  if (!res || !res.ok) {
    throw new Error(`tryBuildLineup failed: ${JSON.stringify(res)}`);
  }
  return res;
};

const sitsPerInning = (
  sched: Map<string, Set<number>>,
  totalInnings: number,
) => {
  const counts = new Array(totalInnings).fill(0);
  for (const innings of sched.values()) {
    for (const inn of innings) counts[inn]++;
  }
  return counts;
};

const at = (inning: Inning, pos: string): SlimPlayer =>
  (Array.isArray(inning[pos]) ? null : inning[pos]) as SlimPlayer;

const benchIdsOf = (inning: Inning) =>
  (inning.BENCH ?? []).map((p) => p?.id).filter(Boolean) as string[];

// ---------------------------------------------------------------------------
// maxPositionMatching
// ---------------------------------------------------------------------------

describe("maxPositionMatching", () => {
  it("covers every position when a perfect matching exists", () => {
    const eligible: Record<string, string[]> = {
      "1B": ["ana"],
      SS: ["ben"],
      LF: ["cal"],
    };
    const matched = maxPositionMatching(
      ["1B", "SS", "LF"],
      ["ana", "ben", "cal"],
      (pos, pid) => eligible[pos].includes(pid),
    );
    expect(matched.size).toBe(3);
    expect(matched.get("1B")).toBe("ana");
    expect(matched.get("SS")).toBe("ben");
    expect(matched.get("LF")).toBe("cal");
  });

  it("re-seats an earlier pick rather than settling for the greedy answer", () => {
    // Greedy order hands SS to the do-anything kid and then strands 1B; the
    // augmenting path has to push them off SS and bring in the SS-only kid.
    const eligible: Record<string, string[]> = {
      SS: ["flex", "onlySS"],
      "1B": ["flex"],
    };
    const matched = maxPositionMatching(
      ["SS", "1B"],
      ["flex", "onlySS"],
      (pos, pid) => eligible[pos].includes(pid),
    );
    expect(matched.size).toBe(2);
    expect(matched.get("SS")).toBe("onlySS");
    expect(matched.get("1B")).toBe("flex");

    // Genuinely uncoverable: one kid can't hold both spots, and the caller
    // reads the short size as "this inning strands a position".
    const shorthanded = maxPositionMatching(["SS", "1B"], ["solo"], () => true);
    expect(shorthanded.size).toBe(1);
    expect([...shorthanded.values()]).toEqual(["solo"]);
  });
});

// ---------------------------------------------------------------------------
// precomputeBenchSchedule
// ---------------------------------------------------------------------------

describe("precomputeBenchSchedule", () => {
  it("fills every inning's bench and keeps the sit spread at the math minimum", () => {
    // 13 attendees, 10 field spots → 3 sit per inning, 18 sits over 6 innings.
    // Perfectly fair is 1 or 2 sits each; anything wider is the unfairness the
    // pass exists to prevent.
    for (let seed = 1; seed <= 20; seed++) {
      const profiled = makeRoster(13);
      const { schedule: sched } = schedule(
        benchOpts(profiled, { rand: mulberry32(seed) }),
      );
      expect(sitsPerInning(sched, 6)).toEqual([3, 3, 3, 3, 3, 3]);

      const counts = profiled.map((p) => sched.get(p.id)!.size);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(18);
      expect(Math.min(...counts)).toBe(1);
      expect(Math.max(...counts)).toBe(2);
      // Minimum-play floor: nobody watches more than a third of the game.
      for (const c of counts) expect(6 - c).toBeGreaterThanOrEqual(4);
    }
  });

  it("never sits a player two innings in a row", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const profiled = makeRoster(13);
      const { schedule: sched } = schedule(
        benchOpts(profiled, { rand: mulberry32(seed) }),
      );
      for (const innings of sched.values()) {
        const sorted = [...innings].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(1);
        }
      }
    }
  });

  it("competitive mode holds a half-game minimum-play floor", () => {
    // Tournament: the weakest gloves absorb the bench, but the cap is
    // floor(innings / 2) so even the last kid on the depth chart plays half.
    const profiled = makeRoster(13);
    const { schedule: sched } = schedule(
      benchOpts(profiled, { competitive: true, rand: mulberry32(7) }),
    );
    const counts = new Map(profiled.map((p) => [p.id, sched.get(p.id)!.size]));
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(18);
    for (const c of counts.values()) expect(c).toBeLessThanOrEqual(3);
    // p0 is the strongest defender, p12 the weakest.
    expect(counts.get("p0")).toBe(0);
    expect(counts.get("p12")).toBe(3);
  });

  it("sits the over-played kid and spares the under-played one", () => {
    const profiled = makeRoster(11);
    // Same bench innings for everyone; only defensive innings differ, so the
    // over/under-played split is purely the season delta.
    const priorExtraSits = new Map(
      profiled.map((p) => [
        p.id,
        { extraSits: 0, benchInn: 5, defInn: 20, expectedDef: 20 },
      ]),
    );
    priorExtraSits.set("p3", {
      extraSits: 0,
      benchInn: 5,
      defInn: 30,
      expectedDef: 20,
    });
    priorExtraSits.set("p7", {
      extraSits: 0,
      benchInn: 5,
      defInn: 10,
      expectedDef: 20,
    });
    const { schedule: sched } = schedule(
      benchOpts(profiled, { priorExtraSits }),
    );
    expect(sched.get("p3")!.size).toBeGreaterThanOrEqual(1);
    expect(sched.get("p7")!.size).toBe(0);
  });

  it("never benches the only player cleared for a position", () => {
    // p4 is the lone SS; sitting them in any inning strands the position and
    // fails the whole attempt, so the anchor guard has to zero their sits.
    const others = ALL_POSITIONS.filter((pos) => pos !== "SS");
    const profiled = Array.from({ length: 11 }, (_, i) =>
      makePlayer(`p${i}`, {
        comfortablePositions: i === 4 ? ALL_POSITIONS : others,
        defensiveScore: 90 - i * 3,
      }),
    );
    for (let seed = 1; seed <= 10; seed++) {
      const { schedule: sched } = schedule(
        benchOpts(profiled, { rand: mulberry32(seed) }),
      );
      expect(sched.get("p4")!.size).toBe(0);
      expect(sitsPerInning(sched, 6)).toEqual([1, 1, 1, 1, 1, 1]);
    }
  });

  it("gives each catcher block one catcher, on the field and under the cap", () => {
    const catcherIds = new Set(["p1", "p4", "p7"]);
    const noC = ALL_POSITIONS.filter((pos) => pos !== "C");
    const profiled = Array.from({ length: 12 }, (_, i) =>
      makePlayer(`p${i}`, {
        comfortablePositions: catcherIds.has(`p${i}`) ? ALL_POSITIONS : noC,
        defensiveScore: 90 - i * 3,
      }),
    );
    const blocks = [
      [0, 1],
      [2, 3],
      [4, 5],
    ];
    const { schedule: sched, catcherByInning } = schedule(
      benchOpts(profiled, {
        catcherInningBlocks: blocks,
        catcherCap: 2,
        enforceCatcherCap: true,
      }),
    );
    const caught = new Map<string, number>();
    for (const block of blocks) {
      const ids = block.map((inn) => catcherByInning.get(inn));
      expect(new Set(ids).size).toBe(1);
      const id = ids[0]!;
      expect(catcherIds.has(id)).toBe(true);
      for (const inn of block) expect(sched.get(id)!.has(inn)).toBe(false);
      caught.set(id, (caught.get(id) || 0) + block.length);
    }
    for (const innings of caught.values())
      expect(innings).toBeLessThanOrEqual(2);

    // Two catchers can't legally cover three blocks under a hard cap of 2 —
    // the caller needs the null so it can restart the attempt.
    const thin = profiled.map((p) =>
      p.id === "p7"
        ? makePlayer(p.id, { comfortablePositions: noC, defensiveScore: 60 })
        : p,
    );
    expect(
      precomputeBenchSchedule(
        benchOpts(thin, {
          catcherInningBlocks: blocks,
          catcherCap: 2,
          enforceCatcherCap: true,
        }),
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tryBuildLineup
// ---------------------------------------------------------------------------

describe("tryBuildLineup", () => {
  it("fills every position with a distinct available player and honors the inning-0 pin", () => {
    const profiled = makeRoster(11);
    const { lineup, penalty } = lineupOf(
      buildCtx(profiled, { firstInningOverridesById: { "3B": "p6" } }),
    );
    expect(lineup).toHaveLength(6);
    expect(at(lineup[0], "3B")?.id).toBe("p6");

    const benchTally = new Map(profiled.map((p) => [p.id, 0]));
    const posTally = new Map<string, number>();
    for (const inning of lineup) {
      const onField = POS_10.map((pos) => at(inning, pos)?.id);
      expect(onField.every(Boolean)).toBe(true);
      expect(new Set(onField).size).toBe(POS_10.length);
      const benched = benchIdsOf(inning);
      expect(benched).toHaveLength(1);
      expect(onField).not.toContain(benched[0]);
      benchTally.set(benched[0], benchTally.get(benched[0])! + 1);
      for (const pos of POS_10) {
        if (pos === "C" || pos === "P") continue;
        const key = `${at(inning, pos)!.id}|${pos}`;
        posTally.set(key, (posTally.get(key) || 0) + 1);
      }
    }
    const sits = [...benchTally.values()];
    expect(Math.max(...sits) - Math.min(...sits)).toBeLessThanOrEqual(1);
    for (const s of sits) expect(6 - s).toBeGreaterThanOrEqual(5);

    // 6 bench slots across 11 kids: nobody is owed a sit and the spread is the
    // unavoidable 1, so the score is exactly one unit of season extra-sit
    // spread plus the position-diversity change — no hard-tier violation.
    let diversity = 0;
    for (const count of posTally.values()) {
      if (count >= PENALTY_WEIGHTS.POSITION_REPEAT_THRESHOLD) {
        diversity +=
          (count - (PENALTY_WEIGHTS.POSITION_REPEAT_THRESHOLD - 1)) *
          PENALTY_WEIGHTS.POSITION_REPEAT_STEP;
      }
    }
    expect(penalty).toBe(PENALTY_WEIGHTS.SEASON_EXTRA_SIT_SPREAD + diversity);
  });

  it("charges nothing when the bench divides evenly", () => {
    // 12 attendees, 2 sitting per inning: 12 sits for 12 kids, so the perfectly
    // fair game exists and must score 0 — every penalty tier is a deviation
    // from it. A free-rotating catcher is used deliberately: back-to-back
    // catcher blocks pin kids on the field and are covered on their own below.
    const profiled = makeRoster(12);
    const { lineup, penalty } = lineupOf(
      buildCtx(profiled, {
        catcherPolicy: { cap: 3, consecutive: false, enforceCap: false },
      }),
    );
    const tally = new Map(profiled.map((p) => [p.id, 0]));
    for (const inning of lineup) {
      for (const id of benchIdsOf(inning)) tally.set(id, tally.get(id)! + 1);
    }
    expect([...tally.values()].every((c) => c === 1)).toBe(true);
    expect(penalty).toBe(0);
  });

  it("seats only catcher-cleared kids behind the plate, within the auto cap", () => {
    const catcherIds = new Set(["p2", "p5", "p9"]);
    const noC = ALL_POSITIONS.filter((pos) => pos !== "C");
    const profiled = Array.from({ length: 11 }, (_, i) =>
      makePlayer(`p${i}`, {
        comfortablePositions: catcherIds.has(`p${i}`) ? ALL_POSITIONS : noC,
        defensiveScore: 90 - i * 3,
      }),
    );
    const { lineup } = lineupOf(buildCtx(profiled));
    const caught = new Map<string, number>();
    for (const inning of lineup) {
      const id = at(inning, "C")?.id;
      expect(id && catcherIds.has(id)).toBe(true);
      caught.set(id!, (caught.get(id!) || 0) + 1);
    }
    for (const innings of caught.values()) {
      expect(innings).toBeLessThanOrEqual(AUTO_CATCHER_CAP.TEN_FIELDER);
    }
  });

  it("names the position it could not cover instead of failing generically", () => {
    // Nobody opted into catcher: the coach needs to be told it's C, not handed
    // a bare "couldn't build a lineup".
    const noC = ALL_POSITIONS.filter((pos) => pos !== "C");
    const profiled = makeRoster(10, { comfort: noC });
    const res = tryBuildLineup(buildCtx(profiled));
    expect(res && res.ok).toBe(false);
    expect(res && !res.ok && res.failure).toMatchObject({
      type: "no-candidate-for-position",
      position: "C",
    });
  });
});

// ---------------------------------------------------------------------------
// pickBestForPosition
// ---------------------------------------------------------------------------

describe("pickBestForPosition", () => {
  it("skips used, benched and non-cleared players", () => {
    const onField = makePlayer("used");
    const sitting = makePlayer("benched");
    const blocked = makePlayer("blocked", {
      comfortablePositions: ["1B", "2B"],
    });
    const roster = [onField, sitting, blocked];
    expect(
      pickBestForPosition(
        pickOpts(roster, {
          used: new Set(["used"]),
          benchedSet: new Set(["benched"]),
        }),
      ),
    ).toBeNull();

    const cleared = makePlayer("blocked", {
      comfortablePositions: ["1B", "LF"],
    });
    expect(
      pickBestForPosition(
        pickOpts([onField, sitting, cleared], {
          used: new Set(["used"]),
          benchedSet: new Set(["benched"]),
        }),
      )?.id,
    ).toBe("blocked");
  });

  it("rotates in fair mode: innings already logged at a spot push a kid off it", () => {
    const veteran = makePlayer("veteran");
    const fresh = makePlayer("fresh");
    const opts = pickOpts([veteran, fresh]);
    // veteran is listed first, so a tie would return them — only the rotation
    // pressure from two prior LF innings moves the pick.
    opts.state.set("veteran", {
      bench: 0,
      positions: { LF: 2 },
      history: ["1B", "2B", "3B"],
    });
    expect(pickBestForPosition(opts)?.id).toBe("fresh");
  });

  it("steers Big Game picks by skill and pins primary-position kids", () => {
    const strong = makePlayer("strong", { overallScore: 95 });
    const weak = makePlayer("weak", { overallScore: 10 });
    const bigGame = { isBigGame: true };
    // Rosters are ordered so the OTHER kid would win a tie — only the skill
    // term can produce the expected pick.
    expect(
      pickBestForPosition(pickOpts([weak, strong], { ...bigGame, pos: "SS" }))
        ?.id,
    ).toBe("strong");
    // Mirror image in the outfield: the strongest kid is pushed away from it.
    expect(
      pickBestForPosition(pickOpts([strong, weak], { ...bigGame, pos: "RF" }))
        ?.id,
    ).toBe("weak");
    // The primary-position pin outranks the skill pull outright.
    const primary = makePlayer("primary", {
      overallScore: 20,
      primaryPosition: "SS",
    });
    expect(
      pickBestForPosition(
        pickOpts([strong, weak, primary], { ...bigGame, pos: "SS" }),
      )?.id,
    ).toBe("primary");
  });

  it("stops picking a catcher who has hit the inning cap", () => {
    const capped = makePlayer("capped");
    const fresh = makePlayer("fresh");
    const noC = makePlayer("noC", {
      comfortablePositions: ALL_POSITIONS.filter((pos) => pos !== "C"),
    });
    const roster = [capped, fresh, noC];
    const opts = pickOpts(roster, { pos: "C" });
    opts.state.set("capped", {
      bench: 0,
      positions: { C: AUTO_CATCHER_CAP.TEN_FIELDER },
      history: ["C", "C", "1B"],
    });
    expect(pickBestForPosition(opts)?.id).toBe("fresh");

    const withoutFresh = pickOpts([capped, noC], { pos: "C" });
    withoutFresh.state.set("capped", {
      bench: 0,
      positions: { C: AUTO_CATCHER_CAP.TEN_FIELDER },
      history: ["C", "C", "1B"],
    });
    expect(pickBestForPosition(withoutFresh)).toBeNull();
  });
});
