// THE back-compat test for per-team eval categories.
//
// Every other test here checks that the feature works. This one checks that it
// changed NOTHING for the ~all teams that never touch it, and that a team which
// does touch it never has its already-saved rounds restated. The contract it
// pins is written out at the top of src/utils/evalCategories.ts.
//
// The fixture below is deliberately rich and deliberately OLD: legacy grade
// keys from schema v7 (`speedBaserunning`, `fielding`, `arm`,
// `plateDiscipline`), a head round plus two assistants (so the 50/50 merge
// runs), a seeded Preseason round, a tryout round that must be ignored, a
// pitcher, a catcher, a dual-role kid, a kid with past seasons, and a kid
// nobody ever graded. The expected numbers are FROZEN LITERALS, not recomputed
// from the code under test — if any default-path math moves, this fails.

import { describe, expect, it } from "vitest";
import {
  getCombinedGrades,
  calculateTotalScore,
  totalScoreMaxFor,
  TOTAL_SCORE_MAX,
} from "../lineupEngine";
import { currentEvaluationScore100 } from "./evaluationScore";
import {
  avgUniversal,
  defaultGradesFor,
  sanitizeGrades,
  DEFAULT_GRADES,
} from "./evalScoring";
import {
  addCustomEvalCategory,
  CUSTOM_EVAL_CATEGORY_WEIGHT,
  readEvalCategoryConfig,
  renameEvalCategory,
  scoredCustomCategories,
  setEvalCategoryHidden,
  evalCategoryConfigPatch,
  type EvalCategoryConfig,
} from "./evalCategories";
import { handGradedCategoriesForTeam } from "../constants/ui";
import { evalRoundCsv } from "./evalExport";
import type { Player } from "../types";

const TEAM_AGE = "8U";
const FORMAT = "Kid Pitch";

const players: Player[] = [
  {
    id: "p1",
    name: "Ace Miller",
    number: "7",
    comfortablePositions: ["P", "SS"],
    stats: {
      ab: 34,
      avg: 0.38,
      ops: 0.95,
      obp: 0.46,
      qab: 0.55,
      ld: 0.24,
      hard: 0.31,
      doubles: 5,
      triples: 1,
      hr: 2,
      babip: 0.34,
      fFpct: 0.94,
      fTc: 30,
      pTopMph: 44,
      pBf: 60,
      pIp: 14,
      pStrikePct: 0.62,
      pFps: 0.6,
      pBbPerInn: 0.4,
      pKbb: 2.4,
      pWhip: 1.1,
      pEra: 3.1,
      pBaa: 0.22,
    },
  } as Player,
  {
    id: "p2",
    name: "Beau Nguyen",
    number: "12",
    comfortablePositions: ["C", "1B"],
    stats: {
      ab: 21,
      avg: 0.25,
      ops: 0.6,
      obp: 0.33,
      qab: 0.32,
      ld: 0.12,
      hard: 0.14,
      doubles: 2,
      babip: 0.27,
      fFpct: 0.9,
      fTc: 40,
      fCsPct: 0.35,
      fSbAtt: 14,
      fPb: 6,
    },
  } as Player,
  {
    id: "p3",
    name: "Cal Ortiz",
    number: "3",
    comfortablePositions: ["SS", "2B"],
    stats: { ab: 8, avg: 0.2, ops: 0.5, obp: 0.3, fFpct: 0.86, fTc: 12 },
    pastSeasons: [
      { season: "Fall 2025", stats: { ab: 40, avg: 0.31, ops: 0.8, obp: 0.4 } },
    ],
  } as Player,
  {
    id: "p4",
    name: "Dex Park",
    number: "21",
    comfortablePositions: ["P", "C"],
    stats: { ab: 12, avg: 0.28, ops: 0.7, obp: 0.36, pTopMph: 38, pBf: 12 },
  } as Player,
  {
    id: "p5",
    name: "Eli Ross",
    number: "9",
    comfortablePositions: [],
  } as Player,
];

