import { describe, it, expect, vi } from "vitest";
import {
  computeDevelopmentTrends,
  buildPlayerSeasonSummaries,
} from "./playerDevelopment";
import type {
  EvaluationEvent,
  Game,
  Player,
  PlayerStats,
  Practice,
} from "../types";

// The real score model (lineupEngine buckets + pitcher/catcher expansion) has
// its own tests; here we need exact per-round numbers to hit the ±4 delta
// boundaries, so each round's score is read straight off a `score` grade key.
vi.mock("./evaluationScore", () => ({
  currentEvaluationScore100: (
    grades: { score?: unknown } | null | undefined,
  ): number | null => (typeof grades?.score === "number" ? grades.score : null),
}));

const player = (
  id: string,
  name: string,
  extra: Partial<Player> = {},
): Player => ({
  id,
  name,
  ...extra,
});

const finalGame = (
  id: string,
  date: string,
  playerStats?: Record<string, PlayerStats>,
  extra: Partial<Game> = {},
): Game => ({
  id,
  date,
  opponent: "Opp",
  status: "final",
  teamScore: 1,
  opponentScore: 0,
  playerStats,
  ...extra,
});

// One finalized game per line for p1, chronological.
const lineGames = (lines: PlayerStats[], pid = "p1"): Game[] =>
  lines.map((line, i) =>
    finalGame(`g${i + 1}`, `2026-04-${String(i + 1).padStart(2, "0")}`, {
      [pid]: line,
    }),
  );

const round = (
  id: string,
  date: string,
  grades: EvaluationEvent["grades"],
  extra: Partial<EvaluationEvent> = {},
): EvaluationEvent => ({ id, date, grades, ...extra });

const trendsFor = (
  players: Player[],
  games: Game[] = [],
  evaluationEvents: EvaluationEvent[] = [],
) => computeDevelopmentTrends({ players, games, evaluationEvents });

const soloTrend = (
  games: Game[] = [],
  evaluationEvents: EvaluationEvent[] = [],
) => trendsFor([player("p1", "Ava")], games, evaluationEvents)[0];

