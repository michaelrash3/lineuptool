import {
  normalizeDateToIso,
  parseCsvRecords,
  parseGameChangerPastSeasonCsv,
  evalDueDatesForYear,
  evalPromptStatus,
  evalRoundDateForSave,
  evalRoundRecency,
  restampEvalDueDates,
  emailPromptStatus,
  isReturning,
  getReturningDecision,
  lineupSlotMatchesPlayer,
  isGameFinalized,
  buildSeasonBenchImbalance,
  gamesDueForReminder,
  buildPublicMirror,
  resolveTryoutDateForSlug,
  normalizeTryoutDateLinks,
  revertOptimisticUpdate,
  buildScheduleIcs,
  recordPitchingOuting,
  summarizePitchingWorkload,
  estimateDocSizeBytes,
  FIRESTORE_DOC_LIMIT_BYTES,
  buildSeasonPositionVariety,
  buildSeasonSummary,
  compareRecordsByWinningPercentage,
  recordWinningPercentage,
  clampText,
  isValidEmail,
  isSafeCssColor,
  isSafeImageUrl,
  SIGNUP_LIMITS,
  extractAdvancedStats,
  parseGameChangerStatsCsv,
  stripPitchingStatsForFormat,
  aggregateGameLines,
  teamStatAverages,
  deriveSeasonFromGameLines,
  latestGameLineMovement,
  seasonSeriesFromGameLines,
  isPlayerScheduledOut,
  addAbsenceDateRange,
  removeAbsenceDates,
  foldAbsenceRanges,
  countAvailableOnDate,
  isShortHandedOnDate,
  playersOutOnDate,
  buildMonthGrid,
  isDepartedPlayer,
  recentGameLines,
  evalStatHint,
  deriveTournaments,
  recordCatchingOuting,
  sameDayRoleSets,
  mergeTeamEntries,
  blockedRosterWipeReason,
  formatCurrency,
  budgetTotal,
  suggestedFeePerPlayer,
  buildPlayerFeeBreakdown,
  financeSummary,
  teamFeesStatus,
  budgetItemAmount,
  roundUpToIncrement,
  incomeTotal,
  sponsorshipTotal,
  transactionLedger,
  budgetActuals,
  monthlyCashflow,
  owesReminderText,
  ledgerCsv,
  yearComparison,
  rollFinancesForNewSeason,
} from "./helpers";

describe("extractAdvancedStats (section-aware GameChanger stats)", () => {
  // label row puts the section name at each section's first column; the header
  // row has the real column names. Batting and Pitching both have h/bb here —
  // the extractor must read pitching's, not batting's.
  const labelRow = [
    "batting",
    "",
    "",
    "",
    "pitching",
    "",
    "",
    "",
    "",
    "fielding",
    "",
    "",
    "",
  ];
  const headerRow = [
    "gp",
    "ops",
    "h",
    "bb",
    "ip",
    "s%",
    "h",
    "bb",
    "whip",
    "fpct",
    "e",
    "cs%",
    "pb",
  ];
  const cols = [
    "10",
    "0.900",
    "12",
    "5",
    "20.0",
    "65%",
    "8",
    "3",
    "1.10",
    ".952",
    "2",
    "40%",
    "1",
  ];

  it("reads pitching + fielding columns from their own sections", () => {
    const s = extractAdvancedStats(labelRow, headerRow, cols);
    expect(s.pIp).toBe(20);
    expect(s.pStrikePct).toBeCloseTo(0.65);
    expect(s.pWhip).toBeCloseTo(1.1);
    expect(s.fFpct).toBeCloseTo(0.952);
    expect(s.fErrors).toBe(2);
    expect(s.fCsPct).toBeCloseTo(0.4);
    expect(s.fPb).toBe(1);
  });

  it("does not pull Batting columns of the same name into pitching", () => {
    const s = extractAdvancedStats(labelRow, headerRow, cols);
    // h/bb aren't in the pitching/fielding maps, so neither the batting nor the
    // pitching copies leak in — and the batting h (12) never masquerades as a
    // pitching stat.
    expect(s).not.toHaveProperty("h");
    expect(s).not.toHaveProperty("bb");
  });

  it("returns {} when the export has no section labels", () => {
    expect(extractAdvancedStats(undefined, headerRow, cols)).toEqual({});
    const noLabels = ["", "", ""];
    expect(
      extractAdvancedStats(noLabels, ["ops", "h", "bb"], ["1", "2", "3"]),
    ).toEqual({});
  });

  it("reads per-position innings from the fielding block without batting collision", () => {
    // Batting 2b/3b (doubles/triples) and SF must NOT bleed into the fielding
    // position-innings columns of the same name. Each section is range-bounded.
    const lbl = ["batting", "", "", "fielding", "", "", "", "", "", ""];
    const hdr = [
      "2b",
      "3b",
      "sf",
      "fpct",
      "p",
      "1b",
      "2b",
      "3b",
      "ss",
      "total",
    ];
    const row = ["4", "1", "2", ".980", "5", "0", "1", "0", "6", "12"];
    const s = extractAdvancedStats(lbl, hdr, row);
    // Fielding-section innings:
    expect(s.fInnP).toBe(5);
    expect(s.fInn2B).toBe(1); // fielding 2B innings, not batting doubles (4)
    expect(s.fInn3B).toBe(0);
    expect(s.fInnSS).toBe(6);
    expect(s.fInnTotal).toBe(12);
    expect(s.fFpct).toBeCloseTo(0.98);
    // Batting doubles (4)/triples (1)/SF (2) are outside FIELDING_COLS, so they
    // never appear here.
    expect(s).not.toHaveProperty("doubles");
  });
});

describe("CSV helpers", () => {
  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    const rows = parseCsvRecords(
      'First,Last,Note\r\nJane,"Smith, Jr.","Line one\nLine two"\r\nBob,"O""Brien","He said ""go"""',
    );

    expect(rows).toEqual([
      ["First", "Last", "Note"],
      ["Jane", "Smith, Jr.", "Line one\nLine two"],
      ["Bob", 'O"Brien', 'He said "go"'],
    ]);
  });

  it("keeps GameChanger compatibility with quoted newlines", () => {
    const result = parseGameChangerPastSeasonCsv(
      'First,Last,OPS,AB,H\n"Ava",Rivera,.900,10,4\n"Mia","Stone",.700,8,2\nTotals,,.800,18,6\nGlossary,"ignored\nfooter",,,\n',
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
      (d) => d.getMonth() >= 8 && d.getMonth() <= 9,
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
    const dates = evalDueDatesForYear(year!);
    const mar15s = dates.filter(
      (d) => d.getMonth() === 2 && d.getDate() === 15,
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
    const dates = evalDueDatesForYear(year!);
    const hasSep1 = dates.some((d) => d.getMonth() === 8 && d.getDate() === 1);
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
      new Date(2026, 1, 2),
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
      new Date(2026, 2, 13),
    );
    expect(before.active).toBe(false);
    // And the day after the due date — still cleared, not re-nagging.
    const after = evalPromptStatus(
      submittedTeam,
      uid,
      "Head",
      new Date(2026, 2, 16),
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
      new Date(2026, 2, 22),
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
      onFeb1,
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

describe("getReturningDecision planning helper", () => {
  it("returns unknown when modern returning intent is missing", () => {
    expect(getReturningDecision({})).toBe("unknown");
    expect(getReturningDecision({ playerStatus: "returning" })).toBe("unknown");
  });

  it("maps explicit yes/no intent", () => {
    expect(getReturningDecision({ returning: true })).toBe("yes");
    expect(getReturningDecision({ returning: false })).toBe("no");
  });

  it("maps legacy released/declined statuses to no", () => {
    expect(getReturningDecision({ playerStatus: "released" })).toBe("no");
    expect(getReturningDecision({ playerStatus: "declined" })).toBe("no");
  });

  it("lets explicit returning intent beat legacy status", () => {
    expect(
      getReturningDecision({ returning: true, playerStatus: "released" }),
    ).toBe("yes");
    expect(
      getReturningDecision({ returning: false, playerStatus: "returning" }),
    ).toBe("no");
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
    expect(isReturning({ returning: false, playerStatus: "returning" })).toBe(
      false,
    );
    expect(isReturning({ returning: true, playerStatus: "released" })).toBe(
      true,
    );
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
    expect(lineupSlotMatchesPlayer(slot, player, new Set(["new", "old"]))).toBe(
      false,
    );
  });

  it("returns false for null/empty slots", () => {
    const player = { id: "p1", name: "Test" };
    expect(lineupSlotMatchesPlayer(null, player, new Set(["p1"]))).toBe(false);
    expect(lineupSlotMatchesPlayer(undefined, player, new Set(["p1"]))).toBe(
      false,
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
      }),
    ).toBe(false);
  });
  it("returns false for empty-string scores (in-progress ScoreEditor state)", () => {
    // Score editor seeds inputs as "" when no score is set. Number("")
    // is also 0, so the same regression class — strict guard catches it.
    expect(isGameFinalized({ teamScore: "", opponentScore: "" })).toBe(false);
    expect(isGameFinalized({ teamScore: "", opponentScore: 5 })).toBe(false);
    expect(isGameFinalized({ teamScore: 5, opponentScore: "" })).toBe(false);
  });
  it("still counts a real 0-0 tie when both scores are numeric 0", () => {
    // The strict guard rejects nullish/empty but real zeros still
    // count — actual scoreless games are valid finalized games.
    expect(isGameFinalized({ teamScore: 0, opponentScore: 0 })).toBe(true);
  });
});

describe("buildSeasonBenchImbalance (actual innings from imported box scores)", () => {
  // A finalized 6-inning game whose stats have been imported. fInnTotal is the
  // GameChanger fielding "Total" (defensive innings); game length is inferred
  // as the max fInnTotal across the box-score lines. Bench = gameInnings − def.
  const game = {
    id: "g1",
    status: "final",
    teamScore: 5,
    opponentScore: 3,
    playerStats: {
      p1: { fInnTotal: 6 }, // played the whole game in the field
      p2: { fInnTotal: 6 },
      p3: { fInnTotal: 4 }, // sat 2
      p4: { fInnTotal: 2 }, // sat 4
    },
  };

  it("apportions defense and bench from the fielding Total column", () => {
    const out = buildSeasonBenchImbalance([game], "");
    // gameInnings 6, playerCount 4, totalDefense 18 → expected 4.5 each,
    // benchSlots 6*4-18 = 6 → minBench floor(6/4) = 1.
    expect(out.get("p1")).toMatchObject({
      totalDefense: 6,
      totalBench: 0,
      extraSits: 0,
      expectedDefense: 4.5,
      gamesAttended: 1,
    });
    expect(out.get("p4")).toMatchObject({
      totalDefense: 2,
      totalBench: 4,
      extraSits: 3, // bench 4 − minBench 1
      gamesAttended: 1,
    });
  });

  it("skips games whose stats haven't been imported (actuals only)", () => {
    const noStats = {
      id: "g2",
      status: "final",
      teamScore: 1,
      opponentScore: 0,
    };
    const out = buildSeasonBenchImbalance([noStats], "");
    expect(out.size).toBe(0);
  });

  it("excludes the current game and games with no fielded innings", () => {
    const zero = {
      id: "g3",
      status: "final",
      teamScore: 1,
      opponentScore: 0,
      playerStats: { p1: { ab: 3 } }, // batted only, no fielding Total
    };
    expect(buildSeasonBenchImbalance([game], "g1").size).toBe(0); // current game excluded
    expect(buildSeasonBenchImbalance([zero], "").size).toBe(0); // gameInnings 0
  });
});

describe("evalRoundDateForSave", () => {
  const isoLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
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
      ].map(isoLocal),
    );
    expect(allDue.has(out)).toBe(true);
  });
});

