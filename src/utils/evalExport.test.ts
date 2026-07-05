import { evalRoundCsv, evalRoundCsvFilename } from "./evalExport";

const players = [
  { id: "p1", name: "Ava Rivera", number: "3" },
  { id: "p2", name: "Ben Stone", number: 7 },
];
const categories = [
  { id: "contact", label: "Contact" },
  { id: "power", label: "Power" },
];

describe("evalRoundCsv", () => {
  it("emits a header and one row per player with grades in category order", () => {
    const round = {
      date: "2026-06-01",
      grades: {
        p1: { contact: 5, power: 3, notes: "quick bat" },
        p2: { contact: 2, power: 4 },
      },
    };
    const csv = evalRoundCsv(round, players, categories);
    expect(csv.split("\n")).toEqual([
      "Player,Number,Contact,Power,Notes",
      "Ava Rivera,3,5,3,quick bat",
      "Ben Stone,7,2,4,",
    ]);
  });

  it("leaves ungraded categories blank (never 0)", () => {
    const round = { grades: { p1: { power: 4 } } };
    const csv = evalRoundCsv(round, [players[0]], categories);
    // Contact ungraded → empty cell, not "0".
    expect(csv).toBe("Player,Number,Contact,Power,Notes\nAva Rivera,3,,4,");
  });

  it("blanks the number column when a player has no number", () => {
    const round = { grades: { p1: { contact: 5, power: 2 } } };
    const csv = evalRoundCsv(round, [{ id: "p1", name: "Ava" }], categories);
    expect(csv).toBe("Player,Number,Contact,Power,Notes\nAva,,5,2,");
  });

  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const round = {
      grades: { p1: { contact: 5, notes: 'Says "hi", newline\nhere' } },
    };
    const csv = evalRoundCsv(
      round,
      [{ id: "p1", name: "Smith, Jr." }],
      [{ id: "contact", label: "Contact" }],
    );
    expect(csv).toBe(
      'Player,Number,Contact,Notes\n"Smith, Jr.",,5,"Says ""hi"", newline\nhere"',
    );
  });

  it("handles a null round and empty roster gracefully", () => {
    expect(evalRoundCsv(null, players, categories)).toBe(
      "Player,Number,Contact,Power,Notes\nAva Rivera,3,,,\nBen Stone,7,,,",
    );
    expect(evalRoundCsv(null, [], categories)).toBe(
      "Player,Number,Contact,Power,Notes",
    );
  });

  it("ignores non-numeric grade values", () => {
    const round = { grades: { p1: { contact: "bad" as any, power: 4 } } };
    const csv = evalRoundCsv(round, [players[0]], categories);
    expect(csv).toBe("Player,Number,Contact,Power,Notes\nAva Rivera,3,,4,");
  });
});

describe("evalRoundCsvFilename", () => {
  it("builds a filesystem-safe name from team + date", () => {
    expect(evalRoundCsvFilename({ date: "2026-06-01" }, "Hawks 10U!")).toBe(
      "hawks-10u-evaluations-2026-06-01.csv",
    );
  });

  it("falls back when team/date are missing", () => {
    expect(evalRoundCsvFilename(null)).toBe("evaluations-round.csv");
    expect(evalRoundCsvFilename({ date: "2026-06-01" })).toBe(
      "evaluations-2026-06-01.csv",
    );
  });
});
