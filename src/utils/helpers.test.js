import {
  normalizeDateToIso,
  parseCsvRecords,
  parseGameChangerPastSeasonCsv,
  evalDueDatesForYear,
  evalPromptStatus,
  evalRoundDateForSave,
  restampEvalDueDates,
  emailPromptStatus,
  isReturning,
  lineupSlotMatchesPlayer,
  isGameFinalized,
  buildSeasonBenchImbalance,
  gamesDueForReminder,
} from "./helpers";

describe("CSV helpers", () => {
  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    const rows = parseCsvRecords(
      'First,Last,Note\r\nJane,"Smith, Jr.","Line one\nLine two"\r\nBob,"O""Brien","He said ""go"""'
    );

    expect(rows).toEqual([
      ["First", "Last", "Note"],
      ["Jane", "Smith, Jr.", "Line one\nLine two"],
      ["Bob", 'O"Brien', 'He said "go"'],
    ]);
  });

  it("keeps GameChanger compatibility with quoted newlines", () => {
    const result = parseGameChangerPastSeasonCsv(
      'First,Last,OPS,AB,H\n"Ava",Rivera,.900,10,4\n"Mia","Stone",.700,8,2\nTotals,,.800,18,6\nGlossary,"ignored\nfooter",,,\n'
    );

    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].csvName).toBe("Ava Rivera");
    expect(result.rows[0].stats.ops).toBe(0.9);
  });
});

describe("date helpers", () => {
  it.each([
    ["2026-04-07", "2026-04-07"],
    ["2026-4-7", "2026-04-07"],
    ["2026-04-07T23:30:00Z", "2026-04-07"],
    ["4/7/26", "2026-04-07"],
    ["04/07/2026", "2026-04-07"],
  ])("normalizes %s to %s deterministically", (input, expected) => {
    expect(normalizeDateToIso(input)).toBe(expected);
  });

  it("rejects invalid calendar dates", () => {
    expect(normalizeDateToIso("2/30/26")).toBe("");
  });
});

describe("evalDueDatesForYear", () => {
  it("anchors Spring on Feb 1 and Mar 15", () => {
    const dates = evalDueDatesForYear(2026);
    expect(dates[0].getMonth()).toBe(1); // February
    expect(dates[0].getDate()).toBe(1);
    expect(dates[1].getMonth()).toBe(2); // March
    expect(dates[1].getDate()).toBe(15);
  });

  it("walks biweekly Sundays from Mar 15 through Jun 30", () => {
    const dates = evalDueDatesForYear(2026)
      .filter((d) => d.getMonth() >= 2 && d.getMonth() <= 5)
      .filter((d) => !(d.getMonth() === 2 && d.getDate() === 15));
    for (const d of dates) {
      expect(d.getDay()).toBe(0); // Sunday
    }
    expect(dates[0].getTime()).toBeGreaterThan(new Date(2026, 2, 15).getTime());
    const last = dates[dates.length - 1];
    expect(last.getTime()).toBeLessThanOrEqual(new Date(2026, 5, 30).getTime());
  });

  it("walks weekly Sundays Sep 1–Oct 31 for Fall", () => {
    const fall = evalDueDatesForYear(2026).filter(
      (d) => d.getMonth() >= 8 && d.getMonth() <= 9
    );
    for (const d of fall) {
      expect(d.getDay()).toBe(0);
    }
    expect(fall.length).toBeGreaterThanOrEqual(8);
  });

  it("emits no dates in Jul/Aug/Nov–Jan", () => {
    const dates = evalDueDatesForYear(2026);
    const offSeasonMonths = new Set([0, 6, 7, 10, 11]);
    for (const d of dates) {
      expect(offSeasonMonths.has(d.getMonth())).toBe(false);
    }
  });

  it("returns dates sorted ascending with no duplicates", () => {
    const dates = evalDueDatesForYear(2026);
    const times = dates.map((d) => d.getTime());
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
    expect(new Set(times).size).toBe(times.length);
  });

  // The spring biweekly walk starts the first Sunday *after* Mar 15
  // (the `|| 7` skip), specifically so Mar 15 isn't pushed twice when it
  // itself lands on a Sunday. Lock that intentional asymmetry.
  it("never duplicates Mar 15 even in a year where it is a Sunday", () => {
    let year = null;
    for (let y = 2024; y <= 2040; y++) {
      if (new Date(y, 2, 15).getDay() === 0) {
        year = y;
        break;
      }
    }
    expect(year).not.toBeNull();
    const dates = evalDueDatesForYear(year);
    const mar15s = dates.filter(
      (d) => d.getMonth() === 2 && d.getDate() === 15
    );
    expect(mar15s.length).toBe(1);
  });

  // Fall has no separate Sep 1 anchor, so unlike spring it *includes*
  // Sep 1 when that day is a Sunday (no `|| 7` skip). Lock that too.
  it("includes Sep 1 in Fall when it falls on a Sunday", () => {
    let year = null;
    for (let y = 2024; y <= 2040; y++) {
      if (new Date(y, 8, 1).getDay() === 0) {
        year = y;
        break;
      }
    }
    expect(year).not.toBeNull();
    const dates = evalDueDatesForYear(year);
    const hasSep1 = dates.some(
      (d) => d.getMonth() === 8 && d.getDate() === 1
    );
    expect(hasSep1).toBe(true);
  });
});

