import type { Game, OpponentSeasonRecord } from "../types";
import { countsTowardStats } from "./gameStatus";

// Head-to-head against a named opponent, matched by opponent NAME because
// that's all a schedule carries — there is no opponent entity. Matching is
// deliberately forgiving (case/whitespace) but never fuzzy: "Cubs" and
// "Chicago Cubs" are different teams until the coach types them the same way.
//
// Two sources combine: the current season's finalized games, and the
// per-opponent aggregates advanceSeason archives before wiping the games
// array (team.opponentArchive). Pure module — no writes here.

export interface OpponentRecord {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  runsFor: number;
  runsAgainst: number;
}

export const normalizeOpponentName = (
  name: string | null | undefined,
): string =>
  String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const emptyRecord = (): OpponentRecord => ({
  games: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  runsFor: 0,
  runsAgainst: 0,
});

const foldGame = (rec: OpponentRecord, game: Game): void => {
  const ts = Number(game.teamScore);
  const os = Number(game.opponentScore);
  rec.games += 1;
  rec.runsFor += ts;
  rec.runsAgainst += os;
  if (ts > os) rec.wins += 1;
  else if (ts < os) rec.losses += 1;
  else rec.ties += 1;
};

// Current-season record vs one opponent: finalized, non-scrimmage games
// whose normalized opponent name matches.
export function seasonOpponentRecord(
  games: Game[] | null | undefined,
  opponentName: string | null | undefined,
): OpponentRecord {
  const key = normalizeOpponentName(opponentName);
  const rec = emptyRecord();
  if (!key) return rec;
  for (const g of games || []) {
    if (!countsTowardStats(g)) continue;
    if (normalizeOpponentName(g.opponent) !== key) continue;
    foldGame(rec, g);
  }
  return rec;
}

// Everything the rollover needs to archive: one aggregate per distinct
// opponent played this season (finalized, non-scrimmage). The display name
// is the first-seen spelling; matching stays on the normalized key.
export function buildOpponentSeasonAggregates(
  games: Game[] | null | undefined,
  season: string,
): OpponentSeasonRecord[] {
  const byKey = new Map<string, OpponentSeasonRecord>();
  for (const g of games || []) {
    if (!countsTowardStats(g)) continue;
    const key = normalizeOpponentName(g.opponent);
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        season,
        opponent: String(g.opponent).trim().replace(/\s+/g, " "),
        wins: 0,
        losses: 0,
        ties: 0,
        runsFor: 0,
        runsAgainst: 0,
      };
      byKey.set(key, entry);
    }
    const ts = Number(g.teamScore);
    const os = Number(g.opponentScore);
    entry.runsFor += ts;
    entry.runsAgainst += os;
    if (ts > os) entry.wins += 1;
    else if (ts < os) entry.losses += 1;
    else entry.ties += 1;
  }
  return [...byKey.values()].sort((a, b) =>
    a.opponent.localeCompare(b.opponent),
  );
}

// Growth bound for team.opponentArchive: ~25 opponents × ~90 bytes a season,
// so 400 entries is well over a decade of history inside the 1 MB team doc.
// Oldest entries fall off first (the array is appended newest-last).
export const OPPONENT_ARCHIVE_MAX = 400;

export function appendOpponentArchive(
  archive: OpponentSeasonRecord[] | null | undefined,
  additions: OpponentSeasonRecord[],
): OpponentSeasonRecord[] {
  const merged = [...(archive || []), ...additions];
  return merged.length > OPPONENT_ARCHIVE_MAX
    ? merged.slice(merged.length - OPPONENT_ARCHIVE_MAX)
    : merged;
}

export interface CombinedOpponentRecord {
  // This season's finalized games vs them.
  current: OpponentRecord;
  // Archived seasons combined (0 games when they've never met before).
  past: OpponentRecord;
  // Which archived seasons contributed, oldest first (for "met in 2024 &
  // 2025" style copy).
  pastSeasons: string[];
}

// The full name-matched track record vs one opponent: current season plus
// every archived season. Consumers usually render current and past
// separately ("2-1 this season, 5-3 all-time").
export function combinedOpponentRecord(
  games: Game[] | null | undefined,
  archive: OpponentSeasonRecord[] | null | undefined,
  opponentName: string | null | undefined,
): CombinedOpponentRecord {
  const key = normalizeOpponentName(opponentName);
  const past = emptyRecord();
  const pastSeasons: string[] = [];
  if (key) {
    for (const entry of archive || []) {
      if (normalizeOpponentName(entry.opponent) !== key) continue;
      past.games += entry.wins + entry.losses + entry.ties;
      past.wins += entry.wins;
      past.losses += entry.losses;
      past.ties += entry.ties;
      past.runsFor += entry.runsFor;
      past.runsAgainst += entry.runsAgainst;
      if (!pastSeasons.includes(entry.season)) pastSeasons.push(entry.season);
    }
  }
  return {
    current: seasonOpponentRecord(games, opponentName),
    past,
    pastSeasons,
  };
}

// Compact "2-1" / "2-1-1" display for an OpponentRecord (ties shown only
// when present, the way coaches actually say records).
export function formatRecord(rec: OpponentRecord): string {
  return rec.ties > 0
    ? `${rec.wins}-${rec.losses}-${rec.ties}`
    : `${rec.wins}-${rec.losses}`;
}
