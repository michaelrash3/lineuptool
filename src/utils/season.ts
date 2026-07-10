// Season-level reports + returning-status helpers, extracted from helpers.ts:
// bench-equity and position-variety reports, W-L record math, the season
// summary, and returning-intent predicates. Pure aggregation over team data.

import { countsTowardStats } from "./gameStatus";
import { normalizeDateToIso } from "./dates";
import type { Game, Player, PlayerId, PlayerStats, SlimPlayer } from "../types";

export interface BenchImbalanceEntry {
  extraSits: number;
  totalBench: number;
  totalDefense: number;
  expectedDefense: number;
  gamesAttended: number;
}

export const buildSeasonBenchImbalance = (
  games: Game[] | null | undefined,
  currentGameId: string,
  // Roster is unused now that defense/bench come from imported box-score lines
  // (keyed by current player id), but the param is kept for call-site stability.
  _players?: Array<{ id?: string; name?: string }> | null,
): Map<PlayerId, BenchImbalanceEntry> => {
  const out = new Map<PlayerId, BenchImbalanceEntry>();

  for (const g of games || []) {
    if (g.id === currentGameId) continue;
    if (!countsTowardStats(g)) continue;
    // Actuals only: a game contributes nothing until its stats are imported.
    // playerStats is keyed by current roster id (matched by name at import).
    const lines = g.playerStats;
    if (!lines) continue;

    // Attendance = players with a box-score line this game. Defensive innings
    // come straight from the fielding "Total" column; players who only batted
    // (full bench in the field) carry fInnTotal 0 and count as all-bench.
    const defenseById = new Map<PlayerId, number>();
    let gameInnings = 0;
    for (const pid of Object.keys(lines)) {
      const def = Number(lines[pid]?.fInnTotal) || 0;
      defenseById.set(pid, def);
      if (def > gameInnings) gameInnings = def;
    }
    const playerCount = defenseById.size;
    // Need at least one fielded inning to know the game length; otherwise this
    // import has no fielding data to apportion.
    if (playerCount === 0 || gameInnings <= 0) continue;

    let totalDefenseSlots = 0;
    for (const def of defenseById.values()) totalDefenseSlots += def;
    const expectedDefensePerPlayer = totalDefenseSlots / playerCount;
    const totalBenchSlots = gameInnings * playerCount - totalDefenseSlots;
    const minBenchPerPlayer = Math.floor(
      Math.max(0, totalBenchSlots) / playerCount,
    );

    for (const [pid, def] of defenseById) {
      const bench = Math.max(0, gameInnings - def);
      const cur = out.get(pid) || {
        extraSits: 0,
        totalBench: 0,
        totalDefense: 0,
        expectedDefense: 0,
        gamesAttended: 0,
      };
      cur.extraSits += Math.max(0, bench - minBenchPerPlayer);
      cur.totalBench += bench;
      cur.totalDefense += def;
      cur.expectedDefense += expectedDefensePerPlayer;
      cur.gamesAttended += 1;
      out.set(pid, cur);
    }
  }
  return out;
};

// ============================================================================
// Season position variety — how many innings each player has logged at each
// defensive position. Sourced from imported GameChanger box scores (the fielding
// per-position innings block), not the planned lineup, so it reflects what
// actually happened. Many youth leagues expect (or require) coaches to rotate
// kids through different spots; this surfaces who's been stuck at one position
// and who's never seen the infield/outfield, so the rotation can be evened out.
// Games without imported stats contribute nothing.
// ============================================================================

const INFIELD_POSITIONS = ["1B", "2B", "3B", "SS"];
const OUTFIELD_POSITIONS = ["LF", "CF", "RF", "LCF", "RCF"];
const BATTERY_POSITIONS = ["P", "C"];

export interface PositionVarietyEntry {
  // innings logged at each position, e.g. { SS: 8, "2B": 3 }
  byPosition: Record<string, number>;
  totalDefense: number;
  distinctPositions: number;
  infieldInnings: number;
  outfieldInnings: number;
  batteryInnings: number;
}