describe("evalPromptStatus calendar cadence", () => {
  const team = { currentSeason: "Spring 2026", evaluationEvents: [] };
  const uid = "coach1";

  it("is active on Feb 1 (preseason) when no eval submitted", () => {
    const status = evalPromptStatus(team, uid, "Head", new Date(2026, 1, 1));
    expect(status.active).toBe(true);
    expect(status.kind).toBe("preseason");
  });

  it("is active on Mar 12 (within 3 days before Mar 15)", () => {
    const status = evalPromptStatus(team, uid, "Head", new Date(2026, 2, 12));
    expect(status.active).toBe(true);
    expect(status.kind).toBe("biweekly");
  });

  it("is not active mid-July (off-season)", () => {
    const status = evalPromptStatus(team, uid, "Head", new Date(2026, 6, 15));
    expect(status.active).toBe(false);
  });

  it("is not active mid-August (still off-season)", () => {
    const status = evalPromptStatus(team, uid, "Head", new Date(2026, 7, 15));
    expect(status.active).toBe(false);
    expect(status.nextDueDate).toMatch(/^2026-09-/);
  });

  it("is active on a Fall Sunday (Sep 13, 2026 is a Sunday)", () => {
    const status = evalPromptStatus(team, uid, "Head", new Date(2026, 8, 13));
    expect(status.active).toBe(true);
    expect(status.kind).toBe("biweekly");
  });

  it("is not active on Nov 1 (after fall window)", () => {
    const status = evalPromptStatus(team, uid, "Head", new Date(2026, 10, 1));
    expect(status.active).toBe(false);
  });

  it("does not fire on a date the coach already submitted on or after", () => {
    const submittedTeam = {
      currentSeason: "Spring 2026",
      evaluationEvents: [
        {
          coachRole: "Head",
          evaluatorId: uid,
          date: "2026-02-01",
        },
      ],
    };
    const status = evalPromptStatus(
      submittedTeam,
      uid,
      "Head",
      new Date(2026, 1, 2)
    );
    expect(status.active).toBe(false);
  });

  it("clears once an eval is filed early, before the due date passes", () => {
    // Mar 15 due date; coach files on Mar 12 (3 days early, still inside the
    // active window). The prompt must go quiet for the rest of the window
    // instead of nagging until Mar 15 arrives.
    const submittedTeam = {
      currentSeason: "Spring 2026",
      evaluationEvents: [
        {
          coachRole: "Head",
          evaluatorId: uid,
          date: "2026-03-12",
        },
      ],
    };
    // Two days before the due date, having already submitted.
    const before = evalPromptStatus(
      submittedTeam,
      uid,
      "Head",
      new Date(2026, 2, 13)
    );
    expect(before.active).toBe(false);
    // And the day after the due date — still cleared, not re-nagging.
    const after = evalPromptStatus(
      submittedTeam,
      uid,
      "Head",
      new Date(2026, 2, 16)
    );
    expect(after.active).toBe(false);
  });

  it("surfaces the active due date so the banner can show it", () => {
    const status = evalPromptStatus(team, uid, "Head", new Date(2026, 2, 12));
    expect(status.active).toBe(true);
    expect(status.nextDueDate).toBe("2026-03-15");
  });

  it("does not let an early eval suppress the next cadence window", () => {
    // Filing for the Mar 15 round must not clear the following biweekly
    // Sunday's prompt (adjacent windows stay independent).
    const submittedTeam = {
      currentSeason: "Spring 2026",
      evaluationEvents: [
        { coachRole: "Head", evaluatorId: uid, date: "2026-03-12" },
      ],
    };
    // Mar 22, 2026 is the next biweekly Sunday after Mar 15 (Mar 15 itself is
    // a Sunday, so the cadence steps a week, then biweekly thereafter).
    const status = evalPromptStatus(
      submittedTeam,
      uid,
      "Head",
      new Date(2026, 2, 22)
    );
    expect(status.active).toBe(true);
    expect(status.nextDueDate).toBe("2026-03-22");
  });

  it("rolls the next due date into next year at year end", () => {
    // Late December: all of this year's windows are past, so the next due
    // date must come from next year's Feb 1 preseason anchor.
    const status = evalPromptStatus(team, uid, "Head", new Date(2026, 11, 20));
    expect(status.active).toBe(false);
    expect(status.nextDueDate).toBe("2027-02-01");
  });

  it("returns inert defaults when team or user is missing", () => {
    const a = evalPromptStatus(null, uid, "Head", new Date(2026, 1, 1));
    const b = evalPromptStatus(team, null, "Head", new Date(2026, 1, 1));
    expect(a.active).toBe(false);
    expect(a.nextDueDate).toBeNull();
    expect(b.active).toBe(false);
  });
});

