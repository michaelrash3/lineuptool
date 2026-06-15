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
      meta
    );
    expect(round).not.toBeNull();
    expect(round.grades.p1).toEqual({ hitting: 5, fielding: 4 });
    expect(round.label).toBe("Preseason");
    expect(round.evaluatorName).toBe("Preseason");
    expect(round.date).toBe("2026-08-15");
  });

  it("seeds promoted tryouts from their tryout eval, preferring the Head's", () => {
    const endingEvents = [
      {
        id: "t-asst",
        tryoutSignupId: "s9",
        coachRole: "Assistant",
        grades: { signup: { hitting: 3 } },
      },
      {
        id: "t-head",
        tryoutSignupId: "s9",
        coachRole: "Head",
        grades: { signup: { hitting: 4, speed: 5 } },
      },
    ];
    const round = buildPreseasonSeedRound(
      endingEvents,
      [],
      [{ id: "pNew", tryoutSignupId: "s9" }],
      meta
    );
    expect(round.grades.pNew).toEqual({ hitting: 4, speed: 5 });
  });

  it("returns null when there is nothing to seed", () => {
    expect(buildPreseasonSeedRound([], [{ id: "p1" }], [], meta)).toBeNull();
    // Returning player with no grades, promoted with no matching tryout eval.
    expect(
      buildPreseasonSeedRound(
        [{ id: "r1", grades: { other: { x: 1 } } }],
        [{ id: "p1" }],
        [{ id: "pNew", tryoutSignupId: "missing" }],
        meta
      )
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
    const round = buildPreseasonSeedRound(endingEvents, [{ id: "p1" }], [], meta);
    expect(round).toBeNull();
  });
});