describe("batting trend", () => {
  it("is insufficient with only 3 game lines even when AB is plentiful", () => {
    const t = soloTrend(
      lineGames([
        { ab: 4, h: 2 },
        { ab: 4, h: 2 },
        { ab: 4, h: 2 },
      ]),
    );
    expect(t.batting).toEqual({ class: "insufficient", basis: null });
  });

  it("is insufficient with 4 games when a half has under 10 trips to the plate", () => {
    const t = soloTrend(
      lineGames([
        { pa: 4, ab: 4, h: 2, bb: 0 },
        { pa: 4, ab: 4, h: 2, bb: 0 },
        { pa: 4, ab: 4, h: 2, bb: 0 },
        { pa: 4, ab: 4, h: 2, bb: 0 },
      ]),
    );
    expect(t.batting).toEqual({ class: "insufficient", basis: null });
  });

  it("ignores scrimmage lines (dropping the sample below the minimum)", () => {
    const games = lineGames([
      { ab: 4, h: 2 },
      { ab: 4, h: 2 },
      { ab: 4, h: 2 },
    ]);
    games.push(
      finalGame(
        "scrim",
        "2026-04-09",
        { p1: { ab: 4, h: 2 } },
        {
          isScrimmage: true,
        },
      ),
    );
    expect(soloTrend(games).batting.class).toBe("insufficient");
  });

  it("counts a kid who walks their way on base more as improving, though their average didn't move", () => {
    // First half: 4 hits in 12 trips (.333 on-base, .333 average). Second
    // half: 2 hits in 6 at-bats plus 6 walks, so on base 8 of 12 (.667) and
    // still a .333 average. The old batting-average rule called this steady.
    const t = soloTrend(
      lineGames([
        { pa: 6, ab: 6, h: 2, bb: 0 },
        { pa: 6, ab: 6, h: 2, bb: 0 },
        { pa: 6, ab: 3, h: 1, bb: 3 },
        { pa: 6, ab: 3, h: 1, bb: 3 },
      ]),
    );
    expect(t.batting.class).toBe("improving");
    expect(t.batting.basis).toBe("obp");
    expect(t.batting.earlier).toBeCloseTo(1 / 3, 10);
    expect(t.batting.recent).toBeCloseTo(2 / 3, 10);
    expect(t.batting.delta).toBeCloseTo(1 / 3, 10);
    // Running season on-base after each game.
    expect(t.batting.series).toEqual([2 / 6, 4 / 12, 8 / 18, 12 / 24]);
  });

  it("calls the same games in reverse declining", () => {
    const t = soloTrend(
      lineGames([
        { pa: 6, ab: 3, h: 1, bb: 3 },
        { pa: 6, ab: 3, h: 1, bb: 3 },
        { pa: 6, ab: 6, h: 2, bb: 0 },
        { pa: 6, ab: 6, h: 2, bb: 0 },
      ]),
    );
    expect(t.batting.class).toBe("declining");
    expect(t.batting.delta).toBeCloseTo(-1 / 3, 10);
  });

  it("calls a move inside the usual luck swing steady", () => {
    // .333 → .500 on 12 trips a side: about what luck alone does (the swing
    // here is ~.201), so it isn't a trend yet.
    const t = soloTrend(
      lineGames([
        { pa: 6, ab: 6, h: 2, bb: 0 },
        { pa: 6, ab: 6, h: 2, bb: 0 },
        { pa: 6, ab: 6, h: 3, bb: 0 },
        { pa: 6, ab: 6, h: 3, bb: 0 },
      ]),
    );
    expect(t.batting.class).toBe("steady");
    expect(t.batting.delta).toBeCloseTo(1 / 6, 10);
    expect(t.batting.threshold).toBeCloseTo(0.2013, 3);
  });

  it("needs at least a .050 move however big the sample", () => {
    // 400 trips a side shrinks the luck swing to ~.033; the .050 floor holds.
    const half = (on: number) => [
      { pa: 200, ab: 200, h: on, bb: 0 },
      { pa: 200, ab: 200, h: on, bb: 0 },
    ];
    const up6 = soloTrend(lineGames([...half(60), ...half(72)]));
    expect(up6.batting.threshold).toBeCloseTo(0.05, 10);
    expect(up6.batting.class).toBe("improving"); // .300 → .360
    const up4 = soloTrend(lineGames([...half(60), ...half(68)]));
    expect(up4.batting.class).toBe("steady"); // .300 → .340
  });

  it("uses GameChanger's OBP on lines imported before walks were read", () => {
    const t = soloTrend(
      lineGames([
        { pa: 6, ab: 5, h: 1, obp: 1 / 3 },
        { pa: 6, ab: 5, h: 1, obp: 1 / 3 },
        { pa: 6, ab: 3, h: 2, bb: 3 },
        { pa: 6, ab: 3, h: 2, bb: 3 },
      ]),
    );
    expect(t.batting.basis).toBe("obp");
    expect(t.batting.earlier).toBeCloseTo(1 / 3, 10);
    expect(t.batting.recent).toBeCloseTo(5 / 6, 10);
    expect(t.batting.class).toBe("improving");
  });

  it("falls back to batting average when the lines can't say how often the kid got on", () => {
    const t = soloTrend(
      lineGames([
        { ab: 6, h: 1 },
        { ab: 6, h: 1 },
        { ab: 6, h: 5 },
        { ab: 6, h: 5 },
      ]),
    );
    expect(t.batting.basis).toBe("avg");
    expect(t.batting.class).toBe("improving");
    expect(t.batting.delta).toBeCloseTo(8 / 12, 10);
  });

  it("falls back to QAB% when there's no on-base or average to compare", () => {
    const t = soloTrend(
      lineGames([
        { pa: 6, qab: 0.2 },
        { pa: 6, qab: 0.2 },
        { pa: 6, qab: 0.8 },
        { pa: 6, qab: 0.8 },
      ]),
    );
    expect(t.batting.basis).toBe("qab");
    expect(t.batting.class).toBe("improving");
    expect(t.batting.delta).toBeCloseTo(0.6, 10);
  });
});

