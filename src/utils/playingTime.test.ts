import { describe, it, expect } from "vitest";
import {
  buildPlayingTimeReport,
  buildSitStreakHistory,
  countedGamesNote,
  playingTimeSentence,
  positionBreakdownLabel,
} from "./playingTime";
import {
  buildExtraSitHistory,
  buildSlotIdResolver,
} from "../lineupEngine/profile";
import type { Game, Inning } from "../types";

// ---------------------------------------------------------------------------
// A hand-built fixture season, small enough that every number below can be
// checked with a pencil. Four fielders (P/C/1B/SS) + a 2-deep bench, so each
// inning is six kids: four playing, two sitting.
//
// Roster: Avery, Bo, Cash, Drew, Ellis, Finn — plus Milo (joined mid-season,
// one game) and Nico (on the roster, never played).
//
// Games:
//   g1  final, 4 innings, clean rotation                        → counts
//   g2  final, 4 innings, Finn pulled from inning 3 (injury)    → counts
//   g3  final, SHORTENED to 3 innings (originalLineup keeps 6),
//       Finn marked absent, Milo's first game                   → counts
//   g4  SCRIMMAGE, final, Avery benched all four innings        → excluded
//   g5  draft (no score), Bo benched all four innings           → excluded
//   g6  final, 4 innings, Ellis sits three IN A ROW             → counts
// ---------------------------------------------------------------------------

const NAMES: Record<string, string> = {
  a: "Avery",
  b: "Bo",
  c: "Cash",
  d: "Drew",
  e: "Ellis",
  f: "Finn",
  m: "Milo",
  n: "Nico",
};

const slim = (id: string) => ({ id, name: NAMES[id], number: "" });

// One inning: four fielders in P/C/1B/SS order, everyone else on the bench.
const inn = (fielders: [string, string, string, string], bench: string[]) =>
  ({
    P: slim(fielders[0]),
    C: slim(fielders[1]),
    "1B": slim(fielders[2]),
    SS: slim(fielders[3]),
    BENCH: bench.map(slim),
  }) as unknown as Inning;

const g1: Game = {
  id: "g1",
  date: "2026-04-04",
  opponent: "Hawks",
  status: "final",
  teamScore: 7,
  opponentScore: 3,
  lineup: [
    inn(["a", "b", "c", "d"], ["e", "f"]),
    inn(["e", "f", "a", "b"], ["c", "d"]),
    inn(["c", "d", "e", "f"], ["a", "b"]),
    inn(["a", "b", "c", "d"], ["e", "f"]),
  ],
};

// Finn is pulled from inning 3 (index 2); innings 3-4 run five-deep, so the
// bench is one slot instead of two for the rest of the game.
const g2: Game = {
  id: "g2",
  date: "2026-04-11",
  opponent: "Bandits",
  status: "final",
  teamScore: 5,
  opponentScore: 5,
  midGameRemovals: { f: { fromInning: 2, reason: "injury" } },
  lineup: [
    inn(["a", "b", "c", "d"], ["e", "f"]),
    inn(["e", "f", "a", "b"], ["c", "d"]),
    inn(["c", "d", "e", "a"], ["b"]),
    inn(["b", "e", "d", "c"], ["a"]),
  ],
};

// Called after three innings (rain). `lineup` was trimmed to what was played;
// `originalLineup` still holds the full six-inning draft — three innings that
// never happened, in which Avery and Bo would have sat again.
const g3: Game = {
  id: "g3",
  date: "2026-04-18",
  opponent: "Sox",
  status: "final",
  teamScore: 4,
  opponentScore: 2,
  attendance: { f: false },
  lineup: [
    inn(["a", "b", "c", "d"], ["e", "m"]),
    inn(["e", "m", "a", "b"], ["c", "d"]),
    inn(["c", "d", "e", "m"], ["a", "b"]),
  ],
  originalLineup: [
    inn(["a", "b", "c", "d"], ["e", "m"]),
    inn(["e", "m", "a", "b"], ["c", "d"]),
    inn(["c", "d", "e", "m"], ["a", "b"]),
    inn(["c", "d", "e", "m"], ["a", "b"]),
    inn(["c", "d", "e", "m"], ["a", "b"]),
    inn(["c", "d", "e", "m"], ["a", "b"]),
  ],
};

