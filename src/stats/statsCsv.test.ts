import { statsCsvFilename, statsTableCsv } from "./statsCsv";
import { BATTING_COLS, PITCHING_COLS, type StatRow } from "./statColumns";

const row = (over: Partial<StatRow>): StatRow => ({
  id: "p1",
  name: "Player",
  stats: {},
  total: 0,
  ...over,
});

const batting = { label: "Batting", cols: BATTING_COLS, defaultKey: "ops" };
const pitching = { label: "Pitching", cols: PITCHING_COLS, defaultKey: "era" };

describe("statsTableCsv", () => {
  it("emits the header with Player, Number, Overall, then the category columns", () => {
    expect(statsTableCsv([], batting)).toBe(
      "Player,Number,Overall,AB,AVG,OBP,OPS,H,2B,3B,HR,RBI,SB,K,QAB%",
    );
  });

  it("formats cells like the table and blanks missing values", () => {
    const csv = statsTableCsv(
      [
        row({
          id: "a",
          name: "Apex",
          number: "1",
          total: 72,
          stats: { ab: 20, avg: 0.4, ops: 1.205 },
        }),
      ],
      batting,
    );
    expect(csv.split("\n")[1]).toBe("Apex,1,72,20,.400,,1.205,,,,,,,,");
  });

  it("escapes names containing commas or quotes", () => {
    const csv = statsTableCsv(
      [row({ name: 'Smith, Jr. "Ace"', total: 10 })],
      batting,
    );
    expect(csv.split("\n")[1].startsWith('"Smith, Jr. ""Ace""",')).toBe(true);
  });

  it("sorts batting by OPS descending and pitching by ERA ascending, sinking missing values", () => {
    const names = (csv: string) =>
      csv
        .split("\n")
        .slice(1)
        .map((l) => l.split(",")[0]);
    expect(
      names(
        statsTableCsv(
          [
            row({ id: "a", name: "Alpha", stats: { ops: 0.7 }, total: 1 }),
            row({ id: "b", name: "Bravo", stats: { ops: 1.1 }, total: 1 }),
            row({ id: "c", name: "Charlie", stats: {}, total: 1 }),
          ],
          batting,
        ),
      ),
    ).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(
      names(
        statsTableCsv(
          [
            row({ id: "a", name: "Alpha", stats: { pEra: 6 }, total: 1 }),
            row({ id: "b", name: "Bravo", stats: { pEra: 2.5 }, total: 1 }),
          ],
          pitching,
        ),
      ),
    ).toEqual(["Bravo", "Alpha"]);
  });

  it("drops players with no stats and no eval score, blanks Overall at 0", () => {
    const lines = statsTableCsv(
      [
        row({ id: "a", name: "Alpha", stats: { ab: 5 }, total: 0 }),
        row({ id: "b", name: "Bravo", stats: {}, total: 0 }),
      ],
      batting,
    ).split("\n");
    expect(lines).toHaveLength(2); // header + Alpha only
    expect(lines[1].split(",")[0]).toBe("Alpha");
    expect(lines[1].split(",")[2]).toBe(""); // Overall blank when 0
  });
});

describe("statsCsvFilename", () => {
  it("slugs team, category, and scope", () => {
    expect(statsCsvFilename("Hawks Elite", "Batting", "Kid Pitch")).toBe(
      "hawks-elite-stats-batting-kid-pitch.csv",
    );
  });

  it("omits the scope for the default all-formats view", () => {
    expect(statsCsvFilename("Hawks", "Pitching", "All Formats")).toBe(
      "hawks-stats-pitching.csv",
    );
  });

  it("falls back cleanly with nothing provided", () => {
    expect(statsCsvFilename(undefined, undefined, undefined)).toBe(
      "stats-players.csv",
    );
  });
});
