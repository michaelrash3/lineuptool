// Season playing-time report — the receipts behind "is my kid playing enough?".
//
// EVERY number here comes out of the SAME season-ledger builders the rotation
// engine itself reads (lineupEngine/profile.ts):
//
//   buildExtraSitHistory        → bench innings, defensive innings, sits beyond
//                                 an even share, and the even-share target
//   buildPositionHistory        → innings at each defensive position
//   buildFirstInningBenchHistory→ how often a kid started the game on the bench
//   buildSlotIdResolver         → follows a kid whose roster id changed
//   isFinalizedGame             → which games count at all
//
// That reuse is the whole point: this report is shown to parents, so it must
// never be able to disagree with the lineup the engine actually built. Nothing
// below re-derives bench/defense/extra-sit math with its own rules.
//
// Two facts the engine doesn't keep (it has no use for them) are walked here:
// how many games a kid actually played in, and whether they ever sat two
// innings back-to-back. That walk mirrors buildExtraSitHistory's own
// per-inning "was this kid actually here" rule (absent for the game, or pulled
// mid-game from inning N on), and playingTime.test.ts asserts the walk's bench
// tally equals the engine ledger's for every player in a fixture season — so
// the two can't silently drift apart.
//
// What counts: finalized, non-scrimmage games that have a saved lineup grid.
// Scrimmages and games that aren't final yet contribute nothing (that's
// isFinalizedGame's rule, and the UI says so out loud).
//
// One deliberate difference from the engine: the engine keeps SEPARATE ledgers
// for rec and tournament games (it balances playing time within a mode). This
// report is the season a parent lived through, so it totals every counted game
// together.

import type { Game, SlimPlayer } from "../types";
import {
  buildExtraSitHistory,
  buildFirstInningBenchHistory,
  buildPositionHistory,
  buildSlotIdResolver,
  isFinalizedGame,
} from "../lineupEngine/profile";

export interface PlayingTimePosition {
  position: string;
  innings: number;
}

export interface PlayingTimeRow {
  id: string;
  name: string;
  number: string;
  /** Finalized, non-scrimmage games this kid actually took the field for. */
  gamesPlayed: number;
  defensiveInnings: number;
  benchInnings: number;
  /** Innings sat beyond an even share of that game's bench time. */
  extraSits: number;
  /** Defensive innings an even split would have given them (fractional). */
  fairShareInnings: number;
  /** Distinct positions played, most innings first. */
  positions: string[];
  positionInnings: PlayingTimePosition[];
  distinctPositions: number;
  /** Games that started with this kid on the bench. */
  firstInningBenches: number;
  /** Times a bench inning immediately followed another, within one game. */
  backToBackSits: number;
  /** Longest run of bench innings in a single game. */
  longestSitStreak: number;
  benchInningsPerGame: number;
  defensiveInningsPerGame: number;
}

export interface PlayingTimeReport {
  /** Finalized, non-scrimmage games with a lineup — the report's whole basis. */
  gamesCounted: number;
  /** Scrimmages with a lineup that were left out. */
  scrimmagesSkipped: number;
  /** Games with a lineup that aren't final yet, so they were left out. */
  unfinalizedSkipped: number;
  /** Most out-of-balance first: extra sits, then bench time per game. */
  rows: PlayingTimeRow[];
  /** On the roster, no counted games yet (joined late, or hasn't played). */
  notYetPlayed: Array<{ id: string; name: string }>;
  mostSat: PlayingTimeRow | null;
  leastSat: PlayingTimeRow | null;
  /** Bench innings per game, biggest gap between any two kids. */
  benchSpreadPerGame: number;
  fewestPositions: PlayingTimeRow | null;
}

interface RosterLike {
  id?: string;
  name?: string;
  number?: string | number | null;
}

type SitEntry = {
  gamesPlayed: number;
  benchInnings: number;
  backToBackSits: number;
  longestSitStreak: number;
};

