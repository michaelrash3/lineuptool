import {
  normalizeDateToIso,
  parseCsvRecords,
  parseGameChangerPastSeasonCsv,
  evalRoundDateFor,
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

describe("evalRoundDateFor", () => {
  it("stamps a biweekly round with its due date (filed after it came due)", () => {
    const team = {
      currentSeason: "Spring 2026",
      evaluationEvents: [
        { coachRole: "Head", evaluatorId: "u1", date: "2026-03-08" },
      ],
    };
    // 17 days after the last round — biweekly window is open, due 2026-03-22.
    const now = new Date("2026-03-25T12:00:00Z");
    expect(evalRoundDateFor(team, "u1", "Head", "2026-03-25", now)).toBe(
      "2026-03-22"
    );
  });

  it("stamps a preseason round with the season start (filed before it)", () => {
    const team = { currentSeason: "Spring 2026", evaluationEvents: [] };
    // Filed Feb 15, before the Mar 1 season start — still the preseason round.
    const now = new Date("2026-02-15T12:00:00Z");
    expect(evalRoundDateFor(team, "u1", "Head", "2026-02-15", now)).toBe(
      "2026-03-01"
    );
  });

  it("falls back to today off-cadence (no open window)", () => {
    const team = {
      currentSeason: "Spring 2026",
      evaluationEvents: [
        { coachRole: "Head", evaluatorId: "u1", date: "2026-03-08" },
      ],
    };
    // Only 4 days since the last round — no window open yet.
    const now = new Date("2026-03-12T12:00:00Z");
    expect(evalRoundDateFor(team, "u1", "Head", "2026-03-12", now)).toBe(
      "2026-03-12"
    );
  });

  it("falls back to today when the season can't be parsed (off-season)", () => {
    const team = { currentSeason: undefined, evaluationEvents: [] };
    const now = new Date("2026-07-04T12:00:00Z");
    expect(evalRoundDateFor(team, "u1", "Head", "2026-07-04", now)).toBe(
      "2026-07-04"
    );
  });

  it("falls back to today when team or user is missing", () => {
    const now = new Date("2026-07-04T12:00:00Z");
    expect(evalRoundDateFor(null, "u1", "Head", "2026-07-04", now)).toBe(
      "2026-07-04"
    );
    expect(
      evalRoundDateFor(
        { currentSeason: "Spring 2026", evaluationEvents: [] },
        null,
        "Head",
        "2026-07-04",
        now
      )
    ).toBe("2026-07-04");
  });
});
