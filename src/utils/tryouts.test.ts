import {
  combinedTryoutGradeForSignup,
  migrateLegacyTryoutGrades,
  normalizeTryoutSessions,
} from "./tryouts";

// A legacy tryout grade as it was stored before tryoutSessions existed: an
// evaluationEvents entry carrying a tryoutSignupId + grades.signup.
const legacyGrade = (over: any = {}) => ({
  id: "ev-legacy",
  date: "2026-06-18",
  tryoutSignupId: "sig-1",
  evaluatorId: "coach-1",
  coachRole: "Head",
  grades: { signup: { contact: 4, power: 3 } },
  ...over,
});

const rosterRound = () => ({
  id: "ev-round",
  date: "2026-06-01",
  coachRole: "Head",
  evaluatorId: "coach-1",
  grades: { p1: { contact: 5 } },
});

describe("migrateLegacyTryoutGrades", () => {
  it("folds a legacy tryout grade into tryoutSessions and drops it from evaluationEvents", () => {
    const team = {
      tryoutSignups: [{ id: "sig-1", tryoutDate: "2026-06-18" }],
      evaluationEvents: [rosterRound(), legacyGrade()],
      tryoutSessions: [],
    };
    const out = migrateLegacyTryoutGrades(team);
    // The legacy entry is gone; the real roster round survives.
    expect(out.evaluationEvents.map((e: any) => e.id)).toEqual(["ev-round"]);
    // The grade now lives in a session, keyed by evaluator → signup.
    const session = out.tryoutSessions.find(
      (s: any) => s.gradesByEvaluator?.["coach-1"]?.grades?.["sig-1"],
    );
    expect(session).toBeTruthy();
    expect(session.gradesByEvaluator["coach-1"].grades["sig-1"]).toEqual({
      contact: 4,
      power: 3,
    });
  });

  it("preserves exactly what normalizeTryoutSessions would have folded", () => {
    const team = {
      tryoutSignups: [{ id: "sig-1", tryoutDate: "2026-06-18" }],
      evaluationEvents: [legacyGrade()],
      tryoutSessions: [],
    };
    const out = migrateLegacyTryoutGrades(team);
    // The migrated sessions equal the on-read fold — nothing invented or lost.
    expect(out.tryoutSessions).toEqual(normalizeTryoutSessions(team));
  });

  it("is idempotent — a second run is a no-op returning the same references", () => {
    const team = {
      tryoutSignups: [{ id: "sig-1", tryoutDate: "2026-06-18" }],
      evaluationEvents: [rosterRound(), legacyGrade()],
      tryoutSessions: [],
    };
    const first = migrateLegacyTryoutGrades(team);
    const migratedTeam = {
      ...team,
      evaluationEvents: first.evaluationEvents,
      tryoutSessions: first.tryoutSessions,
    };
    const second = migrateLegacyTryoutGrades(migratedTeam);
    // Nothing left to migrate → inputs returned unchanged (reference-equal),
    // so the caller writes nothing on the second load.
    expect(second.evaluationEvents).toBe(migratedTeam.evaluationEvents);
    expect(second.tryoutSessions).toBe(migratedTeam.tryoutSessions);
  });

  it("no-ops for a team with no legacy tryout grades", () => {
    const team = {
      evaluationEvents: [rosterRound()],
      tryoutSessions: [{ id: "tryout-2026-06-18", gradesByEvaluator: {} }],
    };
    const out = migrateLegacyTryoutGrades(team);
    expect(out.evaluationEvents).toBe(team.evaluationEvents);
    expect(out.tryoutSessions).toBe(team.tryoutSessions);
  });

  it("keeps a tryout-tagged event that was never foldable (no grades.signup)", () => {
    // Missing grades.signup → normalizeTryoutSessions never folded it, so the
    // migration must NOT drop it (no silent data loss).
    const unfoldable = {
      id: "ev-partial",
      tryoutSignupId: "sig-9",
      evaluatorId: "coach-1",
      grades: { p1: { contact: 3 } },
    };
    const team = {
      tryoutSignups: [{ id: "sig-9" }],
      evaluationEvents: [unfoldable],
      tryoutSessions: [],
    };
    const out = migrateLegacyTryoutGrades(team);
    expect(out.evaluationEvents).toContain(unfoldable);
  });

  it("tolerates missing arrays", () => {
    const out = migrateLegacyTryoutGrades({});
    expect(out.evaluationEvents).toEqual([]);
    expect(out.tryoutSessions).toEqual([]);
  });
});

describe("combinedTryoutGradeForSignup", () => {
  const session = (gradesByEvaluator: any, over: any = {}) => ({
    id: "tryout-2026-06-18",
    date: "2026-06-18",
    updatedAt: 100,
    gradesByEvaluator,
    ...over,
  });

  it("rounds the head+assistant blend once, not twice (finding 3.3)", () => {
    // Head: one coach grades contact 4 → head group mean 4.0.
    // Assistants: two coaches grade 5 and 4 → assistant group mean 4.5.
    // Blend of the raw group means: (4.0 + 4.5) / 2 = 4.25 → rounds to 4.
    // The old two-pass code rounded assistants to 5 first, then blended
    // round((4 + 5) / 2) = round(4.5) = 5 — a full grade point too high.
    const sessions = [
      session({
        h1: { coachRole: "Head", grades: { s1: { contact: 4 } } },
        a1: { coachRole: "Assistant", grades: { s1: { contact: 5 } } },
        a2: { coachRole: "Assistant", grades: { s1: { contact: 4 } } },
      }),
    ];
    expect(combinedTryoutGradeForSignup(sessions, "s1")).toEqual({
      contact: 4,
    });
  });

  it("averages a single group with one rounding pass (head only)", () => {
    const sessions = [
      session({
        h1: { coachRole: "Head", grades: { s1: { contact: 4, power: 5 } } },
        h2: { coachRole: "Head", grades: { s1: { contact: 5, power: 5 } } },
      }),
    ];
    // contact (4+5)/2 = 4.5 → 5;  power (5+5)/2 = 5.
    expect(combinedTryoutGradeForSignup(sessions, "s1")).toEqual({
      contact: 5,
      power: 5,
    });
  });

  it("blends assistants only when there is no head grade", () => {
    const sessions = [
      session({
        a1: { coachRole: "Assistant", grades: { s1: { contact: 3 } } },
        a2: { coachRole: "Assistant", grades: { s1: { contact: 4 } } },
      }),
    ];
    // (3 + 4) / 2 = 3.5 → 4.
    expect(combinedTryoutGradeForSignup(sessions, "s1")).toEqual({
      contact: 4,
    });
  });

  it("carries notes/suggestedPositions through without averaging", () => {
    const sessions = [
      session({
        h1: {
          coachRole: "Head",
          grades: { s1: { contact: 4, notes: "strong arm" } },
        },
        a1: {
          coachRole: "Assistant",
          grades: { s1: { contact: 4, suggestedPositions: ["SS"] } },
        },
      }),
    ];
    const out = combinedTryoutGradeForSignup(sessions, "s1");
    expect(out.contact).toBe(4);
    expect(out.notes).toBe("strong arm");
    expect(out.suggestedPositions).toEqual(["SS"]);
  });

  it("returns null with no signup id or no matching session", () => {
    const sessions = [
      session({ h1: { coachRole: "Head", grades: { s1: { contact: 4 } } } }),
    ];
    expect(combinedTryoutGradeForSignup(sessions, null)).toBeNull();
    expect(combinedTryoutGradeForSignup(sessions, "nope")).toBeNull();
    expect(combinedTryoutGradeForSignup(null, "s1")).toBeNull();
  });
});