// Rounds newest-first, exactly as the evalRounds subscription assembles them.
const evaluationEvents = [
  {
    id: "r-head-2026",
    date: "2026-02-01",
    createdAt: 1770000000000,
    coachRole: "Head",
    evaluatorId: "head-uid",
    evaluatorName: "Rash",
    grades: {
      p1: {
        approach: 5,
        speed: 4,
        baserunning: 4,
        baseballIQ: 5,
        coachability: 5,
        composure: 4,
        pitchVelo: 44,
        power: 4,
        glove: 4,
        armStrength: 5,
        armAccuracy: 4,
        notes: "Best arm on the team.",
        suggestedPositions: ["P", "SS"],
      },
      p2: {
        approach: 3,
        speed: 2,
        baserunning: 3,
        baseballIQ: 4,
        coachability: 5,
        composure: 4,
        blocking: 4,
        receiving: 3,
      },
      p3: {
        approach: 3,
        speed: 4,
        baserunning: 4,
        baseballIQ: 3,
        coachability: 4,
        composure: 3,
      },
      p4: {
        approach: 2,
        speed: 3,
        baserunning: 2,
        baseballIQ: 3,
        coachability: 3,
        composure: 2,
        blocking: 3,
        receiving: 2,
        pitchVelo: 38,
      },
    },
  },
  {
    id: "r-ast-b",
    date: "2026-02-02",
    createdAt: 1770100000000,
    coachRole: "Assistant",
    evaluatorId: "ast-b",
    evaluatorName: "Diaz",
    grades: {
      p1: {
        approach: 4,
        speed: 5,
        baserunning: 4,
        baseballIQ: 4,
        coachability: 5,
      },
      p3: {
        approach: 4,
        speed: 3,
        baserunning: 3,
        baseballIQ: 4,
        coachability: 4,
      },
    },
  },
  {
    id: "r-ast-a",
    date: "2026-02-01",
    createdAt: 1770000500000,
    coachRole: "Assistant",
    evaluatorId: "ast-a",
    evaluatorName: "Kim",
    grades: {
      p1: {
        approach: 5,
        speed: 4,
        baserunning: 5,
        baseballIQ: 5,
        coachability: 4,
      },
      p2: {
        approach: 2,
        speed: 2,
        baserunning: 2,
        baseballIQ: 3,
        coachability: 4,
      },
    },
  },
  {
    id: "r-preseason",
    date: "2026-01-05",
    createdAt: 1769000000000,
    coachRole: "Head",
    evaluatorId: "head-uid",
    evaluatorName: "Preseason",
    label: "Preseason",
    seededFromAdvance: true,
    grades: {
      p1: {
        approach: 4,
        speed: 4,
        baserunning: 3,
        baseballIQ: 4,
        coachability: 5,
      },
      p2: {
        approach: 3,
        speed: 2,
        baserunning: 3,
        baseballIQ: 3,
        coachability: 4,
      },
    },
  },
  {
    // Schema-v7-era round: merged/legacy keys only. The readers' fallbacks are
    // what keep it scoring, and they must keep working forever.
    id: "r-legacy-2025",
    date: "2025-03-01",
    createdAt: 1740000000000,
    coachRole: "Head",
    evaluatorId: "head-uid",
    grades: {
      p1: {
        approach: 4,
        speedBaserunning: 4,
        fielding: 4,
        arm: 5,
        plateDiscipline: 3,
        baseballIQ: 4,
        coachability: 4,
      },
      p3: {
        approach: 2,
        speedBaserunning: 3,
        fielding: 3,
        arm: 2,
        baseballIQ: 2,
        coachability: 3,
      },
    },
  },
  {
    // A tryout round — every roster aggregation must skip it.
    id: "r-tryout",
    date: "2025-11-01",
    createdAt: 1735000000000,
    coachRole: "Head",
    evaluatorId: "head-uid",
    tryoutSignupId: "sig-1",
    grades: { p1: { approach: 5, speed: 5 } },
  },
] as never[];

// The historical half of the aggregate — the numbers that describe rounds
// ALREADY SAVED. Copy-forward (`sanitized`) is deliberately excluded: it seeds
// the NEXT round, so a hide is supposed to change it.
const historyOnly = (agg: ReturnType<typeof aggregateNumbers>) => ({
  combined: agg.combined,
  perRoundScores: agg.perRoundScores,
  totals: agg.totals,
  perRoundAverages: agg.perRoundAverages,
});

const team = {
  players,
  teamAge: TEAM_AGE,
  pitchingFormat: FORMAT,
  evaluationEvents,
};