// Maps each per-game fielding-innings field to its display position label.
// GameChanger's "SF" column is right-center field, so fInnSF → RCF.
// Exported for the player-development trend engine, which reads distinct
// positions per game line from the same actuals fields.
export const POSITION_INNINGS_FIELDS: Array<[keyof PlayerStats, string]> = [
  ["fInnP", "P"],
  ["fInnC", "C"],
  ["fInn1B", "1B"],
  ["fInn2B", "2B"],
  ["fInn3B", "3B"],
  ["fInnSS", "SS"],
  ["fInnLF", "LF"],
  ["fInnCF", "CF"],
  ["fInnRF", "RF"],
  ["fInnSF", "RCF"],
];

export const buildSeasonPositionVariety = (
  games: Game[] | null | undefined,
  // Roster is unused now that positions come from imported box-score lines
  // (keyed by current player id); param kept for call-site stability.
  _players?: Array<{ id?: string; name?: string }> | null,
): Map<PlayerId, PositionVarietyEntry> => {
  const out = new Map<PlayerId, PositionVarietyEntry>();
  const infield = new Set(INFIELD_POSITIONS);
  const outfield = new Set(OUTFIELD_POSITIONS);
  const battery = new Set(BATTERY_POSITIONS);

  for (const g of games || []) {
    if (!countsTowardStats(g)) continue;
    // Actuals only: skip games whose stats haven't been imported.
    const lines = g.playerStats;
    if (!lines) continue;
    for (const pid of Object.keys(lines)) {
      const line = lines[pid] as PlayerStats | undefined;
      if (!line) continue;
      let entry: PositionVarietyEntry | undefined;
      for (const [field, pos] of POSITION_INNINGS_FIELDS) {
        const innings = Number(line[field]);
        if (!Number.isFinite(innings) || innings <= 0) continue;
        if (!entry) {
          entry = out.get(pid);
          if (!entry) {
            entry = {
              byPosition: {},
              totalDefense: 0,
              distinctPositions: 0,
              infieldInnings: 0,
              outfieldInnings: 0,
              batteryInnings: 0,
            };
            out.set(pid, entry);
          }
        }
        entry.byPosition[pos] = (entry.byPosition[pos] || 0) + innings;
        entry.totalDefense += innings;
        if (infield.has(pos)) entry.infieldInnings += innings;
        else if (outfield.has(pos)) entry.outfieldInnings += innings;
        else if (battery.has(pos)) entry.batteryInnings += innings;
      }
    }
  }
  for (const entry of out.values()) {
    entry.distinctPositions = Object.keys(entry.byPosition).length;
  }
  return out;
};

// ============================================================================
// Season summary — record, run differential, current streak, and a recent
// game log, computed from finalized games. A season-at-a-glance for coaches.
// ============================================================================

interface SeasonGameResult {
  id: string;
  date: string;
  opponent: string;
  teamScore: number;
  opponentScore: number;
  result: "W" | "L" | "T";
}

export interface TeamRecordLike {
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
}

// GameChanger-style standings use winning percentage, with ties counting as
// half a win and half a loss. That means 8-2-3 (.731) correctly ranks above
// 10-4 (.714), even though 10-4 has more total wins.
export const recordWinningPercentage = (
  record: TeamRecordLike | null | undefined,
): number => {
  const wins = Number(record?.wins) || 0;
  const losses = Number(record?.losses) || 0;
  const ties = Number(record?.ties) || 0;
  const total = wins + losses + ties;
  if (total <= 0) return 0;
  return (wins + 0.5 * ties) / total;
};

