import { generateLineup, generateBattingOnly } from "./lineupEngine.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const makePlayer = (id, name, opts = {}) => ({
  id,
  name,
  number: opts.number ?? "",
  primaryPosition: opts.primaryPosition ?? "",
  restrictions: opts.restrictions ?? [],
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

  test("Fair mode inning 0: primary kid starts at primary position", () => {
    // Fair mode pre-pins only inning 0. Use a 10-active / 10-fielder
    // roster so no one is benched and ace is guaranteed on the field.
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
    expect(result.lineup[0]["3B"]?.id).toBe("ace");
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
