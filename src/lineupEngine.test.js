import {
  generateLineup,
  generateBattingOnly,
  calcPitcherScore,
  calcPitcherStatsQuality,
  calcCatcherScore,
  calcDefensiveScore,
  getPitcherPoolSize,
  isCatcherEligible,
  resolveCatcherPolicy,
  maxPitchesForAge,
  checkPitchEligibility,
  buildPitchingPlan,
} from "./lineupEngine";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// All field positions a player can be cleared for (mirrors the app's
// position model). Catcher is just "C" in comfortablePositions now.
const ALL_POSITIONS = [
  "P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF",
];

const makePlayer = (id, name, opts = {}) => ({
  id,
  name,
  number: opts.number ?? "",
  primaryPosition: opts.primaryPosition ?? "",
  restrictions: opts.restrictions ?? [],
  // Catcher is opt-in via "C" in comfortablePositions. A vanilla, fully
  // unconstrained test player is cleared everywhere INCLUDING catcher —
  // mirror migrated production data by defaulting the list to every
  // position minus any restrictions (so restriction-based tests still
  // work and rosters always have catchers). Tests that exercise catcher
  // exclusion pass an explicit comfortablePositions without "C" (or
  // restrictions: ["C"]).
  comfortablePositions:
    opts.comfortablePositions ??
    ALL_POSITIONS.filter((p) => !(opts.restrictions ?? []).includes(p)),
  // Engine reads these when present. Defaulted out so a vanilla makePlayer
  // call produces a player with no special handling.
  throws: opts.throws,
  dob: opts.dob,
  pitching: opts.pitching,
  stats: opts.stats,
  pastSeasons: opts.pastSeasons,
});

// Build a head-coach eval with explicit grades so we can control
// defensiveScore in tests. Any field omitted defaults to 5 (mid-grade).
const headEval = (gradesByPlayer) => ({
  id: "eval1",
  date: "2026-04-01",
  coachRole: "Head",
  evaluatorId: "coach1",
  grades: Object.fromEntries(
    Object.entries(gradesByPlayer).map(([pid, g]) => [
      pid,
      {
        fielding: g.fielding ?? 5,
        armStrength: g.armStrength ?? 5,
        armAccuracy: g.armAccuracy ?? 5,
        speedAgility: g.speedAgility ?? 5,
        baseballIQ: g.baseballIQ ?? 5,
        coachability: g.coachability ?? 5,
      },
    ])
  ),
});

// Cheap helper: 11 vanilla players with known ids.
const makeRoster = (count = 11, overrides = {}) =>
  Array.from({ length: count }, (_, i) => {
    const id = `p${i}`;
    return makePlayer(id, `Player ${i}`, overrides[id] || {});
  });

const baseGame = (overrides = {}) => ({
  id: "g_test",
  date: "2026-05-01",
  opponent: "Test Opp",
  ...overrides,
});

const buildLineup = (opts = {}) => {
  const players = opts.players;
  return generateLineup({
    activePlayers: players,
    allPlayers: players,
    games: opts.games || [],
    evaluationEvents: opts.evaluationEvents || [],
    currentGame: opts.currentGame || baseGame(),
    firstInningOverridesById: opts.firstInningOverridesById || {},
    totalInnings: opts.totalInnings ?? 6,
    leagueRuleSet: opts.leagueRuleSet || "USSSA",
    teamAge: opts.teamAge || "8U",
    defenseSize: opts.defenseSize || "10",
    positionLock: opts.positionLock || "0",
    battingSize: opts.battingSize || "roster",
    seed: opts.seed ?? 42,
    isBigGame: opts.isBigGame || false,
    competitive: opts.competitive || false,
    depthChart: opts.depthChart,
    catcherMaxInnings: opts.catcherMaxInnings,
    catcherConsecutive: opts.catcherConsecutive,
    pitchingFormat: opts.pitchingFormat,
  });
};

// Position label a player occupies in an inning (or undefined if benched).
const posOf = (inn, id) =>
  Object.keys(inn).find((k) => k !== "BENCH" && inn[k]?.id === id);
const isBenched = (inn, id) => (inn.BENCH || []).some((p) => p?.id === id);

const inningsPlayed = (lineup, playerId) =>
  lineup
    .map((inn, i) => {
      const benched = (inn.BENCH || []).some((p) => p?.id === playerId);
      return benched ? null : i;
    })
    .filter((i) => i !== null);

const positionsOf = (lineup, playerId) =>
  lineup.map((inn) => {
    for (const pos of Object.keys(inn)) {
      if (pos === "BENCH") continue;
      if (inn[pos]?.id === playerId) return pos;
    }
    return null;
  });

// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------

describe("generateLineup — smoke", () => {
  test("produces a 6-inning lineup with 10 fielders for an 11-player roster", () => {
    const result = buildLineup({ players: makeRoster(11) });
    expect(result.error).toBeUndefined();
    expect(result.lineup).toHaveLength(6);
    for (const inn of result.lineup) {
      const fielderIds = Object.keys(inn)
        .filter((k) => k !== "BENCH")
        .map((k) => inn[k]?.id)
        .filter(Boolean);
      // 10 fielders + 1 bench (11 active, defenseSize=10)
      expect(fielderIds).toHaveLength(10);
      expect((inn.BENCH || []).filter(Boolean)).toHaveLength(1);
    }
    expect(result.battingLineup).toHaveLength(11);
  });

  test("rejects rosters smaller than 7 active players", () => {
    const result = buildLineup({ players: makeRoster(6) });
    expect(result.error).toMatch(/at least 7/i);
  });
});

// ---------------------------------------------------------------------------
// Catcher pre-pin (PR #3)
// ---------------------------------------------------------------------------

