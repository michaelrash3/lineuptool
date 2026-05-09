import { generateLineup } from "./lineupEngine.js";

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

  test("a kid with primaryPosition set to non-C is a last-resort catcher", () => {
    // Reproduces the "primary-3B kid catches innings 0-1 and doesn't return
    // to 3B until later" report: without this rule, the catcher pre-pin's
    // tier-2 defScore tiebreaker pulls the strong 3B-primary kid behind
    // the plate before the primary pre-pin pass downstream can claim him
    // for 3B. Across many seeds and with the strong defender having no
    // C restriction, the bug surfaces deterministically. After the
    // three-tier sort, primary-non-C kids are last-resort and the bug
    // goes away as long as another eligible kid exists.
    const players = [
      makePlayer("ace", "Ace", { primaryPosition: "3B" }),
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

    // Sweep seeds — across 50 generations the ace should never catch
    // (a tier-2 / tier-3 kid is always available).
    const violations = [];
    for (let seed = 1; seed <= 50; seed++) {
      const result = buildLineup({
        players,
        evaluationEvents: [headEval(grades)],
        teamAge: "10U",
        isBigGame: true,
        seed,
      });
      if (result.error) continue;
      const acePositions = positionsOf(result.lineup, "ace");
      const wrong = acePositions
        .map((p, idx) => ({ idx, pos: p }))
        .filter(({ pos }) => pos !== null && pos !== "3B");
      if (wrong.length > 0) violations.push({ seed, wrong });
    }
    expect(violations).toEqual([]);
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
