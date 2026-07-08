import { describe, it, expect } from "vitest";
import { buildPreseasonSeedRound } from "./helpers";

const meta = { date: "2026-08-15", evaluatorId: "u1" };

describe("buildPreseasonSeedRound", () => {
  it("seeds returning players from their MOST RECENT eval round", () => {
    const endingEvents = [
      {
        id: "r1",
        date: "2026-04-01",
        createdAt: 100,
        coachRole: "Head",
        grades: { p1: { hitting: 2, fielding: 2 } },
      },
      {
        id: "r2",
        date: "2026-06-01",
        createdAt: 200,
        coachRole: "Head",
        grades: { p1: { hitting: 5, fielding: 4 } },
      },
    ];
    const round = buildPreseasonSeedRound(
      endingEvents,
      [{ id: "p1" }],
      [],
      meta,
    );
    expect(round).not.toBeNull();
    expect(round.grades.p1).toEqual({ hitting: 5, fielding: 4 });
    expect(round.label).toBe("Preseason");
    expect(round.evaluatorName).toBe("Preseason");
    expect(round.date).toBe("2026-08-15");
  });

  it("seeds promoted tryouts from date-grouped tryout sessions with head/assistant halves", () => {
    const tryoutSessions = [
      {
        id: "tryout-2026-06-18",
        date: "2026-06-18",
        gradesByEvaluator: {
          head: {
            coachRole: "Head",
            grades: { s9: { hitting: 5, fielding: 3 } },
          },
          a1: {
            coachRole: "Assistant",
            grades: { s9: { hitting: 3, fielding: 5 } },
          },
          a2: {
            coachRole: "Assistant",
            grades: { s9: { hitting: 1, fielding: 3 } },
          },
        },
      },
    ];
    const round = buildPreseasonSeedRound(
      [],
      [],
      [{ id: "pNew", tryoutSignupId: "s9" }],
      { ...meta, tryoutSessions },
    );
    expect(round.grades.pNew).toEqual({ hitting: 4, fielding: 4 });
  });

  it("can migrate legacy per-signup tryout evals into the preseason seed", () => {
    const endingEvents = [
      {
        id: "t-asst",
        date: "2026-06-18",
        tryoutSignupId: "s9",
        evaluatorId: "a1",
        coachRole: "Assistant",
        grades: { signup: { hitting: 3 } },
      },
      {
        id: "t-head",
        date: "2026-06-18",
        tryoutSignupId: "s9",
        evaluatorId: "h1",
        coachRole: "Head",
        grades: { signup: { hitting: 5 } },
      },
    ];
    const round = buildPreseasonSeedRound(
      endingEvents,
      [],
      [{ id: "pNew", tryoutSignupId: "s9" }],
      meta,
    );
    expect(round.grades.pNew).toEqual({ hitting: 4 });
  });

  it("returns null when there is nothing to seed", () => {
    expect(buildPreseasonSeedRound([], [{ id: "p1" }], [], meta)).toBeNull();
    // Returning player with no grades, promoted with no matching tryout eval.
    expect(
      buildPreseasonSeedRound(
        [{ id: "r1", grades: { other: { x: 1 } } }],
        [{ id: "p1" }],
        [{ id: "pNew", tryoutSignupId: "missing" }],
        meta,
      ),
    ).toBeNull();
  });

  it("ignores tryout rounds when seeding returning players", () => {
    const endingEvents = [
      {
        id: "t1",
        tryoutSignupId: "p1",
        coachRole: "Head",
        grades: { signup: { hitting: 1 } },
      },
    ];
    // p1 here is a returning player id; the tryout round must NOT leak in.
    const round = buildPreseasonSeedRound(
      endingEvents,
      [{ id: "p1" }],
      [],
      meta,
    );
    expect(round).toBeNull();
  });
});

describe("showcase-measurement overlay (C4)", () => {
  it("promoted players' seeds carry DEFINITIVE measured grades over the tryout blend", () => {
    // Head eyeballed power 2; the radar said exit velo 57 (10U → 5).
    const sessions = [
      {
        id: "tryout-2026-08-01",
        date: "2026-08-01",
        updatedAt: 100,
        gradesByEvaluator: {
          h1: {
            coachRole: "Head",
            grades: { "sig-1": { power: 2, approach: 4 } },
          },
        },
      },
    ];
    const round = buildPreseasonSeedRound(
      [],
      [],
      [{ id: "p-new", tryoutSignupId: "sig-1" }],
      {
        date: "2027-02-01",
        evaluatorId: "hc",
        tryoutSessions: sessions,
        tryoutSignups: [
          {
            id: "sig-1",
            tryoutDate: "2026-08-01",
            measurements: { exitVeloMph: 57, runToFirstSec: 4.0 },
          },
        ],
        teamAge: "10U",
      },
    );
    expect(round.grades["p-new"]).toMatchObject({
      power: 5, // measured beats the eyeball 2
      speed: 5, // measured
      approach: 4, // subjective survives
    });
  });

  it("falls back to the plain blend when the signup carries no measurements", () => {
    const sessions = [
      {
        id: "tryout-2026-08-01",
        date: "2026-08-01",
        updatedAt: 100,
        gradesByEvaluator: {
          h1: { coachRole: "Head", grades: { "sig-1": { approach: 3 } } },
        },
      },
    ];
    const round = buildPreseasonSeedRound(
      [],
      [],
      [{ id: "p-new", tryoutSignupId: "sig-1" }],
      {
        date: "2027-02-01",
        tryoutSessions: sessions,
        tryoutSignups: [{ id: "sig-1", tryoutDate: "2026-08-01" }],
        teamAge: "10U",
      },
    );
    expect(round.grades["p-new"]).toEqual({ approach: 3 });
  });
});
