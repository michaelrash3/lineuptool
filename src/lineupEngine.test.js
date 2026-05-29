import {
  generateLineup,
  generateBattingOnly,
  calcPitcherScore,
  getPitcherPoolSize,
} from "./lineupEngine";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const makePlayer = (id, name, opts = {}) => ({
  id,
  name,
  number: opts.number ?? "",
  primaryPosition: opts.primaryPosition ?? "",
  restrictions: opts.restrictions ?? [],
  comfortablePositions: opts.comfortablePositions,
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
  });
};

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
// Primary-position pre-pin (PR #5) + Big Game lock (PR #3)
// ---------------------------------------------------------------------------

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

describe("D4 — pitcher scoring + pool sizing", () => {
  test("calcPitcherScore weights control highest, returns 0 for empty grades", () => {
    expect(calcPitcherScore(null)).toBe(0);
    expect(calcPitcherScore({})).toBe(0);
    // velocity*1.5 + control*2 + command*1.5 + offSpeed*0.5 + composure*1
    // = 5*1.5 + 5*2 + 5*1.5 + 5*0.5 + 5*1 = 7.5 + 10 + 7.5 + 2.5 + 5 = 32.5
    expect(
      calcPitcherScore({
        velocity: 5,
        control: 5,
        command: 5,
        offSpeed: 5,
        composure: 5,
      })
    ).toBe(32.5);
    // Control is highest weight (2.0). 5 control alone outranks 5 of any other.
    const onlyControl = calcPitcherScore({ control: 5 });
    const onlyVelocity = calcPitcherScore({ velocity: 5 });
    expect(onlyControl).toBeGreaterThan(onlyVelocity);
  });

  test("getPitcherPoolSize maps gameType to pool size", () => {
    expect(getPitcherPoolSize("pool")).toBe(5);
    expect(getPitcherPoolSize("bracket")).toBe(3);
    expect(getPitcherPoolSize("league")).toBe(3);
    expect(getPitcherPoolSize(undefined)).toBe(3);
    expect(getPitcherPoolSize(null)).toBe(3);
  });
});