describe("eval trend", () => {
  it("is insufficient with a single scored round", () => {
    const t = soloTrend([], [round("r1", "2026-04-01", { p1: { score: 50 } })]);
    expect(t.evals.class).toBe("insufficient");
    expect(t.evals.rounds).toBe(1);
    expect(t.evals.delta).toBeUndefined();
  });

  it("treats a delta of exactly +4 as improving", () => {
    const t = soloTrend(
      [],
      [
        round("r1", "2026-04-01", { p1: { score: 50 } }),
        round("r2", "2026-05-01", { p1: { score: 54 } }),
      ],
    );
    expect(t.evals.class).toBe("improving");
    expect(t.evals).toMatchObject({
      delta: 4,
      first: 50,
      last: 54,
      rounds: 2,
      series: [50, 54],
    });
  });

  it("treats a delta of +3 as steady", () => {
    const t = soloTrend(
      [],
      [
        round("r1", "2026-04-01", { p1: { score: 50 } }),
        round("r2", "2026-05-01", { p1: { score: 53 } }),
      ],
    );
    expect(t.evals.class).toBe("steady");
  });

  it("treats a delta of exactly -4 as declining", () => {
    const t = soloTrend(
      [],
      [
        round("r1", "2026-04-01", { p1: { score: 54 } }),
        round("r2", "2026-05-01", { p1: { score: 50 } }),
      ],
    );
    expect(t.evals.class).toBe("declining");
    expect(t.evals.delta).toBe(-4);
  });

  it("orders rounds by date then createdAt, skipping tryout and unscored rounds", () => {
    const t = soloTrend(
      [],
      [
        // Same date: createdAt breaks the tie, so 60 is the LAST score.
        round("r3", "2026-05-01", { p1: { score: 60 } }, { createdAt: 2 }),
        round("r2", "2026-05-01", { p1: { score: 40 } }, { createdAt: 1 }),
        round("r1", "2026-04-01", { p1: { score: 50 } }),
        // Tryout round: excluded outright.
        round(
          "rt",
          "2026-06-01",
          { p1: { score: 99 } },
          { tryoutSignupId: "signup1" },
        ),
        // Graded someone else: not a round for p1.
        round("rx", "2026-06-02", { p2: { score: 99 } }),
        // Graded p1 but yields no score: dropped.
        round("rn", "2026-06-03", { p1: { approach: 3 } }),
      ],
    );
    expect(t.evals.series).toEqual([50, 40, 60]);
    expect(t.evals.rounds).toBe(3);
    expect(t.evals.first).toBe(50);
    expect(t.evals.last).toBe(60);
    expect(t.evals.class).toBe("improving");
  });
});

describe("position trend", () => {
  it("is insufficient below 4 game lines", () => {
    const t = soloTrend(
      lineGames([{ fInnSS: 3 }, { fInnSS: 3 }, { fInnSS: 3 }]),
    );
    expect(t.positions).toEqual({
      class: "insufficient",
      firstHalfDistinct: 0,
      secondHalfDistinct: 0,
    });
  });

  it("classifies a widening second half as improving (even split)", () => {
    const t = soloTrend(
      lineGames([
        { fInnSS: 3 },
        { fInnSS: 3 },
        { fInnSS: 2, fInnLF: 1 },
        { fInnLF: 3 },
      ]),
    );
    expect(t.positions.class).toBe("improving");
    expect(t.positions.firstHalfDistinct).toBe(1);
    expect(t.positions.secondHalfDistinct).toBe(2);
    expect(t.positions.delta).toBe(1);
  });

  it("gives the extra game to the FIRST half on an odd count", () => {
    // 5 lines → halves of 3 + 2. The lone 2B game is #3, so it must land in
    // the first half (2 distinct) leaving the second half at 1 → declining.
    const t = soloTrend(
      lineGames([
        { fInnSS: 3 },
        { fInnSS: 3 },
        { fInnSS: 2, fInn2B: 1 },
        { fInnSS: 3 },
        { fInnSS: 3 },
      ]),
    );
    expect(t.positions.class).toBe("declining");
    expect(t.positions.firstHalfDistinct).toBe(2);
    expect(t.positions.secondHalfDistinct).toBe(1);
  });

  it("is steady when both halves show the same variety", () => {
    const t = soloTrend(
      lineGames([{ fInnSS: 3 }, { fInnSS: 3 }, { fInnSS: 3 }, { fInnSS: 3 }]),
    );
    expect(t.positions.class).toBe("steady");
  });
});