const g4Scrimmage: Game = {
  id: "g4",
  date: "2026-04-25",
  opponent: "Intrasquad",
  status: "final",
  teamScore: 6,
  opponentScore: 6,
  isScrimmage: true,
  lineup: [
    inn(["b", "c", "d", "e"], ["a", "f"]),
    inn(["b", "c", "d", "e"], ["a", "f"]),
    inn(["b", "c", "d", "e"], ["a", "f"]),
    inn(["b", "c", "d", "e"], ["a", "f"]),
  ],
};

const g5Draft: Game = {
  id: "g5",
  date: "2026-05-02",
  opponent: "Rays",
  status: "draft",
  lineup: [
    inn(["a", "c", "d", "e"], ["b", "f"]),
    inn(["a", "c", "d", "e"], ["b", "f"]),
    inn(["a", "c", "d", "e"], ["b", "f"]),
    inn(["a", "c", "d", "e"], ["b", "f"]),
  ],
};

const g6: Game = {
  id: "g6",
  date: "2026-05-09",
  opponent: "Jays",
  status: "final",
  teamScore: 9,
  opponentScore: 1,
  lineup: [
    inn(["a", "b", "c", "d"], ["e", "f"]),
    inn(["a", "b", "c", "f"], ["e", "d"]),
    inn(["a", "b", "d", "f"], ["e", "c"]),
    inn(["e", "b", "c", "d"], ["a", "f"]),
  ],
};

const GAMES: Game[] = [g1, g2, g3, g4Scrimmage, g5Draft, g6];
const ROSTER = ["a", "b", "c", "d", "e", "f", "m", "n"].map((id) => ({
  id,
  name: NAMES[id],
  number: "",
}));

const report = () => buildPlayingTimeReport(GAMES, ROSTER);
const row = (name: string) => {
  const found = report().rows.find((r) => r.name === name);
  if (!found) throw new Error(`no row for ${name}`);
  return found;
};

describe("buildPlayingTimeReport — which games count", () => {
  it("counts only finalized, non-scrimmage games with a lineup", () => {
    const r = report();
    expect(r.gamesCounted).toBe(4); // g1, g2, g3, g6
    expect(r.scrimmagesSkipped).toBe(1);
    expect(r.unfinalizedSkipped).toBe(1);
  });

  it("a scrimmage never counts — Avery sat all four of its innings and none of them show up", () => {
    // In the four counted games Avery sits exactly once each: 4 bench innings.
    // The scrimmage would add 4 more (and 4 more games' worth of first-inning
    // benches) if it leaked in.
    expect(row("Avery").benchInnings).toBe(4);
    expect(row("Avery").gamesPlayed).toBe(4);
    expect(row("Avery").firstInningBenches).toBe(0);
    // Sanity: the scrimmage really does contain those four bench innings.
    const scrimmageOnly = buildPlayingTimeReport([g4Scrimmage], ROSTER);
    expect(scrimmageOnly.gamesCounted).toBe(0);
    expect(scrimmageOnly.rows).toHaveLength(0);
  });

  it("a game that isn't final yet never counts — Bo sat all four of its innings and none of them show up", () => {
    expect(row("Bo").benchInnings).toBe(3);
    expect(row("Bo").gamesPlayed).toBe(4);
    // Same lineup, flipped to final, is counted — proving the draft grid is
    // otherwise perfectly readable and it's the status that excluded it.
    const finalized = buildPlayingTimeReport(
      [{ ...g5Draft, status: "final", teamScore: 1, opponentScore: 0 }],
      ROSTER,
    );
    expect(finalized.gamesCounted).toBe(1);
    expect(finalized.rows.find((r) => r.name === "Bo")!.benchInnings).toBe(4);
  });

  it("states the counting rule in plain words", () => {
    expect(countedGamesNote(report())).toBe(
      "Season totals from 4 finalized games. Not counted: 1 scrimmage and 1 game not final yet.",
    );
    expect(countedGamesNote(buildPlayingTimeReport([g1], ROSTER))).toBe(
      "Season totals from 1 finalized game. Scrimmages and games that aren't final yet are never counted.",
    );
  });
});

