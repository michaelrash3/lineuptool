import {
  normalizeDateToIso,
  parseCsvRecords,
  parseGameChangerPastSeasonCsv,
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