describe("overall vote and roster handling", () => {
  it("improving + declining + steady signals net out to steady", () => {
    // Batting improving (on-base .167 → .750), evals declining (-10),
    // positions steady (same lone position in both halves).
    const t = soloTrend(
      lineGames([
        { pa: 6, ab: 6, h: 1, bb: 0, fInnSS: 3 },
        { pa: 6, ab: 6, h: 1, bb: 0, fInnSS: 3 },
        { pa: 6, ab: 6, h: 4, bb: 0, fInnSS: 3 },
        { pa: 6, ab: 6, h: 5, bb: 0, fInnSS: 3 },
      ]),
      [
        round("r1", "2026-04-01", { p1: { score: 60 } }),
        round("r2", "2026-05-01", { p1: { score: 50 } }),
      ],
    );
    expect(t.batting.class).toBe("improving");
    expect(t.evals.class).toBe("declining");
    expect(t.positions.class).toBe("steady");
    expect(t.overall).toBe("steady");
    expect(t.signalCount).toBe(3);
  });

  it("a single improving signal is enough for an improving overall", () => {
    const t = soloTrend(
      [],
      [
        round("r1", "2026-04-01", { p1: { score: 50 } }),
        round("r2", "2026-05-01", { p1: { score: 60 } }),
      ],
    );
    expect(t.batting.class).toBe("insufficient");
    expect(t.positions.class).toBe("insufficient");
    expect(t.overall).toBe("improving");
    expect(t.signalCount).toBe(1);
  });

  it("is insufficient overall when every signal lacks data", () => {
    const t = soloTrend([], [round("r1", "2026-04-01", { p1: { score: 50 } })]);
    expect(t.overall).toBe("insufficient");
    expect(t.signalCount).toBe(0);
  });

  it("excludes departed players", () => {
    const trends = trendsFor([
      player("p1", "Ava"),
      player("p2", "Ben", { rosterStatus: "departed" }),
    ]);
    expect(trends.map((t) => t.playerId)).toEqual(["p1"]);
  });

  it("sorts by class, then |eval delta| descending, then name", () => {
    const rounds = (pid: string, first: number, last: number) => [
      round(`${pid}-r1`, "2026-04-01", { [pid]: { score: first } }),
      round(`${pid}-r2`, "2026-05-01", { [pid]: { score: last } }),
    ];
    const trends = trendsFor(
      [
        player("zed", "Zed"),
        player("dan", "Dan"),
        player("nora", "Nora"),
        player("ivy", "Ivy"),
        player("sam", "Sam"),
        player("amy", "Amy"),
      ],
      [],
      [
        ...rounds("nora", 50, 60), // improving, |delta| 10
        ...rounds("amy", 50, 55), // improving, |delta| 5
        ...rounds("zed", 50, 55), // improving, |delta| 5 → after Amy by name
        ...rounds("sam", 50, 50), // steady
        ...rounds("dan", 60, 50), // declining
        // ivy: no rounds → insufficient
      ],
    );
    expect(trends.map((t) => t.name)).toEqual([
      "Nora",
      "Amy",
      "Zed",
      "Sam",
      "Dan",
      "Ivy",
    ]);
  });
});

// Recursively assert a summary carries no undefined or NaN anywhere —
// Firestore rejects undefined, and NaN would poison the archived numbers.
const expectClean = (value: unknown): void => {
  expect(value).not.toBeUndefined();
  if (typeof value === "number") {
    expect(Number.isNaN(value)).toBe(false);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) expectClean(v);
  }
};

