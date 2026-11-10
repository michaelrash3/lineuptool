import { describe, it, expect } from "vitest";
import { foldTryoutGradeEntries, tryoutGradeEntryKey } from "./tryouts";

const entry = (over: Record<string, unknown> = {}) => ({
  sessionId: "tryout-2026-06-18",
  date: "2026-06-18",
  evaluatorId: "u1",
  coachRole: "Head",
  evaluatorName: "Rash",
  updatedAt: 10,
  grades: { s1: { arm: 4 } },
  ...over,
});

describe("foldTryoutGradeEntries", () => {
  it("creates the session an entry belongs to", () => {
    const [session] = foldTryoutGradeEntries([], {
      [tryoutGradeEntryKey("tryout-2026-06-18", "u1")]: entry(),
    });
    expect(session).toMatchObject({
      id: "tryout-2026-06-18",
      date: "2026-06-18",
      signupIds: ["s1"],
    });
    expect(session.gradesByEvaluator.u1).toMatchObject({
      evaluatorId: "u1",
      coachRole: "Head",
      evaluatorName: "Rash",
      grades: { s1: { arm: 4 } },
    });
  });

  it("merges onto a legacy session without touching other coaches", () => {
    const legacy = [
      {
        id: "tryout-2026-06-18",
        date: "2026-06-18",
        label: "Tryout · 2026-06-18",
        signupIds: ["s9"],
        gradesByEvaluator: {
          old: { evaluatorId: "old", grades: { s9: { arm: 2 } } },
          u1: { evaluatorId: "u1", grades: { s9: { arm: 3 } } },
        },
      },
    ];
    const [session] = foldTryoutGradeEntries(legacy, { k: entry() });
    expect(session.label).toBe("Tryout · 2026-06-18");
    expect(session.signupIds).toEqual(["s9", "s1"]);
    expect(session.gradesByEvaluator.old.grades).toEqual({ s9: { arm: 2 } });
    expect(session.gradesByEvaluator.u1.grades).toEqual({
      s9: { arm: 3 },
      s1: { arm: 4 },
    });
    // Pure: the input wasn't touched.
    expect(legacy[0].signupIds).toEqual(["s9"]);
  });

  it("is idempotent — folding the same entries again changes nothing", () => {
    const entries = { k: entry() };
    const once = foldTryoutGradeEntries([], entries);
    expect(foldTryoutGradeEntries(once, entries)).toEqual(once);
  });

  it("skips malformed entries", () => {
    expect(
      foldTryoutGradeEntries([], {
        a: null,
        b: { grades: { s1: {} } },
        c: entry({ evaluatorId: "" }),
      } as any),
    ).toEqual([]);
  });
});
