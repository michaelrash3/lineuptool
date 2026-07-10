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

  it("is insufficient with 4 lines but season AB of 7", () => {
    const t = soloTrend(
      lineGames([
        { ab: 2, h: 1 },
        { ab: 2, h: 1 },
        { ab: 2, h: 1 },
        { ab: 1, h: 1 },
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

  it("classifies rising recent AVG as improving and builds the cumulative series", () => {
    const t = soloTrend(
      lineGames([
        { ab: 4, h: 0 },
        { ab: 4, h: 1 },
        { ab: 4, h: 2 },
        { ab: 4, h: 3 },
      ]),
    );
    // baseline 6/16 = .375; recent (last 3) 6/12 = .500
    expect(t.batting.class).toBe("improving");
    expect(t.batting.basis).toBe("avg");
    expect(t.batting.delta).toBeCloseTo(0.125, 10);
    expect(t.batting.series).toEqual([0, 0.125, 0.25, 0.375]);
  });

  it("classifies falling recent AVG as declining", () => {
    const t = soloTrend(
      lineGames([
        { ab: 4, h: 3 },
        { ab: 4, h: 2 },
        { ab: 4, h: 1 },
        { ab: 4, h: 0 },
      ]),
    );
    expect(t.batting.class).toBe("declining");
    expect(t.batting.delta).toBeCloseTo(-0.125, 10);
  });

  it("treats a delta of exactly +0.02 as steady", () => {
    // baseline 30/240 = .125; recent 29/200 = .145 → delta exactly +0.02
    const t = soloTrend(
      lineGames([
        { ab: 40, h: 1 },
        { ab: 100, h: 15 },
        { ab: 50, h: 7 },
        { ab: 50, h: 7 },
      ]),
    );
    expect(t.batting.class).toBe("steady");
    expect(t.batting.delta).toBeCloseTo(0.02, 10);
  });

  it("classifies a delta just above +0.02 as improving", () => {
    // baseline 100/800 = .125; recent 73/500 = .146 → delta +0.021
    const t = soloTrend(
      lineGames([
        { ab: 300, h: 27 },
        { ab: 200, h: 30 },
        { ab: 200, h: 29 },
        { ab: 100, h: 14 },
      ]),
    );
    expect(t.batting.class).toBe("improving");
    expect(t.batting.delta).toBeCloseTo(0.021, 10);
  });

  it("falls back to QAB% when no AVG comparable exists", () => {
    // Lines carry AB (so the sample guard passes) but no H → no AVG.
    const t = soloTrend(
      lineGames([
        { ab: 2, qab: 0.2 },
        { ab: 2, qab: 0.4 },
        { ab: 2, qab: 0.4 },
        { ab: 2, qab: 0.4 },
      ]),
    );
    expect(t.batting.basis).toBe("qab");
    expect(t.batting.class).toBe("improving");
    // baseline mean .35 vs recent mean .40
    expect(t.batting.delta).toBeCloseTo(0.05, 10);
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
    // Batting improving (rising AVG), evals declining (-10), positions steady
    // (same lone position in both halves).
    const t = soloTrend(
      lineGames([
        { ab: 4, h: 0, fInnSS: 3 },
        { ab: 4, h: 1, fInnSS: 3 },
        { ab: 4, h: 2, fInnSS: 3 },
        { ab: 4, h: 3, fInnSS: 3 },
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
