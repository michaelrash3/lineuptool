import {
  combinedTryoutGradeForSignup,
  migrateLegacyTryoutGrades,
  normalizeTryoutSessions,
  nextTryoutNumber,
  applyMissingTryoutNumbers,
  tryoutGradeWithMeasurements,
  unifiedTryoutGradeForSignup,
  evaluatorEntriesForSignup,
} from "./tryouts";

// A legacy tryout grade as it was stored before tryoutSessions existed: an
// evaluationEvents entry carrying a tryoutSignupId + grades.signup. A fixed
// `createdAt` is included so normalizeTryoutSessions stamps the folded session's
// `updatedAt` from it deterministically instead of `Date.now()` — otherwise the
// "preserves exactly what normalizeTryoutSessions would have folded" test flakes
// when its two normalize calls straddle a millisecond boundary.
const legacyGrade = (over: any = {}) => ({
  id: "ev-legacy",
  date: "2026-06-18",
  createdAt: 1750000000000,
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

describe("tryout numbers", () => {
  const s = (
    id: string,
    tryoutNumber?: string,
    tryoutDate?: string,
    submittedAt = "2026-07-01T10:00:00.000Z",
  ) => ({ id, tryoutNumber, tryoutDate, submittedAt });

  describe("nextTryoutNumber", () => {
    it("starts at 1 and fills the lowest gap within the date pool", () => {
      expect(nextTryoutNumber([], "2026-08-01")).toBe("1");
      expect(
        nextTryoutNumber(
          [s("a", "1", "2026-08-01"), s("b", "3", "2026-08-01")],
          "2026-08-01",
        ),
      ).toBe("2");
    });

    it("scopes numbers PER tryout date — two dates can both have a #1", () => {
      const signups = [s("a", "1", "2026-08-01")];
      expect(nextTryoutNumber(signups, "2026-08-08")).toBe("1");
      // Undated signups share their own pool.
      expect(nextTryoutNumber(signups, undefined)).toBe("1");
    });

    it("ignores malformed numbers", () => {
      expect(
        nextTryoutNumber(
          [s("a", "abc", "2026-08-01"), s("b", "", "2026-08-01")],
          "2026-08-01",
        ),
      ).toBe("1");
    });
  });

  describe("applyMissingTryoutNumbers", () => {
    it("fills only the missing numbers, in submission order, per date pool", () => {
      const out = applyMissingTryoutNumbers([
        s("late", undefined, "2026-08-01", "2026-07-02T00:00:00.000Z"),
        s("kept", "2", "2026-08-01"),
        s("early", undefined, "2026-08-01", "2026-07-01T00:00:00.000Z"),
        s("otherDate", undefined, "2026-08-08"),
      ]);
      const byId = Object.fromEntries(out.map((x) => [x.id, x.tryoutNumber]));
      // Existing #2 kept; earliest submitter takes 1, next takes 3 (2 is used).
      expect(byId.kept).toBe("2");
      expect(byId.early).toBe("1");
      expect(byId.late).toBe("3");
      // The other date's pool starts fresh at 1.
      expect(byId.otherDate).toBe("1");
    });

    it("returns the SAME array reference when nothing is missing (no-op write)", () => {
      const signups = [s("a", "1", "2026-08-01"), s("b", "2", "2026-08-01")];
      expect(applyMissingTryoutNumbers(signups)).toBe(signups);
    });
  });
});

describe("tryoutGradeWithMeasurements — the definitive overlay", () => {
  const sessions = [
    {
      id: "tryout-2026-08-01",
      date: "2026-08-01",
      updatedAt: 100,
      gradesByEvaluator: {
        h1: {
          coachRole: "Head",
          grades: { s1: { power: 2, approach: 4 } },
        },
      },
    },
  ];

  it("measured stations OVERRIDE the subjective blend for their categories", () => {
    const grade = tryoutGradeWithMeasurements(
      sessions,
      {
        id: "s1",
        tryoutDate: "2026-08-01",
        // 10U exit velo 57 → power 5, beating the head's eyeballed 2.
        measurements: { exitVeloMph: 57 },
      },
      "10U",
    );
    expect(grade.power).toBe(5);
    // Non-measured categories keep the subjective blend.
    expect(grade.approach).toBe(4);
  });

  it("returns the plain blend when nothing was measured", () => {
    const grade = tryoutGradeWithMeasurements(
      sessions,
      { id: "s1", tryoutDate: "2026-08-01" },
      "10U",
    );
    expect(grade).toEqual({ power: 2, approach: 4 });
  });

  it("grades an UNGRADED kid from measurements alone", () => {
    const grade = tryoutGradeWithMeasurements(
      sessions,
      {
        id: "walk-up",
        measurements: { runToFirstSec: 4.0, maxThrowVeloMph: 56 },
      },
      "10U",
    );
    expect(grade).toEqual({ speed: 5, armStrength: 5 });
  });

  it("null when there is neither a grade nor a measurement", () => {
    expect(
      tryoutGradeWithMeasurements(sessions, { id: "nobody" }, "10U"),
    ).toBeNull();
  });
});

describe("unifiedTryoutGradeForSignup — the multi-tryout fold", () => {
  const twoSessions = [
    {
      id: "tryout-2026-08-01",
      date: "2026-08-01",
      updatedAt: 100,
      gradesByEvaluator: {
        h1: { coachRole: "Head", grades: { s1: { approach: 2 } } },
      },
    },
    {
      id: "tryout-2026-08-08",
      date: "2026-08-08",
      updatedAt: 200,
      gradesByEvaluator: {
        h1: {
          coachRole: "Head",
          grades: { s1: { approach: 5, notes: "second look: much better" } },
        },
      },
    },
  ];

  it("averages a kid's tryouts equally into one grade (single rounding)", () => {
    // (2 + 5) / 2 = 3.5 → 4, rounded exactly once.
    expect(unifiedTryoutGradeForSignup(twoSessions, "s1").approach).toBe(4);
    // The per-date view still shows the single latest session (5).
    expect(
      combinedTryoutGradeForSignup(twoSessions, "s1", "2026-08-08").approach,
    ).toBe(5);
  });

  it("takes notes from the newest session that has them", () => {
    expect(unifiedTryoutGradeForSignup(twoSessions, "s1").notes).toBe(
      "second look: much better",
    );
  });

  it("degrades to the single-session blend when the kid attended one tryout", () => {
    const one = [twoSessions[0]];
    expect(unifiedTryoutGradeForSignup(one, "s1")).toEqual(
      combinedTryoutGradeForSignup(one, "s1"),
    );
  });

  it("feeds tryoutGradeWithMeasurements by default (no date → unified)", () => {
    const grade = tryoutGradeWithMeasurements(
      twoSessions,
      { id: "s1", tryoutDate: "2026-08-01" },
      "10U",
    );
    // Unified fold (4), NOT the signup's own date's session (2).
    expect(grade.approach).toBe(4);
    // Explicit date scopes to that tryout.
    expect(
      tryoutGradeWithMeasurements(
        twoSessions,
        { id: "s1", tryoutDate: "2026-08-01" },
        "10U",
        "2026-08-01",
      ).approach,
    ).toBe(2);
  });

  it("returns null for an ungraded kid", () => {
    expect(unifiedTryoutGradeForSignup(twoSessions, "nobody")).toBeNull();
  });
});

describe("evaluatorEntriesForSignup — cross-coach visibility", () => {
  const sessions = [
    {
      id: "tryout-2026-08-01",
      date: "2026-08-01",
      updatedAt: 2,
      gradesByEvaluator: {
        ac: {
          coachRole: "Assistant",
          evaluatorId: "ac",
          evaluatorName: "Lee",
          grades: { s1: { approach: 2 } },
        },
        hc: {
          coachRole: "Head",
          evaluatorId: "hc",
          evaluatorName: "Rash",
          grades: { s1: { approach: 4, notes: "Barrels it" } },
        },
        // Graded a DIFFERENT kid only — must not appear for s1.
        other: {
          coachRole: "Assistant",
          evaluatorId: "other",
          grades: { s2: { approach: 5 } },
        },
      },
    },
    {
      id: "tryout-2026-07-01",
      date: "2026-07-01",
      updatedAt: 1,
      gradesByEvaluator: {
        hc: {
          coachRole: "Head",
          evaluatorId: "hc",
          grades: { s1: { approach: 3 } },
        },
      },
    },
  ];

  it("lists every evaluator who graded the kid, heads first, newest session first", () => {
    const entries = evaluatorEntriesForSignup(sessions, "s1");
    expect(entries.map((e) => [e.evaluatorId, e.coachRole, e.date])).toEqual([
      ["hc", "Head", "2026-08-01"],
      ["ac", "Assistant", "2026-08-01"],
      ["hc", "Head", "2026-07-01"],
    ]);
    // The whole recorded read travels — grade AND notes.
    expect(entries[0].evaluatorName).toBe("Rash");
    expect(entries[0].grade).toEqual({ approach: 4, notes: "Barrels it" });
  });

  it("scopes to one tryout date when given", () => {
    const entries = evaluatorEntriesForSignup(sessions, "s1", "2026-07-01");
    expect(entries).toHaveLength(1);
    expect(entries[0].grade).toEqual({ approach: 3 });
    // Legacy entries saved before name-stamping simply omit the field.
    expect(entries[0].evaluatorName).toBeUndefined();
  });

  it("is empty for an ungraded kid or missing inputs", () => {
    expect(evaluatorEntriesForSignup(sessions, "nobody")).toEqual([]);
    expect(evaluatorEntriesForSignup(null, "s1")).toEqual([]);
    expect(evaluatorEntriesForSignup(sessions, null)).toEqual([]);
  });
});