// Every number the eval surfaces put in front of a coach, in one object.
// Deliberately NOT including the new-round seed — hiding a category is
// supposed to change that, and only that.
const aggregateNumbers = (config?: EvalCategoryConfig) => {
  const extra = scoredCustomCategories(config);
  const combined = getCombinedGrades(evaluationEvents, players, {
    teamAge: TEAM_AGE,
    extraCategories: extra,
  });
  return {
    // The merged head+assistant grade map behind depth charts and rankings.
    combined,
    // Per-round score for every player — the trend/roster-decision series.
    perRoundScores: evaluationEvents.map((round: any) =>
      players.map((p) =>
        currentEvaluationScore100(
          round.grades?.[p.id],
          p,
          TEAM_AGE,
          null,
          extra,
        ),
      ),
    ),
    // Engine total off the merged map.
    totals: players.map((p) =>
      calculateTotalScore(combined[p.id], p.stats, extra),
    ),
    // Round-over-round comparison averages.
    perRoundAverages: evaluationEvents.map((round: any) =>
      players.map((p) => avgUniversal(round.grades?.[p.id], config)),
    ),
    // What "copy from last round" would carry forward for the graded kids.
    sanitized: players.map((p) =>
      sanitizeGrades((evaluationEvents[0] as any).grades?.[p.id], config),
    ),
  };
};

// ---------------------------------------------------------------------------
// The frozen expectation. Regenerate ONLY with a deliberate, explained
// behavior change — this literal is the record of what every existing team's
// evaluations already look like.
// ---------------------------------------------------------------------------
const LEGACY_AGGREGATE = {
  combined: {
    p1: {
      approach: 5,
      speed: 4,
      baserunning: 4,
      baseballIQ: 5,
      coachability: 5,
      composure: 4,
      blocking: 3,
      receiving: 3,
      pitchVelo: 44,
      power: 4,
      glove: 4.1,
      armStrength: 3.8,
      armAccuracy: 3.8,
      contact: 4.2,
      fielding: 4.1,
      range: 4.1,
      arm: 3.8,
      velocity: 3.8,
      strikes: 4.3,
    },
    p2: {
      approach: 3,
      speed: 2,
      baserunning: 3,
      baseballIQ: 4,
      coachability: 5,
      composure: 4,
      blocking: 4,
      receiving: 3,
      contact: 2.4,
      power: 2.2,
      fielding: 3.2,
      glove: 3.2,
      range: 3.2,
      arm: 3,
      armStrength: 3,
      armAccuracy: 3,
      throwing: 3,
    },
    p3: {
      approach: 4,
      speed: 4,
      baserunning: 4,
      baseballIQ: 4,
      coachability: 4,
      composure: 3,
      blocking: 3,
      receiving: 3,
      contact: 2.8,
      power: 2.3,
      fielding: 2.7,
      glove: 2.7,
      range: 2.7,
    },
    p4: {
      approach: 2,
      speed: 3,
      baserunning: 2,
      baseballIQ: 3,
      coachability: 3,
      composure: 2,
      blocking: 3,
      receiving: 2,
      pitchVelo: 38,
      contact: 2.9,
      power: 2.5,
      arm: 2.6,
      armStrength: 2.6,
      armAccuracy: 2.6,
      velocity: 2.6,
    },
    p5: {
      approach: 3,
      speed: 3,
      baserunning: 3,
      baseballIQ: 3,
      coachability: 3,
    },
  },
  perRoundScores: [
    [87, 63, 55, 46, null],
    [78, null, 57, null, null],
    [79, 50, null, null, null],
    [77, 53, null, null, null],
    [82, null, 46, null, null],
    [74, null, null, null, null],
  ],
  totals: [87, 62, 59, 50, 58],
  perRoundAverages: [
    [4.4, 3.5, 3.5, 2.5, null],
    [4.4, null, 3.6, null, null],
    [4.6, 2.6, null, null, null],
    [4, 3, null, null, null],
    [4, null, 2.3333333333333335, null, null],
    [5, null, null, null, null],
  ],
  sanitized: [
    {
      approach: 5,
      power: 4,
      glove: 4,
      armStrength: 5,
      armAccuracy: 4,
      speed: 4,
      baserunning: 4,
      baseballIQ: 5,
      coachability: 5,
      composure: 4,
      blocking: 3,
      receiving: 3,
      // The radar reading survives sanitize verbatim. This literal used to
      // read 5: pitchVelo is an mph MEASUREMENT, not a 1-5 grade, and the
      // clamp rewrote it — so Copy From Last Round destroyed the reading and
      // moved the kid's velocity score with it. The frozen aggregate had
      // encoded that bug; the byte-identical contract covers CATEGORY CONFIG
      // never moving a number, not preserving a data-corruption defect.
      pitchVelo: 44,
      notes: "Best arm on the team.",
    },
    {
      approach: 3,
      power: 3,
      glove: 3,
      armStrength: 3,
      armAccuracy: 3,
      speed: 2,
      baserunning: 3,
      baseballIQ: 4,
      coachability: 5,
      composure: 4,
      blocking: 4,
      receiving: 3,
    },
    {
      approach: 3,
      power: 3,
      glove: 3,
      armStrength: 3,
      armAccuracy: 3,
      speed: 4,
      baserunning: 4,
      baseballIQ: 3,
      coachability: 4,
      composure: 3,
      blocking: 3,
      receiving: 3,
    },
    {
      approach: 2,
      power: 3,
      glove: 3,
      armStrength: 3,
      armAccuracy: 3,
      speed: 3,
      baserunning: 2,
      baseballIQ: 3,
      coachability: 3,
      composure: 2,
      blocking: 3,
      receiving: 2,
      // Same correction as above — the second graded pitcher's real reading.
      pitchVelo: 38,
    },
    {
      approach: 3,
      power: 3,
      glove: 3,
      armStrength: 3,
      armAccuracy: 3,
      speed: 3,
      baserunning: 3,
      baseballIQ: 3,
      coachability: 3,
      composure: 3,
      blocking: 3,
      receiving: 3,
    },
  ],
};