export const compareRecordsByWinningPercentage = (
  a: TeamRecordLike | null | undefined,
  b: TeamRecordLike | null | undefined,
): number => {
  const pctDiff = recordWinningPercentage(b) - recordWinningPercentage(a);
  if (pctDiff !== 0) return pctDiff;
  const aWins = Number(a?.wins) || 0;
  const bWins = Number(b?.wins) || 0;
  if (bWins !== aWins) return bWins - aWins;
  const aLosses = Number(a?.losses) || 0;
  const bLosses = Number(b?.losses) || 0;
  if (aLosses !== bLosses) return aLosses - bLosses;
  const aTies = Number(a?.ties) || 0;
  const bTies = Number(b?.ties) || 0;
  return bTies - aTies;
};

export interface SeasonSummary {
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  runsFor: number;
  runsAgainst: number;
  runDiff: number;
  // Current streak from the most recent finalized game; ties reset it.
  streakType: "W" | "L" | null;
  streakCount: number;
  // Finalized games, most recent first.
  results: SeasonGameResult[];
}

export const buildSeasonSummary = (
  games: Game[] | null | undefined,
): SeasonSummary => {
  const finalized = (games || [])
    .filter((g) => countsTowardStats(g))
    .map((g): SeasonGameResult => {
      const ts = Number(g.teamScore) || 0;
      const os = Number(g.opponentScore) || 0;
      return {
        id: g.id,
        date: normalizeDateToIso(g.date) || (g.date as string) || "",
        opponent: (g.opponent || "").trim() || "TBD",
        teamScore: ts,
        opponentScore: os,
        result: ts > os ? "W" : ts < os ? "L" : "T",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  let wins = 0,
    losses = 0,
    ties = 0,
    runsFor = 0,
    runsAgainst = 0;
  for (const r of finalized) {
    if (r.result === "W") wins++;
    else if (r.result === "L") losses++;
    else ties++;
    runsFor += r.teamScore;
    runsAgainst += r.opponentScore;
  }

  // Current streak: walk back from the most recent game while the result
  // matches; a tie ends any streak.
  let streakType: "W" | "L" | null = null;
  let streakCount = 0;
  for (let i = finalized.length - 1; i >= 0; i--) {
    const res = finalized[i].result;
    if (res === "T") break;
    if (streakType === null) {
      streakType = res;
      streakCount = 1;
    } else if (res === streakType) {
      streakCount++;
    } else break;
  }

  return {
    wins,
    losses,
    ties,
    gamesPlayed: finalized.length,
    runsFor,
    runsAgainst,
    runDiff: runsFor - runsAgainst,
    streakType,
    streakCount,
    results: finalized.slice().reverse(),
  };
};

// Resolve "is this player coming back" across the legacy playerStatus
// enum + the new returning boolean field. Order of precedence:
//   1. p.returning === false  → No  (explicit opt-out)
//   2. p.returning === true   → Yes (explicit opt-in)
//   3. p.playerStatus === "released" | "declined" → No (legacy)
//   4. anything else → Yes (back-compat default; matches the prior
//      "no playerStatus means returning" behaviour)
// Tryout-flow states ("tryout" / "offered" / "accepted") that aren't
// yet on the active roster still answer Yes here; this helper answers
// the season-advance question, not "is this kid currently rostered".
export const isReturning = (
  player: { returning?: boolean; playerStatus?: string } | null | undefined,
): boolean => {
  if (!player) return false;
  if (player.returning === false) return false;
  if (player.returning === true) return true;
  if (
    player.playerStatus === "released" ||
    player.playerStatus === "declined"
  ) {
    return false;
  }
  return true;
};

// Planning-specific returning intent for Tryouts. Unlike isReturning(),
// missing modern intent is intentionally Unknown so coaches do not plan
// as if every current roster player has confirmed for next season.
export type ReturningDecision = "yes" | "no" | "unknown";

export const getReturningDecision = (
  player: { returning?: boolean; playerStatus?: string } | null | undefined,
): ReturningDecision => {
  if (!player) return "unknown";
  if (player.returning === true) return "yes";
  if (player.returning === false) return "no";
  if (
    player.playerStatus === "released" ||
    player.playerStatus === "declined"
  ) {
    return "no";
  }
  return "unknown";
};