describe("emailPromptStatus", () => {
  const onFeb1 = new Date(2026, 1, 1); // preseason cadence active
  const team = {
    ownerId: "head1",
    evaluationEvents: [],
    coachRoles: { asst1: "assistant" },
  };

  it("returns inactive for a missing team", () => {
    const s = emailPromptStatus(null, onFeb1);
    expect(s.active).toBe(false);
    expect(s.reason).toBe("no team");
  });

  it("respects the reminders-disabled flag", () => {
    const s = emailPromptStatus(
      { ...team, emailEvalRemindersDisabled: true },
      onFeb1
    );
    expect(s.active).toBe(false);
    expect(s.reason).toBe("reminders disabled");
  });

  it("honors the cool-off after a recent send", () => {
    const recent = new Date(2026, 0, 30).toISOString(); // 2 days before
    const s = emailPromptStatus({ ...team, lastEvalEmailedAt: recent }, onFeb1);
    expect(s.active).toBe(false);
    expect(s.reason).toMatch(/cool-off/);
  });

  it("fires when cadence is active and nobody has submitted", () => {
    const s = emailPromptStatus(team, onFeb1);
    expect(s.active).toBe(true);
    expect(s.kind).toBe("preseason");
    expect(s.headDue).toBe(true);
    expect(s.assistantsDue.asst1).toBe(true);
  });

  it("is inactive off-season even with reminders enabled", () => {
    const s = emailPromptStatus(team, new Date(2026, 6, 15)); // mid-July
    expect(s.active).toBe(false);
    expect(s.reason).toBe("no cadence active");
  });
});

describe("isReturning legacy fallback", () => {
  it("explicit returning:false → false", () => {
    expect(isReturning({ returning: false })).toBe(false);
  });
  it("explicit returning:true → true", () => {
    expect(isReturning({ returning: true })).toBe(true);
  });
  it("legacy playerStatus released → false", () => {
    expect(isReturning({ playerStatus: "released" })).toBe(false);
  });
  it("legacy playerStatus declined → false", () => {
    expect(isReturning({ playerStatus: "declined" })).toBe(false);
  });
  it("legacy playerStatus returning → true", () => {
    expect(isReturning({ playerStatus: "returning" })).toBe(true);
  });
  it("no fields → defaults to true", () => {
    expect(isReturning({})).toBe(true);
  });
  it("explicit returning beats legacy playerStatus", () => {
    expect(isReturning({ returning: false, playerStatus: "returning" })).toBe(false);
    expect(isReturning({ returning: true, playerStatus: "released" })).toBe(true);
  });
});

