import {
  normalizeDateToIso,
  parseCsvRecords,
  parseGameChangerPastSeasonCsv,
  evalDueDatesForYear,
  evalPromptStatus,
  isReturning,
  lineupSlotMatchesPlayer,
  isGameFinalized,
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
});