describe("buildPlayingTimeReport — per-player totals", () => {
  it("reports defensive innings, bench innings and games played", () => {
    expect(row("Avery")).toMatchObject({
      gamesPlayed: 4,
      defensiveInnings: 11,
      benchInnings: 4,
    });
    expect(row("Bo")).toMatchObject({
      gamesPlayed: 4,
      defensiveInnings: 12,
      benchInnings: 3,
    });
    expect(row("Ellis")).toMatchObject({
      gamesPlayed: 4,
      defensiveInnings: 8,
      benchInnings: 7,
    });
  });

  it("a shortened game contributes only the innings that were played, never the trimmed draft", () => {
    // g3 was called after 3 innings; originalLineup still holds 6. Avery's
    // season is 4 + 4 + 3 + 4 = 15 innings of baseball, not 18.
    const avery = row("Avery");
    expect(avery.defensiveInnings + avery.benchInnings).toBe(15);
    // The three innings that never happened would each have sat Avery again.
    expect(avery.benchInnings).toBe(4);
  });

  it("a kid pulled mid-game is only charged for the innings he was there for", () => {
    // Finn played 3 counted games. In g2 he was pulled from inning 3, so that
    // game gives him 2 innings (1 bench + 1 at C), not 4.
    const finn = row("Finn");
    expect(finn.gamesPlayed).toBe(3);
    expect(finn.defensiveInnings).toBe(5);
    expect(finn.benchInnings).toBe(5);
    // g1 (4) + g2 (2) + g6 (4) = 10 innings present.
    expect(finn.defensiveInnings + finn.benchInnings).toBe(10);
  });

  it("a kid who joined mid-season is scored on the games he was actually there for", () => {
    const milo = row("Milo");
    expect(milo.gamesPlayed).toBe(1);
    expect(milo.defensiveInnings).toBe(2);
    expect(milo.benchInnings).toBe(1);
    expect(milo.positions).toEqual(["C", "SS"]);
    // Per-game rates are what make him comparable to a kid with four games.
    expect(milo.benchInningsPerGame).toBe(1);
    expect(row("Ellis").benchInningsPerGame).toBe(1.75);
  });

  it("a rostered kid with no counted games is listed separately, not as a zero row", () => {
    const r = report();
    expect(r.notYetPlayed).toEqual([{ id: "n", name: "Nico" }]);
    expect(r.rows.map((x) => x.name)).not.toContain("Nico");
  });

  it("a kid still sitting in a saved grid but marked absent didn't play that game", () => {
    // Real shape: the coach generated a lineup, then marked a kid out and
    // never regenerated. He's in the grid, but he wasn't at the field.
    const staleGrid: Game = {
      id: "stale",
      date: "2026-05-16",
      opponent: "Owls",
      status: "final",
      teamScore: 2,
      opponentScore: 1,
      attendance: { m: false },
      lineup: [
        inn(["a", "m", "c", "d"], ["e", "b"]),
        inn(["a", "m", "c", "d"], ["e", "b"]),
      ],
    };
    const r = buildPlayingTimeReport([staleGrid], ROSTER);
    expect(r.rows.map((x) => x.name)).not.toContain("Milo");
    expect(r.notYetPlayed.map((p) => p.name)).toContain("Milo");
    expect(r.rows.find((x) => x.name === "Avery")!.gamesPlayed).toBe(1);
  });

  it("tallies sits beyond an even share of the game's bench time", () => {
    // Ellis: +1 in g1 (sat 2 where the even share was 1) and +2 in g6 (sat 3).
    expect(row("Ellis").extraSits).toBe(3);
    // Finn: +1 in g1, +1 in g6. His shortened g2 charges him nothing.
    expect(row("Finn").extraSits).toBe(2);
    // Everyone else came out even.
    for (const name of ["Avery", "Bo", "Cash", "Drew", "Milo"]) {
      expect(row(name).extraSits).toBe(0);
    }
  });

  it("reports the even-share defensive-innings target alongside the actual", () => {
    // Three 4-inning games at 16 defensive slots / 6 kids, plus a 3-inning
    // game at 12 / 6 → 8 + 2 = 10.
    expect(row("Avery").fairShareInnings).toBeCloseTo(10, 6);
    expect(row("Avery").defensiveInnings).toBe(11);
    // Finn's g2 share is prorated to the half of the game he was there for.
    expect(row("Finn").fairShareInnings).toBeCloseTo(
      16 / 6 + 8 / 6 + 16 / 6,
      6,
    );
  });

  it("counts games that started with the kid on the bench", () => {
    expect(row("Ellis").firstInningBenches).toBe(4);
    expect(row("Finn").firstInningBenches).toBe(3);
    expect(row("Milo").firstInningBenches).toBe(1);
    expect(row("Bo").firstInningBenches).toBe(0);
  });

  it("lists the distinct positions each kid played, most innings first", () => {
    expect(row("Avery").positionInnings).toEqual([
      { position: "P", innings: 7 },
      { position: "1B", innings: 3 },
      { position: "SS", innings: 1 },
    ]);
    expect(row("Avery").positions).toEqual(["P", "1B", "SS"]);
    expect(row("Avery").distinctPositions).toBe(3);
    expect(positionBreakdownLabel(row("Avery"))).toBe("P 7 · 1B 3 · SS 1");
    expect(row("Finn").distinctPositions).toBe(2);
  });

  it("position innings always add up to the defensive innings on the same line", () => {
    // If these two ever disagreed the report would be arguing with itself in
    // front of a parent.
    for (const r of report().rows) {
      const summed = r.positionInnings.reduce((s, x) => s + x.innings, 0);
      expect(summed).toBe(r.defensiveInnings);
    }
  });

  it("flags bench innings that came back-to-back, within a game only", () => {
    // Ellis sat innings 1-2-3 of g6: two back-to-back pairs, longest run 3.
    expect(row("Ellis").backToBackSits).toBe(2);
    expect(row("Ellis").longestSitStreak).toBe(3);
    // Finn sat the first and last inning of g1 and of g6 — never in a row.
    expect(row("Finn").backToBackSits).toBe(0);
    expect(row("Finn").longestSitStreak).toBe(1);
    // A bench inning at the end of one game and the start of the next is not
    // back-to-back: Avery's four sits are one per game.
    expect(row("Avery").backToBackSits).toBe(0);
  });
});