describe("lineupSlotMatchesPlayer orphan-id fallback", () => {
  it("matches by id when ids are equal", () => {
    const slot = { id: "abc", name: "Mike Smith" };
    const player = { id: "abc", name: "Mike Smith" };
    expect(lineupSlotMatchesPlayer(slot, player, new Set(["abc"]))).toBe(true);
  });

  it("matches deleted-and-re-added player by name when slot's id is orphaned", () => {
    // The slot was written when the player had id "old". The roster
    // now has the same kid under id "new" (and "old" is no longer
    // present). Name match should fire.
    const slot = { id: "old", name: "Mike Smith" };
    const player = { id: "new", name: "Mike Smith" };
    expect(lineupSlotMatchesPlayer(slot, player, new Set(["new"]))).toBe(true);
  });

  it("does NOT name-match when the slot's id still lives on the roster", () => {
    // Two siblings both named "Mike Smith" — slot.id ("old") is still
    // on the roster (some other player), so the orphan path must NOT
    // trigger and incorrectly credit innings to the wrong kid.
    const slot = { id: "old", name: "Mike Smith" };
    const player = { id: "new", name: "Mike Smith" };
    expect(
      lineupSlotMatchesPlayer(slot, player, new Set(["new", "old"]))
    ).toBe(false);
  });

  it("returns false for null/empty slots", () => {
    const player = { id: "p1", name: "Test" };
    expect(lineupSlotMatchesPlayer(null, player, new Set(["p1"]))).toBe(false);
    expect(lineupSlotMatchesPlayer(undefined, player, new Set(["p1"]))).toBe(
      false
    );
  });

  it("does not name-match when names are empty on either side", () => {
    const slot = { id: "old", name: "" };
    const player = { id: "new", name: "Mike" };
    expect(lineupSlotMatchesPlayer(slot, player, new Set(["new"]))).toBe(false);
  });

  it("name match is case- and whitespace-insensitive", () => {
    const slot = { id: "old", name: "  Mike Smith  " };
    const player = { id: "new", name: "mike smith" };
    expect(lineupSlotMatchesPlayer(slot, player, new Set(["new"]))).toBe(true);
  });
});

describe("isGameFinalized", () => {
  it('returns true for status === "final"', () => {
    expect(isGameFinalized({ status: "final" })).toBe(true);
  });
  it('returns true for legacy status === "completed"', () => {
    expect(isGameFinalized({ status: "completed" })).toBe(true);
  });
  it("returns true when both scores are finite even with no status", () => {
    expect(isGameFinalized({ teamScore: 7, opponentScore: 4 })).toBe(true);
  });
  it("returns true when both scores are finite numeric strings", () => {
    expect(isGameFinalized({ teamScore: "5", opponentScore: "3" })).toBe(true);
  });
  it("returns false for scheduled games with no scores", () => {
    expect(isGameFinalized({ status: "scheduled" })).toBe(false);
  });
  it("returns false for postponed", () => {
    expect(isGameFinalized({ status: "postponed" })).toBe(false);
  });
  it("returns false when only one score is set", () => {
    expect(isGameFinalized({ teamScore: 5 })).toBe(false);
    expect(isGameFinalized({ opponentScore: 5 })).toBe(false);
  });
  it("returns false for null/undefined input", () => {
    expect(isGameFinalized(null)).toBe(false);
    expect(isGameFinalized(undefined)).toBe(false);
  });
  it("returns false for explicit null teamScore + opponentScore (future game)", () => {
    // Regression: this was the "future games shown as 0-0 tie" bug.
    // Number(null) === 0 and Number.isFinite(0) === true, so the old
    // predicate silently turned every brand-new scheduled game into
    // a counted 0-0 tie. The strict null guard at the top of the
    // helper now rejects it.
    expect(
      isGameFinalized({
        status: "scheduled",
        teamScore: null,
        opponentScore: null,
      })
    ).toBe(false);
  });
  it("returns false for empty-string scores (in-progress ScoreEditor state)", () => {
    // Score editor seeds inputs as "" when no score is set. Number("")
    // is also 0, so the same regression class — strict guard catches it.
    expect(isGameFinalized({ teamScore: "", opponentScore: "" })).toBe(
      false
    );
    expect(isGameFinalized({ teamScore: "", opponentScore: 5 })).toBe(false);
    expect(isGameFinalized({ teamScore: 5, opponentScore: "" })).toBe(false);
  });
  it("still counts a real 0-0 tie when both scores are numeric 0", () => {
    // The strict guard rejects nullish/empty but real zeros still
    // count — actual scoreless games are valid finalized games.
    expect(isGameFinalized({ teamScore: 0, opponentScore: 0 })).toBe(true);
  });
});