// Per-game walk for the two facts the engine ledger doesn't store: games
// actually played, and bench innings that came back-to-back. The game filter
// and the per-inning "was this kid here" rule are deliberately identical to
// buildExtraSitHistory's — a kid marked absent, or pulled from inning N on,
// isn't credited or charged for innings they weren't part of.
export const buildSitStreakHistory = (
  games: Game[] | null | undefined,
  resolveId: (id?: string, name?: string) => string | undefined = (id) => id,
): Map<string, SitEntry> => {
  const out = new Map<string, SitEntry>();

  for (const g of games || []) {
    if (!g?.lineup?.length) continue;
    if (!isFinalizedGame(g)) continue;

    // The grid that was actually played. A game shortened by weather or a
    // run rule keeps its full-length draft in `originalLineup`; the engine
    // ledger only ever reads `lineup`, so this walk does too — innings that
    // never happened are nobody's playing time.
    const grid = g.lineup;

    const removedFrom = (pid: string): number | null => {
      const r = (
        g.midGameRemovals as Record<string, { fromInning?: number }>
      )?.[pid];
      const fi = r?.fromInning;
      return Number.isFinite(fi) && fi != null ? fi : null;
    };
    const isActiveAtInning = (pid: string, inn: number) => {
      if (g.attendance?.[pid] === false) return false;
      const rf = removedFrom(pid);
      if (rf !== null && inn >= rf) return false;
      return true;
    };

    // Everyone who shows up anywhere in this game's grid, keyed by the id the
    // snapshot stored (attendance / removals are keyed the same way).
    const attending = new Set<string>();
    const idName = new Map<string, string>();
    for (const inning of grid) {
      for (const pos in inning) {
        if (pos === "BENCH") continue;
        const p = inning[pos] as SlimPlayer | undefined;
        if (p) {
          attending.add(p.id);
          idName.set(p.id, p.name);
        }
      }
      for (const bp of (inning.BENCH || []) as NonNullable<SlimPlayer>[]) {
        if (g.attendance?.[bp.id] === false) continue;
        attending.add(bp.id);
        idName.set(bp.id, bp.name);
      }
    }

    const innings = grid.length;
    for (const pid of attending) {
      let played = 0;
      let benchInnings = 0;
      let backToBackSits = 0;
      let longestSitStreak = 0;
      let run = 0;
      for (let i = 0; i < innings; i++) {
        if (!isActiveAtInning(pid, i)) {
          run = 0;
          continue;
        }
        played += 1;
        const onBench = (
          (grid[i].BENCH || []) as NonNullable<SlimPlayer>[]
        ).some((bp) => bp && bp.id === pid);
        if (!onBench) {
          run = 0;
          continue;
        }
        benchInnings += 1;
        run += 1;
        if (run >= 2) backToBackSits += 1;
        if (run > longestSitStreak) longestSitStreak = run;
      }
      // Present in the grid but active for no inning = they weren't at this
      // game. It isn't a game played.
      if (played === 0) continue;
      const key = resolveId(pid, idName.get(pid));
      if (!key) continue;
      const cur = out.get(key) || {
        gamesPlayed: 0,
        benchInnings: 0,
        backToBackSits: 0,
        longestSitStreak: 0,
      };
      cur.gamesPlayed += 1;
      cur.benchInnings += benchInnings;
      cur.backToBackSits += backToBackSits;
      if (longestSitStreak > cur.longestSitStreak)
        cur.longestSitStreak = longestSitStreak;
      out.set(key, cur);
    }
  }
  return out;
};

const EMPTY_ROW = {
  gamesPlayed: 0,
  benchInnings: 0,
  backToBackSits: 0,
  longestSitStreak: 0,
};