describe("buildPlayingTimeReport — team view", () => {
  it("sorts the most out-of-balance kid to the top", () => {
    expect(report().rows.map((r) => r.name)).toEqual([
      "Ellis",
      "Finn",
      "Avery",
      "Cash",
      "Drew",
      "Milo",
      "Bo",
    ]);
  });

  it("surfaces most-sat vs least-sat by bench innings per game", () => {
    const r = report();
    expect(r.mostSat?.name).toBe("Ellis");
    expect(r.leastSat?.name).toBe("Bo");
    expect(r.benchSpreadPerGame).toBeCloseTo(1.75 - 0.75, 6);
  });

  it("surfaces the kid who has seen the fewest positions", () => {
    expect(report().fewestPositions?.name).toBe("Finn");
    expect(report().fewestPositions?.distinctPositions).toBe(2);
  });

  it("an empty season reports nothing rather than throwing", () => {
    const r = buildPlayingTimeReport([], ROSTER);
    expect(r.gamesCounted).toBe(0);
    expect(r.rows).toHaveLength(0);
    expect(r.mostSat).toBeNull();
    expect(r.benchSpreadPerGame).toBe(0);
    expect(buildPlayingTimeReport(null, null).rows).toHaveLength(0);
  });
});

describe("playingTimeSentence", () => {
  it("reads aloud in plain words", () => {
    expect(playingTimeSentence(row("Avery"))).toBe(
      "Avery: 11 defensive innings, 3 positions, sat 4 innings, never sat twice in a row.",
    );
    expect(playingTimeSentence(row("Ellis"))).toBe(
      "Ellis: 8 defensive innings, 3 positions, sat 7 innings, sat back-to-back 2 times.",
    );
    expect(playingTimeSentence(row("Milo"))).toBe(
      "Milo: 2 defensive innings, 2 positions, sat 1 inning, never sat twice in a row.",
    );
  });

  it("uses no engine vocabulary", () => {
    const banned = /penalty|weight|fairness score|ledger|extraSit|solver/i;
    for (const r of report().rows) {
      expect(playingTimeSentence(r)).not.toMatch(banned);
    }
  });

  it("says so when a kid never sat", () => {
    const neverSat = buildPlayingTimeReport(
      [
        {
          ...g1,
          lineup: [inn(["a", "b", "c", "d"], ["e", "f"])],
        } as Game,
      ],
      ROSTER,
    );
    const bo = neverSat.rows.find((r) => r.name === "Bo")!;
    expect(playingTimeSentence(bo)).toBe(
      "Bo: 1 defensive inning, 1 position, never sat.",
    );
  });
});