describe("buildSeasonBenchImbalance orphan-id coalescing", () => {
  // Two finalized 2-position (P/C), 1-bench, 2-inning games. "Sam"
  // appears under id "old-sam" in game 1 (written before he was deleted
  // from the roster) and under "new-sam" in game 2 (after re-add). The
  // current roster only has "new-sam".
  const game = (id, samId) => ({
    id,
    status: "final",
    teamScore: 1,
    opponentScore: 0,
    lineup: [
      {
        P: { id: "A", name: "Alice" },
        C: { id: samId, name: "Sam" },
        BENCH: [{ id: "B", name: "Bob" }],
      },
      {
        P: { id: "B", name: "Bob" },
        C: { id: "A", name: "Alice" },
        BENCH: [{ id: samId, name: "Sam" }],
      },
    ],
  });
  const games = [game("g1", "old-sam"), game("g2", "new-sam")];
  const roster = [
    { id: "A", name: "Alice" },
    { id: "B", name: "Bob" },
    { id: "new-sam", name: "Sam" },
  ];

  it("merges a re-added player's pre-deletion history into the current id", () => {
    const out = buildSeasonBenchImbalance(games, "", roster);
    const sam = out.get("new-sam");
    expect(sam).toBeDefined();
    // Sam fielded 1 inning in each game → 2 total across both games.
    expect(sam.totalDefense).toBe(2);
    expect(sam.gamesAttended).toBe(2);
    expect(sam.totalBench).toBe(2);
    // The orphan key must not survive — its innings were coalesced.
    expect(out.get("old-sam")).toBeUndefined();
  });

  it("without a roster, keeps the legacy by-raw-id behaviour", () => {
    const out = buildSeasonBenchImbalance(games, "");
    // No coalescing: the two ids stay split, one game each.
    expect(out.get("old-sam")?.gamesAttended).toBe(1);
    expect(out.get("new-sam")?.gamesAttended).toBe(1);
  });

  it("does not merge two distinct live players who share a name", () => {
    // Both ids are on the current roster, so the name fallback must not
    // fire — each "Sam" keeps their own innings.
    const liveRoster = [
      { id: "A", name: "Alice" },
      { id: "B", name: "Bob" },
      { id: "old-sam", name: "Sam" },
      { id: "new-sam", name: "Sam" },
    ];
    const out = buildSeasonBenchImbalance(games, "", liveRoster);
    expect(out.get("old-sam")?.gamesAttended).toBe(1);
    expect(out.get("new-sam")?.gamesAttended).toBe(1);
  });
});

describe("evalRoundDateForSave", () => {
  const isoLocal = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  it("stamps a save made on a due date with that due date", () => {
    // Mar 15, 2026 is a scheduled due date.
    expect(evalRoundDateForSave(new Date(2026, 2, 15, 12))).toBe("2026-03-15");
  });

  it("snaps a save filed a few days early to the upcoming due date", () => {
    expect(evalRoundDateForSave(new Date(2026, 2, 12, 9))).toBe("2026-03-15");
  });

  it("stamps a preseason save with Feb 1", () => {
    expect(evalRoundDateForSave(new Date(2026, 1, 1, 17))).toBe("2026-02-01");
  });

  it("snaps a late-January save to that year's Feb 1, not the prior fall", () => {
    expect(evalRoundDateForSave(new Date(2026, 0, 25, 12))).toBe("2026-02-01");
  });

  it("never returns the literal off-season day — always a real due date", () => {
    const out = evalRoundDateForSave(new Date(2026, 6, 1, 12)); // Jul 1
    expect(out).not.toBe("2026-07-01");
    const allDue = new Set(
      [
        ...evalDueDatesForYear(2025),
        ...evalDueDatesForYear(2026),
        ...evalDueDatesForYear(2027),
      ].map(isoLocal)
    );
    expect(allDue.has(out)).toBe(true);
  });
});