describe("evalRoundRecency", () => {
  it("sorts newest date first", () => {
    const a = { date: "2026-05-01" };
    const b = { date: "2026-06-01" };
    expect([a, b].sort(evalRoundRecency)[0]).toBe(b);
  });

  it("breaks same-date ties by createdAt so the newest round leads", () => {
    const older = { date: "2026-06-01", createdAt: 100 };
    const newer = { date: "2026-06-01", createdAt: 200 };
    expect([older, newer].sort(evalRoundRecency)[0]).toBe(newer);
    // "is strictly newer" check used by the latest-round pickers
    expect(evalRoundRecency(newer, older)).toBeLessThan(0);
  });

  it("treats rounds without createdAt as oldest among ties", () => {
    const legacy = { date: "2026-06-01" };
    const stamped = { date: "2026-06-01", createdAt: 50 };
    expect([legacy, stamped].sort(evalRoundRecency)[0]).toBe(stamped);
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
  const iso = (d: Date) => {
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
      now,
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
      now,
    );
    expect(due.map((g) => g.id)).toEqual(["today", "tom"]);
    expect(due.find((g) => g.id === "tom")!.whenLabel).toBe("Tomorrow");
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
      now,
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
      now,
    );
    expect(due.map((g) => g.id)).toEqual(["today", "tom"]);
    expect(due[0].date).toBe("2026-05-10");
  });
});

describe("buildPublicMirror", () => {
  const fullTeam = {
    name: "Sharks",
    primaryColor: "#111111",
    secondaryColor: "#222222",
    tertiaryColor: "#333333",
    logoUrl: "data:image/jpeg;base64,abc",
    currentSeason: "Spring 2026",
    teamAge: "10U",
    tryoutsOpen: true,
    tryoutsPhase: "open",
    tryoutShareId: "share123",
    tryoutDateSlug: "2026-05-01",
    tryoutDates: ["2026-05-01", "", "2026-05-08"],
    // Sensitive — must never appear in the mirror:
    players: [{ id: "p1", name: "Kid", stats: {} }],
    games: [{ id: "g1" }],
    evaluationEvents: [{ id: "e1", grades: {} }],
    tryoutSignups: [{ email: "parent@example.com" }],
    interestSignups: [{ email: "lead@example.com" }],
    members: ["uid-1", "uid-2"],
    ownerId: "uid-1",
    coachRoles: { "uid-1": "head" },
    joinCode: "ABC234",
  };

  it("carries only the allowlisted branding + tryout config", () => {
    const mirror = buildPublicMirror(fullTeam);
    expect(mirror).toEqual({
      name: "Sharks",
      primaryColor: "#111111",
      secondaryColor: "#222222",
      tertiaryColor: "#333333",
      logoUrl: "data:image/jpeg;base64,abc",
      currentSeason: "Spring 2026",
      teamAge: "10U",
      tryoutsOpen: true,
      tryoutsPhase: "open",
      tryoutShareId: "share123",
      tryoutDateSlug: "2026-05-01",
      tryoutDates: ["2026-05-01", "2026-05-08"],
      // Derived from the legacy single-slug field — slug/date only, no PII.
      tryoutDateLinks: [{ slug: "2026-05-01", date: "2026-05-01" }],
      tryoutDateBySlug: { "2026-05-01": "2026-05-01" },
      tryoutDateSlugs: ["2026-05-01"],
      // Opt-in public coach contact (empty here — fullTeam sets neither).
      headCoachName: "",
      headCoachEmail: "",
    });
  });

  it("mirrors opt-in public head-coach contact (and not the private phone)", () => {
    const mirror = buildPublicMirror({
      ...fullTeam,
      headCoachName: "Coach Smith",
      headCoachPublicEmail: "coach@sharks.com",
      headCoachPhone: "(555) 000-1111",
    });
    expect(mirror.headCoachName).toBe("Coach Smith");
    expect(mirror.headCoachEmail).toBe("coach@sharks.com");
    // The private offer-letter phone must never reach the public doc.
    expect(mirror).not.toHaveProperty("headCoachPhone");
  });

  it("carries the explicit per-date link mapping for new teams", () => {
    const mirror = buildPublicMirror({
      ...fullTeam,
      tryoutDateSlug: "sharks-2026-05-08-zz9",
      tryoutDateLinks: [
        { slug: "sharks-2026-05-01-aa1", date: "2026-05-01" },
        { slug: "sharks-2026-05-08-zz9", date: "2026-05-08" },
      ],
    });
    expect(mirror.tryoutDateLinks).toEqual([
      { slug: "sharks-2026-05-01-aa1", date: "2026-05-01" },
      { slug: "sharks-2026-05-08-zz9", date: "2026-05-08" },
    ]);
    expect(mirror.tryoutDateBySlug).toEqual({
      "sharks-2026-05-01-aa1": "2026-05-01",
      "sharks-2026-05-08-zz9": "2026-05-08",
    });
    expect(mirror.tryoutDateSlugs).toEqual([
      "sharks-2026-05-01-aa1",
      "sharks-2026-05-08-zz9",
    ]);
  });

  it("never leaks sensitive fields", () => {
    const mirror = buildPublicMirror(fullTeam);
    for (const sensitive of [
      "players",
      "games",
      "evaluationEvents",
      "tryoutSignups",
      "interestSignups",
      "members",
      "ownerId",
      "coachRoles",
      "joinCode",
    ]) {
      expect(mirror).not.toHaveProperty(sensitive);
    }
  });

  it("produces a stable shape for an empty/never-shared team", () => {
    const mirror = buildPublicMirror({});
    expect(mirror.tryoutShareId).toBeNull();
    expect(mirror.tryoutDateSlug).toBeNull();
    expect(mirror.tryoutsOpen).toBe(false);
    expect(mirror.tryoutDates).toEqual([]);
    expect(mirror.name).toBe("");
  });

  it("handles null/undefined input without throwing", () => {
    expect(() => buildPublicMirror(null)).not.toThrow();
    expect(buildPublicMirror(undefined).tryoutDates).toEqual([]);
  });
});

describe("resolveTryoutDateForSlug", () => {
  const team = {
    tryoutDates: ["2026-04-10", "2026-05-22"],
    tryoutDateLinks: [
      { slug: "hawks-2026-04-10-aaa", date: "2026-04-10" },
      { slug: "hawks-2026-05-22-bbb", date: "2026-05-22" },
    ],
    tryoutDateBySlug: {
      "hawks-2026-04-10-aaa": "2026-04-10",
      "hawks-2026-05-22-bbb": "2026-05-22",
    },
  };

  it("pins each slug to its OWN date (never the first configured date)", () => {
    expect(resolveTryoutDateForSlug(team, "hawks-2026-05-22-bbb")).toBe(
      "2026-05-22",
    );
    expect(resolveTryoutDateForSlug(team, "hawks-2026-04-10-aaa")).toBe(
      "2026-04-10",
    );
  });

  it("falls back to the link list when no bySlug map is present", () => {
    const legacyish = { tryoutDateLinks: team.tryoutDateLinks };
    expect(resolveTryoutDateForSlug(legacyish, "hawks-2026-05-22-bbb")).toBe(
      "2026-05-22",
    );
  });

  it("recovers a legacy single-slug team's date from the embedded date", () => {
    // Pre-mapping teams only had tryoutDateSlug + tryoutDates; the date is in
    // the slug. We must still resolve the embedded date, not configured[0].
    const legacy = {
      tryoutDateSlug: "team-1-2026-05-22-xyz",
      tryoutDates: ["2026-04-10", "2026-05-22"],
    };
    expect(resolveTryoutDateForSlug(legacy, "team-1-2026-05-22-xyz")).toBe(
      "2026-05-22",
    );
  });

  it("returns '' for an unknown/blank slug", () => {
    expect(resolveTryoutDateForSlug(team, "")).toBe("");
    expect(resolveTryoutDateForSlug(null, "x")).toBe("");
  });
});

describe("normalizeTryoutDateLinks", () => {
  it("dedupes by slug and drops malformed entries", () => {
    const links = normalizeTryoutDateLinks({
      tryoutDateLinks: [
        { slug: "a", date: "2026-04-10" },
        { slug: "a", date: "2026-04-10" }, // dup slug
        { slug: "", date: "2026-04-10" }, // no slug
        { slug: "b", date: "" }, // no date
        { slug: "c", date: "2026-05-22" },
      ],
    });
    expect(links).toEqual([
      { slug: "a", date: "2026-04-10" },
      { slug: "c", date: "2026-05-22" },
    ]);
  });
});

describe("revertOptimisticUpdate", () => {
  it("restores prior values for keys still holding the attempted value", () => {
    const attempted = { name: "New", tryoutsOpen: true };
    const prevValues = { name: "Old", tryoutsOpen: false };
    const current = { name: "New", tryoutsOpen: true, other: 1 };
    expect(revertOptimisticUpdate(current, attempted, prevValues)).toEqual({
      name: "Old",
      tryoutsOpen: false,
      other: 1,
    });
  });

  it("does not clobber a key the user changed after the optimistic write", () => {
    const attempted = { name: "New" };
    const prevValues = { name: "Old" };
    // User typed again — current.name is a different reference/value now.
    const current = { name: "Newer" };
    expect(revertOptimisticUpdate(current, attempted, prevValues)).toBe(
      current,
    );
  });
});