describe("report ↔ engine ledger agreement", () => {
  // The report is only worth showing a parent if it is the same arithmetic the
  // rotation engine used when it built those lineups. The report reads the
  // engine's own ledger for bench/defense/extra sits; this walks the season a
  // second way (the games-played / back-to-back walk) and demands the two
  // agree, so a change to either side can't quietly split them.
  it("the report's own game walk produces the same bench innings as the engine ledger", () => {
    const resolveId = buildSlotIdResolver(ROSTER);
    const ledger = buildExtraSitHistory(GAMES, null, resolveId);
    const walk = buildSitStreakHistory(GAMES, resolveId);
    expect(ledger.size).toBeGreaterThan(0);
    for (const [id, entry] of ledger) {
      expect(walk.get(id)?.benchInnings ?? 0).toBe(entry.benchInn);
    }
  });

  it("every reported number is the engine ledger's number", () => {
    const resolveId = buildSlotIdResolver(ROSTER);
    const ledger = buildExtraSitHistory(GAMES, null, resolveId);
    for (const r of report().rows) {
      const entry = ledger.get(r.id)!;
      expect(r.benchInnings).toBe(entry.benchInn);
      expect(r.defensiveInnings).toBe(entry.defInn);
      expect(r.extraSits).toBe(entry.extraSits);
      expect(r.fairShareInnings).toBe(entry.expectedDef);
    }
  });

  it("follows a kid whose roster id changed (delete + re-add) instead of stranding his history", () => {
    // Same games, but Ellis is back on the roster under a fresh id — the
    // engine's slot resolver coalesces by name, so the report must too.
    const readded = ROSTER.map((p) =>
      p.id === "e" ? { ...p, id: "e-new" } : p,
    );
    const r = buildPlayingTimeReport(GAMES, readded);
    const ellis = r.rows.find((x) => x.name === "Ellis")!;
    expect(ellis.id).toBe("e-new");
    expect(ellis.benchInnings).toBe(7);
    expect(ellis.extraSits).toBe(3);
    expect(r.notYetPlayed).toEqual([{ id: "n", name: "Nico" }]);
  });
});