describe("back-compat: an UNCONFIGURED team is byte-identical", () => {
  it("resolves no config at all off the team doc", () => {
    expect(readEvalCategoryConfig(team)).toBeUndefined();
  });

  it("produces the frozen aggregate for a rich legacy fixture", () => {
    expect(aggregateNumbers(undefined)).toStrictEqual(LEGACY_AGGREGATE);
  });

  it("produces the SAME aggregate for an empty stored config", () => {
    // A team that added a category and then removed it lands here.
    const emptied = readEvalCategoryConfig({
      evalCategoryOverrides: {},
      evalCustomCategories: [],
    });
    expect(aggregateNumbers(emptied)).toStrictEqual(LEGACY_AGGREGATE);
  });

  it("seeds a new round exactly as before", () => {
    expect(defaultGradesFor(undefined)).toBe(DEFAULT_GRADES);
  });
});

describe("back-compat: renaming never moves a number", () => {
  const renamed = renameEvalCategory(
    renameEvalCategory(undefined, "coachability", "Buy-In"),
    "approach",
    "At Bats",
  );

  it("keeps every aggregate identical", () => {
    expect(aggregateNumbers(renamed)).toStrictEqual(LEGACY_AGGREGATE);
  });

  it("keeps the new-round seed identical", () => {
    expect(defaultGradesFor(renamed)).toEqual(DEFAULT_GRADES);
  });

  it("only changes the label a coach reads", () => {
    const cats = handGradedCategoriesForTeam(FORMAT, renamed);
    expect(cats.find((c) => c.id === "coachability")!.label).toBe("Buy-In");
    expect(cats.map((c) => c.id)).toEqual(
      handGradedCategoriesForTeam(FORMAT).map((c) => c.id),
    );
  });
});

describe("back-compat: hiding is forward-only", () => {
  const hidden = setEvalCategoryHidden(undefined, "composure", true);

  it("leaves every historical aggregate untouched", () => {
    // Composure is still SCORED wherever a round recorded it — hiding stops
    // new grading, it does not retroactively delete a season of grades.
    expect(historyOnly(aggregateNumbers(hidden))).toStrictEqual(
      historyOnly(LEGACY_AGGREGATE),
    );
  });

  it("drops the category from NEW rounds only", () => {
    const seed = defaultGradesFor(hidden);
    expect(seed.composure).toBeUndefined();
    expect(DEFAULT_GRADES.composure).toBe(3);
    // Copy-forward is the ONE thing a hide changes: an ungraded kid stops
    // carrying the category into the next round…
    expect(
      aggregateNumbers(hidden).sanitized.map((g: any) => g.composure),
    ).toEqual([4, 4, 3, 2, undefined]);
    expect(LEGACY_AGGREGATE.sanitized.map((g: any) => g.composure)).toEqual([
      4, 4, 3, 2, 3,
    ]);
    // …while a historical record carrying it keeps its value on copy-forward.
    expect(
      sanitizeGrades({ composure: 5, approach: 4 }, hidden).composure,
    ).toBe(5);
  });

  it("keeps the category on history surfaces and out of the grading list", () => {
    expect(
      handGradedCategoriesForTeam(FORMAT, hidden).map((c) => c.id),
    ).not.toContain("composure");
    expect(
      handGradedCategoriesForTeam(FORMAT, hidden, {
        includeHidden: true,
      }).map((c) => c.id),
    ).toContain("composure");
  });

  it("still renders a hidden category's historical grades in the export", () => {
    const csv = evalRoundCsv(
      evaluationEvents[0] as never,
      players,
      handGradedCategoriesForTeam(FORMAT, hidden, { includeHidden: true }),
    );
    expect(csv.split("\n")[0]).toContain("Composure");
    // Ace's composure 4 from the head round is still in his row.
    expect(csv.split("\n")[1]).toContain("Ace Miller");
  });
});

