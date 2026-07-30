import { describe, it, expect } from "vitest";
import { buildPlayingTimeReportData } from "./playingTimeReportPdf";
import type { Game, Inning } from "../types";

// The season-ledger math is covered end-to-end in utils/playingTime.test.ts.
// These tests cover the printable assembly only: what the page actually says,
// in the words it says it. jspdf rendering is never exercised (it stays behind
// a lazy import so it never lands in the startup bundle).

const NAMES: Record<string, string> = {
  w: "Wes",
  x: "Xan",
  y: "Yuli",
  z: "Zeke",
  q: "Quinn",
};

const slim = (id: string) => ({ id, name: NAMES[id], number: "" });

// Two fielders (P/C) and a two-deep bench: four kids, every inning.
const inn = (fielders: [string, string], bench: string[]) =>
  ({
    P: slim(fielders[0]),
    C: slim(fielders[1]),
    BENCH: bench.map(slim),
  }) as unknown as Inning;

const played: Game = {
  id: "g1",
  date: "2026-04-04",
  opponent: "Hawks",
  status: "final",
  teamScore: 3,
  opponentScore: 1,
  lineup: [
    inn(["w", "x"], ["y", "z"]),
    inn(["y", "z"], ["w", "x"]),
    inn(["w", "y"], ["x", "z"]),
  ],
};

const scrimmage: Game = {
  ...played,
  id: "g2",
  date: "2026-04-05",
  isScrimmage: true,
};

const GAMES = [played, scrimmage];
const ROSTER = [
  { id: "w", name: "Wes", number: "3" },
  { id: "x", name: "Xan", number: "" },
  { id: "y", name: "Yuli", number: "12" },
  { id: "z", name: "Zeke", number: "" },
  { id: "q", name: "Quinn", number: "" },
];

describe("buildPlayingTimeReportData", () => {
  it("returns null until a finalized game with a lineup exists", () => {
    expect(buildPlayingTimeReportData([], ROSTER)).toBeNull();
    expect(buildPlayingTimeReportData([scrimmage], ROSTER)).toBeNull();
    expect(buildPlayingTimeReportData(undefined, ROSTER)).toBeNull();
    expect(buildPlayingTimeReportData(GAMES, [])).toBeNull();
  });

  it("prints which games it counted, and which it didn't", () => {
    const d = buildPlayingTimeReportData(GAMES, ROSTER)!;
    expect(d.gamesCounted).toBe(1);
    expect(d.countingNote).toBe(
      "Season totals from 1 finalized game. Not counted: 1 scrimmage.",
    );
  });

  it("leads with the team-level read, in plain words", () => {
    const d = buildPlayingTimeReportData(GAMES, ROSTER)!;
    expect(d.teamNotes).toEqual([
      "Bench innings per game run from 1 (Yuli) to 2 (Xan).",
      "Sat more than an even share so far: Xan (1 inning) and Zeke (1 inning).",
      "Fewest positions tried: Wes, Xan and Zeke — 1 position.",
      "Sat two innings in a row at some point: Xan.",
    ]);
    expect(d.notYetPlayedNote).toBe(
      "Quinn hasn't played in a counted game yet.",
    );
  });

  it("says so plainly when the season is even", () => {
    const even: Game = {
      ...played,
      lineup: [inn(["w", "x"], ["y", "z"]), inn(["y", "z"], ["w", "x"])],
    };
    const d = buildPlayingTimeReportData([even], ROSTER)!;
    expect(d.teamNotes).toContain(
      "Nobody has sat more than an even share of bench time this season.",
    );
    expect(d.teamNotes).toContain(
      "Nobody has sat two innings in a row all season.",
    );
    // Everyone sat exactly once — no spread worth calling out.
    expect(
      d.teamNotes.some((n) => n.startsWith("Bench innings per game")),
    ).toBe(false);
  });

  it("builds one table row per player, most out-of-balance first", () => {
    const d = buildPlayingTimeReportData(GAMES, ROSTER)!;
    expect(d.columns).toEqual([
      "Games",
      "Defense",
      "Bench",
      "Over share",
      "Bench 1st",
      "Positions",
    ]);
    expect(d.rows.map((r) => r.label)).toEqual([
      "Xan",
      "Zeke",
      "#3  Wes",
      "#12  Yuli",
    ]);
    // Xan: 1 game, 1 defensive inning, 2 bench, +1 over an even share,
    // never started on the bench, 1 position.
    expect(d.rows[0].cells).toEqual(["1", "1", "2", "+1", "0", "1"]);
    // A kid at or under an even share prints a dash, not "+0".
    expect(d.rows[2].cells).toEqual(["1", "2", "1", "—", "0", "1"]);
  });

  it("carries the read-aloud line and the position breakdown for each kid", () => {
    const d = buildPlayingTimeReportData(GAMES, ROSTER)!;
    expect(d.rows[0].sentence).toBe(
      "Xan: 1 defensive inning, 1 position, sat 2 innings, sat back-to-back 1 time.",
    );
    expect(d.rows[0].positionsLabel).toBe("C 1");
    const yuli = d.rows.find((r) => r.id === "y")!;
    expect(yuli.sentence).toBe(
      "Yuli: 2 defensive innings, 2 positions, sat 1 inning, never sat twice in a row.",
    );
    expect(yuli.positionsLabel).toBe("C 1 · P 1");
  });

  it("keeps engine vocabulary off the page", () => {
    const d = buildPlayingTimeReportData(GAMES, ROSTER)!;
    const banned = /penalty|weight|solver|ledger|fairness relax/i;
    for (const text of [
      d.countingNote,
      ...d.teamNotes,
      d.notYetPlayedNote,
      ...d.rows.map((r) => r.sentence),
    ]) {
      expect(text).not.toMatch(banned);
    }
  });
});