export const buildPlayingTimeReport = (
  games: Game[] | null | undefined,
  players: RosterLike[] | null | undefined,
): PlayingTimeReport => {
  const roster = (players || []).filter((p) => p?.id);
  const all = games || [];

  // Same resolver the engine builds, so a kid who was removed and re-added to
  // the roster keeps the history they earned under their old id.
  const resolveId = buildSlotIdResolver(roster);

  // The engine's own ledger, verbatim.
  const sitLedger = buildExtraSitHistory(all, null, resolveId);
  const positionLedger = buildPositionHistory(all, null, resolveId);
  const firstInningLedger = buildFirstInningBenchHistory(all, null, resolveId);
  const streaks = buildSitStreakHistory(all, resolveId);

  let gamesCounted = 0;
  let scrimmagesSkipped = 0;
  let unfinalizedSkipped = 0;
  for (const g of all) {
    if (!g?.lineup?.length) continue;
    if (isFinalizedGame(g)) gamesCounted += 1;
    else if (g.isScrimmage) scrimmagesSkipped += 1;
    else unfinalizedSkipped += 1;
  }

  const rows: PlayingTimeRow[] = [];
  const notYetPlayed: Array<{ id: string; name: string }> = [];

  for (const p of roster) {
    const id = p.id as string;
    const name = (p.name || "").trim() || "Player";
    const streak = streaks.get(id) || EMPTY_ROW;
    if (streak.gamesPlayed === 0) {
      notYetPlayed.push({ id, name });
      continue;
    }
    const sit = sitLedger.get(id) || {
      extraSits: 0,
      benchInn: 0,
      defInn: 0,
      expectedDef: 0,
    };
    const positionInnings: PlayingTimePosition[] = [
      ...(positionLedger.get(id)?.entries() || []),
    ]
      .map(([position, v]) => ({ position, innings: v.total }))
      .sort(
        (a, b) => b.innings - a.innings || a.position.localeCompare(b.position),
      );

    rows.push({
      id,
      name,
      number: p.number == null ? "" : String(p.number),
      gamesPlayed: streak.gamesPlayed,
      defensiveInnings: sit.defInn,
      benchInnings: sit.benchInn,
      extraSits: sit.extraSits,
      fairShareInnings: sit.expectedDef,
      positions: positionInnings.map((x) => x.position),
      positionInnings,
      distinctPositions: positionInnings.length,
      firstInningBenches: firstInningLedger.get(id) || 0,
      backToBackSits: streak.backToBackSits,
      longestSitStreak: streak.longestSitStreak,
      benchInningsPerGame: sit.benchInn / streak.gamesPlayed,
      defensiveInningsPerGame: sit.defInn / streak.gamesPlayed,
    });
  }

  // Imbalance first: sits beyond an even share, then bench time per game so a
  // kid who joined in June isn't buried under kids with twice the games.
  rows.sort(
    (a, b) =>
      b.extraSits - a.extraSits ||
      b.benchInningsPerGame - a.benchInningsPerGame ||
      a.name.localeCompare(b.name),
  );

  const byBench = [...rows].sort(
    (a, b) =>
      b.benchInningsPerGame - a.benchInningsPerGame ||
      a.name.localeCompare(b.name),
  );
  const fewestPositions =
    rows.length === 0
      ? null
      : [...rows].sort(
          (a, b) =>
            a.distinctPositions - b.distinctPositions ||
            a.name.localeCompare(b.name),
        )[0];

  const mostSat = byBench[0] || null;
  const leastSat = byBench.length > 1 ? byBench[byBench.length - 1] : null;

  return {
    gamesCounted,
    scrimmagesSkipped,
    unfinalizedSkipped,
    rows,
    notYetPlayed,
    mostSat,
    leastSat,
    benchSpreadPerGame:
      mostSat && leastSat
        ? mostSat.benchInningsPerGame - leastSat.benchInningsPerGame
        : 0,
    fewestPositions,
  };
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The line a coach reads aloud in a parking-lot conversation. Plain words, no
// engine vocabulary:
//   "Jackson: 42 defensive innings, 6 positions, sat 8 innings, never sat
//    twice in a row."
export const playingTimeSentence = (row: PlayingTimeRow): string => {
  if (row.gamesPlayed === 0) return `${row.name}: no finalized games yet.`;
  const parts = [
    plural(row.defensiveInnings, "defensive inning"),
    plural(row.distinctPositions, "position"),
  ];
  if (row.benchInnings === 0) {
    parts.push("never sat");
  } else {
    parts.push(`sat ${plural(row.benchInnings, "inning")}`);
    parts.push(
      row.backToBackSits === 0
        ? "never sat twice in a row"
        : `sat back-to-back ${plural(row.backToBackSits, "time")}`,
    );
  }
  return `${row.name}: ${parts.join(", ")}.`;
};

// "SS 8 · 2B 6 · RF 4" — where the innings actually went.
export const positionBreakdownLabel = (row: PlayingTimeRow): string =>
  row.positionInnings.map((x) => `${x.position} ${x.innings}`).join(" · ");

const oneDp = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const list = (names: string[]): string => {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

// Name lists that aren't ranking anything read alphabetically, not in
// worst-first order — nobody's singled out by where they land in the sentence.
const byName = (rows: PlayingTimeRow[]): string[] =>
  rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));