describe("restampEvalDueDates", () => {
  it("re-stamps a roster round onto its nearest due date", () => {
    const out = restampEvalDueDates([
      {
        id: "a",
        coachRole: "Head",
        evaluatorId: "u1",
        date: "2026-03-17",
        grades: {},
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].date).toBe("2026-03-15");
  });

  it("leaves tryout grades (tryoutSignupId) untouched", () => {
    const out = restampEvalDueDates([
      {
        id: "t",
        evaluatorId: "u1",
        date: "2026-07-04",
        tryoutSignupId: "s1",
        grades: {},
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-07-04");
  });

  it("collapses two same-coach rounds on one due date, keeping the freshest", () => {
    const out = restampEvalDueDates([
      {
        id: "old",
        coachRole: "Head",
        evaluatorId: "u1",
        date: "2026-03-14",
        grades: { x: 1 },
      },
      {
        id: "new",
        coachRole: "Head",
        evaluatorId: "u1",
        date: "2026-03-16",
        grades: { x: 2 },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("new");
    expect(out[0].date).toBe("2026-03-15");
  });

  it("keeps distinct coaches/roles that land on the same date separate", () => {
    const out = restampEvalDueDates([
      {
        id: "h",
        coachRole: "Head",
        evaluatorId: "u1",
        date: "2026-03-16",
        grades: {},
      },
      {
        id: "a",
        coachRole: "Assistant",
        evaluatorId: "u2",
        date: "2026-03-16",
        grades: {},
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.date === "2026-03-15")).toBe(true);
  });

  it("preserves original order of surviving rounds", () => {
    const out = restampEvalDueDates([
      {
        id: "feb",
        coachRole: "Head",
        evaluatorId: "u1",
        date: "2026-02-02",
        grades: {},
      },
      {
        id: "mar",
        coachRole: "Head",
        evaluatorId: "u1",
        date: "2026-03-16",
        grades: {},
      },
    ]);
    expect(out.map((e) => e.id)).toEqual(["feb", "mar"]);
    expect(out[0].date).toBe("2026-02-01");
    expect(out[1].date).toBe("2026-03-15");
  });

  it("is idempotent", () => {
    const once = restampEvalDueDates([
      {
        id: "feb",
        coachRole: "Head",
        evaluatorId: "u1",
        date: "2026-02-02",
        grades: {},
      },
      {
        id: "mar",
        coachRole: "Head",
        evaluatorId: "u1",
        date: "2026-03-16",
        grades: {},
      },
    ]);
    const twice = restampEvalDueDates(once);
    expect(twice).toEqual(once);
  });

  it("returns [] for non-array input", () => {
    expect(restampEvalDueDates(null)).toEqual([]);
    expect(restampEvalDueDates(undefined)).toEqual([]);
  });
});

describe("gamesDueForReminder", () => {
  // Fix "now" to a local-noon anchor so the local-calendar-day math is stable
  // regardless of the machine's timezone.
  const now = new Date(2026, 4, 10, 12, 0, 0); // 2026-05-10 local
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const today = iso(now);
  const tomorrow = iso(new Date(2026, 4, 11));
  const yesterday = iso(new Date(2026, 4, 9));
  const dayAfter = iso(new Date(2026, 4, 12));

  it("returns [] for empty / non-array input", () => {
    expect(gamesDueForReminder(null, "morning_of", now)).toEqual([]);
    expect(gamesDueForReminder([], "day_before", now)).toEqual([]);
  });

  it("morning_of fires only for games today", () => {
    const due = gamesDueForReminder(
      [
        { id: "today", date: today, opponent: "Rays" },
        { id: "tom", date: tomorrow, opponent: "Cubs" },
      ],
      "morning_of",
      now
    );
    expect(due.map((g) => g.id)).toEqual(["today"]);
    expect(due[0].whenLabel).toBe("Today");
    expect(due[0].daysUntil).toBe(0);
    expect(due[0].opponent).toBe("Rays");
  });

  it("day_before fires for today and tomorrow (catch-up window)", () => {
    const due = gamesDueForReminder(
      [
        { id: "today", date: today },
        { id: "tom", date: tomorrow },
        { id: "later", date: dayAfter },
      ],
      "day_before",
      now
    );
    expect(due.map((g) => g.id)).toEqual(["today", "tom"]);
    expect(due.find((g) => g.id === "tom").whenLabel).toBe("Tomorrow");
  });

  it("skips finalized, postponed, past, and undated games", () => {
    const due = gamesDueForReminder(
      [
        { id: "final", date: today, status: "final" },
        { id: "scored", date: today, teamScore: 5, opponentScore: 3 },
        { id: "postponed", date: today, status: "postponed" },
        { id: "past", date: yesterday },
        { id: "nodate", date: "" },
        { id: "garbled", date: "not-a-date" },
        { id: "ok", date: today, opponent: "" },
      ],
      "day_before",
      now
    );
    expect(due.map((g) => g.id)).toEqual(["ok"]);
    // Missing opponent falls back to TBD.
    expect(due[0].opponent).toBe("TBD");
  });

  it("normalizes slash dates and sorts by date", () => {
    const due = gamesDueForReminder(
      [
        { id: "tom", date: "05/11/2026" },
        { id: "today", date: "5/10/26" },
      ],
      "day_before",
      now
    );
    expect(due.map((g) => g.id)).toEqual(["today", "tom"]);
    expect(due[0].date).toBe("2026-05-10");
  });
});