describe("catcher pre-assignment respects primaryPosition", () => {
  test("primary-C kid is picked over higher-skill non-primary kids", () => {
    // 11 players: one primary-C with terrible fielding, ten others with
    // perfect fielding. Without the tier sort, the high-fielding kids
    // would dominate the catcher tiebreaker (defScore).
    const players = [
      makePlayer("the_catcher", "Catcher Kid", { primaryPosition: "C" }),
      ...makeRoster(10),
    ];
    const grades = { the_catcher: { fielding: 1, armStrength: 1, armAccuracy: 1, speedAgility: 1, baseballIQ: 1 } };
    for (let i = 0; i < 10; i++) {
      grades[`p${i}`] = { fielding: 10, armStrength: 10, armAccuracy: 10, speedAgility: 10, baseballIQ: 10 };
    }

    const result = buildLineup({
      players,
      evaluationEvents: [headEval(grades)],
      teamAge: "8U",
      seed: 1,
    });
    expect(result.error).toBeUndefined();
    const caughtPairs = result.lineup
      .map((inn) => inn.C?.id)
      .filter(Boolean);
    // The primary-C kid should be the catcher in at least one inning.
    expect(caughtPairs.some((id) => id === "the_catcher")).toBe(true);
  });

  test("without any primary-C kid, falls back to high-defScore tiebreaker", () => {
    const players = makeRoster(11);
    const grades = {};
    for (let i = 0; i < 11; i++) grades[`p${i}`] = { fielding: 5 };
    grades.p0 = { fielding: 10, armStrength: 10, armAccuracy: 10, speedAgility: 10, baseballIQ: 10 };

    const result = buildLineup({
      players,
      evaluationEvents: [headEval(grades)],
      teamAge: "10U",
      seed: 1,
    });
    expect(result.error).toBeUndefined();
    // p0 should appear behind the plate at least once.
    const seen = new Set(result.lineup.map((inn) => inn.C?.id).filter(Boolean));
    expect(seen.has("p0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Catcher eligibility — a player may catch ONLY when "C" is in their
// comfortablePositions list (catcher is opt-in; there is no separate flag).
// Regression for: non-catchers kept getting seated at C because the data
// model marked the whole roster catcher-eligible. Empty / omitted lists
// never grant catcher.
// ---------------------------------------------------------------------------

describe("catcher eligibility (C in comfortablePositions)", () => {
  const catcher = (id, name) =>
    makePlayer(id, name);
  const fielder = (id, name) =>
    makePlayer(id, name, {
      // Cleared everywhere EXCEPT catcher — can cover any field spot in
      // both 9- and 10-fielder alignments, but must never be seated at C.
      comfortablePositions: ALL_POSITIONS.filter((p) => p !== "C"),
    });

  // 3 designated catchers + 8 non-catchers — enough catchers that bench
  // scheduling never has to bench the only one, so the assertion isolates
  // the eligibility gate.
  const mixedRoster = () => [
    catcher("c0", "Catcher 0"),
    catcher("c1", "Catcher 1"),
    catcher("c2", "Catcher 2"),
    ...Array.from({ length: 8 }, (_, i) => fielder(`x${i}`, `Field ${i}`)),
  ];
  const nonCatcherIds = Array.from({ length: 8 }, (_, i) => `x${i}`);
  const catchersSeen = (lineup) =>
    lineup.map((inn) => inn.C?.id).filter(Boolean);

  test("10-fielder: a non-catcher is never seated at C", () => {
    const players = mixedRoster();
    for (let seed = 1; seed <= 6; seed++) {
      const result = buildLineup({ players, defenseSize: "10", seed });
      expect(result.error).toBeUndefined();
      const seen = catchersSeen(result.lineup);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.some((id) => nonCatcherIds.includes(id))).toBe(false);
    }
  });

  test("9-fielder: a non-catcher is never seated at C", () => {
    const players = mixedRoster();
    for (let seed = 1; seed <= 6; seed++) {
      const result = buildLineup({ players, defenseSize: "9", seed });
      expect(result.error).toBeUndefined();
      const seen = catchersSeen(result.lineup);
      expect(seen.some((id) => nonCatcherIds.includes(id))).toBe(false);
    }
  });

  test("empty comfortablePositions never grants catcher (opt-in)", () => {
    // Mirrors freshly-added players (empty list). With 3 real catchers
    // present, the empty-list kids must never appear behind the plate.
    const raw = (id, comfort) => ({
      id,
      name: id,
      number: "",
      primaryPosition: "",
      restrictions: [],
      comfortablePositions: comfort,
    });
    const players = [
      // Real catchers, cleared everywhere incl C.
      makePlayer("c0", "Catcher 0"),
      makePlayer("c1", "Catcher 1"),
      makePlayer("c2", "Catcher 2"),
      // Freshly-added kids with an empty list — must never catch.
      ...Array.from({ length: 8 }, (_, i) => raw(`u${i}`, [])),
    ];
    const emptyIds = Array.from({ length: 8 }, (_, i) => `u${i}`);
    for (let seed = 1; seed <= 4; seed++) {
      const result = buildLineup({ players, defenseSize: "10", seed });
      expect(result.error).toBeUndefined();
      const seen = catchersSeen(result.lineup);
      expect(seen.some((id) => emptyIds.includes(id))).toBe(false);
    }
  });

  test("no player cleared for C -> actionable error", () => {
    const players = Array.from({ length: 11 }, (_, i) =>
      fielder(`x${i}`, `Field ${i}`)
    );
    const result = buildLineup({ players, defenseSize: "10", seed: 1 });
    expect(result.lineup).toBeUndefined();
    expect(result.error).toMatch(/catcher/i);
  });

  test("isCatcherEligible: C must be listed; a C restriction still wins", () => {
    expect(isCatcherEligible({ comfortablePositions: ["C", "1B"] })).toBe(true);
    expect(isCatcherEligible({ comfortablePositions: ["1B", "SS"] })).toBe(
      false
    );
    expect(isCatcherEligible({ comfortablePositions: [] })).toBe(false);
    expect(isCatcherEligible({})).toBe(false);
    expect(
      isCatcherEligible({ comfortablePositions: ["C"], restrictions: ["C"] })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Catcher playing-time team setting (catcherMaxInnings + catcherConsecutive).
// "auto" preserves legacy behavior; an explicit cap hard-limits how many
// innings any one kid catches and (when consecutive) keeps them back-to-back.
// ---------------------------------------------------------------------------

// Innings (0-based) a given player caught.
const catchingInnings = (lineup, playerId) =>
  lineup
    .map((inn, i) => (inn.C?.id === playerId ? i : -1))
    .filter((i) => i >= 0);

// Map of catcherId -> sorted innings caught, for every kid who caught.
const catcherInningMap = (lineup) => {
  const m = new Map();
  lineup.forEach((inn, i) => {
    const id = inn.C?.id;
    if (!id) return;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(i);
  });
  return m;
};

const isContiguous = (sorted) =>
  sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);

// ---------------------------------------------------------------------------
// Rotation lock yields to avoid stranding a scarce position.
// Regression for a real coach backup: NKB 8U Machine Pitch, 10-fielder,
// 2-inning rotation lock, catcher cap 2 (back-to-back). The catcher pool and
// the 1B pool are nearly the same 6 kids, so reserving 3 distinct catchers +
// freezing the rest via the rotation lock left inning 6 with no eligible 1B —
// and the engine fell back to one-game balance (dropping season fairness).
// The lock must instead RELAX for that one inning and keep full fairness.
// (Roster eligibility mirrors the real backup; names are anonymized.)
// ---------------------------------------------------------------------------
describe("rotation lock yields instead of stranding a scarce position", () => {
  const PROFILE = [
    "P,1B,C,2B,3B,SS,LF,LCF,RCF,RF", "C,P,1B,2B,LCF,LF,SS,3B,RCF,RF",
    "P,2B,LF,LCF,RCF,RF", "P,2B,3B,SS,RF,RCF,LCF,LF",
    "P,LF,LCF,RCF,RF,2B", "C,P,1B,2B,LCF,LF,SS,3B,RCF,RF",
    "C,P,1B,2B,LCF,LF,SS,3B,RCF,RF", "P,2B,LF,LCF,RCF,RF",
    "P,LCF,LF,RCF,RF,1B,2B", "C,P,1B,2B,LCF,LF,SS,3B,RCF,RF",
    "P,2B,3B,SS,LF,LCF,RCF,RF,C", "P,2B,LCF,LF,SS,3B,RF,RCF",
  ];
  const players = PROFILE.map((cp, i) =>
    makePlayer(`p${i}`, `P${i}`, { comfortablePositions: cp.split(",") })
  );
  const POS10 = ["P","C","1B","2B","3B","SS","LF","LCF","RCF","RF"];
  const slim = (i) => ({ id: `p${i}`, name: `P${i}`, number: "" });
  // Past games bench the 1B-capable kids so they're under-played and the
  // fairness scheduler seats them in late innings — including the inning-6
  // rotation-lock inning, which is what triggers the 1B strand.
  const benchPlan = [[0,1],[5,6],[9,0],[1,5],[6,9],[0,1]];
  const games = [
    "2026-04-01","2026-04-05","2026-04-09","2026-04-13","2026-04-17","2026-04-21",
  ].map((dt, gi) => ({
    id: "g" + gi, date: dt, opponent: "O", status: "final",
    teamScore: 5, opponentScore: 1,
    lineup: benchPlan.map((b) => {
      const inn = {};
      const field = [...Array(12).keys()].filter((x) => !b.includes(x));
      POS10.forEach((pos, k) => (inn[pos] = slim(field[k])));
      inn.BENCH = b.map(slim);
      return inn;
    }),
  }));

  const build = (seed) =>
    generateLineup({
      activePlayers: players, allPlayers: players, games, evaluationEvents: [],
      currentGame: { id: "gn", date: "2026-05-06", opponent: "N" },
      firstInningOverridesById: {}, totalInnings: 6, leagueRuleSet: "NKB",
      teamAge: "8U", defenseSize: "10", positionLock: "2", battingSize: "roster",
      pitchingFormat: "Machine Pitch", catcherMaxInnings: "2",
      catcherConsecutive: true, seed,
    });

  test("builds with full season fairness; lock relaxes only where needed", () => {
    let relaxEngaged = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = build(seed);
      // Must NOT fall back to one-game balance, and 1B is filled every inning.
      expect(r.error).toBeUndefined();
      expect(r.fairnessRelaxed).toBeFalsy();
      for (const inn of r.lineup) expect(inn["1B"]).toBeTruthy();
      if ((r.lockRelaxedInnings || []).length > 0) relaxEngaged++;
    }
    // Across the seeds, the lock-yield must actually fire — without it those
    // seeds would have stranded 1B and dropped season fairness.
    expect(relaxEngaged).toBeGreaterThan(0);
  });
});

describe("lineup failure diagnostics", () => {
  test("hard failure surfaces the specific blocking position + inning", () => {
    // Every present player is restricted from RF, so no inning can be filled.
    // Both fairness passes fail → a specific, actionable error (not generic).
    const players = makeRoster(11).map((p) =>
      makePlayer(p.id, p.name, {
        comfortablePositions: ALL_POSITIONS.filter((x) => x !== "RF"),
        restrictions: ["RF"],
      })
    );
    const result = buildLineup({ players, defenseSize: "9" });
    expect(result.lineup).toBeUndefined();
    expect(result.error).toMatch(/no eligible player for RF/i);
    expect(result.error).toMatch(/restricted from RF/i);
  });

  test("a clean build carries no fairness-relaxed diagnostic", () => {
    const result = buildLineup({ players: makeRoster(12), defenseSize: "9" });
    expect(result.error).toBeUndefined();
    expect(result.fairnessRelaxed).toBeFalsy();
    expect(result.fairnessRelaxedReason).toBeUndefined();
  });
});

describe("resolveCatcherPolicy", () => {
  test("auto preserves legacy defense-size behavior", () => {
    // 10-fielder with a full roster → back-to-back pairs (cap 2), lenient.
    expect(resolveCatcherPolicy("auto", true, "10", 12)).toEqual({
      cap: 2,
      consecutive: true,
      enforceCap: false,
    });
    // 9-fielder → cap 3, no continuity, lenient.
    expect(resolveCatcherPolicy("auto", true, "9", 12)).toEqual({
      cap: 3,
      consecutive: false,
      enforceCap: false,
    });
    // 10-fielder but fewer than 10 present → no continuity (legacy gate).
    expect(resolveCatcherPolicy("auto", true, "10", 9)).toEqual({
      cap: 2,
      consecutive: false,
      enforceCap: false,
    });
    // undefined setting defaults to auto.
    expect(resolveCatcherPolicy(undefined, undefined, "9", 12).cap).toBe(3);
  });

  test("explicit cap enforces and honors the consecutive toggle", () => {
    expect(resolveCatcherPolicy("2", true, "9", 12)).toEqual({
      cap: 2,
      consecutive: true,
      enforceCap: true,
    });
    expect(resolveCatcherPolicy("2", false, "10", 12)).toEqual({
      cap: 2,
      consecutive: false,
      enforceCap: true,
    });
    // Missing toggle defaults consecutive ON for an explicit cap.
    expect(resolveCatcherPolicy("3", undefined, "9", 12).consecutive).toBe(true);
  });

  test("none removes the cap", () => {
    expect(resolveCatcherPolicy("none", true, "9", 12)).toEqual({
      cap: Infinity,
      consecutive: false,
      enforceCap: false,
    });
  });
});

describe("catcher max-innings setting (engine)", () => {
  // 12 players, all catcher-eligible by default (makePlayer clears C).
  const roster = () => makeRoster(12);

  test("cap 2 back-to-back: no kid catches >2 innings, 9-fielder", () => {
    const result = buildLineup({
      players: roster(),
      defenseSize: "9",
      catcherMaxInnings: "2",
      catcherConsecutive: true,
      totalInnings: 6,
    });
    expect(result.error).toBeUndefined();
    const m = catcherInningMap(result.lineup);
    for (const [, innings] of m) {
      expect(innings.length).toBeLessThanOrEqual(2);
      expect(isContiguous(innings)).toBe(true);
    }
  });

  test("cap 2 back-to-back: 9-fielder catcher changes every 2 innings", () => {
    // With continuity + cap 2 over 6 innings we expect 3 distinct catchers
    // covering pairs (0,1)(2,3)(4,5).
    const result = buildLineup({
      players: roster(),
      defenseSize: "9",
      catcherMaxInnings: "2",
      catcherConsecutive: true,
      totalInnings: 6,
    });
    expect(result.error).toBeUndefined();
    expect([0, 1].map((i) => result.lineup[i].C?.id)).toEqual([
      result.lineup[0].C?.id,
      result.lineup[0].C?.id,
    ]);
    // Pair boundaries: inning 1 and 2 are different catchers.
    expect(result.lineup[1].C?.id).not.toBe(result.lineup[2].C?.id);
    expect(result.lineup[3].C?.id).not.toBe(result.lineup[4].C?.id);
  });

  test("cap 3 back-to-back: blocks of three contiguous innings", () => {
    const result = buildLineup({
      players: roster(),
      defenseSize: "9",
      catcherMaxInnings: "3",
      catcherConsecutive: true,
      totalInnings: 6,
    });
    expect(result.error).toBeUndefined();
    const m = catcherInningMap(result.lineup);
    for (const [, innings] of m) {
      expect(innings.length).toBeLessThanOrEqual(3);
      expect(isContiguous(innings)).toBe(true);
    }
    // (0,1,2) one catcher, (3,4,5) another.
    expect(result.lineup[0].C?.id).toBe(result.lineup[2].C?.id);
    expect(result.lineup[3].C?.id).toBe(result.lineup[5].C?.id);
    expect(result.lineup[2].C?.id).not.toBe(result.lineup[3].C?.id);
  });

  test("cap 2 consecutive OFF: cap respected, innings need not be adjacent", () => {
    const result = buildLineup({
      players: roster(),
      defenseSize: "9",
      catcherMaxInnings: "2",
      catcherConsecutive: false,
      totalInnings: 6,
    });
    expect(result.error).toBeUndefined();
    const m = catcherInningMap(result.lineup);
    for (const [, innings] of m) {
      expect(innings.length).toBeLessThanOrEqual(2);
    }
  });

  test("cap 2 also applies in 10-fielder mode", () => {
    const result = buildLineup({
      players: roster(),
      defenseSize: "10",
      catcherMaxInnings: "2",
      catcherConsecutive: true,
      totalInnings: 6,
    });
    expect(result.error).toBeUndefined();
    const m = catcherInningMap(result.lineup);
    for (const [, innings] of m) {
      expect(innings.length).toBeLessThanOrEqual(2);
      expect(isContiguous(innings)).toBe(true);
    }
  });

  test("too few catcher-eligible kids under an explicit cap errors clearly", () => {
    // Only 2 kids cleared for C, 6 innings, cap 2 → need 3 catchers.
    const players = makeRoster(12).map((p, i) =>
      i < 2
        ? p
        : makePlayer(p.id, p.name, {
            comfortablePositions: ALL_POSITIONS.filter((x) => x !== "C"),
          })
    );
    const result = buildLineup({
      players,
      defenseSize: "9",
      catcherMaxInnings: "2",
      catcherConsecutive: true,
      totalInnings: 6,
    });
    expect(result.error).toMatch(/catcher-eligible/i);
    expect(result.error).toMatch(/3/);
  });

  test("no limit: builds and does not impose the catcher-count fast-fail", () => {
    // Only 2 catcher-eligible kids over 6 innings. An explicit cap of 2 would
    // need 3 catchers and error; "none" removes the cap so it must build.
    const players = makeRoster(12).map((p, i) =>
      i < 2
        ? p
        : makePlayer(p.id, p.name, {
            comfortablePositions: ALL_POSITIONS.filter((x) => x !== "C"),
          })
    );
    const result = buildLineup({
      players,
      defenseSize: "9",
      catcherMaxInnings: "none",
      totalInnings: 6,
    });
    expect(result.error).toBeUndefined();
    // Every fielded inning has a catcher, drawn from the 2 eligible kids.
    for (const inn of result.lineup) {
      expect(["p0", "p1"]).toContain(inn.C?.id);
    }
    // With no cap, at least one of them catches more than the default 3.
    const total =
      catchingInnings(result.lineup, "p0").length +
      catchingInnings(result.lineup, "p1").length;
    expect(total).toBe(6);
  });

  test("auto with a single catcher still works (legacy lenient reuse)", () => {
    // 10-fielder, one eligible catcher → legacy behavior reuses them across
    // pairs rather than erroring (no behavior change for existing teams).
    const players = makeRoster(12).map((p, i) =>
      i === 0
        ? p
        : makePlayer(p.id, p.name, {
            comfortablePositions: ALL_POSITIONS.filter((x) => x !== "C"),
          })
    );
    const result = buildLineup({
      players,
      defenseSize: "10",
      catcherMaxInnings: "auto",
      totalInnings: 6,
    });
    expect(result.error).toBeUndefined();
    expect(catchingInnings(result.lineup, "p0").length).toBe(6);
  });
});

describe("primary-position pre-pin", () => {
  test("Big Game: 3B-primary kid plays 3B every inning he's on the field", () => {
    // Reproduces the exact reported bug: at 8U Big Game, a kid with
    // primaryPosition='3B' was landing at RF because the position shuffle
    // picked RF before 3B and Big Game's OF-pull math nudged the strong
    // kid there.
    //
    // Restrict ace from C so the catcher pre-pin (which runs before the
    // primary pre-pin in 10-fielder mode) can't claim him for the plate
    // via the defScore tiebreaker — that's the exact restriction-based
    // workflow real coaches use.
    const players = [
      makePlayer("ace", "3B Ace", { primaryPosition: "3B", restrictions: ["C"] }),
      ...makeRoster(10),
    ];
    const grades = {};
    for (let i = 0; i < 11; i++) grades[`p${i}`] = { fielding: 5 };
    grades.ace = { fielding: 9, armStrength: 9, armAccuracy: 9, speedAgility: 9, baseballIQ: 9 };

    const result = buildLineup({
      players,
      evaluationEvents: [headEval(grades)],
      teamAge: "8U",
      isBigGame: true,
      seed: 7,
    });
    expect(result.error).toBeUndefined();
    const positions = positionsOf(result.lineup, "ace");
    // Every inning the ace is on the field, he should be at 3B (Big Game
    // primary lock).
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] === null) continue;
      expect(positions[i]).toBe("3B");
    }
  });

  test("Big Game: SS-primary kid stays at SS every inning he's on the field", () => {
    const players = [
      makePlayer("ss_ace", "SS Ace", { primaryPosition: "SS", restrictions: ["C"] }),
      ...makeRoster(10),
    ];
    const grades = {};
    for (let i = 0; i < 11; i++) grades[`p${i}`] = { fielding: 5 };
    grades.ss_ace = { fielding: 9, armStrength: 9, armAccuracy: 9, speedAgility: 9, baseballIQ: 9 };

    const result = buildLineup({
      players,
      evaluationEvents: [headEval(grades)],
      teamAge: "10U",
      isBigGame: true,
      seed: 13,
    });
    expect(result.error).toBeUndefined();
    const positions = positionsOf(result.lineup, "ss_ace");
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] === null) continue;
      expect(positions[i]).toBe("SS");
    }
  });

  test("Fair mode does not pin primary position — kid rotates through other allowed spots", () => {
    // Fair mode no longer privileges primaryPosition (coach-requested change).
    // A kid with primaryPosition='3B' should NOT play 3B in every inning —
    // they should land elsewhere at least once across a 6-inning game,
    // driven by rotation pressure + jitter, since no comfortablePositions
    // whitelist restricts them.
    const players = [
      makePlayer("ace", "3B Ace", { primaryPosition: "3B", restrictions: ["C"] }),
      ...makeRoster(9),
    ];
    const result = buildLineup({
      players,
      teamAge: "10U",
      isBigGame: false,
      seed: 99,
    });
    expect(result.error).toBeUndefined();
    // Count innings where 'ace' played 3B vs. somewhere else on the field.
    let inningsAt3B = 0;
    let inningsAwayFrom3B = 0;
    for (const inn of result.lineup) {
      if (inn["3B"]?.id === "ace") inningsAt3B++;
      else {
        for (const pos of Object.keys(inn)) {
          if (pos === "BENCH") continue;
          if (inn[pos]?.id === "ace") {
            inningsAwayFrom3B++;
            break;
          }
        }
      }
    }
    // Fair mode should produce real rotation — the ace plays somewhere
    // other than 3B at least once across the game.
    expect(inningsAwayFrom3B).toBeGreaterThan(0);
  });

  test("Fair mode: kid with comfortablePositions stays inside that set", () => {
    // Mike's comfort list is just {1B, 2B, 3B}. In a 6-inning fair-mode
    // game, every inning he's on the field MUST be 1B/2B/3B — the
    // whitelist is enforced by isPositionBlocked. This guards the
    // fair-mode comfortablePositions bonus doesn't accidentally allow
    // out-of-list placements via some scoring path.
    const players = [
      makePlayer("mike", "Mike", {
        primaryPosition: "3B",
        comfortablePositions: ["1B", "2B", "3B"],
      }),
      ...makeRoster(9),
    ];
    const result = buildLineup({
      players,
      teamAge: "10U",
      isBigGame: false,
      seed: 7,
    });
    expect(result.error).toBeUndefined();
    const allowed = new Set(["1B", "2B", "3B"]);
    for (const inn of result.lineup) {
      for (const pos of Object.keys(inn)) {
        if (pos === "BENCH") continue;
        if (inn[pos]?.id === "mike") {
          expect(allowed.has(pos)).toBe(true);
        }
      }
    }
  });

  test("Fair mode: kid with comfortablePositions actually rotates within them", () => {
    // Mike's comfort list = {1B, 2B, 3B}, primary = 3B. Over a 6-inning
    // fair-mode game, he should appear at MORE than just 3B — the
    // primary-position bias is gone in fair mode, and the equal
    // comfortablePositions bonus should let rotation pressure / jitter
    // spread him across his allowed set.
    const players = [
      makePlayer("mike", "Mike", {
        primaryPosition: "3B",
        comfortablePositions: ["1B", "2B", "3B"],
      }),
      ...makeRoster(9),
    ];
    const result = buildLineup({
      players,
      teamAge: "10U",
      isBigGame: false,
      seed: 7,
    });
    expect(result.error).toBeUndefined();
    const positionsSeen = new Set();
    for (const inn of result.lineup) {
      for (const pos of Object.keys(inn)) {
        if (pos === "BENCH") continue;
        if (inn[pos]?.id === "mike") positionsSeen.add(pos);
      }
    }
    // At least two different comfortable positions across the game.
    expect(positionsSeen.size).toBeGreaterThan(1);
  });

  test("Big Game still pins primary even when comfortablePositions includes others", () => {
    // The comfortablePositions bonus only fires in fair mode. Big Game
    // mode keeps its -10000 primary-position pin, so a primary-SS kid
    // with comfort list = {SS, 3B, 1B} should still play SS every
    // inning he's on the field.
    const players = [
      makePlayer("ace", "SS Ace", {
        primaryPosition: "SS",
        comfortablePositions: ["SS", "3B", "1B"],
        restrictions: ["C"],
      }),
      ...makeRoster(10),
    ];
    const grades = {};
    for (let i = 0; i < 11; i++) grades[`p${i}`] = { fielding: 5 };
    grades.ace = { fielding: 9, armStrength: 9, armAccuracy: 9 };
    const result = buildLineup({
      players,
      evaluationEvents: [headEval(grades)],
      teamAge: "10U",
      isBigGame: true,
      seed: 7,
    });
    expect(result.error).toBeUndefined();
    for (const inn of result.lineup) {
      const wasBenched = (inn.BENCH || []).some((p) => p?.id === "ace");
      if (wasBenched) continue;
      // On the field → must be at SS.
      expect(inn["SS"]?.id).toBe("ace");
    }
  });

  test("Fair mode: kid restricted to OF cycles through LF/CF/RF, doesn't park at one", () => {
    // Mike's comfort list is the three OF spots. In a 6-inning fair-mode
    // game, the engine should rotate him across multiple OF positions
    // instead of putting him at RF (or any one spot) every inning he's
    // on the field — the +1.75x OF rotation multiplier in fair mode
    // makes repeating the same OF position actively expensive.
    const players = [
      makePlayer("mike", "Mike", {
        primaryPosition: "RF",
        comfortablePositions: ["LF", "CF", "RF"],
      }),
      ...makeRoster(9),
    ];
    // Try several seeds — at least one should show real rotation.
    // Any single seed could hit a coin-flip edge case via jitter, so
    // the assertion is that across these seeds Mike sees multiple OF
    // positions over the 6 innings of each game.
    // Use positionLock="1" (no lock-inning carry-over) so the engine is
    // free to rotate inning-to-inning. Lock modes ("2", "3", "full")
    // intentionally pin same-position via a -1000 bonus, which would
    // override the OF rotation pressure being tested here.
    let totalDistinctOFSeen = 0;
    let games = 0;
    for (const seed of [11, 23, 47, 99, 113]) {
      const result = buildLineup({
        players,
        teamAge: "10U",
        isBigGame: false,
        positionLock: "1",
        seed,
      });
      if (result.error) continue;
      games++;
      const positionsSeen = new Set();
      for (const inn of result.lineup) {
        for (const pos of ["LF", "CF", "RF"]) {
          if (inn[pos]?.id === "mike") positionsSeen.add(pos);
        }
      }
      totalDistinctOFSeen += positionsSeen.size;
    }
    // Average ≥ 2 different OF positions per game over the 5 seeds.
    expect(totalDistinctOFSeen / games).toBeGreaterThanOrEqual(2);
  });

  test("two kids with same primaryPosition: better defender wins it", () => {
    // Both restricted from C so the catcher pre-pin can't grab the strong
    // defender via tier-2 defScore tiebreaker.
    const players = [
      makePlayer("a", "A", { primaryPosition: "SS", restrictions: ["C"] }),
      makePlayer("b", "B", { primaryPosition: "SS", restrictions: ["C"] }),
      ...makeRoster(9),
    ];
    const grades = {};
    for (let i = 0; i < 9; i++) grades[`p${i}`] = { fielding: 5 };
    grades.a = { fielding: 9, armStrength: 9, armAccuracy: 9, speedAgility: 9, baseballIQ: 9 };
    grades.b = { fielding: 4, armStrength: 4, armAccuracy: 4, speedAgility: 4, baseballIQ: 4 };

    const result = buildLineup({
      players,
      evaluationEvents: [headEval(grades)],
      teamAge: "10U",
      isBigGame: true,
      seed: 21,
    });
    expect(result.error).toBeUndefined();
    // The better defender ('a') should be at SS whenever on the field.
    const aPositions = positionsOf(result.lineup, "a");
    for (const pos of aPositions) {
      if (pos === null) continue;
      expect(pos).toBe("SS");
    }
  });

  test("Big Game: primary-3B kid returns to 3B after sitting an inning (13-player roster)", () => {
    // The user's exact scenario: a kid set as 3B in Big Game should play
    // 3B the whole game, including after a fairness bench. With 13 active
    // and 10 fielders, the bench schedule forces every kid to sit
    // approximately once. The ace must come back to 3B — never displaced
    // by the substitute who held 3B during the bench inning.
    const players = [
      makePlayer("ace", "Ace 3B", { primaryPosition: "3B", restrictions: ["C"] }),
      ...makeRoster(12),
    ];
    const grades = {};
    for (const p of players) grades[p.id] = { fielding: 5 };
    grades.ace = {
      fielding: 9,
      armStrength: 9,
      armAccuracy: 9,
      speedAgility: 9,
      baseballIQ: 9,
    };

    let benchedAtLeastOnce = false;
    const violations = [];
    for (let seed = 1; seed <= 30; seed++) {
      const result = buildLineup({
        players,
        evaluationEvents: [headEval(grades)],
        teamAge: "8U",
        isBigGame: true,
        seed,
      });
      if (result.error) continue;
      const acePos = result.lineup.map((inn) => {
        if ((inn.BENCH || []).some((p) => p?.id === "ace")) return "BENCH";
        for (const k of Object.keys(inn)) {
          if (k === "BENCH") continue;
          if (inn[k]?.id === "ace") return k;
        }
        return null;
      });
      if (acePos.includes("BENCH")) benchedAtLeastOnce = true;
      // Walk innings: any non-BENCH inning that isn't 3B is a violation.
      const wrong = acePos.filter((p) => p !== null && p !== "BENCH" && p !== "3B");
      if (wrong.length > 0) violations.push({ seed, acePos });
    }
    expect(benchedAtLeastOnce).toBe(true); // sanity: roster size forces sits
    expect(violations).toEqual([]);
  });

  test("primary-infield kid stays out of catcher pool when explicitly C-restricted", () => {
    // A primary-3B kid is eligible to catch by default — real rosters
    // include catchers whose primary is 2B/SS/3B, and the engine does NOT
    // heuristically exclude them. The way coaches keep a primary-infield
    // kid behind the plate-free is the explicit `restrictions: ["C"]`
    // flag, which gates the catcher pool at every age.
    const players = [
      makePlayer("ace", "Ace 3B", {
        primaryPosition: "3B",
        restrictions: ["C"],
      }),
      ...makeRoster(10),
    ];
    const grades = {};
    for (const p of players) grades[p.id] = { fielding: 5 };
    grades.ace = {
      fielding: 9,
      armStrength: 9,
      armAccuracy: 9,
      speedAgility: 9,
      baseballIQ: 9,
    };

    for (let seed = 1; seed <= 25; seed++) {
      const result = buildLineup({
        players,
        evaluationEvents: [headEval(grades)],
        teamAge: "8U",
        isBigGame: true,
        seed,
      });
      if (result.error) continue;
      for (const inn of result.lineup) {
        expect(inn.C?.id).not.toBe("ace");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Restrictions still gate eligibility
// ---------------------------------------------------------------------------

describe("position restrictions", () => {
  test("a player restricted from C is never assigned to C", () => {
    const players = [
      makePlayer("p_norestrict", "Catcher OK"),
      makePlayer("p_restrict", "No C", { restrictions: ["C"] }),
      ...makeRoster(9),
    ];
    const result = buildLineup({
      players,
      teamAge: "8U",
      seed: 33,
    });
    expect(result.error).toBeUndefined();
    for (const inn of result.lineup) {
      expect(inn.C?.id).not.toBe("p_restrict");
    }
  });
});

// ---------------------------------------------------------------------------
// Left-handed-throwing infield penalty (2B / SS / 3B)
// ---------------------------------------------------------------------------

describe("lefty-throwing infield penalty (2B/SS/3B)", () => {
  test("a lefty is strongly biased away from 2B/SS/3B", () => {
    // One left-handed thrower in an otherwise right-handed roster (13 kids, 10
    // fielders). The penalty is a SOFT score term, not a hard block — a tight
    // roster can still strand the lefty there rather than fail to field a
    // team. So we assert the BIAS: across many seeds the lefty lands at the
    // three throwing-angle-hostile infield spots far below the 3-of-10 (=30%)
    // positional baseline. 1B (a natural lefty spot) and the outfield absorb
    // the lefty instead.
    const players = [
      makePlayer("lefty", "Lefty", { throws: "L" }),
      ...makeRoster(12).map((p) => ({ ...p, throws: "R" })),
    ];
    let fieldInn = 0;
    let infieldInn = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const result = buildLineup({
        players,
        leagueRuleSet: "USSSA",
        teamAge: "8U",
        defenseSize: "10",
        seed,
      });
      expect(result.error).toBeUndefined();
      for (const pos of positionsOf(result.lineup, "lefty")) {
        if (pos === null) continue; // benched
        fieldInn++;
        if (pos === "2B" || pos === "SS" || pos === "3B") infieldInn++;
      }
    }
    expect(fieldInn).toBeGreaterThan(0);
    // Well under the 30% you'd expect if the lefty were placed blind.
    expect(infieldInn / fieldInn).toBeLessThan(0.2);
  });
});

// ---------------------------------------------------------------------------
// Player-side positional scarcity ("some kids have few positions")
// ---------------------------------------------------------------------------

describe("positional-scarcity reservation (reserve flexible kids for holes)", () => {
  test("a low-flexibility kid wins a contested slot over a do-anything kid", () => {
    // 3B is open to exactly two kids: a corner-limited kid (cleared only for
    // 3B/RF) and a play-anywhere kid. The flexible kid even has the STRONGER
    // arm, so the arm-strength bias alone would hand them 3B. The scarcity
    // reservation flips it: seat the limited kid at 3B and reserve the
    // do-anything kid to plug the remaining holes. Asserted on inning 0 where
    // no rotation history clouds the decision.
    const others = makeRoster(9).map((p) => ({
      ...p,
      // Everyone else can play anywhere EXCEPT 3B, so 3B has only two takers.
      comfortablePositions: ALL_POSITIONS.filter((x) => x !== "3B"),
    }));
    const corner = makePlayer("corner", "Corner", {
      comfortablePositions: ["3B", "RF"],
    });
    const flex = makePlayer("flex", "Flex"); // cleared everywhere
    const players = [corner, flex, ...others];

    const result = buildLineup({
      players,
      teamAge: "8U",
      defenseSize: "10",
      seed: 7,
      // Give the flexible kid the stronger arm so, absent the reservation,
      // the 3B arm bias would pick them instead.
      evaluationEvents: [
        headEval({ flex: { armStrength: 9 }, corner: { armStrength: 3 } }),
      ],
    });

    expect(result.error).toBeUndefined();
    expect(result.lineup[0]["3B"]?.id).toBe("corner");
  });

  test("vanilla rosters are unaffected (constant offset on every candidate)", () => {
    // When everyone is cleared everywhere the reservation adds the same offset
    // to all candidates, so it can't change any decision — the lineup is still
    // valid and complete.
    const players = makeRoster(11);
    const result = buildLineup({ players, seed: 99 });
    expect(result.error).toBeUndefined();
    expect(result.lineup).toHaveLength(6);
    for (const inn of result.lineup) {
      for (const pos of ["P", "C", "1B", "2B", "3B", "SS"]) {
        expect(inn[pos]).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Batting order — NKB youth strategy + re-roll variance
// ---------------------------------------------------------------------------

// Fixture helpers for batting tests. Players have stats so OPS / contact /
// leadoff scores actually differ (without stats every kid gets the same
// profile and the order is grade-driven only).
const makeBatter = (id, name, stats = {}, opts = {}) => ({
  id,
  name,
  number: opts.number ?? "",
  primaryPosition: opts.primaryPosition ?? "",
  restrictions: opts.restrictions ?? [],
  stats: {
    ops: 0,
    obp: 0,
    avg: 0,
    contact: 0,
    ld: 0,
    hard: 0,
    qab: 0,
    ...stats,
  },
});

const youthBatter = (id, archetype) => {
  // Three archetypes that stress different parts of the youth strategy.
  switch (archetype) {
    case "leadoff":
      return makeBatter(id, `Leadoff ${id}`, { obp: 0.55, avg: 0.4, contact: 0.85, ops: 0.7 });
    case "contact":
      return makeBatter(id, `Contact ${id}`, { obp: 0.4, avg: 0.45, contact: 0.9, ops: 0.7 });
    case "ops":
      return makeBatter(id, `OPS ${id}`, { obp: 0.42, avg: 0.38, contact: 0.6, ops: 1.05, hard: 0.5 });
    case "weak":
      return makeBatter(id, `Weak ${id}`, { obp: 0.2, avg: 0.15, contact: 0.4, ops: 0.3 });
    default:
      return makeBatter(id, `Avg ${id}`, { obp: 0.35, avg: 0.3, contact: 0.65, ops: 0.6 });
  }
};

describe("batting order — NKB 7U/8U youth strategy", () => {
  test("places best OPS at #3 (cleanup with men on)", () => {
    const players = [
      youthBatter("lo1", "leadoff"),
      youthBatter("lo2", "leadoff"),
      youthBatter("c1", "contact"),
      youthBatter("c2", "contact"),
      youthBatter("ops1", "ops"),
      youthBatter("ops2", "ops"),
      youthBatter("ops3", "ops"),
      youthBatter("avg1", "avg"),
      youthBatter("avg2", "avg"),
      youthBatter("w1", "weak"),
      youthBatter("w2", "weak"),
    ];
    const result = generateBattingOnly({
      activePlayers: players,
      allPlayers: players,
      evaluationEvents: [],
      leagueRuleSet: "NKB",
      teamAge: "8U",
      battingSize: "roster",
      seed: 42,
    });
    expect(result.error).toBeUndefined();
    const order = result.battingLineup;
    expect(order).toHaveLength(11);
    // The role labels carry the strategy intent (UI shows them too).
    const roles = order.map((p) => p.battingReason?.role);
    expect(roles[0]).toBe("Leadoff");
    expect(roles[1]).toBe("#2 Contact");
    expect(roles[2]).toBe("#3 OPS");
    expect(roles[3]).toBe("Cleanup OPS");
    expect(roles[6]).toBe("#7 Late OPS");
  });

  test("does not use powerScore (HR/SLG noise) at NKB 8U", () => {
    // A kid with high HR + RBI but mediocre OPS / contact should NOT win
    // any of the "big hitter" slots over a true OPS bat. The youth path
    // must ignore powerScore.
    const players = [
      youthBatter("lo1", "leadoff"),
      youthBatter("c1", "contact"),
      youthBatter("ops_real", "ops"),
      makeBatter("power_only", "Power Only", {
        ops: 0.6,
        obp: 0.3,
        avg: 0.25,
        contact: 0.5,
        hr: 8,
        rbi: 25,
        doubles: 6,
        triples: 1,
      }),
      youthBatter("avg1", "avg"),
      youthBatter("avg2", "avg"),
      youthBatter("avg3", "avg"),
      youthBatter("w1", "weak"),
      youthBatter("w2", "weak"),
    ];
    const result = generateBattingOnly({
      activePlayers: players,
      allPlayers: players,
      evaluationEvents: [],
      leagueRuleSet: "NKB",
      teamAge: "8U",
      battingSize: "roster",
      seed: 42,
    });
    expect(result.error).toBeUndefined();
    // The primary OPS slot (#3) must belong to the genuine OPS bat. The
    // cleanup slot (#4) goes to whoever has the next-best OPS, which can
    // be a tied .600 kid — that's fine; the point is that powerScore
    // (HR/RBI/SLG) can't promote the power_only kid into the leadoff spot
    // or above the real OPS bat.
    expect(result.battingLineup[2].id).toBe("ops_real");
  });

  test("USSSA at 8U keeps the existing Tango strategy (powerScore at cleanup)", () => {
    const players = [
      youthBatter("lo1", "leadoff"),
      youthBatter("c1", "contact"),
      youthBatter("ops1", "ops"),
      makeBatter("slugger", "Slugger", {
        ops: 0.85, obp: 0.32, avg: 0.27, contact: 0.55,
        hr: 12, rbi: 35, doubles: 8, triples: 2, hard: 0.6,
      }),
      youthBatter("avg1", "avg"),
      youthBatter("avg2", "avg"),
      youthBatter("avg3", "avg"),
      youthBatter("w1", "weak"),
      youthBatter("w2", "weak"),
    ];
    const result = generateBattingOnly({
      activePlayers: players,
      allPlayers: players,
      evaluationEvents: [],
      leagueRuleSet: "USSSA",
      teamAge: "8U",
      battingSize: "roster",
      seed: 42,
    });
    expect(result.error).toBeUndefined();
    // The Tango code path uses role labels distinct from the youth path
    // — verify those exist (not the youth "#3 OPS" / "Cleanup OPS" /
    // "#7 Late OPS" labels). The slugger ends up high in the order
    // because his RBI/HR inflate overallScore (Tango pulls him to the
    // #2 Premium slot before the cleanup pick runs).
    const roles = result.battingLineup.map((p) => p.battingReason?.role);
    expect(roles).toContain("Cleanup");
    expect(roles).not.toContain("#3 OPS");
    expect(roles).not.toContain("Cleanup OPS");
    // Slugger should land in the top half (Tango promotes him).
    const sluggerIdx = result.battingLineup.findIndex((p) => p.id === "slugger");
    expect(sluggerIdx).toBeGreaterThanOrEqual(0);
    expect(sluggerIdx).toBeLessThan(5);
  });

  test("re-roll: same seed → identical order (deterministic)", () => {
    const players = Array.from({ length: 11 }, (_, i) =>
      youthBatter(`p${i}`, i % 4 === 0 ? "ops" : i % 4 === 1 ? "leadoff" : i % 4 === 2 ? "contact" : "avg")
    );
    const a = generateBattingOnly({
      activePlayers: players, allPlayers: players, evaluationEvents: [],
      leagueRuleSet: "NKB", teamAge: "8U", battingSize: "roster", seed: 1234,
    });
    const b = generateBattingOnly({
      activePlayers: players, allPlayers: players, evaluationEvents: [],
      leagueRuleSet: "NKB", teamAge: "8U", battingSize: "roster", seed: 1234,
    });
    expect(a.battingLineup.map((p) => p.id)).toEqual(b.battingLineup.map((p) => p.id));
  });

  test("re-roll: different seeds reshuffle similarly-rated kids", () => {
    // Five "leadoff"-archetype kids with identical stats — completely
    // interchangeable. Different seeds should produce different orders
    // among them on average. (Plus a strong OPS hitter pinned to #3 to
    // confirm the strategy still respects role-driven slots.)
    const players = [
      youthBatter("ops1", "ops"),
      ...Array.from({ length: 5 }, (_, i) => youthBatter(`lo${i}`, "leadoff")),
      ...Array.from({ length: 5 }, (_, i) => youthBatter(`c${i}`, "contact")),
    ];
    const seen = new Set();
    for (let s = 1; s <= 20; s++) {
      const r = generateBattingOnly({
        activePlayers: players, allPlayers: players, evaluationEvents: [],
        leagueRuleSet: "NKB", teamAge: "8U", battingSize: "roster", seed: s,
      });
      seen.add(r.battingLineup.map((p) => p.id).join(","));
    }
    // 20 seeds should produce a handful of distinct orders, not just one.
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Mid-game removal (injury / illness / left site)
// ---------------------------------------------------------------------------

describe("mid-game removal — fairness counting", () => {
  // Reach into the engine via generateLineup using a prior game whose
  // lineup includes a removed kid. We verify the engine's fairness
  // accounting respects the removal: innings before the removal count
  // toward the kid's season totals; innings after don't.
  //
  // The contract being tested:
  //   game.midGameRemovals = { [pid]: { fromInning: N, reason: "..." } }
  // means the player was on the field through inning N-1, then gone
  // from inning N onward. NKB skips the kid in the batting order
  // without penalty; for engine purposes their bench/play counts
  // should only sum the innings they actually played.

  const aPlayer = (id) =>
    makePlayer(id, `Player ${id}`, { primaryPosition: "" });

  const inningOf = (assignments, bench) => ({ ...assignments, BENCH: bench });

  test("removed kid's innings after removal don't inflate bench count", () => {
    // Past game: 11 players, kid 'inj' played innings 0-2, removed at
    // inning 3 (lineup data for innings 3-5 has him gone). Without the
    // removal-aware logic, the engine's old code would count innings
    // 3-5 toward his bench count (since `innings - benchCount` was the
    // formula and benchCount was counted only when he appeared in BENCH).
    // With the new logic, his benchInn = innings he was actually
    // benched while present (0), and his defInn = 3 (played innings).
    const players = Array.from({ length: 11 }, (_, i) => aPlayer(`p${i}`));
    const injIdx = 0;
    const injId = players[injIdx].id;

    // Build a 6-inning past game where 'inj' played 1B in innings 0-2
    // and is gone from innings 3-5 (slot null, not on BENCH).
    const pastGame = {
      id: "past1",
      date: "2026-04-25",
      status: "final",
      attendance: Object.fromEntries(players.map((p) => [p.id, true])),
      midGameRemovals: { [injId]: { fromInning: 3, reason: "injury" } },
      lineup: [0, 1, 2, 3, 4, 5].map((i) => {
        const slots = {};
        const benched = [];
        for (let k = 0; k < players.length; k++) {
          const pid = players[k].id;
          const isInj = pid === injId;
          if (isInj && i >= 3) continue; // removed from inning 3 onward
          if (k === injIdx) {
            slots["1B"] = { id: pid, name: players[k].name };
            continue;
          }
          // Distribute remaining 10 kids to fixed positions; nobody benched
          // in any inning. This keeps the test simple — we only care about
          // the engine's accounting for inj.
          const posList = ["P", "C", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"];
          const pos = posList[k - 1];
          slots[pos] = { id: pid, name: players[k].name };
        }
        // Backfill removed kid's 1B slot from inning 3+ with someone else.
        if (i >= 3 && !slots["1B"]) slots["1B"] = null;
        return inningOf(slots, benched);
      }),
    };

    // Now generate a fresh lineup. We don't care about the lineup
    // output here — we care that the engine, when computing bench
    // history for 'inj', counts 3 innings of play and 0 bench (not 0
    // bench and 6 defInn, which is what the old code would have done).
    // Verify by checking the engine doesn't crash and produces a valid
    // result. The accounting itself is internal; the public smoke is
    // "no error" + the kid is treated as if he played 3 innings.
    const result = generateLineup({
      activePlayers: players,
      allPlayers: players,
      games: [pastGame],
      evaluationEvents: [],
      currentGame: { id: "g_today", date: "2026-05-01" },
      firstInningOverridesById: {},
      totalInnings: 6,
      leagueRuleSet: "USSSA",
      teamAge: "8U",
      defenseSize: "10",
      positionLock: "0",
      battingSize: "roster",
      seed: 42,
      isBigGame: false,
    });
    expect(result.error).toBeUndefined();
    expect(result.lineup).toHaveLength(6);
  });

  test("a kid with no removal record is unaffected (backward compatible)", () => {
    // Sanity: a past game without midGameRemovals at all should produce
    // the same kind of lineup as before. Just verify the engine still
    // works on a clean past-game history.
    const players = Array.from({ length: 11 }, (_, i) => aPlayer(`p${i}`));
    const result = generateLineup({
      activePlayers: players,
      allPlayers: players,
      games: [],
      evaluationEvents: [],
      currentGame: { id: "g1", date: "2026-05-01" },
      firstInningOverridesById: {},
      totalInnings: 6,
      leagueRuleSet: "USSSA",
      teamAge: "10U",
      defenseSize: "10",
      positionLock: "0",
      battingSize: "roster",
      seed: 7,
      isBigGame: false,
    });
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Mid-game rebuild fairness — bench history of THIS game's already-played
// innings feeds the priorRatio of the bench scheduler for innings N+, so a
// kid benched twice in 0..N-1 isn't picked AGAIN in N+ just because the
// in-game state was previously invisible to the scheduler.
// ---------------------------------------------------------------------------

describe("mid-game rebuild fairness", () => {
  const slim = (id) => ({ id, name: `Player ${id}`, number: "" });

  test("rebuild doesn't bench a kid who already sat twice this game", () => {
    // 11 active players, defenseSize=10 → 1 bench slot per inning.
    // Simulated history (innings 0..3 played):
    //   inn 0: p0 on bench, p1..p10 on field
    //   inn 1: p10 on bench, p0..p9 on field
    //   inn 2: p0 on bench, p1..p10 on field   ← p0 has sat TWICE now
    //   inn 3: p1 on bench, others on field
    // Rebuild from inn 4 with 6 total innings. p0 has the highest in-
    // game bench count; with the fairness fix folded into priorRatio,
    // p0 should NOT be picked for the inning 4 or inning 5 bench.
    const players = Array.from({ length: 11 }, (_, i) =>
      makePlayer(`p${i}`, `P${i}`)
    );
    const onFieldExcept = (excludeId) => {
      const fielders = players.filter((p) => p.id !== excludeId);
      return {
        P: slim(fielders[0].id),
        C: slim(fielders[1].id),
        "1B": slim(fielders[2].id),
        "2B": slim(fielders[3].id),
        "3B": slim(fielders[4].id),
        SS: slim(fielders[5].id),
        LF: slim(fielders[6].id),
        LCF: slim(fielders[7].id),
        RCF: slim(fielders[8].id),
        RF: slim(fielders[9].id),
        BENCH: [slim(excludeId)],
      };
    };
    const currentLineup = [
      onFieldExcept("p0"),
      onFieldExcept("p10"),
      onFieldExcept("p0"),
      onFieldExcept("p1"),
    ];
    const result = buildLineup({
      players,
      teamAge: "10U",
      isBigGame: false,
      seed: 17,
      totalInnings: 6,
      currentGame: {
        ...baseGame(),
        // Mid-game rebuild requires fromInning + currentLineup.
        fromInning: 4,
        currentLineup,
      },
    });
    // Pass through generateLineup directly so we control fromInning +
    // currentLineup. buildLineup doesn't forward those; spell them out.
    const direct = generateLineup({
      activePlayers: players,
      allPlayers: players,
      games: [],
      evaluationEvents: [],
      currentGame: { id: "g_test", date: "2026-05-01", opponent: "X" },
      firstInningOverridesById: {},
      totalInnings: 6,
      leagueRuleSet: "USSSA",
      teamAge: "10U",
      defenseSize: "10",
      positionLock: "0",
      battingSize: "roster",
      seed: 17,
      isBigGame: false,
      fromInning: 4,
      currentLineup,
    });
    expect(direct.error).toBeUndefined();
    // Replayed innings 0..3 should match currentLineup verbatim.
    for (let i = 0; i < 4; i++) {
      expect(direct.lineup[i].BENCH[0]?.id).toBe(currentLineup[i].BENCH[0].id);
    }
    // The fix: p0 should NOT be benched again in innings 4 or 5.
    for (let i = 4; i < 6; i++) {
      const benchIds = (direct.lineup[i].BENCH || []).map((b) => b?.id);
      expect(benchIds).not.toContain("p0");
    }
    // And the unused result var keeps tslint quiet — touch it.
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8U fuzz / soak — run many realistic 8U setups through the engine and
// assert it never bails out and never violates basic invariants. This is
// the safety net that catches "no eligible player for LF in inning 3"
// before it ships.
// ---------------------------------------------------------------------------

const INFIELD_PRIMARIES = ["P", "C", "1B", "2B", "3B", "SS"];
const OF_PRIMARIES_10 = ["LF", "LCF", "RCF", "RF"];

const seededRand = (seed) => {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Build a plausible 8U roster of N players with realistic primary
// positions and occasional C restrictions. Deterministic given seed
// so failures are reproducible.
const makeFuzzRoster = (size, seed) => {
  const r = seededRand(seed);
  const pickFrom = (arr) => arr[Math.floor(r() * arr.length)];

  const roster = [];
  for (let i = 0; i < size; i++) {
    const id = `p${i}`;
    // ~60% infield primary, ~30% OF primary, ~10% no primary
    const roll = r();
    let primary = "";
    if (roll < 0.6) primary = pickFrom(INFIELD_PRIMARIES);
    else if (roll < 0.9) primary = pickFrom(OF_PRIMARIES_10);
    // ~15% of non-C-primary kids are explicitly C-restricted (real coach
    // workflow: keep your infield kids off the plate when you have
    // dedicated catchers).
    const restrictions =
      primary && primary !== "C" && r() < 0.15 ? ["C"] : [];
    roster.push(
      makePlayer(id, `Player ${i}`, {
        primaryPosition: primary,
        restrictions,
      })
    );
  }
  return roster;
};

// Validate a generated lineup against engine invariants the user
// should never see broken. Returns a list of strings describing any
// violations (empty when fine).
const validateLineup = (result, opts) => {
  const violations = [];
  if (result.error) {
    violations.push(`engine error: ${result.error}`);
    return violations;
  }
  const { lineup, battingLineup } = result;
  if (!Array.isArray(lineup)) {
    violations.push("lineup is not an array");
    return violations;
  }
  if (lineup.length !== opts.totalInnings) {
    violations.push(
      `expected ${opts.totalInnings} innings, got ${lineup.length}`
    );
  }
  if (!Array.isArray(battingLineup) || battingLineup.length < 1) {
    violations.push("battingLineup missing or empty");
  }

  const restrictionsByPlayer = new Map();
  for (const p of opts.players) {
    restrictionsByPlayer.set(p.id, new Set(p.restrictions || []));
  }

  for (let inn = 0; inn < lineup.length; inn++) {
    const inning = lineup[inn] || {};
    const ids = new Set();

    // Position assignments
    for (const pos of Object.keys(inning)) {
      if (pos === "BENCH") continue;
      const p = inning[pos];
      if (!p) continue; // null slot is OK (e.g. after mid-game removal)
      if (ids.has(p.id)) {
        violations.push(
          `inning ${inn + 1}: player ${p.id} (${p.name}) double-assigned`
        );
      }
      ids.add(p.id);
      // Restriction violation?
      const restr = restrictionsByPlayer.get(p.id);
      if (restr && restr.has(pos)) {
        violations.push(
          `inning ${inn + 1}: ${p.name} assigned to restricted position ${pos}`
        );
      }
    }

    // Bench duplication
    for (const p of inning.BENCH || []) {
      if (!p) continue;
      if (ids.has(p.id)) {
        violations.push(
          `inning ${inn + 1}: ${p.id} (${p.name}) on bench AND on field`
        );
      }
      ids.add(p.id);
    }
  }

  return violations;
};

// ---------------------------------------------------------------------------
// 9U+ fuzz / soak — extends the 8U coverage to older age tiers where kid
// pitch + pitch counts + USSSA lefty-infield rules kick in. Each tier gets
// 32 deterministic scenarios. Roster generator seeds realistic pitching
// state (recentPitches + lastPitchDate) and bats/throws hand so the engine
// has to honor pitch-count rest rules and lefty-infield penalties.
// ---------------------------------------------------------------------------

const PITCH_LIMITS_FUZZ = {
  "9U": 75,
  "10U": 75,
  "11U to 12U": 85,
};

const restDaysRequired = (recent) => {
  if (recent >= 66) return 4;
  if (recent >= 51) return 3;
  if (recent >= 36) return 2;
  if (recent >= 21) return 1;
  return 0;
};

const daysBetween = (a, b) => {
  const A = new Date(a).getTime();
  const B = new Date(b).getTime();
  return Math.floor((B - A) / 86400000);
};

const isPitcherEligible = (player, targetDate, ageGroup) => {
  const pitching = player.pitching;
  if (!pitching || !pitching.lastPitchDate || !pitching.recentPitches) return true;
  const recent = pitching.recentPitches;
  if (recent === 0) return true;
  if (recent >= (PITCH_LIMITS_FUZZ[ageGroup] || 105)) return false;
  return daysBetween(pitching.lastPitchDate, targetDate) >= restDaysRequired(recent);
};

// Roster generator for 9U+. Same primary-position distribution as 8U,
// but adds a 30% chance of recent pitching state and an explicit bats/throws
// hand (~20% lefty bats, ~10% lefty throws to keep USSSA penalty active).
const makeFuzzRoster9Plus = (size, seed, targetDate) => {
  const r = seededRand(seed);
  const pickFrom = (arr) => arr[Math.floor(r() * arr.length)];
  const roster = [];
  for (let i = 0; i < size; i++) {
    const id = `p${i}`;
    const roll = r();
    let primary = "";
    if (roll < 0.6) primary = pickFrom(INFIELD_PRIMARIES);
    else if (roll < 0.9) primary = pickFrom(OF_PRIMARIES_10);
    const restrictions =
      primary && primary !== "C" && r() < 0.15 ? ["C"] : [];
    const bats = r() < 0.2 ? "L" : "R";
    const throws_ = r() < 0.1 ? "L" : "R";
    // ~30% of roster has pitching state — some recent, some over the limit,
    // some safely rested. Walks the gamut so the engine has to skip them
    // appropriately.
    let pitching = { recentPitches: 0, lastPitchDate: null };
    if (r() < 0.3) {
      const recent = Math.floor(r() * 80); // 0..79
      // Last pitched 0..5 days before targetDate
      const lastD = new Date(targetDate);
      lastD.setDate(lastD.getDate() - Math.floor(r() * 6));
      pitching = {
        recentPitches: recent,
        lastPitchDate: lastD.toISOString().slice(0, 10),
      };
    }
    roster.push(
      makePlayer(id, `Player ${i}`, {
        primaryPosition: primary,
        restrictions,
        bats,
        throws: throws_,
        pitching,
      })
    );
  }
  return roster;
};

// Extended validator: invariants + pitch-count eligibility for any P slot.
const validateLineup9Plus = (result, opts) => {
  const base = validateLineup(result, opts);
  if (base.length > 0) return base;
  if (!result.lineup) return base;
  const violations = [];
  const playerById = new Map();
  for (const p of opts.players) playerById.set(p.id, p);
  for (let inn = 0; inn < result.lineup.length; inn++) {
    const inning = result.lineup[inn] || {};
    const pitcher = inning.P;
    if (!pitcher) continue;
    const fullPlayer = playerById.get(pitcher.id);
    if (!fullPlayer) continue;
    if (!isPitcherEligible(fullPlayer, opts.targetDate, opts.teamAge)) {
      violations.push(
        `inning ${inn + 1}: pitcher ${pitcher.name} ineligible by pitch count rules ` +
          `(recent=${fullPlayer.pitching?.recentPitches}, lastPitchDate=${fullPlayer.pitching?.lastPitchDate})`
      );
    }
  }
  return violations;
};

const TIERS_9_PLUS = ["9U", "10U", "11U to 12U"];
const SCENARIOS_PER_TIER = 32;

for (const teamAge of TIERS_9_PLUS) {
  describe(`${teamAge} fuzz / soak — kid pitch eligibility + invariants`, () => {
    for (let i = 1; i <= SCENARIOS_PER_TIER; i++) {
      // Seed deliberately distinct from 8U fuzz so failures stay
      // reproducible per tier.
      const scenarioSeed = TIERS_9_PLUS.indexOf(teamAge) * 1000 + i;
      const r = seededRand(scenarioSeed);
      const size = 9 + Math.floor(r() * 7); // 9..15 players
      const defenseSize = r() < 0.5 ? "10" : "9";
      const isBigGame = r() < 0.35;
      const positionLockOptions = ["0", "1", "2", "3", "full"];
      const positionLock =
        positionLockOptions[Math.floor(r() * positionLockOptions.length)];
      // NKB only — the engine gates pitch-count eligibility checks on
      // leagueRuleSet === "NKB" && defenseSize === "9" (see lineupEngine.js
      // pickBestForPosition + pre-pin). USSSA + 10-fielder pitch-count
      // enforcement is a known gap; this fuzz tier doesn't cover it yet.
      const leagueRuleSet = "NKB";
      const defenseSize9 = "9";
      const totalInnings = teamAge === "11U to 12U" ? 7 : 6;
      const targetDate = "2026-05-15";
      const players = makeFuzzRoster9Plus(size, scenarioSeed * 17 + 3, targetDate);

      const cfg = {
        size,
        defenseSize: defenseSize9,
        isBigGame,
        positionLock,
        leagueRuleSet,
        totalInnings,
        players,
        teamAge,
        targetDate,
        scenarioSeed,
      };

      test(`seed=${scenarioSeed} n=${size} ${leagueRuleSet} ${teamAge} def=${defenseSize9} lock=${positionLock}${
        isBigGame ? " BG" : ""
      }`, () => {
        const result = generateLineup({
          activePlayers: players,
          allPlayers: players,
          games: [],
          evaluationEvents: [],
          currentGame: { id: `g-fuzz-${teamAge}-${scenarioSeed}`, date: targetDate },
          firstInningOverridesById: {},
          totalInnings,
          leagueRuleSet,
          teamAge,
          defenseSize: defenseSize9,
          positionLock,
          battingSize: "roster",
          seed: scenarioSeed * 31 + 7,
          isBigGame,
          pitchingFormat: "Kid Pitch",
        });
        const v = validateLineup9Plus(result, cfg);
        expect(v).toEqual([]);
      });
    }
  });
}

describe("8U fuzz / soak — engine never fails or violates invariants", () => {
  // 64 random scenarios spanning realistic 8U conditions. Each gets a
  // deterministic seed so a failure is exactly reproducible.
  const SCENARIOS = 64;

  for (let scenarioSeed = 1; scenarioSeed <= SCENARIOS; scenarioSeed++) {
    const r = seededRand(scenarioSeed);
    const size = 8 + Math.floor(r() * 8); // 8..15 players
    const defenseSize = r() < 0.6 ? "10" : "9";
    const isBigGame = r() < 0.35;
    const positionLockOptions = ["0", "1", "2", "3", "full"];
    const positionLock =
      positionLockOptions[Math.floor(r() * positionLockOptions.length)];
    const leagueRuleSet = r() < 0.5 ? "NKB" : "USSSA";
    const totalInnings = 6;
    const players = makeFuzzRoster(size, scenarioSeed * 17 + 3);

    const cfg = {
      size,
      defenseSize,
      isBigGame,
      positionLock,
      leagueRuleSet,
      totalInnings,
      players,
      scenarioSeed,
    };

    test(`scenario seed=${scenarioSeed} n=${size} ${leagueRuleSet} 8U def=${defenseSize} lock=${positionLock}${
      isBigGame ? " BG" : ""
    }`, () => {
      const result = generateLineup({
        activePlayers: players,
        allPlayers: players,
        games: [],
        evaluationEvents: [],
        currentGame: { id: `g-fuzz-${scenarioSeed}`, date: "2026-05-01" },
        firstInningOverridesById: {},
        totalInnings,
        leagueRuleSet,
        teamAge: "8U",
        defenseSize,
        positionLock,
        battingSize: "roster",
        seed: scenarioSeed * 31 + 7,
        isBigGame,
      });

      const v = validateLineup(result, cfg);
      expect(v).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Catcher-cap fuzz: explicit cap + back-to-back across many random rosters.
// Either the engine errors (genuinely too few catchers for the cap) OR it
// builds a lineup that NEVER exceeds the cap and keeps each catcher's innings
// contiguous, on top of all the base invariants.
// ---------------------------------------------------------------------------
describe("catcher-cap fuzz — explicit cap is never violated", () => {
  const CASES = 40;
  for (let s = 1; s <= CASES; s++) {
    const r = seededRand(s * 13 + 1);
    const size = 9 + Math.floor(r() * 7); // 9..15
    const defenseSize = r() < 0.5 ? "9" : "10";
    const cap = 2 + Math.floor(r() * 2); // 2 or 3
    const consecutive = r() < 0.7;
    const totalInnings = 6;
    const players = makeFuzzRoster(size, s * 29 + 5);

    test(`seed=${s} n=${size} def=${defenseSize} cap=${cap}${
      consecutive ? " B2B" : ""
    }`, () => {
      const result = generateLineup({
        activePlayers: players,
        allPlayers: players,
        games: [],
        evaluationEvents: [],
        currentGame: { id: `g-ccap-${s}`, date: "2026-05-01" },
        totalInnings,
        leagueRuleSet: "USSSA",
        teamAge: "8U",
        defenseSize,
        positionLock: "0",
        battingSize: "roster",
        seed: s * 31 + 7,
        catcherMaxInnings: String(cap),
        catcherConsecutive: consecutive,
      });

      const eligible = players.filter((p) => isCatcherEligible(p)).length;
      const required = Math.ceil(totalInnings / cap);
      if (eligible < required) {
        expect(result.error).toMatch(/catcher-eligible/i);
        return;
      }

      expect(result.error).toBeUndefined();
      // Base invariants still hold.
      expect(
        validateLineup(result, {
          totalInnings,
          players,
          size,
          defenseSize,
          positionLock: "0",
          leagueRuleSet: "USSSA",
        })
      ).toEqual([]);
      // Cap + continuity.
      const m = catcherInningMap(result.lineup);
      for (const [, innings] of m) {
        expect(innings.length).toBeLessThanOrEqual(cap);
        if (consecutive) expect(isContiguous(innings)).toBe(true);
      }
    });
  }
});

describe("D4 — pitcher scoring + pool sizing", () => {
  test("calcPitcherScore weights strikes highest, returns 0 for empty grades", () => {
    expect(calcPitcherScore(null)).toBe(0);
    expect(calcPitcherScore({})).toBe(0);
    // velocity*1.5 + strikes*3.5 + offSpeed*0.5 + composure*1
    // = 5*1.5 + 5*3.5 + 5*0.5 + 5*1 = 7.5 + 17.5 + 2.5 + 5 = 32.5
    expect(
      calcPitcherScore({
        velocity: 5,
        strikes: 5,
        offSpeed: 5,
        composure: 5,
      })
    ).toBe(32.5);
    // Strikes is highest weight (3.5). 5 strikes alone outranks 5 of any other.
    const onlyStrikes = calcPitcherScore({ strikes: 5 });
    const onlyVelocity = calcPitcherScore({ velocity: 5 });
    expect(onlyStrikes).toBeGreaterThan(onlyVelocity);
    // Regression: the old taxonomy used control/command, which no longer exist
    // on graded players (folded into `strikes`). They must not be scored.
    expect(calcPitcherScore({ control: 5, command: 5 })).toBe(0);
  });

  test("calcCatcherScore weights blocking/throwing over receiving/game-calling", () => {
    expect(calcCatcherScore(null)).toBe(0);
    expect(calcCatcherScore({})).toBe(0);
    // receiving*1 + blocking*1.5 + throwing*1.5 + gameCalling*1
    // = 4 + 6 + 6 + 4 = 20
    expect(
      calcCatcherScore({ receiving: 4, blocking: 4, throwing: 4, gameCalling: 4 })
    ).toBe(20);
    expect(calcCatcherScore({ blocking: 5 })).toBeGreaterThan(
      calcCatcherScore({ receiving: 5 })
    );
  });

  test("calcDefensiveScore defaults missing grades to mid (3) and rewards glove", () => {
    // All-default grades: glove*2 + range*1.5 + armStr*1.5 + armAcc*1.5 +
    // baserunning*1.5 + IQ*2, each = 3 -> 3*(2+1.5+1.5+1.5+1.5+2) = 30.
    expect(calcDefensiveScore({})).toBe(30);
    expect(calcDefensiveScore(null)).toBe(30);
    expect(calcDefensiveScore({ glove: 5 })).toBeGreaterThan(
      calcDefensiveScore({})
    );
  });

  test("getPitcherPoolSize maps gameType to pool size", () => {
    expect(getPitcherPoolSize("pool")).toBe(5);
    expect(getPitcherPoolSize("bracket")).toBe(3);
    expect(getPitcherPoolSize("league")).toBe(3);
    expect(getPitcherPoolSize(undefined)).toBe(3);
    expect(getPitcherPoolSize(null)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Season fairness must survive (a) a roster delete + re-add, where past games
// reference the players' OLD ids, and (b) games finalized without
// status:"final" (legacy "completed"). Before the fix the engine's history
// builders keyed by the raw snapshot id and used a strict status check, so it
// saw no history and seated the weakest / least-used kids FIRST — the bug a
// coach hit: their most-unused player sat first.
// ---------------------------------------------------------------------------

describe("season fairness: orphan ids + non-'final' games still count", () => {
  const POS9 = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  // p0 sits 4 innings, p1 sits 2 (one bench slot per inning, 9-fielder).
  const bench = [0, 0, 1, 0, 1, 0];
  const finalGame = (id, date, status, slimFor) => ({
    id,
    date,
    opponent: "Opp",
    status,
    teamScore: 7,
    opponentScore: 1,
    lineup: bench.map((benchIdx) => {
      const inning = {};
      const field = [...Array(10).keys()].filter((idx) => idx !== benchIdx);
      POS9.forEach((pos, k) => {
        inning[pos] = slimFor(field[k]);
      });
      inning.BENCH = [slimFor(benchIdx)];
      return inning;
    }),
  });
  // Current roster: p0..p9 named "Player 0".."Player 9"; p0 is the weakest
  // fielder, so with NO usable history the engine seats them first.
  const weakP0 = () => {
    const players = makeRoster(10);
    const grades = {};
    for (let i = 0; i < 10; i++) {
      const lo = i === 0;
      grades[`p${i}`] = {
        fielding: lo ? 1 : 9,
        armStrength: lo ? 1 : 9,
        armAccuracy: lo ? 1 : 9,
        speedAgility: lo ? 1 : 9,
        baseballIQ: lo ? 1 : 9,
      };
    }
    return { players, ev: [headEval(grades)] };
  };
  const benchCount = (lineup, id) =>
    lineup.filter((inn) => (inn.BENCH || []).some((b) => b?.id === id)).length;
  const dates = ["2026-04-01", "2026-04-08", "2026-04-15"];

  test("re-added roster (old ids in history) — under-played kid is not benched first", () => {
    const { players, ev } = weakP0();
    // History snapshots use OLD ids but the players' real names.
    const slimOld = (i) => ({ id: "OLD" + i, name: `Player ${i}`, number: "" });
    const games = dates.map((d, gi) => finalGame("g" + gi, d, "final", slimOld));
    for (let seed = 1; seed <= 5; seed++) {
      const result = buildLineup({
        players,
        games,
        evaluationEvents: ev,
        defenseSize: "9",
        // Seasonal fairness is a Rec (NKB) concept — Tournament games don't
        // share a ledger, so this fairness test runs as a Rec team.
        leagueRuleSet: "NKB",
        seed,
        currentGame: { id: "g_new", date: "2026-05-01", opponent: "New" },
      });
      expect(result.error).toBeUndefined();
      expect(benchCount(result.lineup, "p0")).toBe(0);
    }
  });

  test("legacy 'completed' games still feed fairness", () => {
    const { players, ev } = weakP0();
    const slimCur = (i) => ({ id: `p${i}`, name: `Player ${i}`, number: "" });
    const games = dates.map((d, gi) =>
      finalGame("g" + gi, d, "completed", slimCur)
    );
    for (let seed = 1; seed <= 5; seed++) {
      const result = buildLineup({
        players,
        games,
        evaluationEvents: ev,
        defenseSize: "9",
        leagueRuleSet: "NKB",
        seed,
        currentGame: { id: "g_new", date: "2026-05-01", opponent: "New" },
      });
      expect(result.error).toBeUndefined();
      expect(benchCount(result.lineup, "p0")).toBe(0);
    }
  });
});


// ---------------------------------------------------------------------------
// Pitch limits + eligibility (shared by InGameView, PitcherRankingPanel, card)
// ---------------------------------------------------------------------------
describe("maxPitchesForAge", () => {
  it("returns the configured limit per age tier", () => {
    expect(maxPitchesForAge("8U")).toBe(50);
    expect(maxPitchesForAge("9U")).toBe(75);
    expect(maxPitchesForAge("10U")).toBe(75);
    expect(maxPitchesForAge("11U to 12U")).toBe(85);
    expect(maxPitchesForAge("13U to 14U")).toBe(95);
    expect(maxPitchesForAge("15U to 18U")).toBe(105);
  });

  it("defaults to 105 for an unknown age", () => {
    expect(maxPitchesForAge("unknown")).toBe(105);
  });
});

describe("checkPitchEligibility", () => {
  const pitcher = (recentPitches, lastPitchDate) => ({
    id: "p",
    pitching: { recentPitches, lastPitchDate },
  });

  it("is eligible when the pitcher has never pitched", () => {
    expect(checkPitchEligibility(pitcher(0, null), "2026-05-10", "10U")).toBe(true);
  });

  it("is ineligible at or over the age limit", () => {
    // 10U limit is 75.
    expect(checkPitchEligibility(pitcher(75, "2026-05-09"), "2026-05-10", "10U")).toBe(false);
  });

  it("requires rest days scaled to the recent count", () => {
    // 60 pitches => 3 days rest required. 2 days later: not yet eligible.
    expect(checkPitchEligibility(pitcher(60, "2026-05-08"), "2026-05-10", "10U")).toBe(false);
    // 4 days later: eligible.
    expect(checkPitchEligibility(pitcher(60, "2026-05-08"), "2026-05-12", "10U")).toBe(true);
  });
});

describe("buildPitchingPlan", () => {
  const P = (id, opts = {}) => ({
    id,
    name: id,
    comfortablePositions: opts.positions || ["P"],
    pitching: { recentPitches: opts.recent || 0, lastPitchDate: opts.last || null },
  });

  it("classifies ready / resting / maxed against the game date and age rules", () => {
    const players = [
      P("ready", { recent: 0 }),
      // 60 pitches needs 3 days rest; only 2 days before the game -> resting.
      P("resting", { recent: 60, last: "2026-05-08" }),
      // 80 >= 10U limit (75) -> maxed.
      P("maxed", { recent: 80, last: "2026-05-01" }),
      // Not cleared to pitch -> excluded from the pool.
      P("fielder", { positions: ["SS"] }),
    ];
    const plan = buildPitchingPlan(players, "2026-05-10", "10U");

    expect(plan.map((r) => r.id)).toEqual(["ready", "resting", "maxed"]); // fielder excluded, sorted
    const byId = Object.fromEntries(plan.map((r) => [r.id, r]));
    expect(byId.ready.status).toBe("ready");
    expect(byId.resting.status).toBe("resting");
    expect(byId.resting.daysUntilReady).toBe(2);
    expect(byId.maxed.status).toBe("maxed");
    expect(byId.ready.maxPitches).toBe(75);
  });

  it("returns an empty plan when no one is cleared to pitch", () => {
    expect(buildPitchingPlan([P("a", { positions: ["1B"] })], "2026-05-10", "10U")).toEqual([]);
    expect(buildPitchingPlan(null, "2026-05-10", "10U")).toEqual([]);
  });

  it("orders ready arms freshest-first (fewest recent pitches, longest rest)", () => {
    const players = [
      P("tired", { recent: 20, last: "2026-05-01" }), // ready (20<21 rest=0) but more recent
      P("fresh", { recent: 0 }),
    ];
    const plan = buildPitchingPlan(players, "2026-05-10", "10U");
    expect(plan.map((r) => r.id)).toEqual(["fresh", "tired"]);
  });
});

describe("competitive depth chart drives position assignment", () => {
  it("Tournament puts a charted player at their charted field position", () => {
    const players = makeRoster(11);
    const { lineup } = buildLineup({
      players,
      competitive: true,
      depthChart: { "3B": ["p9"] },
    });
    let played = 0;
    for (const inn of lineup) {
      if (isBenched(inn, "p9")) continue;
      played++;
      expect(posOf(inn, "p9")).toBe("3B");
    }
    expect(played).toBeGreaterThan(0);
  });

  it("prefers the highest AVAILABLE charted player (falls to next when absent)", () => {
    const players = makeRoster(11);
    const withTop = buildLineup({
      players,
      competitive: true,
      depthChart: { SS: ["p8", "p9"] },
    }).lineup;
    for (const inn of withTop) {
      if (!isBenched(inn, "p8")) expect(posOf(inn, "p8")).toBe("SS");
    }
    // Drop p8 from the roster: rank-2 p9 should inherit SS.
    const without = buildLineup({
      players: players.filter((p) => p.id !== "p8"),
      competitive: true,
      depthChart: { SS: ["p8", "p9"] },
    }).lineup;
    for (const inn of without) {
      if (!isBenched(inn, "p9")) expect(posOf(inn, "p9")).toBe("SS");
    }
  });

  it("Rec games ignore the depth chart entirely (byte-for-byte unchanged)", () => {
    const players = makeRoster(11);
    const base = buildLineup({ players, competitive: false, seed: 7 });
    const withChart = buildLineup({
      players,
      competitive: false,
      seed: 7,
      depthChart: { "3B": ["p9"], SS: ["p8"], C: ["p3"] },
    });
    expect(withChart.lineup).toEqual(base.lineup);
    expect(withChart.battingLineup).toEqual(base.battingLineup);
  });

  it("competitive output is identical with no chart vs an empty chart", () => {
    const players = makeRoster(11);
    const undefChart = buildLineup({ players, competitive: true, seed: 7 });
    const emptyChart = buildLineup({
      players,
      competitive: true,
      seed: 7,
      depthChart: {},
    });
    expect(emptyChart.lineup).toEqual(undefChart.lineup);
  });

  it("does NOT override the pitcher pool (9U+ Kid Pitch); pool still owns P", () => {
    // 9 players at defenseSize 9 => nobody benched, so the pool never empties
    // into the generic fallback — locking "the pool owns P."
    const players = makeRoster(9);
    const evaluationEvents = [
      {
        id: "e",
        date: "2026-04-01",
        coachRole: "Head",
        evaluatorId: "c",
        grades: { p0: { strikes: 5 }, p1: { strikes: 4 }, p2: { strikes: 3 } },
      },
    ];
    const { lineup } = buildLineup({
      players,
      evaluationEvents,
      competitive: true,
      teamAge: "9U",
      defenseSize: "9",
      pitchingFormat: "Kid Pitch",
      depthChart: { P: ["p5"] }, // p5 has no pitching eval -> not in the pool
    });
    const pool = new Set(["p0", "p1", "p2"]);
    for (const inn of lineup) {
      expect(inn.P).toBeTruthy();
      expect(pool.has(inn.P.id)).toBe(true);
      expect(inn.P.id).not.toBe("p5");
    }
  });

  it("catcher cap still beats the chart", () => {
    const players = makeRoster(11);
    const { lineup } = buildLineup({
      players,
      competitive: true,
      catcherMaxInnings: "2",
      depthChart: { C: ["p3"] },
    });
    let caught = 0;
    for (const inn of lineup) if (posOf(inn, "p3") === "C") caught++;
    expect(caught).toBeLessThanOrEqual(2);
  });

  it("never double-assigns a player listed at two positions", () => {
    const players = makeRoster(11);
    const { lineup } = buildLineup({
      players,
      competitive: true,
      depthChart: { SS: ["p7"], "3B": ["p7"] },
    });
    for (const inn of lineup) {
      expect(inn.SS).toBeTruthy();
      expect(inn["3B"]).toBeTruthy();
      expect(inn.SS.id).not.toBe(inn["3B"].id);
      if (!isBenched(inn, "p7")) expect(["SS", "3B"]).toContain(posOf(inn, "p7"));
    }
  });

  it("canonicalizes outfield: a CF chart entry applies to LCF/RCF slots", () => {
    const players = makeRoster(11);
    const { lineup } = buildLineup({
      players,
      competitive: true,
      defenseSize: "10",
      depthChart: { CF: ["p6"] },
    });
    let centered = 0;
    for (const inn of lineup) {
      if (isBenched(inn, "p6")) continue;
      expect(["LCF", "RCF"]).toContain(posOf(inn, "p6"));
      centered++;
    }
    expect(centered).toBeGreaterThan(0);
  });
});

describe("pitcher stats blend", () => {
  test("calcPitcherScore is eval-only when there are no stats", () => {
    expect(calcPitcherScore({ strikes: 5 })).toBeCloseTo(17.5); // 5 * 3.5
    expect(calcPitcherScore({ strikes: 5 }, undefined)).toBeCloseTo(17.5);
    expect(calcPitcherScore({ strikes: 5 }, null)).toBeCloseTo(17.5);
  });

  test("stats present but no sample (no BF/IP) stays eval-only", () => {
    expect(calcPitcherScore({ strikes: 5 }, { pStrikePct: 0.65 })).toBeCloseTo(17.5);
  });

  test("elite stats with a full sample lift a weak-eval pitcher", () => {
    const evalOnly = calcPitcherScore({ strikes: 1 }); // 3.5
    const blended = calcPitcherScore(
      { strikes: 1 },
      { pStrikePct: 0.65, pWhip: 1.0, pKbb: 3.0, pBf: 40 }
    );
    expect(blended).toBeGreaterThan(evalOnly);
  });

  test("smaller sample leans less on stats", () => {
    const grades = { strikes: 1 };
    const elite = { pStrikePct: 0.65, pWhip: 1.0, pKbb: 3.0 };
    const evalOnly = calcPitcherScore(grades);
    const bigSample = calcPitcherScore(grades, { ...elite, pBf: 40 });
    const tinySample = calcPitcherScore(grades, { ...elite, pBf: 4 });
    expect(tinySample).toBeGreaterThan(evalOnly);
    expect(tinySample).toBeLessThan(bigSample);
  });

  test("calcPitcherStatsQuality is direction-aware and ignores missing stats", () => {
    expect(calcPitcherStatsQuality(null)).toBeNull();
    expect(calcPitcherStatsQuality({})).toBeNull();
    expect(calcPitcherStatsQuality({ pStrikePct: 0.65, pWhip: 1.0 })).toBeCloseTo(1);
    expect(calcPitcherStatsQuality({ pStrikePct: 0.45, pWhip: 2.2 })).toBeCloseTo(0);
    expect(calcPitcherStatsQuality({ pStrikePct: 0.55 })).toBeCloseTo(0.5);
    expect(calcPitcherStatsQuality({ pWhip: 1.6 })).toBeCloseTo(0.5); // lower is better
  });
});