// The team-level read, in the order a coach would say it. Shared by the Stats
// tab card and the printable report so the screen and the page a parent takes
// home are word-for-word the same.
export const playingTimeTeamNotes = (report: PlayingTimeReport): string[] => {
  const notes: string[] = [];
  if (report.mostSat && report.leastSat && report.benchSpreadPerGame > 0) {
    notes.push(
      `Bench innings per game run from ${oneDp(report.leastSat.benchInningsPerGame)} (${report.leastSat.name}) to ${oneDp(report.mostSat.benchInningsPerGame)} (${report.mostSat.name}).`,
    );
  }

  const overShare = report.rows.filter((r) => r.extraSits > 0);
  notes.push(
    overShare.length === 0
      ? "Nobody has sat more than an even share of bench time this season."
      : `Sat more than an even share so far: ${list(
          overShare.map(
            (r) =>
              `${r.name} (${r.extraSits} inning${r.extraSits === 1 ? "" : "s"})`,
          ),
        )}.`,
  );

  if (report.fewestPositions) {
    const n = report.fewestPositions.distinctPositions;
    const fewest = report.rows.filter((r) => r.distinctPositions === n);
    notes.push(
      `Fewest positions tried: ${list(byName(fewest))} — ${n} position${n === 1 ? "" : "s"}.`,
    );
  }

  const backToBack = report.rows.filter((r) => r.backToBackSits > 0);
  notes.push(
    backToBack.length === 0
      ? "Nobody has sat two innings in a row all season."
      : `Sat two innings in a row at some point: ${list(byName(backToBack))}.`,
  );
  return notes;
};

// Rostered kids with nothing to report yet — a late add, or someone who
// hasn't made a finalized game. Named rather than shown as a row of zeros.
export const notYetPlayedNote = (report: PlayingTimeReport): string =>
  report.notYetPlayed.length === 0
    ? ""
    : `${list(report.notYetPlayed.map((p) => p.name))} ${
        report.notYetPlayed.length === 1 ? "hasn't" : "haven't"
      } played in a counted game yet.`;

// One sentence stating exactly which games are behind every number on the
// page. Shown in the UI and printed on the PDF — a parent should never have to
// ask "does that include the scrimmage?".
export const countedGamesNote = (report: PlayingTimeReport): string => {
  const base = `Season totals from ${plural(report.gamesCounted, "finalized game")}.`;
  const left: string[] = [];
  if (report.scrimmagesSkipped > 0)
    left.push(plural(report.scrimmagesSkipped, "scrimmage"));
  if (report.unfinalizedSkipped > 0)
    left.push(`${plural(report.unfinalizedSkipped, "game")} not final yet`);
  if (left.length === 0) {
    return `${base} Scrimmages and games that aren't final yet are never counted.`;
  }
  return `${base} Not counted: ${left.join(" and ")}.`;
};