describe("buildScheduleIcs", () => {
  const now = new Date(Date.UTC(2026, 4, 1, 12, 0, 0)); // fixed DTSTAMP anchor

  it("emits a sorted all-day VEVENT per eligible game", () => {
    const ics = buildScheduleIcs(
      [
        { id: "g2", date: "2026-05-08", opponent: "Cubs" },
        { id: "g1", date: "05/01/2026", opponent: "Rays", time: "5:30 PM" },
      ],
      "Hawks",
      now,
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    // Two events, sorted by date (g1 before g2).
    const uids = [...ics.matchAll(/UID:(.+)/g)].map((m) => m[1].trim());
    expect(uids).toEqual(["game-g1@coachscard", "game-g2@coachscard"]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260501");
    // All-day DTEND is exclusive (next day).
    expect(ics).toContain("DTEND;VALUE=DATE:20260502");
    expect(ics).toContain("SUMMARY:Hawks vs Rays (5:30 PM)");
    expect(ics).toContain("DTSTAMP:20260501T120000Z");
  });

  it("omits finalized, postponed, and undated games", () => {
    const ics = buildScheduleIcs(
      [
        { id: "done", date: "2026-05-01", status: "final" },
        { id: "scored", date: "2026-05-02", teamScore: 5, opponentScore: 3 },
        { id: "pp", date: "2026-05-03", status: "postponed" },
        { id: "nodate", date: "" },
        { id: "ok", date: "2026-05-04", opponent: "Sox" },
      ],
      "Hawks",
      now,
    );
    const uids = [...ics.matchAll(/UID:(.+)/g)].map((m) => m[1].trim());
    expect(uids).toEqual(["game-ok@coachscard"]);
  });

  it("escapes commas in the summary and defaults a missing opponent", () => {
    const ics = buildScheduleIcs(
      [{ id: "g", date: "2026-05-01" }],
      "Hawks, AAA",
      now,
    );
    expect(ics).toContain("SUMMARY:Hawks\\, AAA vs TBD");
  });

  it("returns a valid empty calendar for no eligible games", () => {
    const ics = buildScheduleIcs([], "Hawks", now);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(() => buildScheduleIcs(null, null, now)).not.toThrow();
  });
});

describe("recordPitchingOuting", () => {
  it("starts a log and sets most-recent fields for a first outing", () => {
    const out = recordPitchingOuting(null, "2026-05-01", 40);
    expect(out).toMatchObject({
      recentPitches: 40,
      lastPitchDate: "2026-05-01",
    });
    expect(out.log).toEqual([{ date: "2026-05-01", pitches: 40 }]);
  });

  it("appends new outings newest-first", () => {
    let p = recordPitchingOuting(null, "2026-05-01", 40);
    p = recordPitchingOuting(p, "2026-05-08", 55);
    expect(p.log).toEqual([
      { date: "2026-05-08", pitches: 55 },
      { date: "2026-05-01", pitches: 40 },
    ]);
    expect(p.recentPitches).toBe(55);
  });

  it("dedupes by date so re-finalizing a game updates the entry", () => {
    let p = recordPitchingOuting(null, "2026-05-01", 40);
    p = recordPitchingOuting(p, "2026-05-01", 48);
    expect(p.log).toEqual([{ date: "2026-05-01", pitches: 48 }]);
  });

  it("caps the log at 12 entries", () => {
    let p = null;
    for (let i = 1; i <= 15; i++) {
      const d = `2026-05-${String(i).padStart(2, "0")}`;
      p = recordPitchingOuting(p, d, i);
    }
    expect(p!.log).toHaveLength(12);
    // Newest retained, oldest dropped.
    expect(p!.log[0].date).toBe("2026-05-15");
    expect(p!.log[p!.log.length - 1].date).toBe("2026-05-04");
  });

  it("preserves other pitching fields", () => {
    const out = recordPitchingOuting({ someFlag: true }, "2026-05-01", 10);
    expect(out.someFlag).toBe(true);
  });

  it("keeps separate entries for two games on the same date (doubleheader)", () => {
    let p = recordPitchingOuting(null, "2026-05-01", 30, "g1");
    p = recordPitchingOuting(p, "2026-05-01", 25, "g2");
    expect(p!.log).toEqual([
      { date: "2026-05-01", pitches: 25, gameId: "g2" },
      { date: "2026-05-01", pitches: 30, gameId: "g1" },
    ]);
    expect(p!.recentPitches).toBe(25);
  });

  it("updates in place when the same game is re-finalized (by gameId)", () => {
    let p = recordPitchingOuting(null, "2026-05-01", 30, "g1");
    p = recordPitchingOuting(p, "2026-05-01", 42, "g1");
    expect(p!.log).toEqual([{ date: "2026-05-01", pitches: 42, gameId: "g1" }]);
  });

  it("preserves a legacy date-keyed entry when a new game is added that day", () => {
    // Legacy entry has no gameId (written before keying by game).
    const legacy = { log: [{ date: "2026-05-01", pitches: 20 }] };
    const out = recordPitchingOuting(legacy, "2026-05-01", 33, "g2");
    expect(out.log).toEqual([
      { date: "2026-05-01", pitches: 33, gameId: "g2" },
      { date: "2026-05-01", pitches: 20 },
    ]);
  });
});

describe("summarizePitchingWorkload", () => {
  it("returns zeros for a pitcher with no log", () => {
    expect(summarizePitchingWorkload(null)).toEqual({
      outings: 0,
      totalPitches: 0,
      maxPitches: 0,
      lastDate: null,
    });
    expect(
      summarizePitchingWorkload({ recentPitches: 5 } as any),
    ).toMatchObject({ outings: 0, totalPitches: 0 });
  });

  it("sums totals, tracks the high, and the latest date", () => {
    const pitching = {
      log: [
        { date: "2026-05-08", pitches: 55 },
        { date: "2026-05-01", pitches: 40 },
        { date: "2026-04-20", pitches: 12 },
      ],
    };
    expect(summarizePitchingWorkload(pitching)).toEqual({
      outings: 3,
      totalPitches: 107,
      maxPitches: 55,
      lastDate: "2026-05-08",
    });
  });
});

describe("estimateDocSizeBytes", () => {
  it("measures UTF-8 byte length of the serialized value", () => {
    expect(estimateDocSizeBytes({})).toBe(2); // "{}"
    expect(estimateDocSizeBytes({ a: "x" })).toBe(
      JSON.stringify({ a: "x" }).length,
    );
  });

  it("counts multi-byte characters as multiple bytes", () => {
    // "é" is 2 UTF-8 bytes; JSON adds the surrounding quotes (2 bytes).
    expect(estimateDocSizeBytes("é")).toBe(4);
  });

  it("returns 0 for unserializable input rather than throwing", () => {
    const circular: any = {};
    circular.self = circular;
    expect(estimateDocSizeBytes(circular)).toBe(0);
  });

  it("exposes the Firestore 1 MiB document cap", () => {
    expect(FIRESTORE_DOC_LIMIT_BYTES).toBe(1048576);
  });
});

describe("buildSeasonPositionVariety (per-position innings from imported box scores)", () => {
  // Per-position innings come from the GameChanger fielding block. p1: SS only
  // (infield); p2: LF + CF (outfield); p3: P + C (battery); p4: SF, which is
  // right-center field → mapped to the RCF outfield label.
  const finalGame = {
    id: "g1",
    status: "final",
    teamScore: 5,
    opponentScore: 3,
    playerStats: {
      p1: { fInnSS: 2, fInnTotal: 2 },
      p2: { fInnLF: 1, fInnCF: 1, fInnTotal: 2 },
      p3: { fInnP: 1, fInnC: 1, fInnTotal: 2 },
      p4: { fInnSF: 3, fInnTotal: 3 },
    },
  };

  it("tallies innings per position across imported games", () => {
    const m = buildSeasonPositionVariety([finalGame]);
    expect(m.get("p1")!.byPosition).toEqual({ SS: 2 });
    expect(m.get("p1")!).toMatchObject({
      totalDefense: 2,
      distinctPositions: 1,
      infieldInnings: 2,
      outfieldInnings: 0,
    });
    expect(m.get("p2")).toMatchObject({
      outfieldInnings: 2,
      infieldInnings: 0,
      distinctPositions: 2,
    });
    expect(m.get("p3")).toMatchObject({
      batteryInnings: 2,
      distinctPositions: 2,
    });
    // GameChanger "SF" lands under RCF and counts as outfield.
    expect(m.get("p4")!.byPosition).toEqual({ RCF: 3 });
    expect(m.get("p4")).toMatchObject({ outfieldInnings: 3 });
  });

  it("ignores games without imported stats", () => {
    const scheduled = { id: "g2", status: "scheduled" };
    expect(buildSeasonPositionVariety([scheduled]).size).toBe(0);
  });
});

describe("record standings helpers", () => {
  it("ranks an 8-2-3 GameChanger record above 10-4 by win percentage", () => {
    const gcRecord = { wins: 8, losses: 2, ties: 3 };
    const tenFour = { wins: 10, losses: 4, ties: 0 };

    expect(recordWinningPercentage(gcRecord)).toBeCloseTo(0.731, 3);
    expect(recordWinningPercentage(tenFour)).toBeCloseTo(0.714, 3);
    expect([tenFour, gcRecord].sort(compareRecordsByWinningPercentage)).toEqual(
      [gcRecord, tenFour],
    );
  });
});

describe("buildSeasonSummary", () => {
  const g = (id: any, date: any, opp: any, ts: any, os: any) => ({
    id,
    date,
    opponent: opp,
    status: "final",
    teamScore: ts,
    opponentScore: os,
  });

  it("tallies record, runs, run differential, and games played", () => {
    const s = buildSeasonSummary([
      g("a", "2026-05-01", "Rays", 5, 3),
      g("b", "2026-05-08", "Cubs", 2, 6),
      g("c", "2026-05-15", "Sox", 4, 4),
      { id: "d", date: "2026-05-22", status: "scheduled" }, // not finalized -> ignored
    ]);
    expect(s).toMatchObject({
      wins: 1,
      losses: 1,
      ties: 1,
      gamesPlayed: 3,
      runsFor: 11,
      runsAgainst: 13,
      runDiff: -2,
    });
  });

  it("computes the current win/loss streak from the most recent game, reset by ties", () => {
    const won = buildSeasonSummary([
      g("a", "2026-05-01", "A", 1, 0),
      g("b", "2026-05-02", "B", 3, 2),
      g("c", "2026-05-03", "C", 5, 1),
    ]);
    expect(won).toMatchObject({ streakType: "W", streakCount: 3 });

    const tieReset = buildSeasonSummary([
      g("a", "2026-05-01", "A", 1, 0),
      g("b", "2026-05-02", "B", 2, 2), // tie
      g("c", "2026-05-03", "C", 0, 4), // loss (most recent)
    ]);
    expect(tieReset).toMatchObject({ streakType: "L", streakCount: 1 });
  });

  it("returns recent results most-recent-first with W/L/T", () => {
    const s = buildSeasonSummary([
      g("a", "2026-05-01", "Rays", 5, 3),
      g("b", "2026-05-08", "Cubs", 2, 6),
    ]);
    expect(s.results.map((r) => [r.opponent, r.result])).toEqual([
      ["Cubs", "L"],
      ["Rays", "W"],
    ]);
  });

  it("is empty/zeroed when there are no finalized games", () => {
    const s = buildSeasonSummary([{ id: "x", status: "scheduled" }]);
    expect(s).toMatchObject({
      gamesPlayed: 0,
      wins: 0,
      runDiff: 0,
      streakType: null,
      streakCount: 0,
      results: [],
    });
  });
});

describe("public-form input hygiene", () => {
  it("clampText trims and hard-caps length", () => {
    expect(clampText("  hi  ", 50)).toBe("hi");
    expect(clampText("abcdef", 3)).toBe("abc");
    expect(clampText(null, 5)).toBe("");
    expect(clampText(undefined, 5)).toBe("");
  });

  it("isValidEmail accepts plausible addresses and rejects junk", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("  parent@example.com ")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("isSafeCssColor allows hex/rgb/hsl and blocks injection", () => {
    expect(isSafeCssColor("#2563eb")).toBe(true);
    expect(isSafeCssColor("#abc")).toBe(true);
    expect(isSafeCssColor("rgb(10, 20, 30)")).toBe(true);
    expect(isSafeCssColor("hsl(200, 50%, 40%)")).toBe(true);
    expect(isSafeCssColor("red; background: url(x)")).toBe(false);
    expect(isSafeCssColor("expression(alert(1))")).toBe(false);
    expect(isSafeCssColor("")).toBe(false);
  });

  it("isSafeImageUrl allows https + image data URLs, blocks the rest", () => {
    expect(isSafeImageUrl("https://example.com/logo.png")).toBe(true);
    expect(isSafeImageUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeImageUrl("data:image/svg+xml;base64,AAAA")).toBe(true);
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeImageUrl("http://insecure.example/logo.png")).toBe(false);
    expect(isSafeImageUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeImageUrl("")).toBe(false);
  });

  it("exposes sane signup field limits", () => {
    expect(SIGNUP_LIMITS.email).toBe(254);
    expect(SIGNUP_LIMITS.name).toBeGreaterThan(0);
    expect(SIGNUP_LIMITS.notes).toBeGreaterThanOrEqual(SIGNUP_LIMITS.name);
  });
});

describe("evalStatHint", () => {
  it("maps categories to the right objective stat and formats it", () => {
    expect(evalStatHint("contact", { avg: 0.312 })).toBe("AVG .312");
    expect(evalStatHint("fielding", { fFpct: 0.95 })).toBe("FPCT .950");
    expect(evalStatHint("strikes", { pStrikePct: 0.62 })).toBe("S% 62%");
    expect(evalStatHint("throwing", { fCsPct: 0.4 })).toBe("CS% 40%");
    expect(evalStatHint("speedBaserunning", { sb: 8 })).toBe("8 SB");
  });

  it("reads velocity from the pitching object when stats lack it", () => {
    expect(evalStatHint("velocity", {}, { topMph: 52 })).toBe("Top 52 mph");
    expect(evalStatHint("velocity", { pTopMph: 50 }, null)).toBe("Top 50 mph");
  });

  it("returns null when the stat is missing or the category has none", () => {
    expect(evalStatHint("contact", {})).toBeNull();
    expect(evalStatHint("contact", null)).toBeNull();
    expect(evalStatHint("coachability", { avg: 0.4 })).toBeNull();
    expect(evalStatHint("baseballIQ", { avg: 0.4 })).toBeNull();
  });
});

describe("deriveTournaments", () => {
  it("clusters same-weekend Tournament games (pool + bracket) into one event", () => {
    const games = [
      { id: "a", date: "2026-06-06", leagueRuleSet: "USSSA", gameType: "pool" },
      { id: "b", date: "2026-06-06", leagueRuleSet: "USSSA", gameType: "pool" },
      {
        id: "c",
        date: "2026-06-07",
        leagueRuleSet: "USSSA",
        gameType: "bracket",
      },
    ];
    const t = deriveTournaments(games);
    expect(t).toHaveLength(1);
    expect(t[0].gameIds).toEqual(["a", "b", "c"]);
  });

  it("does not group a lone Tournament game, far-apart games, Rec, or scrimmages", () => {
    const games = [
      { id: "solo", date: "2026-06-20", leagueRuleSet: "USSSA" }, // lone
      { id: "rec1", date: "2026-06-06", leagueRuleSet: "NKB" },
      { id: "rec2", date: "2026-06-07", leagueRuleSet: "NKB" },
      {
        id: "scrim1",
        date: "2026-07-04",
        leagueRuleSet: "USSSA",
        isScrimmage: true,
      },
      {
        id: "scrim2",
        date: "2026-07-05",
        leagueRuleSet: "USSSA",
        isScrimmage: true,
      },
    ];
    expect(deriveTournaments(games)).toEqual([]);
  });

  it("splits Tournament games more than a weekend apart into separate events", () => {
    const games = [
      { id: "w1a", date: "2026-06-06", leagueRuleSet: "USSSA" },
      { id: "w1b", date: "2026-06-07", leagueRuleSet: "USSSA" },
      { id: "w2a", date: "2026-06-20", leagueRuleSet: "USSSA" },
      { id: "w2b", date: "2026-06-21", leagueRuleSet: "USSSA" },
    ];
    const t = deriveTournaments(games);
    expect(t).toHaveLength(2);
    expect(t[0].gameIds).toEqual(["w1a", "w1b"]);
    expect(t[1].gameIds).toEqual(["w2a", "w2b"]);
  });

  it("falls back to the team rule set when a game doesn't set one", () => {
    const games = [
      { id: "a", date: "2026-06-06" },
      { id: "b", date: "2026-06-07" },
    ];
    expect(deriveTournaments(games, "USSSA")).toHaveLength(1);
    expect(deriveTournaments(games, "NKB")).toEqual([]);
  });
});

describe("recordCatchingOuting + sameDayRoleSets", () => {
  it("logs catching outings, deduped by gameId (doubleheaders stay distinct)", () => {
    let c = recordCatchingOuting(null, "2026-05-10", 3, "g1");
    expect(c.log).toEqual([{ date: "2026-05-10", innings: 3, gameId: "g1" }]);
    expect(c.lastCatchDate).toBe("2026-05-10");
    // Same date, different game -> kept separately.
    c = recordCatchingOuting(c, "2026-05-10", 2, "g2");
    expect(c.log).toHaveLength(2);
    // Re-finalizing g1 replaces its entry in place.
    c = recordCatchingOuting(c, "2026-05-10", 4, "g1");
    expect(c.log.filter((o: any) => o.gameId === "g1")).toEqual([
      { date: "2026-05-10", innings: 4, gameId: "g1" },
    ]);
    expect(c.log).toHaveLength(2);
  });

  it("derives who pitched/caught on a date, excluding the current game", () => {
    const players = [
      {
        id: "a",
        pitching: { log: [{ date: "2026-05-10", pitches: 30, gameId: "g1" }] },
      },
      {
        id: "b",
        catching: { log: [{ date: "2026-05-10", innings: 3, gameId: "g1" }] },
      },
      {
        id: "c",
        pitching: { log: [{ date: "2026-05-09", pitches: 40, gameId: "g0" }] },
      },
    ];
    // Building game g2 on 2026-05-10: a pitched today, b caught today, c was
    // yesterday (ignored).
    const sets = sameDayRoleSets(players, "2026-05-10", "g2");
    expect([...sets.pitched]).toEqual(["a"]);
    expect([...sets.caught]).toEqual(["b"]);

    // Excluding the SAME game the activity came from yields nothing (you don't
    // block yourself within the game you're building).
    const selfExcluded = sameDayRoleSets(players, "2026-05-10", "g1");
    expect(selfExcluded.pitched.size).toBe(0);
    expect(selfExcluded.caught.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-game stat imports: CSV parse → kid-pitch-only pitching → season derive.
// ---------------------------------------------------------------------------
describe("parseGameChangerStatsCsv", () => {
  it("parses a basic single-header GC export into named patches", () => {
    const csv =
      "First,Last,AB,H,AVG,HR,RBI\n" +
      "Sammy,Sosa,3,2,.667,1,3\n" +
      "Totals,,3,2,.667,1,3\n";
    const out = parseGameChangerStatsCsv(csv) as any;
    expect(out.error).toBeUndefined();
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].name).toBe("Sammy Sosa");
    expect(out.rows[0].patch).toMatchObject({ ab: 3, h: 2, hr: 1, rbi: 3 });
  });

  it("rejects a non-GameChanger file with a clear error", () => {
    const out = parseGameChangerStatsCsv(
      "First,Last,Email\nA,B,a@b.c\n",
    ) as any;
    expect(out.error).toMatch(/GameChanger/i);
  });
});

describe("stripPitchingStatsForFormat", () => {
  const line = {
    ab: 3,
    h: 1,
    ip: 2,
    era: 4.5,
    totalPitches: 30,
    pIp: 2,
    pEra: 4.5,
    pStrikePct: 0.6,
    fpct: 0.9,
  };

  it("drops every pitching key for Machine/Coach pitch games", () => {
    for (const f of ["Machine Pitch", "Coach Pitch"]) {
      const out = stripPitchingStatsForFormat(line, f);
      expect(out).toEqual({ ab: 3, h: 1, fpct: 0.9 });
    }
  });

  it("passes Kid Pitch lines through untouched", () => {
    expect(stripPitchingStatsForFormat(line, "Kid Pitch")).toEqual(line);
  });
});

describe("deriveSeasonFromGameLines (per-game lines SUM to season)", () => {
  const game = (id: any, playerStats: any, extra: any = {}) => ({
    id,
    playerStats,
    ...extra,
  });

  it("sums counting stats and recomputes AVG exactly from H/AB", () => {
    const games = [
      game("g1", { p1: { ab: 3, h: 1, hr: 1 } }),
      game("g2", { p1: { ab: 2, h: 2 } }),
    ];
    const season = deriveSeasonFromGameLines(games, "p1");
    expect(season).toMatchObject({ ab: 5, h: 3, hr: 1 });
    expect(season!.avg).toBeCloseTo(3 / 5);
  });

  it("season pitching comes ONLY from kid-pitch games on a mixed schedule", () => {
    // The machine-pitch line was stripped at import (no pitching keys), so the
    // derived season pitching reflects only the kid-pitch outings.
    const machineLine = stripPitchingStatsForFormat(
      { ab: 2, h: 1, pIp: 3, pBf: 12, pEra: 9 },
      "Machine Pitch",
    );
    const games = [
      game("mp", { p1: machineLine }),
      game("kp1", { p1: { ab: 3, h: 1, pIp: 2, pBf: 8, pEra: 3 } }),
      game("kp2", { p1: { ab: 1, h: 0, pIp: 1, pBf: 4, pEra: 6 } }),
    ];
    const season = deriveSeasonFromGameLines(games, "p1");
    // Batting sums across ALL games…
    expect(season!.ab).toBe(6);
    expect(season!.h).toBe(2);
    // …pitching only from the two kid-pitch lines.
    expect(season!.pIp).toBe(3);
    expect(season!.pBf).toBe(12);
    // pEra is pIp-weighted: (3*2 + 6*1) / 3 = 4
    expect(season!.pEra).toBeCloseTo(4);
  });

  it("weights rate stats by sample (QAB% by AB)", () => {
    const games = [
      game("g1", { p1: { ab: 4, qab: 0.5 } }),
      game("g2", { p1: { ab: 1, qab: 1.0 } }),
    ];
    const season = deriveSeasonFromGameLines(games, "p1");
    expect(season!.qab).toBeCloseTo((0.5 * 4 + 1.0 * 1) / 5);
  });

  it("returns null when the player has no game lines (season CSV stays)", () => {
    expect(deriveSeasonFromGameLines([game("g1", {})], "p1")).toBeNull();
    expect(deriveSeasonFromGameLines([], "p1")).toBeNull();
  });
});

describe("latestGameLineMovement (Recent Movement from per-game imports)", () => {
  const games = [
    {
      id: "a",
      date: "2026-04-01",
      playerStats: { p1: { ab: 4, h: 1, obp: 0.25, ops: 0.5 } },
    },
    {
      id: "b",
      date: "2026-05-01",
      playerStats: { p1: { ab: 4, h: 3, obp: 0.75, ops: 1.5 } },
    },
    { id: "c", date: "2026-03-01", playerStats: {} }, // no line for p1
  ];

  it("compares the season derived with vs without the newest game", () => {
    const move = latestGameLineMovement(games, "p1");
    expect(move).toBeTruthy();
    expect(move!.date).toBe("2026-05-01");
    // Prior = game a only; current = a + b summed.
    expect(move!.prior.avg).toBeCloseTo(1 / 4);
    expect(move!.current.avg).toBeCloseTo(4 / 8);
    expect(move!.current.ops).toBeGreaterThan(move!.prior.ops);
  });

  it("needs at least two game lines — one game has no before/after", () => {
    expect(latestGameLineMovement([games[0]], "p1")).toBeNull();
    expect(latestGameLineMovement(games, "p2")).toBeNull();
    expect(latestGameLineMovement(null, "p1")).toBeNull();
  });
});

describe("seasonSeriesFromGameLines (profile Recent Movement fallback)", () => {
  it("returns the cumulative season line after each game, chronological", () => {
    const games = [
      { id: "b", date: "2026-05-01", playerStats: { p1: { ab: 4, h: 3 } } },
      { id: "a", date: "2026-04-01", playerStats: { p1: { ab: 4, h: 1 } } },
      { id: "c", date: "2026-06-01", playerStats: {} }, // no line for p1
    ];
    const series = seasonSeriesFromGameLines(games, "p1");
    expect(series).toHaveLength(2);
    expect(series[0].avg).toBeCloseTo(1 / 4); // after the April game
    expect(series[1].avg).toBeCloseTo(4 / 8); // April + May summed
    expect(series[1].ab).toBe(8);
  });

  it("is empty when the player has no game lines", () => {
    expect(seasonSeriesFromGameLines([], "p1")).toEqual([]);
    expect(seasonSeriesFromGameLines(null, "p1")).toEqual([]);
  });
});

describe("isPlayerScheduledOut (front-loaded absence dates)", () => {
  it("matches an exact ISO date in the player's absences list", () => {
    const p = { absences: ["2026-06-19", "2026-07-04"] };
    expect(isPlayerScheduledOut(p, "2026-06-19")).toBe(true);
    expect(isPlayerScheduledOut(p, "2026-06-20")).toBe(false);
    expect(isPlayerScheduledOut(p, null)).toBe(false);
    expect(isPlayerScheduledOut({}, "2026-06-19")).toBe(false);
    expect(isPlayerScheduledOut(null, "2026-06-19")).toBe(false);
  });
});

describe("absence date-range helpers", () => {
  it("addAbsenceDateRange walks an inclusive range and merges + sorts", () => {
    const out = addAbsenceDateRange(["2026-07-04"], "2026-06-19", "2026-06-21");
    expect(out).toEqual([
      "2026-06-19",
      "2026-06-20",
      "2026-06-21",
      "2026-07-04",
    ]);
  });

  it("blank end date adds a single day; duplicates are deduped", () => {
    expect(addAbsenceDateRange(["2026-06-19"], "2026-06-19", null)).toEqual([
      "2026-06-19",
    ]);
    expect(addAbsenceDateRange([], "2026-06-19")).toEqual(["2026-06-19"]);
  });

  it("swaps reversed inputs and walks month/year boundaries", () => {
    expect(addAbsenceDateRange([], "2027-01-02", "2026-12-30")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("caps absurd ranges at 60 days and ignores unparseable dates", () => {
    expect(addAbsenceDateRange([], "2026-06-01", "2036-06-01")).toHaveLength(
      60,
    );
    expect(addAbsenceDateRange(["2026-06-19"], "not-a-date")).toEqual([
      "2026-06-19",
    ]);
  });

  it("removeAbsenceDates drops exactly the given dates", () => {
    expect(
      removeAbsenceDates(
        ["2026-06-19", "2026-06-20", "2026-07-04"],
        ["2026-06-19", "2026-06-20"],
      ),
    ).toEqual(["2026-07-04"]);
  });

  it("foldAbsenceRanges collapses consecutive days into ranges", () => {
    const ranges = foldAbsenceRanges([
      "2026-06-22",
      "2026-06-19",
      "2026-06-20",
    ]);
    expect(ranges).toEqual([
      {
        from: "2026-06-19",
        to: "2026-06-20",
        dates: ["2026-06-19", "2026-06-20"],
      },
      { from: "2026-06-22", to: "2026-06-22", dates: ["2026-06-22"] },
    ]);
    expect(foldAbsenceRanges([])).toEqual([]);
    expect(foldAbsenceRanges(null)).toEqual([]);
  });
});

describe("availability calendar helpers", () => {
  const roster = [
    { id: "a", name: "A", absences: ["2026-07-04"] },
    { id: "b", name: "B", absences: ["2026-07-04", "2026-07-05"] },
    { id: "c", name: "C", absences: [] },
    { id: "d", name: "D", rosterStatus: "departed", absences: [] },
  ];

  it("isDepartedPlayer flags only departed players", () => {
    expect(isDepartedPlayer({ rosterStatus: "departed" })).toBe(true);
    expect(isDepartedPlayer({ rosterStatus: "inactive" })).toBe(false);
    expect(isDepartedPlayer({})).toBe(false);
    expect(isDepartedPlayer(null)).toBe(false);
  });

  it("countAvailableOnDate excludes departed and scheduled-out players", () => {
    // Active non-departed = A, B, C. On 7/4 both A and B are out → 1 (C).
    expect(countAvailableOnDate(roster, "2026-07-04")).toBe(1);
    // On 7/5 only B is out → A and C available → 2.
    expect(countAvailableOnDate(roster, "2026-07-05")).toBe(2);
    // A clear day → all 3 active available (departed D never counts).
    expect(countAvailableOnDate(roster, "2026-08-01")).toBe(3);
    expect(countAvailableOnDate(roster, null)).toBe(0);
  });

  it("isShortHandedOnDate compares available against the minimum", () => {
    expect(isShortHandedOnDate(roster, "2026-07-04", 2)).toBe(true); // 1 < 2
    expect(isShortHandedOnDate(roster, "2026-07-05", 2)).toBe(false); // 2 == 2
    expect(isShortHandedOnDate(roster, "2026-08-01", 3)).toBe(false); // 3 == 3
  });

  it("playersOutOnDate lists non-departed players scheduled out", () => {
    const out = playersOutOnDate(roster, "2026-07-04").map((p: any) => p.id);
    expect(out).toEqual(["a", "b"]);
    expect(playersOutOnDate(roster, "2026-08-01")).toEqual([]);
  });

  it("buildMonthGrid pads to whole weeks and places days correctly", () => {
    // July 2026: the 1st is a Wednesday (weekday index 3).
    const grid = buildMonthGrid(2026, 6);
    expect(grid.length % 7).toBe(0);
    expect(grid.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[3]).toBe("2026-07-01");
    expect(grid).toContain("2026-07-31");
    expect(grid.filter((d) => d !== null)).toHaveLength(31);
  });
});

describe("recentGameLines + aggregateGameLines (Recent Form)", () => {
  it("returns the newest N lines and aggregates them", () => {
    const games = [
      { id: "a", date: "2026-04-01", playerStats: { p1: { ab: 3, h: 0 } } },
      { id: "b", date: "2026-05-01", playerStats: { p1: { ab: 3, h: 2 } } },
      { id: "c", date: "2026-06-01", playerStats: { p1: { ab: 2, h: 2 } } },
      { id: "d", date: "2026-03-01", playerStats: {} }, // no line for p1
    ];
    const last2 = recentGameLines(games, "p1", 2);
    expect(last2.map((l) => l.date)).toEqual(["2026-06-01", "2026-05-01"]);
    const agg = aggregateGameLines(last2.map((l) => l.line));
    expect(agg.ab).toBe(5);
    expect(agg.h).toBe(4);
    expect(agg.avg).toBeCloseTo(0.8);
  });
});

describe("teamStatAverages (Team avg baseline)", () => {
  it("aggregates the roster as one line: team AVG = total H / total AB", () => {
    const players = [
      { stats: { ab: 10, h: 4 } }, // .400
      { stats: { ab: 10, h: 2 } }, // .200
    ];
    const team = teamStatAverages(players);
    expect(team.ab).toBe(20);
    expect(team.h).toBe(6);
    expect(team.avg).toBeCloseTo(0.3); // 6/20, not the mean of .400 & .200
  });

  it("weight-averages rate stats by sample size (AB)", () => {
    const players = [
      { stats: { ab: 30, obp: 0.4 } },
      { stats: { ab: 10, obp: 0.2 } },
    ];
    // (0.4*30 + 0.2*10) / 40 = 0.35
    expect(teamStatAverages(players).obp).toBeCloseTo(0.35);
  });

  it("returns {} for an empty or statless roster", () => {
    expect(teamStatAverages([])).toEqual({});
    expect(teamStatAverages([{}, { stats: null }])).toEqual({});
    expect(teamStatAverages(null)).toEqual({});
  });
});

describe("mergeTeamEntries (settings teams-list safety)", () => {
  it("unions lists by id without dropping any entry", () => {
    const merged = mergeTeamEntries(
      [{ id: "t1", name: "Hawks" }],
      [{ id: "t2", name: "Owls" }],
      [{ id: "t3", name: "Bats" }],
    );
    expect(merged).toEqual([
      { id: "t1", name: "Hawks" },
      { id: "t2", name: "Owls" },
      { id: "t3", name: "Bats" },
    ]);
  });

  it("preserves the server list when local state is transiently empty (the clobber bug)", () => {
    const server = [{ id: "t-real", name: "My Real Team" }];
    const localState: any[] = []; // raced/empty React state
    const merged = mergeTeamEntries(server, localState, [
      { id: "t-new", name: "Accidental Team" },
    ]);
    expect(merged.map((t) => t.id)).toEqual(["t-real", "t-new"]);
  });

  it("dedupes by id, keeping the first non-empty name", () => {
    const merged = mergeTeamEntries(
      [
        { id: "t1", name: "" },
        { id: "t2", name: "Owls" },
      ],
      [
        { id: "t1", name: "Hawks" },
        { id: "t2", name: "Renamed" },
      ],
    );
    expect(merged).toEqual([
      { id: "t1", name: "Hawks" },
      { id: "t2", name: "Owls" },
    ]);
  });

  it("ignores null/undefined lists and entries without ids, and defaults blank names", () => {
    const merged = mergeTeamEntries(null, undefined, [
      { id: "t1" },
      { name: "no id" } as any,
      { id: "" },
    ]);
    expect(merged).toEqual([{ id: "t1", name: "My Team" }]);
  });
});

describe("blockedRosterWipeReason (empty-roster write guard)", () => {
  const roster = [{ id: "p1" }, { id: "p2" }];

  it("blocks an empty players write before the team doc has loaded", () => {
    expect(blockedRosterWipeReason({ players: [] }, [], false)).toMatch(
      /hasn't finished loading/,
    );
  });

  it("blocks an empty players write over a loaded non-empty roster", () => {
    expect(blockedRosterWipeReason({ players: [] }, roster, true)).toMatch(
      /erase 2 players/,
    );
  });

  it("allows an empty write when the loaded roster is already empty", () => {
    expect(blockedRosterWipeReason({ players: [] }, [], true)).toBeNull();
  });

  it("allows non-empty players writes and writes that don't touch players", () => {
    expect(
      blockedRosterWipeReason({ players: roster }, roster, true),
    ).toBeNull();
    expect(
      blockedRosterWipeReason({ players: [{ id: "p9" }] }, roster, false),
    ).toBeNull();
    expect(
      blockedRosterWipeReason({ name: "Hawks" } as any, roster, false),
    ).toBeNull();
    expect(blockedRosterWipeReason({}, roster, true)).toBeNull();
  });

  it("treats a malformed current roster as empty rather than crashing", () => {
    expect(blockedRosterWipeReason({ players: [] }, null, true)).toBeNull();
    expect(
      blockedRosterWipeReason({ players: [] }, undefined, true),
    ).toBeNull();
  });
});

describe("buildPlayerFeeBreakdown (parent fee sheet)", () => {
  it("spreads the fee across expenses so lines total exactly the fee", () => {
    const fin = {
      nextClubFee: 200,
      budgetItems: [
        { id: "b1", label: "Tournaments", amount: 3000 },
        { id: "b2", label: "Uniforms", amount: 1000 },
      ],
    };
    const out = buildPlayerFeeBreakdown(fin, [{ id: "a" }]);
    expect(out).not.toBeNull();
    expect(out!.fee).toBe(200);
    // 3:1 split of $200 → $150 / $50.
    expect(out!.lines).toEqual([
      { label: "Tournaments", amount: 150 },
      { label: "Uniforms", amount: 50 },
    ]);
    const sum = out!.lines.reduce((s, l) => s + l.amount, 0);
    expect(sum).toBeCloseTo(out!.fee);
  });

  it("lands rounding drift on the largest line so the column sums to the fee", () => {
    const fin = {
      nextClubFee: 100,
      budgetItems: [
        { id: "b1", label: "A", amount: 1 },
        { id: "b2", label: "B", amount: 1 },
        { id: "b3", label: "C", amount: 1 },
      ],
    };
    const out = buildPlayerFeeBreakdown(fin, [{ id: "a" }]);
    const sum = out!.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it("falls back to the suggested fee when no next-season fee is set", () => {
    const fin = {
      budgetItems: [{ id: "b1", label: "Tournaments", amount: 1000 }],
    };
    // 1000 / 4 payers = 250 suggested; the whole fee maps to the one line.
    const players = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const out = buildPlayerFeeBreakdown(fin, players);
    expect(out!.fee).toBe(250);
    expect(out!.lines).toEqual([{ label: "Tournaments", amount: 250 }]);
  });

  it("returns null without priced expenses or without a fee", () => {
    expect(
      buildPlayerFeeBreakdown({ nextClubFee: 200, budgetItems: [] }, [
        { id: "a" },
      ]),
    ).toBeNull();
    expect(
      buildPlayerFeeBreakdown(
        { budgetItems: [{ id: "b1", label: "X", amount: 100 }] },
        [],
      ),
    ).toBeNull();
  });
});

describe("finances money math", () => {
  const finances = {
    clubFee: 150,
    budgetItems: [
      { id: "b1", label: "Tournaments", qty: 8, unitAmount: 450, amount: 3600 },
      { id: "b2", label: "Balls", amount: 250.5 },
    ],
    incomes: [
      {
        id: "i1",
        date: "2026-02-20",
        label: "Smith Hardware sponsorship",
        amount: 600,
      },
    ],
    payments: [
      { id: "p1", playerId: "kid1", date: "2026-03-01", amount: 150 },
      { id: "p2", playerId: "kid2", date: "2026-03-02", amount: 50 },
      { id: "p3", playerId: "kid2", date: "2026-04-01", amount: 25 },
      // Off-roster payment (kid since released): counts toward collected,
      // never toward stillOwed.
      { id: "p4", playerId: "ghost", date: "2026-04-02", amount: 10 },
    ],
    expenses: [
      // Deliberately out of date order — the ledger sorts.
      { id: "e2", date: "2026-03-15", label: "Balls", amount: 60 },
      { id: "e1", date: "2026-03-05", label: "Entry", amount: 100 },
    ],
  };
  const players = [
    { id: "kid1", name: "Ava" },
    { id: "kid2", name: "Ben" },
    { id: "kid3", name: "Cy" },
  ];

  it("formatCurrency: whole dollars unless cents exist, negatives keep the sign", () => {
    expect(formatCurrency(1250)).toBe("$1,250");
    expect(formatCurrency(12.5)).toBe("$12.50");
    expect(formatCurrency(-80)).toBe("-$80");
    expect(formatCurrency("junk")).toBe("$0");
    expect(formatCurrency(null)).toBe("$0");
  });

  it("budgetItemAmount applies sales tax to flagged items only", () => {
    expect(budgetItemAmount({ amount: 100, taxable: true }, 8.25)).toBeCloseTo(
      108.25,
    );
    expect(budgetItemAmount({ amount: 100 }, 8.25)).toBe(100);
    expect(
      budgetItemAmount(
        { qty: 4, unitAmount: 100, amount: 400, taxable: true },
        10,
      ),
    ).toBeCloseTo(440);
    expect(budgetItemAmount({ amount: 100, taxable: true })).toBe(100); // no rate set
  });

  it("budgetTotal includes sales tax on flagged items via finances.salesTaxPct", () => {
    const fin = {
      salesTaxPct: 10,
      budgetItems: [
        { id: "a", label: "Entries", amount: 300, taxable: true },
        { id: "b", label: "Balls", amount: 100 },
      ],
    };
    expect(budgetTotal(fin)).toBeCloseTo(430);
  });

  it("roundUpToIncrement: buffers up to a clean $25/$50, plain ceiling otherwise", () => {
    expect(roundUpToIncrement(205, 25)).toBe(225);
    expect(roundUpToIncrement(205, 50)).toBe(250);
    expect(roundUpToIncrement(200, 25)).toBe(200); // already clean
    expect(roundUpToIncrement(162.4, 0)).toBe(163);
    expect(roundUpToIncrement(162.4)).toBe(163);
    expect(roundUpToIncrement(0, 25)).toBe(0);
  });

  it("suggestedFeePerPlayer rounds up to the fee buffer increment", () => {
    const fin = {
      feeBufferIncrement: 25,
      budgetItems: [{ id: "b", label: "Season", amount: 410 }],
    };
    const two = [{ id: "k1" }, { id: "k2" }];
    expect(suggestedFeePerPlayer(fin, two)).toBe(225); // 205 raw → next $25
    expect(suggestedFeePerPlayer({ ...fin, feeBufferIncrement: 50 }, two)).toBe(
      250,
    );
    expect(suggestedFeePerPlayer({ ...fin, feeBufferIncrement: 0 }, two)).toBe(
      205,
    );
  });

  it("budgetItemAmount: qty × unit when both present, flat amount otherwise", () => {
    expect(budgetItemAmount({ qty: 8, unitAmount: 450, amount: 1 })).toBe(3600);
    expect(budgetItemAmount({ amount: 250.5 })).toBeCloseTo(250.5);
    expect(budgetItemAmount({ qty: 8, amount: 99 })).toBe(99); // missing unit -> flat
    expect(budgetItemAmount(null)).toBe(0);
  });

  it("budgetTotal sums flat + quantity items and tolerates malformed entries", () => {
    expect(budgetTotal(finances)).toBeCloseTo(3850.5);
    expect(budgetTotal(null)).toBe(0);
    expect(
      budgetTotal({ budgetItems: [{ amount: "nope" } as any, null as any] }),
    ).toBe(0);
  });

  it("incomeTotal sums sponsorships/fundraising", () => {
    expect(incomeTotal(finances)).toBe(600);
    expect(incomeTotal(null)).toBe(0);
  });

  it("suggestedFeePerPlayer splits the budget minus pledged sponsorships — this year's ledger stays out", () => {
    // Current-year payments/incomes/expenses in the fixture must NOT
    // discount next season's fee: (3850.5 − 0) / 3 = 1283.5 → 1284.
    expect(suggestedFeePerPlayer(finances, players)).toBe(1284);
    const withSponsors = {
      ...finances,
      sponsorships: [
        { id: "s1", sponsor: "Smith Hardware", amount: 600 },
        { id: "s2", sponsor: "Dairy Bar", amount: 250.5 },
      ],
    };
    // (3850.5 − 850.5) / 3 = 1000.
    expect(suggestedFeePerPlayer(withSponsors, players)).toBe(1000);
    expect(suggestedFeePerPlayer(finances, [])).toBeNull();
    expect(suggestedFeePerPlayer({ budgetItems: [] }, players)).toBeNull();
    expect(suggestedFeePerPlayer(null, players)).toBeNull();
  });

  it("suggestedFeePerPlayer excludes fee-exempt players from the split", () => {
    const withWaiver = { ...finances, feeExemptIds: ["kid3"] };
    // 2 payers: 3850.5 / 2 = 1925.25 → 1926.
    expect(suggestedFeePerPlayer(withWaiver, players)).toBe(1926);
  });

  it("suggestedFeePerPlayer is 0 (not negative) when sponsorships cover everything", () => {
    const covered = {
      budgetItems: [{ id: "b", label: "Balls", amount: 500 }],
      sponsorships: [{ id: "s", sponsor: "Sponsor", amount: 800 }],
    };
    expect(suggestedFeePerPlayer(covered, [{ id: "kid1" }])).toBe(0);
  });

  it("sponsorshipTotal sums next-season pledges and tolerates junk", () => {
    expect(
      sponsorshipTotal({
        sponsorships: [
          { id: "s1", sponsor: "A", amount: 100 },
          { id: "s2", sponsor: "B", amount: "nope" } as any,
          null as any,
        ],
      }),
    ).toBe(100);
    expect(sponsorshipTotal(null)).toBe(0);
  });

  it("financeSummary computes the P&L tiles in one pass, income included", () => {
    const s = financeSummary(finances, players);
    expect(s.collected).toBe(235);
    expect(s.otherIncome).toBe(600);
    expect(s.spent).toBe(160);
    expect(s.balanceNow).toBe(675); // 235 + 600 - 160
    // kid1 settled (150/150), kid2 owes 75, kid3 owes the full 150.
    expect(s.stillOwed).toBe(225);
    expect(s.balanceOnceAllPaid).toBe(900);
    expect(s.paidByPlayer).toEqual({ kid1: 150, kid2: 75, ghost: 10 });
  });

  it("financeSummary never reports negative owed for overpayment", () => {
    const s = financeSummary(
      {
        clubFee: 100,
        payments: [
          { id: "p", playerId: "kid1", date: "2026-01-01", amount: 130 },
        ],
      },
      [{ id: "kid1" }],
    );
    expect(s.stillOwed).toBe(0);
    expect(s.collected).toBe(130);
  });

  it("financeSummary handles a missing/empty finances object", () => {
    const s = financeSummary(null, players);
    expect(s).toMatchObject({
      collected: 0,
      otherIncome: 0,
      spent: 0,
      balanceNow: 0,
      stillOwed: 0,
      balanceOnceAllPaid: 0,
    });
  });

  it("financeSummary skips fee-exempt players in stillOwed", () => {
    const s = financeSummary({ ...finances, feeExemptIds: ["kid3"] }, players);
    expect(s.stillOwed).toBe(75); // kid2's remainder only; kid3 waived
  });

  it("unattributed fundraising splits evenly across all paying families", () => {
    const fin = {
      clubFee: 100,
      incomes: [
        {
          id: "f",
          date: "2026-01-01",
          label: "Fundraiser",
          fundraising: true,
          amount: 30,
        },
      ],
      payments: [],
    };
    const three = [{ id: "k1" }, { id: "k2" }, { id: "k3" }];
    const s = financeSummary(fin, three);
    expect(s.duesCreditPerPlayer).toBe(10); // 30 / 3
    expect(s.effectiveFeePerPlayer).toBe(90);
    expect(s.effectiveFeeByPlayer).toEqual({ k1: 90, k2: 90, k3: 90 });
    expect(s.stillOwed).toBe(270); // 90 * 3
  });

  it("attributed fundraising credits only that child's fee", () => {
    const fin = {
      clubFee: 100,
      incomes: [
        {
          id: "f",
          date: "2026-01-01",
          label: "Fundraiser",
          fundraising: true,
          amount: 40,
          playerId: "k1",
        },
      ],
      payments: [],
    };
    const three = [{ id: "k1" }, { id: "k2" }, { id: "k3" }];
    const s = financeSummary(fin, three);
    expect(s.duesCreditPerPlayer).toBe(0); // nothing to split evenly
    expect(s.effectiveFeeByPlayer).toEqual({ k1: 60, k2: 100, k3: 100 });
    expect(s.creditByPlayer.k1).toBe(40);
    expect(s.stillOwed).toBe(260); // 60 + 100 + 100
  });

  it("a child's surplus over the fee rolls into the even split for everyone", () => {
    const fin = {
      clubFee: 100,
      // k1 raises 160 — 100 covers their fee, the 60 surplus splits across all 3.
      incomes: [
        {
          id: "f",
          date: "2026-01-01",
          label: "Fundraiser",
          fundraising: true,
          amount: 160,
          playerId: "k1",
        },
      ],
      payments: [],
    };
    const three = [{ id: "k1" }, { id: "k2" }, { id: "k3" }];
    const s = financeSummary(fin, three);
    expect(s.duesCreditPerPlayer).toBe(20); // 60 surplus / 3
    expect(s.effectiveFeeByPlayer.k1).toBe(0); // fully covered (capped at fee)
    expect(s.effectiveFeeByPlayer.k2).toBe(80);
    expect(s.effectiveFeeByPlayer.k3).toBe(80);
    expect(s.stillOwed).toBe(160); // 0 + 80 + 80
  });

  it("fundraising credited to an exempt/off-roster child rolls fully to the team", () => {
    const fin = {
      clubFee: 100,
      incomes: [
        {
          id: "f",
          date: "2026-01-01",
          label: "Fundraiser",
          fundraising: true,
          amount: 30,
          playerId: "ghost",
        },
      ],
      payments: [],
    };
    const two = [{ id: "k1" }, { id: "k2" }];
    const s = financeSummary(fin, two);
    expect(s.duesCreditPerPlayer).toBe(15); // 30 / 2, none wasted on the ghost
    expect(s.effectiveFeeByPlayer).toEqual({ k1: 85, k2: 85 });
  });

  it("attributed fundraising is backward-compatible when no playerId is set", () => {
    const fin = {
      clubFee: 100,
      incomes: [
        {
          id: "a",
          date: "2026-01-01",
          label: "Fundraiser A",
          fundraising: true,
          amount: 30,
        },
        {
          id: "b",
          date: "2026-01-01",
          label: "Fundraiser B",
          fundraising: true,
          amount: 30,
        },
      ],
      payments: [],
    };
    const three = [{ id: "k1" }, { id: "k2" }, { id: "k3" }];
    const s = financeSummary(fin, three);
    expect(s.duesCreditPerPlayer).toBe(20); // (30+30)/3 — same as the old model
    expect(s.effectiveFeePerPlayer).toBe(80);
  });

  describe("teamFeesStatus", () => {
    const feePlayers = [
      { id: "kid1", name: "Ava" },
      { id: "kid2", name: "Ben" },
      { id: "kid3", name: "Cy" },
    ];
    const base = {
      clubFee: 150,
      payments: [
        { id: "p1", playerId: "kid1", date: "2026-01-01", amount: 150 }, // paid in full
        { id: "p2", playerId: "kid2", date: "2026-01-01", amount: 75 }, // partial
        // kid3: nothing
      ],
    };

    it("counts families still owing the full fee", () => {
      const t = teamFeesStatus(base, feePlayers);
      expect(t.hasFee).toBe(true);
      expect(t.effectiveFee).toBe(150);
      expect(t.stillOwed).toBe(225); // kid2 75 + kid3 150
      expect(t.fullOwedCount).toBe(2);
      expect(t.depositAmount).toBe(0);
      expect(t.depositOwedCount).toBe(0);
    });

    it("tracks the deposit slice and surfaces both due dates", () => {
      const t = teamFeesStatus(
        {
          ...base,
          depositAmount: 50,
          depositDueDate: "2026-03-01",
          feeDueDate: "2026-05-01",
        },
        feePlayers,
      );
      expect(t.depositAmount).toBe(50);
      expect(t.depositOwedCount).toBe(1); // only kid3 (paid 0)
      expect(t.depositOutstanding).toBe(50);
      expect(t.depositDueDate).toBe("2026-03-01");
      expect(t.feeDueDate).toBe("2026-05-01");
    });

    it("caps the deposit at the effective fee and skips exempt players", () => {
      const t = teamFeesStatus(
        { ...base, depositAmount: 999, feeExemptIds: ["kid3"] },
        feePlayers,
      );
      expect(t.depositAmount).toBe(150); // can't exceed the fee
      expect(t.fullOwedCount).toBe(1); // kid2 only; kid3 waived
      expect(t.stillOwed).toBe(75);
      expect(t.depositOwedCount).toBe(1); // kid2 (paid 75 < 150 deposit)
      expect(t.depositOutstanding).toBe(75);
    });

    it("reports no fee when none is configured", () => {
      const t = teamFeesStatus({ clubFee: 0 }, feePlayers);
      expect(t.hasFee).toBe(false);
      expect(t.fullOwedCount).toBe(0);
    });
  });

  it("rollFinancesForNewSeason carries the balance, resets collections, promotes the planned fee", () => {
    const rolled = rollFinancesForNewSeason(
      {
        ...finances,
        nextClubFee: 1000,
        nextDepositAmount: 250,
        nextDepositDueDate: "2027-07-15",
        feeExemptIds: ["kid3"],
      },
      "Spring 2027",
      "2027-06-01T12:00:00.000Z",
    );
    expect(rolled!.payments).toEqual([]);
    expect(rolled!.expenses).toEqual([]);
    expect(rolled!.incomes!).toHaveLength(1);
    expect(rolled!.incomes![0]).toMatchObject({
      date: "2027-06-01",
      label: "Carried over (through Spring 2027)",
      amount: 675,
    });
    expect(rolled!.clubFee).toBe(1000); // planned fee promoted
    expect(rolled!.depositAmount).toBe(250);
    expect(rolled!.depositDueDate).toBe("2027-07-15");
    expect(rolled!.nextClubFee).toBeUndefined();
    expect(rolled!.nextDepositAmount).toBeUndefined();
    expect(rolled!.nextDepositDueDate).toBeUndefined();
    expect(rolled!.feeExemptIds).toBeUndefined(); // waivers die with the year
    expect(rolled!.budgetItems).toEqual(finances.budgetItems); // plan kept
    expect(rolled!.pastSeasons).toEqual([
      {
        season: "through Spring 2027",
        collected: 235,
        otherIncome: 600,
        spent: 160,
        closingBalance: 675,
      },
    ]);
  });

  it("rollFinancesForNewSeason carries debt as an opening expense", () => {
    const broke = {
      clubFee: 100,
      payments: [{ id: "p", playerId: "kid1", date: "2026-09-01", amount: 50 }],
      expenses: [{ id: "e", date: "2026-10-01", label: "Entry", amount: 200 }],
    };
    const rolled = rollFinancesForNewSeason(broke, "Spring 2027", "2027-06-01");
    expect(rolled!.incomes).toEqual([]);
    expect(rolled!.expenses!).toHaveLength(1);
    expect(rolled!.expenses![0]).toMatchObject({
      label: "Debt carried over (through Spring 2027)",
      amount: 150,
    });
    expect(rolled!.clubFee).toBe(100); // no planned fee → current fee kept
  });

  it("rollFinancesForNewSeason passes through when nothing was recorded", () => {
    expect(
      rollFinancesForNewSeason(undefined, "Spring 2027", "x"),
    ).toBeUndefined();
    const planOnly = { budgetItems: [{ id: "b", label: "Balls", amount: 10 }] };
    expect(rollFinancesForNewSeason(planOnly, "Spring 2027", "x")).toBe(
      planOnly,
    );
  });

  it("rollFinancesForNewSeason promotes planned fee and deposit even with no money recorded", () => {
    // Codex review (#297): a coach who only planned money was promised it
    // takes effect at the new season — even before any ledger activity.
    const planned = {
      nextClubFee: 250,
      nextDepositAmount: 100,
      nextDepositDueDate: "2027-07-15",
      feeExemptIds: ["kid9"],
      budgetItems: [{ id: "b", label: "Balls", amount: 10 }],
    };
    const rolled = rollFinancesForNewSeason(
      planned,
      "Spring 2027",
      "2027-06-01",
    );
    expect(rolled!.clubFee).toBe(250);
    expect(rolled!.depositAmount).toBe(100);
    expect(rolled!.depositDueDate).toBe("2027-07-15");
    expect(rolled!.nextClubFee).toBeUndefined();
    expect(rolled!.nextDepositAmount).toBeUndefined();
    expect(rolled!.nextDepositDueDate).toBeUndefined();
    expect(rolled!.feeExemptIds).toBeUndefined();
    expect(rolled!.budgetItems).toEqual(planned.budgetItems);
    expect(rolled!.incomes).toEqual([]);
    expect(rolled!.pastSeasons).toBeUndefined(); // nothing worth archiving
  });

  it("rollFinancesForNewSeason converts sponsorship pledges into new-year income", () => {
    const rolled = rollFinancesForNewSeason(
      {
        ...finances,
        sponsorships: [
          { id: "s1", sponsor: "Smith Hardware", amount: 500 },
          { id: "s2", sponsor: "Dairy Bar", amount: 0 }, // empty pledge dropped
        ],
      },
      "Spring 2027",
      "2027-06-01",
    );
    // Carry-over first, then the pledge as named income.
    expect(rolled!.incomes!).toHaveLength(2);
    expect(rolled!.incomes![1]).toMatchObject({
      label: "Sponsorship — Smith Hardware",
      amount: 500,
      date: "2027-06-01",
    });
    expect(rolled!.sponsorships).toBeUndefined(); // pledges don't roll twice
  });

  it("budgetActuals buckets linked spending per category, unlinked as unplanned", () => {
    const fin = {
      budgetItems: [{ id: "bt", label: "Tournaments", amount: 3600 }],
      expenses: [
        {
          id: "e1",
          date: "2026-03-01",
          label: "Entry",
          amount: 450,
          budgetItemId: "bt",
        },
        {
          id: "e2",
          date: "2026-04-01",
          label: "Entry 2",
          amount: 450,
          budgetItemId: "bt",
        },
        { id: "e3", date: "2026-04-02", label: "Pizza", amount: 60 },
        {
          id: "e4",
          date: "2026-04-03",
          label: "Old link",
          amount: 10,
          budgetItemId: "gone",
        },
      ],
    };
    const a = budgetActuals(fin);
    expect(a.byItem).toEqual({ bt: 900 });
    expect(a.unplanned).toBe(70); // unlinked + dangling link
    expect(budgetActuals(null)).toEqual({ byItem: {}, unplanned: 0 });
  });

  it("monthlyCashflow buckets the ledger by month and fills silent months", () => {
    const ms = monthlyCashflow(finances, players);
    // Activity spans Feb–Apr 2026 (see fixture) → 3 continuous months.
    expect(ms.map((m) => m.month)).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(ms[0]).toMatchObject({
      label: "Feb",
      in: 600,
      out: 0,
      balanceEnd: 600,
    });
    expect(ms[1]).toMatchObject({ in: 200, out: 160, balanceEnd: 640 });
    expect(ms[2]).toMatchObject({ in: 35, out: 0, balanceEnd: 675 });
    expect(monthlyCashflow(null)).toEqual([]);
  });

  it("owesReminderText lists only owing, non-waived families with the total", () => {
    const text = owesReminderText(
      { ...finances, feeExemptIds: ["kid3"] },
      players,
      "Spring 2026",
    );
    expect(text).toContain("Spring 2026");
    expect(text).toContain("Ben: $75");
    expect(text).not.toContain("Ava"); // settled
    expect(text).not.toContain("Cy"); // waived
    expect(text).toContain("Total outstanding: $75");
    expect(owesReminderText({ clubFee: 0 }, players)).toMatch(/paid in full/i);
  });

  it("owesReminderText reflects per-child fundraising credit in each family's owed", () => {
    const fin = {
      clubFee: 100,
      incomes: [
        {
          id: "f",
          date: "2026-01-01",
          label: "Fundraiser",
          fundraising: true,
          amount: 40,
          playerId: "kid2",
        },
      ],
      payments: [],
    };
    const text = owesReminderText(fin, players);
    expect(text).toContain("Ava: $100"); // no credit
    expect(text).toContain("Ben: $60"); // 100 − 40 credited to Ben
    expect(text).toContain("Cy: $100");
    expect(text).toContain("Total outstanding: $260");
  });

  it("ledgerCsv emits a dated spreadsheet with escaping and running balance", () => {
    const fin = {
      payments: [
        { id: "p", playerId: "kid1", date: "2026-03-01", amount: 100 },
      ],
      expenses: [
        {
          id: "e",
          date: "2026-03-05",
          label: 'Balls, "good" ones',
          amount: 40,
        },
      ],
    };
    const csv = ledgerCsv(fin, players);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Date,Entry,In,Out,Balance");
    expect(lines[1]).toBe("2026-03-01,Team fee — Ava,100.00,,100.00");
    expect(lines[2]).toBe('2026-03-05,"Balls, ""good"" ones",,40.00,60.00');
  });

  it("yearComparison lines up archived years plus the current year", () => {
    const fin = {
      ...finances,
      pastSeasons: [
        {
          season: "through Spring 2026",
          collected: 1200,
          otherIncome: 300,
          spent: 1100,
          closingBalance: 400,
        },
      ],
    };
    const rows = yearComparison(fin, players);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      label: "through Spring 2026",
      in: 1500,
      out: 1100,
      closing: 400,
    });
    // Current year from the live fixture: 235 fees + 600 income, 160 spent, 675 balance.
    expect(rows[1]).toEqual({
      label: "This year",
      in: 835,
      out: 160,
      closing: 675,
    });
    expect(yearComparison(null, [])).toEqual([]);
  });

  it("transactionLedger merges fees, income, and expenses in date order with a running balance", () => {
    const rows = transactionLedger(finances, players);
    expect(rows.map((r) => r.id)).toEqual([
      "i1", // 02-20 sponsorship +600 -> 600
      "p1", // 03-01 Ava fee +150 -> 750
      "p2", // 03-02 Ben fee +50 -> 800
      "e1", // 03-05 entry -100 -> 700
      "e2", // 03-15 balls -60 -> 640
      "p3", // 04-01 Ben fee +25 -> 665
      "p4", // 04-02 ghost fee +10 -> 675
    ]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([
      600, 750, 800, 700, 640, 665, 675,
    ]);
    expect(rows[0]).toMatchObject({ direction: "in", source: "income" });
    expect(rows[1].label).toBe("Team fee — Ava");
    expect(rows[3]).toMatchObject({ direction: "out", source: "expense" });
    // Payment from a kid no longer rostered still shows, with a fallback name.
    expect(rows[6].label).toBe("Team fee — Player");
    expect(transactionLedger(null)).toEqual([]);
  });
});