describe("buildPlayerSeasonSummaries", () => {
  const p1 = player("p1", "Ava");

  it("builds the full summary from lines, attendance, evals, and positions", () => {
    const games: Game[] = [
      finalGame(
        "g1",
        "2026-04-01",
        { p1: { ab: 2, fInnSS: 3 } },
        { attendance: { p1: true } },
      ),
      finalGame(
        "g2",
        "2026-04-08",
        { p1: { fInnSS: 3, fInnLF: 2 } },
        { attendance: { p1: false } },
      ),
      // Scrimmage: its line and innings never count, but its recorded
      // attendance does (mirroring the development report).
      finalGame(
        "scrim",
        "2026-04-15",
        { p1: { ab: 4, fInnC: 6 } },
        { isScrimmage: true, attendance: { p1: true } },
      ),
    ];
    const practices: Practice[] = [
      { id: "pr1", date: "2026-04-02", attendance: { p1: "present" } },
      { id: "pr2", date: "2026-04-09", attendance: { p1: "excused" } },
      { id: "pr3", date: "2026-04-16", attendance: { p1: "absent" } },
    ];
    const evaluationEvents = [
      round("r1", "2026-04-01", { p1: { score: 50 } }),
      round("r2", "2026-05-01", { p1: { score: 60 } }),
    ];
    const summaries = buildPlayerSeasonSummaries({
      players: [p1],
      games,
      practices,
      evaluationEvents,
    });
    expect(summaries.get("p1")).toEqual({
      gamesWithLines: 2,
      // present: g1, scrim, pr1; marked adds g2 + pr3 (excused never counts).
      attendanceRate: 3 / 5,
      evalRounds: 2,
      evalFirst100: 50,
      evalLast100: 60,
      positionInnings: { SS: 6, LF: 2 },
      distinctPositions: 2,
    });
  });

  it("archives development-plan outcomes: goal counts and focus areas", () => {
    const withPlan = player("p1", "Ava", {
      devPlan: {
        focusAreas: ["approach", "speed"],
        goals: [
          { id: "g1", text: "a", status: "achieved", createdAt: "2026-04-01" },
          { id: "g2", text: "b", status: "active", createdAt: "2026-04-01" },
          { id: "g3", text: "c", status: "dropped", createdAt: "2026-04-01" },
        ],
        checkIns: [{ id: "c1", date: "2026-05-01", note: "n" }],
      },
    });
    const summaries = buildPlayerSeasonSummaries({
      players: [withPlan],
      games: [],
      practices: [],
      evaluationEvents: [],
    });
    expect(summaries.get("p1")).toEqual({
      goalsSet: 3,
      goalsAchieved: 1,
      focusAreas: ["approach", "speed"],
    });
  });

  it("includes departed players and omits players with nothing to archive", () => {
    const summaries = buildPlayerSeasonSummaries({
      players: [
        player("gone", "Gone Kid", { rosterStatus: "departed" }),
        player("empty", "Empty Kid"),
      ],
      games: [
        finalGame("g1", "2026-04-01", undefined, {
          attendance: { gone: true },
        }),
      ],
      practices: [],
      evaluationEvents: [],
    });
    expect(summaries.get("gone")).toEqual({ attendanceRate: 1 });
    expect(summaries.has("empty")).toBe(false);
  });

  it("omits attendanceRate when only excused marks exist", () => {
    const summaries = buildPlayerSeasonSummaries({
      players: [p1],
      games: [],
      practices: [
        { id: "pr1", date: "2026-04-02", attendance: { p1: "excused" } },
      ],
      evaluationEvents: [],
    });
    expect(summaries.has("p1")).toBe(false);
  });

  it("archives a single eval round with first == last", () => {
    const summaries = buildPlayerSeasonSummaries({
      players: [p1],
      games: [],
      practices: [],
      evaluationEvents: [round("r1", "2026-04-01", { p1: { score: 72 } })],
    });
    expect(summaries.get("p1")).toEqual({
      evalRounds: 1,
      evalFirst100: 72,
      evalLast100: 72,
    });
  });

  it("never writes undefined or NaN fields (recursive check)", () => {
    const summaries = buildPlayerSeasonSummaries({
      players: [
        p1,
        player("p2", "Ben"),
        player("p3", "Cal", { rosterStatus: "departed" }),
      ],
      games: [
        finalGame(
          "g1",
          "2026-04-01",
          { p1: { ab: 3, h: 1, fInnSS: 3 }, p2: {} },
          { attendance: { p1: true, p2: false } },
        ),
      ],
      practices: [
        { id: "pr1", date: "2026-04-02", attendance: { p3: "present" } },
      ],
      evaluationEvents: [round("r1", "2026-04-01", { p1: { score: 55 } })],
    });
    expect(summaries.size).toBeGreaterThan(0);
    for (const summary of summaries.values()) {
      expectClean(summary);
      // Spot-check: fields must be absent, not undefined-valued.
      for (const [, v] of Object.entries(summary)) {
        expect(v).not.toBeUndefined();
      }
    }
  });
});