describe("adding a category never restates a saved round", () => {
  const added = addCustomEvalCategory(undefined, {
    label: "Bunting",
    group: "Hitting",
  });

  it("leaves every already-saved round's score exactly where it was", () => {
    // No legacy round carries `custom_bunting`, so it lands on neither side of
    // the score fraction. This is the whole promise of the feature.
    expect(aggregateNumbers(added).perRoundScores).toStrictEqual(
      LEGACY_AGGREGATE.perRoundScores,
    );
    expect(aggregateNumbers(added).perRoundAverages).toStrictEqual(
      LEGACY_AGGREGATE.perRoundAverages,
    );
  });

  it("counts the category once a round actually grades it", () => {
    const extra = scoredCustomCategories(added);
    const graded = { ...(evaluationEvents[0] as any).grades.p1 };
    const before = currentEvaluationScore100(graded, players[0], TEAM_AGE);
    const weak = currentEvaluationScore100(
      { ...graded, custom_bunting: 1 },
      players[0],
      TEAM_AGE,
      null,
      extra,
    );
    const strong = currentEvaluationScore100(
      { ...graded, custom_bunting: 5 },
      players[0],
      TEAM_AGE,
      null,
      extra,
    );
    expect(weak!).toBeLessThan(before!);
    expect(strong!).toBeGreaterThan(before!);
  });

  it("keeps a custom grade through copy-from-last-round", () => {
    const record = { approach: 4, custom_bunting: 5 };
    expect(sanitizeGrades(record, added).custom_bunting).toBe(5);
    // Without the config the clamp loop wouldn't know the id and would drop it.
    expect(sanitizeGrades(record).custom_bunting).toBeUndefined();
  });

  it("widens the score denominator by exactly the category's weight", () => {
    const extra = scoredCustomCategories(added);
    const graded = { ...(evaluationEvents[0] as any).grades.p1 };
    // TOTAL_SCORE_MAX (105) + 5 × the fixed custom weight (1.5) = 112.5.
    expect(totalScoreMaxFor(graded, extra)).toBe(TOTAL_SCORE_MAX);
    expect(totalScoreMaxFor({ ...graded, custom_bunting: 3 }, extra)).toBe(
      TOTAL_SCORE_MAX + 5 * CUSTOM_EVAL_CATEGORY_WEIGHT,
    );
    // Frozen: a top grade on the added category moves Ace 87 → 88.
    expect(
      currentEvaluationScore100(
        { ...graded, custom_bunting: 5 },
        players[0],
        TEAM_AGE,
        null,
        extra,
      ),
    ).toBe(88);
  });

  it("carries the category through the head+assistant merge", () => {
    // Without extraCategories the merge's fixed id list would silently drop it.
    const rounds = [
      {
        id: "h",
        date: "2026-03-01",
        createdAt: 3,
        coachRole: "Head",
        evaluatorId: "head-uid",
        grades: { p1: { approach: 4, custom_bunting: 5 } },
      },
      {
        id: "a",
        date: "2026-03-01",
        createdAt: 2,
        coachRole: "Assistant",
        evaluatorId: "ast-a",
        grades: { p1: { approach: 4, custom_bunting: 3 } },
      },
    ] as never[];
    const merged = getCombinedGrades(rounds, [players[0]], {
      teamAge: TEAM_AGE,
      extraCategories: scoredCustomCategories(added),
    });
    expect(merged.p1.custom_bunting).toBe(4); // 50/50 head+assistant
    const dropped = getCombinedGrades(rounds, [players[0]], {
      teamAge: TEAM_AGE,
    });
    expect(dropped.p1.custom_bunting).toBeUndefined();
  });

  it("puts the category in the export grid", () => {
    const round = {
      date: "2026-03-01",
      grades: { p1: { approach: 4, custom_bunting: 5 } },
    };
    const csv = evalRoundCsv(
      round,
      [players[0]],
      handGradedCategoriesForTeam(FORMAT, added),
    );
    expect(csv.split("\n")[0]).toContain("Bunting");
    expect(csv.split("\n")[1]).toContain(",5,");
  });

  it("survives a round-trip through the team doc", () => {
    const stored = { ...team, ...evalCategoryConfigPatch(added) };
    expect(readEvalCategoryConfig(stored)).toEqual({
      overrides: {},
      custom: added.custom,
    });
  });
});
