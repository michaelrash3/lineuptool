// Pure helpers (formatting, parsing) extracted from App.jsx Section 3.

import {
  BudgetItem,
  CsvImportResult,
  Game,
  Inning,
  Player,
  PlayerId,
  PlayerStats,
  SlimPlayer,
  TeamFinances,
} from "../types";

export const formatStat = (val: unknown): string => {
  if (val === undefined || val === null || val === "") return ".000";
  const str = (Number(val) || 0).toFixed(3);
  return str.startsWith("0.") ? str.substring(1) : str;
};

// Normalize a date string to YYYY-MM-DD (the format `<input type="date">`
// requires). Handles common imports: ISO (2026-04-27), US slash (04/27/2026
// or 4/27/26), ISO with time (2026-04-27T...). Returns "" if unparseable.
// All date-only parsing is done from numeric parts instead of `new Date(raw)`
// so imports are deterministic and do not shift a day across time zones.
const padDatePart = (value: string | number): string =>
  String(value).padStart(2, "0");

const isValidDateParts = (
  year: number,
  month: number,
  day: number,
): boolean => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  )
    return false;
  if (
    year < 1900 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
};

const toIsoDate = (year: number, month: number, day: number): string =>
  isValidDateParts(year, month, day)
    ? `${year}-${padDatePart(month)}-${padDatePart(day)}`
    : "";

export const normalizeDateToIso = (dateString: unknown): string => {
  if (!dateString || typeof dateString !== "string") return "";
  const trimmed = dateString.trim();
  if (!trimmed) return "";

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    return toIsoDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = Number(slashMatch[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return toIsoDate(year, Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const dashedUsMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashedUsMatch) {
    let year = Number(dashedUsMatch[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return toIsoDate(year, Number(dashedUsMatch[1]), Number(dashedUsMatch[2]));
  }

  return "";
};

export const formatGameDateDisplay = (
  dateString: string | null | undefined,
): string => {
  if (!dateString) return "";
  const iso = normalizeDateToIso(dateString);
  if (!iso) return dateString;
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

// Slim helpers: strip embedded player objects in saved lineups down to the
// minimum needed for display (id + name + number). Full player data lives on
// team.players and is rehydrated by lookup. Keeps Firestore docs under 1MB.
const slimPlayer = (p: Partial<Player> | null | undefined): SlimPlayer =>
  p && p.id ? { id: p.id, name: p.name || "", number: p.number } : null;

const slimInning = (
  inning: Inning | null | undefined,
): Inning | null | undefined => {
  if (!inning || typeof inning !== "object") return inning;
  const out: Inning = {};
  for (const pos in inning) {
    if (pos === "BENCH") {
      out.BENCH = (inning.BENCH || [])
        .map((p) => slimPlayer(p as Partial<Player>))
        .filter(Boolean) as SlimPlayer[];
    } else {
      out[pos] = slimPlayer(inning[pos] as Partial<Player> | null | undefined);
    }
  }
  return out;
};

export const slimGame = <T extends Partial<Game>>(
  g: T | null | undefined,
): T | null | undefined => {
  if (!g) return g;
  let next: T = g;
  if (Array.isArray(g.lineup)) {
    next = { ...next, lineup: g.lineup.map(slimInning) } as T;
  }
  if (Array.isArray(g.battingLineup)) {
    next = {
      ...next,
      battingLineup: g.battingLineup
        .map((p) => slimPlayer(p as Partial<Player>))
        .filter(Boolean),
    } as T;
  }
  if (Array.isArray(g.originalLineup)) {
    next = {
      ...next,
      originalLineup: g.originalLineup.map(slimInning),
    } as T;
  }
  return next;
};

// ----------------------------------------------------------------------------
// Public team mirror.
//
// The Tryouts Portal is an anonymous-auth surface, but Firestore rules grant
// read access per *document*, not per field — so letting the portal read the
// full team doc would expose evaluations, other families' contact info, member
// UIDs, and the join code. Instead the coach app maintains a sanitized mirror
// doc (artifacts/{appId}/public/data/teamPublic/{teamId}) that the portal reads
// for branding + tryout config. This projection is the allowlist: only fields
// listed here ever reach an anonymous reader. Never add roster, schedule,
// evaluations, signups, members, ownerId, coachRoles, or joinCode.
// ----------------------------------------------------------------------------

export interface TryoutDateLink {
  slug: string;
  date: string;
}

export interface PublicTeamMirror {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  logoUrl: string;
  currentSeason: string;
  teamAge: string;
  tryoutsOpen: boolean;
  tryoutsPhase: string;
  tryoutShareId: string | null;
  tryoutDateSlug: string | null;
  tryoutDates: string[];
  // Explicit slug→date mapping so the public portal can pin a signup to the
  // exact tryout date its link was generated for. `tryoutDateLinks` is the
  // canonical list; `tryoutDateBySlug` is an O(1) lookup of the same data;
  // `tryoutDateSlugs` exists purely so the portal can resolve a link with a
  // single `array-contains` query. These carry only slug + ISO date — no
  // roster, signup, or member data — so they're safe in the public mirror.
  tryoutDateLinks: TryoutDateLink[];
  tryoutDateBySlug: Record<string, string>;
  tryoutDateSlugs: string[];
  // Optional public-facing head-coach contact shown on the portal so families
  // can ask questions. Coach opts in via Settings; empty strings hide the block.
  headCoachName: string;
  headCoachEmail: string;
}

// Normalize a team's per-date tryout links into the canonical slug→date shape.
// New teams persist `tryoutDateLinks` directly (see generateTryoutDateLink).
// Legacy teams only carried a single `tryoutDateSlug` + a `tryoutDates` array,
// with the date embedded inside the slug (`<team>-<YYYY-MM-DD>-<rand>`); we
// recover the intended date by matching a configured date that appears in the
// slug, falling back to the first configured date. Pure.
export const normalizeTryoutDateLinks = (
  team: Record<string, any> | null | undefined,
): TryoutDateLink[] => {
  const seen = new Set<string>();
  const out: TryoutDateLink[] = [];
  const push = (slug: unknown, date: unknown) => {
    const s = String(slug || "").trim();
    const d = String(date || "").trim();
    if (!s || !d || seen.has(s)) return;
    seen.add(s);
    out.push({ slug: s, date: d });
  };

  if (Array.isArray(team?.tryoutDateLinks)) {
    for (const link of team!.tryoutDateLinks) {
      push(link?.slug, link?.date);
    }
  }

  // Legacy single-slug fallback (only if not already represented).
  const legacySlug = String(team?.tryoutDateSlug || "").trim();
  if (legacySlug && !seen.has(legacySlug)) {
    const configured = Array.isArray(team?.tryoutDates)
      ? (team!.tryoutDates as unknown[])
          .map((d) => String(d).trim())
          .filter(Boolean)
      : [];
    const embedded = configured.find((d) => legacySlug.includes(d));
    push(legacySlug, embedded || configured[0] || "");
  }

  return out;
};

// Resolve the tryout date a given portal slug should pin a signup to. Prefers
// the explicit mapping; falls back to deriving from a legacy slug, then to the
// first configured date. Returns "" when nothing resolves. Pure.
export const resolveTryoutDateForSlug = (
  source: Record<string, any> | null | undefined,
  slug: string | null | undefined,
): string => {
  const s = String(slug || "").trim();
  if (!s) return "";
  const map = source?.tryoutDateBySlug;
  if (map && typeof map === "object" && typeof map[s] === "string" && map[s]) {
    return map[s];
  }
  for (const link of normalizeTryoutDateLinks(source)) {
    if (link.slug === s) return link.date;
  }
  const configured = Array.isArray(source?.tryoutDates)
    ? (source!.tryoutDates as unknown[])
        .map((d) => String(d).trim())
        .filter(Boolean)
    : [];
  // Last-ditch legacy: a configured date embedded in the slug, else the first.
  return configured.find((d) => s.includes(d)) || configured[0] || "";
};

export const buildPublicMirror = (
  team: Record<string, any> | null | undefined,
): PublicTeamMirror => {
  const links = normalizeTryoutDateLinks(team);
  const tryoutDateBySlug: Record<string, string> = {};
  for (const link of links) tryoutDateBySlug[link.slug] = link.date;
  return {
    name: team?.name || "",
    primaryColor: team?.primaryColor || "",
    secondaryColor: team?.secondaryColor || "",
    tertiaryColor: team?.tertiaryColor || "",
    logoUrl: team?.logoUrl || "",
    currentSeason: team?.currentSeason || "",
    teamAge: team?.teamAge || "",
    tryoutsOpen: team?.tryoutsOpen === true,
    tryoutsPhase: team?.tryoutsPhase || "",
    // Null (not omitted) so a team that has never shared still produces a stable
    // doc; equality queries on these fields simply won't match a null.
    tryoutShareId: team?.tryoutShareId || null,
    tryoutDateSlug: team?.tryoutDateSlug || null,
    tryoutDates: Array.isArray(team?.tryoutDates)
      ? (team!.tryoutDates as string[]).filter(Boolean)
      : [],
    tryoutDateLinks: links,
    tryoutDateBySlug,
    tryoutDateSlugs: links.map((l) => l.slug),
    headCoachName: (team?.headCoachName as string) || "",
    headCoachEmail: (team?.headCoachPublicEmail as string) || "",
  };
};

// Roll back an optimistic team patch after its persistence failed. For each key
// the patch touched, restore the prior value — but only when the live state
// still holds the exact value we optimistically set (reference identity). A
// concurrent edit that replaced the field after our optimistic write must not
// be clobbered by a late-arriving rollback, so those keys are left alone.
// Returns the same reference when nothing needs reverting. Pure.
export const revertOptimisticUpdate = <T extends Record<string, any>>(
  current: T,
  attempted: Record<string, unknown>,
  prevValues: Record<string, unknown>,
): T => {
  const next: Record<string, any> = { ...current };
  let changed = false;
  for (const key of Object.keys(attempted)) {
    if (Object.is(current[key], attempted[key])) {
      next[key] = prevValues[key];
      changed = true;
    }
  }
  return changed ? (next as T) : current;
};

// Recursively remove undefined values from an object/array tree. Firestore
// rejects documents containing undefined (only null and missing keys are
// valid). Scrub the data right before save.
export const scrubUndefined = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(scrubUndefined).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.constructor && v.constructor !== Object) return value;
    const out: Record<string, unknown> = {};
    for (const k in v) {
      const cleaned = scrubUndefined(v[k]);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
};

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
const POSITION_INNINGS_FIELDS: Array<[keyof PlayerStats, string]> = [
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

// True when a SlimPlayer (or any { id, name } slot from game.lineup or a
// bench list) refers to the given roster player. Primary check is on
// id; fallback handles the orphan-id case where a roster player was
// deleted and re-added with a fresh id — past finalized games' lineups
// still carry the old id baked into the snapshot. We only fall through
// to name match when the slot's id is NOT in the current roster
// (`livePlayerIds`); two siblings who share a first+last name and are
// both still on the roster stay correctly distinguished by their
// live ids.
// True when the game should be treated as finalized for stat,
// record, and trend aggregations. Mirrors the predicate that
// PR #140 introduced for PlayerProfileModal's innings-by-position
// (`modals.jsx`); without unifying it across the rest of the
// app, finalized games that ended up with `status === "completed"`
// (legacy writer) — or with explicit scores but no status flip —
// silently fall out of the team's record, the Home leaderboards,
// and the trend tile, even though they show up correctly on the
// player profile. Strict `status === "final"` checks remain
// appropriate for UI affordances tied to the finalizeGame trim
// flow itself (e.g. Restore Lineup), which only fires from that
// specific writer.
//
// The null/undefined/empty-string guard up front is load-bearing.
// `Number(null)` is `0` and `isFinite(0)` is true, so a brand-new
// scheduled game with `teamScore: null, opponentScore: null` would
// otherwise be treated as a 0-0 tie — that was the bug coaches
// reported where future games showed up as ties on the trend tile
// and record badge.
export const isGameFinalized = (
  game:
    | {
        status?: string;
        teamScore?: number | string | null;
        opponentScore?: number | string | null;
      }
    | null
    | undefined,
): boolean => {
  if (!game) return false;
  if (game.status === "final" || game.status === "completed") return true;
  const ts = game.teamScore;
  const os = game.opponentScore;
  if (ts == null || ts === "" || os == null || os === "") return false;
  return Number.isFinite(Number(ts)) && Number.isFinite(Number(os));
};

// Whether a game contributes to CUMULATIVE totals — the W-L record, run
// totals/form/streak, player stats, defensive-innings distribution, bench
// equity, and the lineup engine's seasonal fairness. A scrimmage is finalizable
// and lives on the schedule (so it's playable and keeps GameChanger's sync
// happy) but is excluded from all of the above. Display/scheduling code keeps
// using isGameFinalized() — a scrimmage is still a real, finalizable game.
export const countsTowardStats = (
  game:
    | {
        status?: string;
        teamScore?: number | string | null;
        opponentScore?: number | string | null;
        isScrimmage?: boolean;
      }
    | null
    | undefined,
): boolean => isGameFinalized(game) && !game?.isScrimmage;

// The canonical set of positions a player can be marked comfortable with / be
// evaluated on — always the 3-outfielder layout, independent of whether the
// team fields 9 or 10. The engine maps CF onto LCF/RCF for 10-fielder games.
export const ROSTER_POSITIONS = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
] as const;

// Collapse the center-field field variants (LCF/RCF) to the canonical CF so
// eligibility treats "plays center" as one thing regardless of 9- vs
// 10-fielder alignment. Corner spots (LF/RF) stay distinct.
export const canonicalizeOutfield = (pos: string): string =>
  pos === "LCF" || pos === "RCF" ? "CF" : pos;

// Normalize a player's accepted-position list to the canonical model: center
// variants collapse to CF, de-duplicated, order preserved.
export const canonicalizePositionList = (
  list: string[] | null | undefined,
): string[] => {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const p of list) {
    const c = canonicalizeOutfield(p);
    if (!out.includes(c)) out.push(c);
  }
  return out;
};

export const lineupSlotMatchesPlayer = (
  slot: { id?: string; name?: string } | null | undefined,
  player: { id?: string; name?: string } | null | undefined,
  livePlayerIds: Set<string>,
): boolean => {
  if (!slot || !player) return false;
  if (slot.id && player.id && slot.id === player.id) return true;
  // Refuse the name-match fallback unless the slot's id is genuinely
  // orphan (no longer on the roster). This prevents accidental
  // collisions when two live players happen to share a name.
  if (slot.id && livePlayerIds.has(slot.id)) return false;
  const norm = (s: unknown) =>
    String(s ?? "")
      .trim()
      .toLowerCase();
  const slotName = norm(slot.name);
  const playerName = norm(player.name);
  if (!slotName || !playerName) return false;
  return slotName === playerName;
};

export const calculateBaseballAge = (
  dob: string | null | undefined,
  currentSeasonStr: string | null | undefined,
): number | null => {
  if (!dob) return null;
  const parts = (currentSeasonStr || "").split(" ");
  let seasonYear = new Date().getFullYear();
  if (parts.length > 1) {
    seasonYear = parseInt(parts[parts.length - 1], 10);
    if (parts[0].toLowerCase() === "fall") seasonYear += 1;
  }
  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) return null;
  let age = seasonYear - dobDate.getUTCFullYear();
  if (dobDate.getUTCMonth() > 3) age -= 1;
  return age;
};

// Parse CSV text into records. This intentionally mirrors the subset of
// PapaParse behavior this app needs while package installation is blocked in
// the current npm environment: quoted commas, escaped quotes, CRLF/LF line
// endings, UTF-8 BOMs, and quoted embedded newlines are all supported.
export const parseCsvRecords = (text: unknown): string[][] => {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = (): void => {
    row.push(cell.trim());
    cell = "";
  };
  const pushRow = (): void => {
    pushCell();
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      pushCell();
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      pushRow();
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) pushRow();
  return rows;
};

export interface CsvHeaderIndex {
  fn: number;
  ln: number;
  ops: number;
  obp: number;
  avg: number;
  contact: number;
  tp: number;
  ip: number;
  era: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  sb: number;
  k: number;
  fpct: number;
  tc: number;
  a: number;
  po: number;
  num: number;
  dob: number;
  phone: number;
  email: number;
  parent: number;
  position: number;
  ld: number;
  fb: number;
  gb: number;
  hard: number;
  qab: number;
  babip: number;
  isTeamSnap: boolean;
}

export const buildCsvHeaderIndex = (headers: string[]): CsvHeaderIndex => {
  const find = (...keys: string[]): number => {
    for (const k of keys) {
      const i = headers.indexOf(k);
      if (i !== -1) return i;
    }
    return -1;
  };
  const findContains = (substring: string): number =>
    headers.findIndex((h) => h.includes(substring));

  return {
    fn: find("first") !== -1 ? find("first") : findContains("first"),
    ln: find("last") !== -1 ? find("last") : findContains("last"),
    ops: find("ops"),
    obp: find("obp"),
    avg: find("avg"),
    contact: find("c%", "contact %", "contact%", "contact"),
    tp: find("#p", "pitches"),
    ip: find("ip"),
    era: find("era"),
    ab: find("ab"),
    h: find("h"),
    doubles: find("2b"),
    triples: find("3b"),
    hr: find("hr"),
    rbi: find("rbi"),
    sb: find("sb", "stolen bases", "stolen"),
    k: find("so", "k", "strikeouts"),
    fpct: find("fpct", "fpct%"),
    tc: find("tc", "total", "total chances"),
    a: find("a", "assists"),
    po: find("po", "putouts"),
    num: find("number", "#", "jersey", "no.", "jersey number"),
    dob: find("birthdate", "dob", "date of birth"),
    phone: find("phone number", "phone", "contact 1 phone", "parent phone"),
    email: find("email", "contact 1 email", "parent email"),
    parent: find("contact 1 name", "parent name"),
    position: find("position"),
    ld: find("ld", "ld%", "line drive", "line drives"),
    fb: find("fb", "fb%", "fly ball", "fly balls"),
    gb: find("gb", "gb%", "ground ball", "ground balls"),
    hard: find("hard", "hard%", "hard hit", "hard hit%"),
    qab: find("qab", "qab%", "quality at bat"),
    babip: find("babip"),
    isTeamSnap:
      headers.includes("contact 1 name") || headers.includes("jersey number"),
  };
};

// GameChanger reuses column names across the Batting / Pitching / Fielding
// sections (H, BB, SO, SB, CS, HR, GP, R, …). buildCsvHeaderIndex reads the
// Batting section correctly (first occurrence), but pulling pitching/fielding
// stats requires bounding the search to each section. The two-row export's
// label row ("batting"/"pitching"/"fielding") delimits the sections; we map the
// chosen columns within each range into section-namespaced PlayerStats fields.
const PITCHING_COLS: Record<string, keyof PlayerStats> = {
  ip: "pIp",
  bf: "pBf",
  "s%": "pStrikePct",
  "fps%": "pFps",
  "bb/inn": "pBbPerInn",
  "k/bb": "pKbb",
  whip: "pWhip",
  era: "pEra",
  baa: "pBaa",
  "k/bf": "pKbf",
  "sm%": "pSwingMiss",
  "weak%": "pWeak",
  "hhb%": "pHardPct",
  "go/ao": "pGoAo",
  topmph: "pTopMph",
  mphfb: "pFbMph",
};
const FIELDING_COLS: Record<string, keyof PlayerStats> = {
  fpct: "fFpct",
  e: "fErrors",
  tc: "fTc",
  a: "fAssists",
  po: "fPutouts",
  "cs%": "fCsPct",
  pb: "fPb",
  sb: "fSbAllowed",
  sbatt: "fSbAtt",
  // Per-position innings block at the end of the fielding section. Read ONLY
  // within the fielding range (extractAdvancedStats bounds by the label row),
  // so the duplicated "1b"/"2b"/"3b"/"sf"/"p" headers never collide with
  // Batting (doubles/triples/sac-fly) or other sections. "c" = innings caught;
  // "total" = total defensive innings; "sf" = short field (10-player rover).
  c: "fInnC",
  p: "fInnP",
  "1b": "fInn1B",
  "2b": "fInn2B",
  "3b": "fInn3B",
  ss: "fInnSS",
  lf: "fInnLF",
  cf: "fInnCF",
  rf: "fInnRF",
  sf: "fInnSF",
  total: "fInnTotal",
};
// Stored as 0–1 fractions (parsePercent). FPCT is already a 0–1 decimal in the
// CSV (e.g. ".952"), so it parses as a plain number.
const ADV_PCT_KEYS = new Set<string>([
  "pStrikePct",
  "pFps",
  "pSwingMiss",
  "pWeak",
  "pHardPct",
  "fCsPct",
]);

// Extract section-namespaced pitching + fielding stats from one data row, using
// the label row to bound each section so duplicate column names don't collide
// with Batting. Returns {} when the export has no section labels (batting-only).
export const extractAdvancedStats = (
  labelRow: string[] | undefined,
  headerRow: string[],
  cols: string[],
): PlayerStats => {
  if (!labelRow) return {};
  const pitchStart = labelRow.indexOf("pitching");
  const fieldStart = labelRow.indexOf("fielding");
  if (pitchStart === -1 && fieldStart === -1) return {};
  const end = headerRow.length;
  const ranges: Array<[Record<string, keyof PlayerStats>, number, number]> = [];
  if (pitchStart !== -1)
    ranges.push([
      PITCHING_COLS,
      pitchStart,
      fieldStart !== -1 && fieldStart > pitchStart ? fieldStart : end,
    ]);
  if (fieldStart !== -1) ranges.push([FIELDING_COLS, fieldStart, end]);

  const out: PlayerStats = {};
  for (const [map, lo, hi] of ranges) {
    for (let c = lo; c < hi && c < headerRow.length; c++) {
      const key = map[headerRow[c]];
      if (!key) continue;
      const raw = cols[c];
      if (raw === undefined || raw === "" || raw === "-") continue;
      if (ADV_PCT_KEYS.has(key as string)) {
        out[key] = parsePercent(raw);
      } else {
        const n = parseFloat(raw);
        if (Number.isFinite(n)) out[key] = n;
      }
    }
  }
  return out;
};

// ============================================================================
// Per-game stat imports (GameChanger CSV filtered to ONE game, attached to the
// finalized game). When per-game lines exist for a player, their season totals
// are DERIVED from those lines; pitching is kid-pitch-only at import time.
// ============================================================================

// Build the stats patch for ONE GameChanger CSV data row — the single source
// of truth for which columns map to which PlayerStats keys. Shared by the
// season importer (merges into player.stats) and the per-game importer
// (stores the line on the game). Only fields actually present in the CSV land
// in the patch, so a missing column never zeroes an existing stat.
export const buildStatsPatchFromCsvRow = (
  idx: CsvHeaderIndex,
  labelRow: string[] | undefined,
  rawHeaders: string[],
  cols: string[],
): Record<string, number> => {
  const patch: Record<string, number> = {};
  const setNum = (key: string, colIdx: number) => {
    if (colIdx === -1) return;
    const raw = cols[colIdx];
    if (raw === undefined || raw === "" || raw === "-") return;
    const n = parseFloat(raw);
    if (!Number.isNaN(n)) patch[key] = n;
  };
  const setInt = (key: string, colIdx: number) => {
    if (colIdx === -1) return;
    const raw = cols[colIdx];
    if (raw === undefined || raw === "" || raw === "-") return;
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) patch[key] = n;
  };
  const setPct = (key: string, colIdx: number) => {
    if (colIdx === -1) return;
    const raw = cols[colIdx];
    if (raw === undefined || raw === "" || raw === "-") return;
    patch[key] = parsePercent(raw);
  };

  setNum("ops", idx.ops);
  setNum("obp", idx.obp);
  setNum("avg", idx.avg);
  setPct("contact", idx.contact);
  setInt("totalPitches", idx.tp);
  setNum("ip", idx.ip);
  setNum("era", idx.era);
  setInt("ab", idx.ab);
  setInt("h", idx.h);
  setInt("doubles", idx.doubles);
  setInt("triples", idx.triples);
  setInt("hr", idx.hr);
  setInt("rbi", idx.rbi);
  setInt("sb", idx.sb);
  setInt("k", idx.k);
  setNum("fpct", idx.fpct);
  setInt("tc", idx.tc);
  setInt("a", idx.a);
  setInt("po", idx.po);
  setPct("ld", idx.ld);
  setPct("fb", idx.fb);
  setPct("gb", idx.gb);
  setPct("hard", idx.hard);
  setPct("qab", idx.qab);
  setNum("babip", idx.babip);
  Object.assign(patch, extractAdvancedStats(labelRow, rawHeaders, cols));
  return patch;
};

// Parse a whole GameChanger stats CSV (season export OR the same export
// filtered to a single game) into per-player stat patches keyed by the
// player's display name. Handles the two-row section-label header layout and
// skips Totals/Glossary footer rows. Returns an error string for files that
// aren't a GameChanger stats export.
export const parseGameChangerStatsCsv = (
  text: string,
):
  | { rows: Array<{ name: string; patch: Record<string, number> }> }
  | { error: string } => {
  // parseCsvRecords strips the UTF-8 BOM GameChanger exports include.
  const rows = parseCsvRecords(text || "");
  if (rows.length < 2) return { error: "Empty file." };

  let headerRowIndex = 0;
  const firstRow = rows[0].map((h) => h.toLowerCase().trim());
  const filledFirstRow = firstRow.filter(Boolean).length;
  const hasSectionLabels = firstRow.some((h) =>
    ["batting", "pitching", "fielding"].includes(h),
  );
  if (hasSectionLabels && filledFirstRow < firstRow.length / 3) {
    headerRowIndex = 1;
  }
  const rawHeaders = rows[headerRowIndex].map((h) => h.toLowerCase().trim());
  const labelRow = headerRowIndex === 1 ? firstRow : undefined;
  const idx = buildCsvHeaderIndex(rawHeaders);
  if (idx.fn === -1 && idx.ln === -1)
    return { error: "Could not find name columns." };
  const isGameChanger = idx.ops !== -1 || idx.avg !== -1 || idx.ab !== -1;
  if (!isGameChanger)
    return { error: "Not a GameChanger stats export (no OPS/AVG/AB columns)." };

  const out: Array<{ name: string; patch: Record<string, number> }> = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const cols = rows[i];
    const fn = (idx.fn !== -1 ? cols[idx.fn] : "").trim();
    const ln = (idx.ln !== -1 ? cols[idx.ln] : "").trim();
    const name = `${fn} ${ln}`.trim();
    if (!name || !ln) continue; // GC always has Last; skips blank/footer rows
    const lcFn = fn.toLowerCase();
    const lcLn = ln.toLowerCase();
    if (
      lcFn === "totals" ||
      lcLn === "totals" ||
      lcFn === "glossary" ||
      lcLn === "glossary"
    )
      continue;
    const patch = buildStatsPatchFromCsvRow(idx, labelRow, rawHeaders, cols);
    if (Object.keys(patch).length === 0) continue;
    out.push({ name, patch });
  }
  return { rows: out };
};

// Drop every pitching stat from a per-game line when the game was Machine or
// Coach pitch — GameChanger still populates those columns (scorers track
// pitches faced) but no kid actually pitched. This is what keeps a mixed
// machine/coach + kid-pitch schedule from polluting the summed season
// pitching numbers: only Kid Pitch game lines ever carry pitching keys.
export const stripPitchingStatsForFormat = (
  patch: Record<string, number>,
  pitchingFormat: string | undefined,
): Record<string, number> => {
  if (!/machine|coach/i.test(pitchingFormat || "")) return patch;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (/^p[A-Z]/.test(k)) continue; // pIp, pEra, pStrikePct, …
    if (k === "ip" || k === "era" || k === "totalPitches") continue;
    out[k] = v;
  }
  return out;
};

// Stat keys that SUM across game lines (true counting stats).
const SUMMABLE_KEYS = [
  "ab",
  "h",
  "doubles",
  "triples",
  "hr",
  "rbi",
  "sb",
  "k",
  "tc",
  "a",
  "po",
  "totalPitches",
  "ip",
  "pIp",
  "pBf",
  "fErrors",
  "fTc",
  "fAssists",
  "fPutouts",
  "fPb",
  "fSbAllowed",
  "fSbAtt",
  // Defensive innings (per position + total) sum across game lines.
  "fInnC",
  "fInnP",
  "fInn1B",
  "fInn2B",
  "fInn3B",
  "fInnSS",
  "fInnLF",
  "fInnCF",
  "fInnRF",
  "fInnSF",
  "fInnTotal",
];
// Rate keys that can't be summed: weighted-average them across lines using the
// given weight key (sample size). An approximation for OBP/OPS (PA vs AB), but
// honest and stable for youth-ball data; AVG is recomputed exactly from H/AB.
const WEIGHTED_KEYS: Array<{ key: string; weightBy: string }> = [
  { key: "obp", weightBy: "ab" },
  { key: "ops", weightBy: "ab" },
  { key: "contact", weightBy: "ab" },
  { key: "qab", weightBy: "ab" },
  { key: "hard", weightBy: "ab" },
  { key: "ld", weightBy: "ab" },
  { key: "fb", weightBy: "ab" },
  { key: "gb", weightBy: "ab" },
  { key: "babip", weightBy: "ab" },
  { key: "era", weightBy: "ip" },
  { key: "pEra", weightBy: "pIp" },
  { key: "pWhip", weightBy: "pIp" },
  { key: "pStrikePct", weightBy: "pBf" },
  { key: "pFps", weightBy: "pBf" },
  { key: "pBbPerInn", weightBy: "pIp" },
  { key: "pKbb", weightBy: "pBf" },
  { key: "pBaa", weightBy: "pBf" },
  { key: "pKbf", weightBy: "pBf" },
  { key: "pSwingMiss", weightBy: "pBf" },
  { key: "pWeak", weightBy: "pBf" },
  { key: "pHardPct", weightBy: "pBf" },
  { key: "pGoAo", weightBy: "pBf" },
  { key: "fpct", weightBy: "tc" },
  { key: "fFpct", weightBy: "fTc" },
  { key: "fCsPct", weightBy: "fSbAtt" },
];

// Aggregate several per-game stat lines into one line. Counting stats sum;
// AVG recomputes exactly from H/AB; other rates are sample-weighted averages;
// pTopMph/pFbMph take the max. Used for both the derived SEASON totals (all
// lines) and the Recent Form view (last N lines). Pure.
export const aggregateGameLines = (
  lines: Array<Record<string, number | undefined>>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const k of SUMMABLE_KEYS) {
    let s = 0;
    let any = false;
    for (const line of lines) {
      const v = Number(line[k]);
      if (Number.isFinite(v)) {
        s += v;
        any = true;
      }
    }
    if (any) out[k] = s;
  }
  if (Number.isFinite(out.ab) && out.ab > 0 && Number.isFinite(out.h)) {
    out.avg = out.h / out.ab;
  }
  for (const { key, weightBy } of WEIGHTED_KEYS) {
    if (key === "avg") continue;
    let acc = 0;
    let w = 0;
    for (const line of lines) {
      const v = Number(line[key]);
      if (!Number.isFinite(v)) continue;
      const rawW = Number(line[weightBy]);
      const weight = Number.isFinite(rawW) && rawW > 0 ? rawW : 1;
      acc += v * weight;
      w += weight;
    }
    if (w > 0) out[key] = acc / w;
  }
  for (const k of ["pTopMph", "pFbMph"]) {
    let max = -Infinity;
    for (const line of lines) {
      const v = Number(line[k]);
      if (Number.isFinite(v) && v > max) max = v;
    }
    if (max > -Infinity) out[k] = max;
  }
  return out;
};

// Team-wide average for every stat: aggregate each rostered player's
// current-season stat line through aggregateGameLines (counting stats sum;
// AVG/rates are sample-weighted), so e.g. team AVG is total H / total AB
// rather than a mean of per-player averages. Used as the "Team avg" baseline
// drawn on a player's stat-trend charts. Pure; empty roster → {}.
export const teamStatAverages = (
  players:
    | Array<{ stats?: Record<string, number | undefined> | null }>
    | null
    | undefined,
): Record<string, number> => {
  const lines = (players || [])
    .map((p) => p?.stats)
    .filter((s): s is Record<string, number> => !!s && typeof s === "object");
  if (lines.length === 0) return {};
  return aggregateGameLines(lines);
};

// line. Pitching keys only exist on Kid Pitch lines (stripped at import), so
// the summed season pitching is kid-pitch-only by construction — exactly the
// rule for mixed machine/coach + kid-pitch schedules. Returns null when the
// player has no per-game lines (callers then leave season-CSV stats untouched).
export const deriveSeasonFromGameLines = (
  games: Array<{ playerStats?: Record<string, any> }> | null | undefined,
  playerId: string,
): Record<string, number> | null => {
  const lines: Array<Record<string, number>> = [];
  for (const g of games || []) {
    const line = g?.playerStats?.[playerId];
    if (line && typeof line === "object") lines.push(line);
  }
  if (lines.length === 0) return null;
  return aggregateGameLines(lines);
};

// Scheduled absences: dates a family already knows the kid is out (vacation,
// school event), entered ahead of time on the player profile. A game on one
// of these dates defaults the kid to absent in Game Day Attendance — the
// coach can still toggle them back if plans change.
export const isPlayerScheduledOut = (
  player: { absences?: string[] } | null | undefined,
  dateIso: string | null | undefined,
): boolean => {
  if (!dateIso) return false;
  return (player?.absences || []).includes(String(dateIso).slice(0, 10));
};

// Walk an inclusive yyyy-mm-dd range via UTC parts (no local-TZ drift) and
// merge each day into the existing absence list, deduped + sorted. Reversed
// inputs are swapped; absurd ranges are capped at 60 days so a typo'd year
// can't generate thousands of entries.
const isoToUtcMs = (iso: string): number | null => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ABSENCE_RANGE_CAP_DAYS = 60;

export const addAbsenceDateRange = (
  absences: string[] | null | undefined,
  fromIso: string,
  toIso?: string | null,
): string[] => {
  const startMs = isoToUtcMs(fromIso);
  // Blank "to" = a single-day absence.
  const endMs = toIso ? isoToUtcMs(toIso) : startMs;
  if (startMs == null || endMs == null) return [...(absences || [])];
  const lo = Math.min(startMs, endMs);
  const hi = Math.min(
    Math.max(startMs, endMs),
    lo + (ABSENCE_RANGE_CAP_DAYS - 1) * DAY_MS,
  );
  const out = new Set(absences || []);
  for (let ms = lo; ms <= hi; ms += DAY_MS) {
    out.add(new Date(ms).toISOString().slice(0, 10));
  }
  return [...out].sort();
};

export const removeAbsenceDates = (
  absences: string[] | null | undefined,
  dates: string[],
): string[] => {
  const drop = new Set(dates);
  return (absences || []).filter((d) => !drop.has(d));
};

// Fold a flat absence list into contiguous ranges for display: consecutive
// days collapse into one { from, to } chip; `dates` carries the exact days a
// chip's remove button should delete.
export const foldAbsenceRanges = (
  absences: string[] | null | undefined,
): Array<{ from: string; to: string; dates: string[] }> => {
  const sorted = [...new Set(absences || [])]
    .filter((d) => isoToUtcMs(d) != null)
    .sort();
  const out: Array<{ from: string; to: string; dates: string[] }> = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && isoToUtcMs(d) === (isoToUtcMs(last.to) as number) + DAY_MS) {
      last.to = d;
      last.dates.push(d);
    } else {
      out.push({ from: d, to: d, dates: [d] });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Availability calendar helpers. The coach's Availability tab blocks out dates
// where the team can't field a full defense; the parent form and that calendar
// share the month-grid date math here. All dates are ISO yyyy-mm-dd, built from
// UTC parts so a viewer's local timezone never shifts a day.
// ---------------------------------------------------------------------------

// A player counts toward availability unless they've left the team. Departed
// players are excluded; everyone else still counts. `rosterStatus` is typed as
// unknown so the loose `Player` shape (open index signature) passes without a
// cast at every call site.
export const isDepartedPlayer = (
  player: { rosterStatus?: unknown; [key: string]: unknown } | null | undefined,
): boolean => player?.rosterStatus === "departed";

// How many non-departed players are available on a date (i.e. NOT scheduled
// out via their absences list).
export const countAvailableOnDate = (
  players:
    | Array<{ rosterStatus?: string; absences?: string[] }>
    | null
    | undefined,
  dateIso: string | null | undefined,
): number => {
  if (!dateIso) return 0;
  const day = String(dateIso).slice(0, 10);
  return (players || []).filter(
    (p) => !isDepartedPlayer(p) && !isPlayerScheduledOut(p, day),
  ).length;
};

// True when fewer than `minPlayers` players are available on the date — the
// signal to block the day out on the calendar. `minPlayers` is the team's
// defenseSize (9 or 10).
export const isShortHandedOnDate = (
  players:
    | Array<{ rosterStatus?: string; absences?: string[] }>
    | null
    | undefined,
  dateIso: string | null | undefined,
  minPlayers: number,
): boolean => countAvailableOnDate(players, dateIso) < minPlayers;

// The non-departed players scheduled out on a date — drives the "who's out"
// panel when the coach taps a day.
export const playersOutOnDate = <
  T extends { rosterStatus?: string; absences?: string[] },
>(
  players: T[] | null | undefined,
  dateIso: string | null | undefined,
): T[] => {
  if (!dateIso) return [];
  const day = String(dateIso).slice(0, 10);
  return (players || []).filter(
    (p) => !isDepartedPlayer(p) && isPlayerScheduledOut(p, day),
  );
};

// Build a 6-row × 7-col month matrix (Sun-first) for `year`/`month` (month is
// 0-based). Each cell is an ISO yyyy-mm-dd string for in-month days, or null
// for the leading/trailing blanks. Pure; UTC-based so no timezone drift.
export const buildMonthGrid = (
  year: number,
  month: number,
): Array<string | null> => {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

// stats derived from all of their game lines vs the same derivation with the
// newest game excluded. Lets Recent Movement work for coaches who import
// stats per game (no statsHistory snapshots from a season-CSV upload).
// Null when the player has fewer than two game lines — no before/after.
export const latestGameLineMovement = (
  games:
    | Array<{
        date?: string;
        opponent?: string;
        playerStats?: Record<string, any>;
      }>
    | null
    | undefined,
  playerId: string,
): {
  prior: Record<string, number>;
  current: Record<string, number>;
  date?: string;
  opponent?: string;
} | null => {
  const withLines = (games || [])
    .filter((g) => g?.playerStats?.[playerId])
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  if (withLines.length < 2) return null;
  const latest = withLines[withLines.length - 1];
  const prior = deriveSeasonFromGameLines(withLines.slice(0, -1), playerId);
  const current = deriveSeasonFromGameLines(withLines, playerId);
  if (!prior || !current) return null;
  return { prior, current, date: latest.date, opponent: latest.opponent };
};

// A player's season line as it stood after each imported game, chronological:
// entry i aggregates their first i+1 game lines. The per-game-import
// equivalent of the statsHistory snapshot trail — powers the profile's
// Recent Movement sparklines for coaches who never upload a season CSV.
export const seasonSeriesFromGameLines = (
  games:
    | Array<{ date?: string; playerStats?: Record<string, any> }>
    | null
    | undefined,
  playerId: string,
): Array<Record<string, number>> => {
  const lines = (games || [])
    .filter((g) => g?.playerStats?.[playerId])
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((g: any) => g.playerStats[playerId]);
  return lines.map((_, i) => aggregateGameLines(lines.slice(0, i + 1)));
};

// The last `n` per-game stat lines for a player, newest game first. Powers the
// Stats tab's Recent Form (hot/cold) view.
export const recentGameLines = (
  games:
    | Array<{
        date?: string;
        opponent?: string;
        playerStats?: Record<string, any>;
      }>
    | null
    | undefined,
  playerId: string,
  n = 3,
): Array<{
  date?: string;
  opponent?: string;
  line: Record<string, number>;
}> => {
  return (games || [])
    .filter((g) => g?.playerStats?.[playerId])
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, n)
    .map((g: any) => ({
      date: g.date,
      opponent: g.opponent,
      line: g.playerStats[playerId],
    }));
};

// A compact objective-stat hint for an eval category, so a coach grades with
// real numbers in view (e.g. "AVG .312" under Contact). Returns null when the
// stat isn't present. `pitching` supplies the manual/imported top velocity for
// the velocity category. Pure — safe to call per category per render.
export const evalStatHint = (
  catId: string,
  stats: PlayerStats | null | undefined,
  pitching?: { topMph?: number } | null,
): string | null => {
  const s: any = stats || {};
  const pct = (v: any) =>
    typeof v === "number" && Number.isFinite(v)
      ? `${Math.round(v * 100)}%`
      : null;
  const avg3 = (v: any) =>
    typeof v === "number" && Number.isFinite(v)
      ? v.toFixed(3).replace(/^0(?=\.)/, "")
      : null;
  switch (catId) {
    case "contact":
      return s.avg != null ? `AVG ${avg3(s.avg)}` : null;
    case "power":
      return s.hard != null
        ? `Hard ${pct(s.hard)}`
        : s.hr != null
          ? `${s.hr} HR`
          : null;
    case "approach":
    case "plateDiscipline":
      return s.qab != null ? `QAB ${pct(s.qab)}` : null;
    case "fielding":
    case "glove":
    case "range":
      return s.fFpct != null ? `FPCT ${avg3(s.fFpct)}` : null;
    case "arm":
    case "armStrength":
    case "armAccuracy":
      return s.fAssists != null ? `${s.fAssists} A` : null;
    case "speedBaserunning":
    case "speed":
    case "baserunning":
      return s.sb != null ? `${s.sb} SB` : null;
    case "strikes":
      return s.pStrikePct != null
        ? `S% ${pct(s.pStrikePct)}`
        : s.pBbPerInn != null
          ? `${s.pBbPerInn} BB/inn`
          : null;
    case "velocity":
      return pitching?.topMph
        ? `Top ${pitching.topMph} mph`
        : s.pTopMph != null
          ? `Top ${s.pTopMph} mph`
          : null;
    case "throwing":
      return s.fCsPct != null ? `CS% ${pct(s.fCsPct)}` : null;
    case "blocking":
      return s.fPb != null ? `${s.fPb} PB` : null;
    default:
      return null;
  }
};

export interface TournamentGroup {
  id: string;
  label: string;
  gameIds: string[];
}

// Auto-detect tournaments from the schedule: cluster Tournament (USSSA) games
// whose dates fall within a weekend window (<= 2 days apart) into one event, so
// pool + bracket games on the same weekend are tied together. A group needs 2+
// games — a lone Tournament game isn't a "tournament." Pure + derived (no stored
// state); scrimmages and Rec games are excluded.
export const deriveTournaments = (
  games:
    | Array<{
        id: string;
        date?: string;
        leagueRuleSet?: string;
        location?: string;
        isScrimmage?: boolean;
      }>
    | null
    | undefined,
  teamLeagueRuleSet?: string,
): TournamentGroup[] => {
  const isoToDays = (d: string): number =>
    Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  const tour = (games || [])
    .filter(
      (g) =>
        g &&
        g.date &&
        !g.isScrimmage &&
        (g.leagueRuleSet || teamLeagueRuleSet) === "USSSA",
    )
    .slice()
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));

  const clusters: (typeof tour)[] = [];
  let cur: typeof tour = [];
  for (const g of tour) {
    if (cur.length === 0) {
      cur = [g];
      continue;
    }
    const gap =
      isoToDays(g.date as string) -
      isoToDays(cur[cur.length - 1].date as string);
    if (gap <= 2) cur.push(g);
    else {
      if (cur.length >= 2) clusters.push(cur);
      cur = [g];
    }
  }
  if (cur.length >= 2) clusters.push(cur);

  const fmt = (d: string): string => {
    const [y, m, day] = d.split("-");
    return new Date(Number(y), Number(m) - 1, Number(day)).toLocaleDateString(
      undefined,
      { month: "short", day: "numeric" },
    );
  };
  return clusters.map((gs) => {
    const start = gs[0].date as string;
    const end = gs[gs.length - 1].date as string;
    const range = start === end ? fmt(start) : `${fmt(start)}–${fmt(end)}`;
    return { id: `tour-${start}`, label: range, gameIds: gs.map((g) => g.id) };
  });
};

const parsePercent = (val: unknown): number => {
  if (!val) return 0;
  const raw = parseFloat(String(val).replace("%", ""));
  if (Number.isNaN(raw)) return 0;
  return raw > 1 ? raw / 100 : raw;
};

// Parse a GameChanger past-season CSV. Returns { rows, error }.
export const parseGameChangerPastSeasonCsv = (
  text: string,
): CsvImportResult => {
  const csvRows = parseCsvRecords(text);
  if (csvRows.length < 2)
    return { error: "File appears to be empty.", rows: [] };

  let headerRowIndex = 0;
  const firstRow = csvRows[0].map((h) => h.toLowerCase().trim());
  const filledFirstRow = firstRow.filter(Boolean).length;
  const hasSectionLabels = firstRow.some((h) =>
    ["batting", "pitching", "fielding"].includes(h),
  );
  if (hasSectionLabels && filledFirstRow < firstRow.length / 3)
    headerRowIndex = 1;

  const rawHeaders = csvRows[headerRowIndex].map((h) => h.toLowerCase().trim());
  // Section label row (when present) delimits Batting/Pitching/Fielding so the
  // advanced-stat extractor can read pitching/fielding columns without colliding
  // with the same-named Batting columns.
  const labelRow = headerRowIndex === 1 ? firstRow : undefined;
  const idx = buildCsvHeaderIndex(rawHeaders);

  if (idx.isTeamSnap) {
    return {
      error:
        "Past-season import accepts GameChanger CSVs only. This looks like a TeamSnap members export.",
      rows: [],
    };
  }
  if (idx.fn === -1 && idx.ln === -1) {
    return { error: "Could not find name columns in this CSV.", rows: [] };
  }
  if (idx.ops === -1 && idx.avg === -1 && idx.ab === -1) {
    return {
      error: "This doesn't look like a GameChanger stats export.",
      rows: [],
    };
  }

  const importRows: CsvImportResult["rows"] = [];
  const dataStart = headerRowIndex + 1;
  for (let i = dataStart; i < csvRows.length; i++) {
    const cols = csvRows[i];
    const fn = (idx.fn !== -1 ? cols[idx.fn] : "").trim();
    const ln = (idx.ln !== -1 ? cols[idx.ln] : "").trim();
    const name = `${fn} ${ln}`.trim();
    if (!name) continue;
    const lcFn = fn.toLowerCase();
    const lcLn = ln.toLowerCase();
    if (
      lcFn === "totals" ||
      lcLn === "totals" ||
      lcFn === "glossary" ||
      lcLn === "glossary" ||
      !ln
    )
      continue;

    const stats: PlayerStats = {};
    const setNum = (key: keyof PlayerStats, colIdx: number): void => {
      if (colIdx === -1) return;
      const raw = cols[colIdx];
      if (raw === undefined || raw === "" || raw === "-") return;
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) stats[key] = n;
    };
    const setInt = (key: keyof PlayerStats, colIdx: number): void => {
      if (colIdx === -1) return;
      const raw = cols[colIdx];
      if (raw === undefined || raw === "" || raw === "-") return;
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) stats[key] = n;
    };
    const setPct = (key: keyof PlayerStats, colIdx: number): void => {
      if (colIdx === -1) return;
      const raw = cols[colIdx];
      if (raw === undefined || raw === "" || raw === "-") return;
      stats[key] = parsePercent(raw);
    };

    setNum("ops", idx.ops);
    setNum("obp", idx.obp);
    setNum("avg", idx.avg);
    setPct("contact", idx.contact);
    setInt("totalPitches", idx.tp);
    setNum("ip", idx.ip);
    setNum("era", idx.era);
    setInt("ab", idx.ab);
    setInt("h", idx.h);
    setInt("doubles", idx.doubles);
    setInt("triples", idx.triples);
    setInt("hr", idx.hr);
    setInt("rbi", idx.rbi);
    setInt("sb", idx.sb);
    setInt("k", idx.k);
    setNum("fpct", idx.fpct);
    setInt("tc", idx.tc);
    setInt("a", idx.a);
    setInt("po", idx.po);
    setPct("ld", idx.ld);
    setPct("fb", idx.fb);
    setPct("gb", idx.gb);
    setPct("hard", idx.hard);
    setPct("qab", idx.qab);
    setNum("babip", idx.babip);
    Object.assign(stats, extractAdvancedStats(labelRow, rawHeaders, cols));

    if (Object.keys(stats).length === 0) continue;
    importRows.push({
      csvName: name,
      number: idx.num !== -1 ? cols[idx.num] || "" : "",
      stats,
    });
  }
  return { rows: importRows };
};

// Suggest a likely match between a CSV row name and existing players.
export const suggestPlayerMatch = (
  csvName: string,
  players: Player[],
): PlayerId | null => {
  const norm = (s: string | null | undefined): string =>
    (s || "").toLowerCase().replace(/[^a-z]/g, "");
  const csvNorm = norm(csvName);
  for (const p of players) {
    if (norm(p.name) === csvNorm) return p.id;
  }
  const csvParts = csvName.trim().split(/\s+/);
  if (csvParts.length >= 2) {
    const firstNorm = norm(csvParts[0]);
    const lastInitial = csvParts[csvParts.length - 1].charAt(0).toLowerCase();
    for (const p of players) {
      const parts = p.name.trim().split(/\s+/);
      if (parts.length < 2) continue;
      if (
        norm(parts[0]) === firstNorm &&
        parts[parts.length - 1].charAt(0).toLowerCase() === lastInitial
      ) {
        return p.id;
      }
    }
  }
  return null;
};

export const blankStats = (): PlayerStats => ({
  ops: 0,
  obp: 0,
  avg: 0,
  contact: 0,
  totalPitches: 0,
  ip: 0,
  era: 0,
  ab: 0,
  h: 0,
  doubles: 0,
  triples: 0,
  hr: 0,
  rbi: 0,
  sb: 0,
  k: 0,
  fpct: 0,
  tc: 0,
  a: 0,
  po: 0,
  ld: 0,
  fb: 0,
  gb: 0,
  hard: 0,
  qab: 0,
  babip: 0,
});

// ============================================================================
// Eval prompt cadence — preseason + biweekly for both head and assistant.
// Coaches submit a fresh evaluation round once when the season starts, then
// every 14 days. The submission UI is gated to active prompts; outside an
// active window the assistant's Submit Eval button is disabled and the head's
// "Start New Round" affordance is hidden.
// ============================================================================

const MS_PER_DAY = 86_400_000;
// Active window around each due date — three days before through three
// days after. Long enough that coaches catching up over a weekend still
// see the prompt; tight enough that the badge doesn't get stale.
const EVAL_WINDOW_DAYS = 3;

// Build the full ordered list of eval due-dates for a given calendar
// year. Spring: Feb 1 (preseason), Mar 15, then every other Sunday
// through Jun 30. Fall: every Sunday from Sep 1 through Oct 31.
// Pure; no dependency on current time. Exported for unit testing.
export const evalDueDatesForYear = (year: number): Date[] => {
  const dates: Date[] = [];
  // Spring preseason + March 15
  dates.push(new Date(year, 1, 1)); // Feb 1
  dates.push(new Date(year, 2, 15)); // Mar 15
  // Every other Sunday from the first Sunday after Mar 15 through Jun 30.
  const springEnd = new Date(year, 5, 30);
  const firstSundayAfter = (start: Date) => {
    const d = new Date(start);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    return d;
  };
  let sunday = firstSundayAfter(new Date(year, 2, 15));
  while (sunday.getTime() <= springEnd.getTime()) {
    dates.push(new Date(sunday));
    sunday = new Date(sunday);
    sunday.setDate(sunday.getDate() + 14);
  }
  // Fall: every Sunday from Sep 1 through Oct 31.
  const fallStart = new Date(year, 8, 1);
  const fallEnd = new Date(year, 9, 31);
  let fallSunday = new Date(fallStart);
  // Walk forward to the first Sunday on or after Sep 1.
  if (fallSunday.getDay() !== 0) {
    fallSunday.setDate(fallSunday.getDate() + ((7 - fallSunday.getDay()) % 7));
  }
  while (fallSunday.getTime() <= fallEnd.getTime()) {
    dates.push(new Date(fallSunday));
    fallSunday = new Date(fallSunday);
    fallSunday.setDate(fallSunday.getDate() + 7);
  }
  return dates.sort((a, b) => a.getTime() - b.getTime());
};

type EvalPromptKind = "preseason" | "biweekly";

export interface EvalPromptStatus {
  active: boolean;
  kind: EvalPromptKind | null;
  lastSubmittedDate: string | null;
  // ISO date string of next due window when not currently active.
  nextDueDate: string | null;
  // Days until next eval is due (null when active). Negative when overdue.
  daysUntilDue: number | null;
}

export const dateToIsoLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Parse a stored eval date ("YYYY-MM-DD", optionally with a time suffix) into
// a *local* midnight Date. Using local construction here keeps the day-delta
// math below on the same footing as `due` (also local midnight) and avoids the
// UTC skew you'd get from `new Date("YYYY-MM-DD")`.
const isoToLocalDate = (s: string): Date => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const sameLocalDay = (a: Date, b: Date): boolean => {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

// Pure: decides whether the given coach owes an eval right now.
// Schedule is fixed by calendar date (see evalDueDatesForYear): Spring
// preseason (2/1) + 3/15 + biweekly Sundays through 6/30; Fall weekly
// Sundays 9/1–10/31. Active when the coach hasn't submitted an eval
// within EVAL_WINDOW_DAYS of the nearest due date. Replaces the prior
// "14 days since last save" logic per coach request — the cadence now
// lives on the calendar, not on the last save timestamp.
export const evalPromptStatus = (
  team: { currentSeason?: string; evaluationEvents?: any[] } | null | undefined,
  userUid: string | null | undefined,
  coachRole: "Head" | "Assistant",
  now: Date = new Date(),
): EvalPromptStatus => {
  if (!team || !userUid) {
    return {
      active: false,
      kind: null,
      lastSubmittedDate: null,
      nextDueDate: null,
      daysUntilDue: null,
    };
  }
  // Every eval this coach has ever filed, newest first. The cadence is
  // purely calendar-driven now, so we don't restrict to "this season" —
  // each due date is checked against the latest submission on its own,
  // and old submissions (way before any current due date) naturally
  // fall outside the alreadyHit window.
  const mine = (team.evaluationEvents || [])
    .filter((e) => e.coachRole === coachRole && e.evaluatorId === userUid)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const lastSubmittedDate = mine[0]?.date || null;

  // Build candidate due dates spanning this calendar year + the next
  // (handles end-of-year edge case where "next due" is in January).
  const candidates = [
    ...evalDueDatesForYear(now.getFullYear()),
    ...evalDueDatesForYear(now.getFullYear() + 1),
  ];

  // Find the due date closest to (and not too far past) "now".
  let activeDue: Date | null = null;
  let upcomingDue: Date | null = null;
  for (const due of candidates) {
    const deltaDays = Math.floor((now.getTime() - due.getTime()) / MS_PER_DAY);
    // Window is [due - WINDOW, due + WINDOW]. The prompt is fulfilled once the
    // coach files an eval anywhere inside that window — including the days
    // *before* the due date — so the reminder clears as soon as they catch up
    // instead of lingering until the due date physically passes. A later
    // submission (next round already in) counts too, hence the open-ended `>=`.
    const alreadyHit =
      lastSubmittedDate &&
      Math.round(
        (isoToLocalDate(lastSubmittedDate).getTime() - due.getTime()) /
          MS_PER_DAY,
      ) >= -EVAL_WINDOW_DAYS;
    if (
      !alreadyHit &&
      deltaDays >= -EVAL_WINDOW_DAYS &&
      deltaDays <= EVAL_WINDOW_DAYS
    ) {
      activeDue = due;
      break;
    }
    if (!upcomingDue && due.getTime() > now.getTime()) {
      upcomingDue = due;
    }
  }

  if (activeDue) {
    // Preseason vs biweekly: Feb 1 is the preseason kickoff; everything
    // else carries the "biweekly" label so existing copy doesn't break.
    const isPreseason = activeDue.getMonth() === 1 && activeDue.getDate() === 1;
    return {
      active: true,
      kind: isPreseason ? "preseason" : "biweekly",
      lastSubmittedDate,
      nextDueDate: dateToIsoLocal(activeDue),
      daysUntilDue: 0,
    };
  }
  if (!upcomingDue) {
    return {
      active: false,
      kind: null,
      lastSubmittedDate,
      nextDueDate: null,
      daysUntilDue: null,
    };
  }
  // sameLocalDay reads as "no rounding error needed" — Math.ceil handles
  // sub-day timestamps the right way.
  const daysUntilDue = sameLocalDay(now, upcomingDue)
    ? 0
    : Math.ceil((upcomingDue.getTime() - now.getTime()) / MS_PER_DAY);
  return {
    active: false,
    kind: null,
    lastSubmittedDate,
    nextDueDate: dateToIsoLocal(upcomingDue),
    daysUntilDue,
  };
};

// Snap a freshly-filed eval to the calendar round it satisfies. The cadence is
// fixed by date (see evalDueDatesForYear), so a saved round should carry the
// due date it lands nearest to — not the literal day it was keyed in. We scan
// last year's, this year's, and next year's due dates and pick the one closest
// in absolute calendar distance (ties favor the earlier date). The schedule is
// never empty, so the `now` fallback is purely defensive. Pure / injectable.
export const evalRoundDateForSave = (now: Date = new Date()): string => {
  const candidates = [
    ...evalDueDatesForYear(now.getFullYear() - 1),
    ...evalDueDatesForYear(now.getFullYear()),
    ...evalDueDatesForYear(now.getFullYear() + 1),
  ];
  let best: Date | null = null;
  let bestDist = Infinity;
  for (const due of candidates) {
    const dist = Math.abs(due.getTime() - now.getTime());
    if (dist < bestDist) {
      bestDist = dist;
      best = due;
    }
  }
  return best ? dateToIsoLocal(best) : dateToIsoLocal(now);
};

// One-time migration: re-stamp every existing roster eval round onto the
// calendar due date it falls nearest to, matching how new saves are now dated
// (see evalRoundDateForSave). Tryout grades (those carrying `tryoutSignupId`)
// are NOT cadence rounds and pass through untouched. When two of the same
// coach's rounds collapse onto one due date, the round with the most recent
// original date wins (its grades are freshest) and the older is dropped, which
// keeps the per-(role, coach, date) upsert key unique. Idempotent: a round
// already on its due date snaps to itself. Pure.
export const restampEvalDueDates = <
  T extends {
    date?: string;
    coachRole?: string;
    evaluatorId?: string;
    tryoutSignupId?: string;
  },
>(
  events: T[] | null | undefined,
): T[] => {
  if (!Array.isArray(events)) return [];
  // Resolve collisions by original recency: decide winners newest-first,
  // breaking ties by original position for determinism.
  const ranked = events
    .map((e, i) => ({
      e,
      i,
      t: e?.date ? isoToLocalDate(e.date).getTime() : 0,
    }))
    .sort((a, b) => b.t - a.t || a.i - b.i);
  const newDateByIndex = new Map<number, string>();
  const dropped = new Set<number>();
  const seen = new Set<string>();
  for (const { e, i } of ranked) {
    // Leave tryout grades and dateless/blank events exactly as they are.
    if (!e?.date || e.tryoutSignupId) continue;
    const snapped = evalRoundDateForSave(isoToLocalDate(e.date));
    const key = `${e.coachRole ?? ""}|${e.evaluatorId ?? ""}|${snapped}`;
    if (seen.has(key)) {
      dropped.add(i); // older duplicate for this round — drop it
      continue;
    }
    seen.add(key);
    newDateByIndex.set(i, snapped);
  }
  return events
    .map((e, i) => {
      if (dropped.has(i)) return null;
      const nd = newDateByIndex.get(i);
      return nd && nd !== e.date ? { ...e, date: nd } : e;
    })
    .filter((e): e is T => e !== null);
};

// Descending recency comparator for eval rounds: newest date first, with the
// wall-clock createdAt stamp breaking date ties (rounds snapped to the same
// cadence due date, or two literal same-day saves). Before this, tied dates
// fell to stable-sort insertion order, so every "latest round" lookup silently
// resolved to the OLDEST of the tied rounds — the newer evaluation existed but
// never surfaced. Rounds without createdAt (pre-stamp data) sort as 0.
export const evalRoundRecency = (
  a: { date?: string; createdAt?: number } | null | undefined,
  b: { date?: string; createdAt?: number } | null | undefined,
): number => {
  const d = new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime();
  if (d !== 0) return d;
  return (b?.createdAt || 0) - (a?.createdAt || 0);
};

const tryoutSessionIdForDate = (date: string) =>
  `tryout-${String(date || "undated").replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export const normalizeTryoutSessions = (team: any): any[] => {
  const sessions = Array.isArray(team?.tryoutSessions)
    ? team.tryoutSessions.map((s: any) => ({
        ...s,
        signupIds: Array.isArray(s.signupIds) ? [...s.signupIds] : [],
        gradesByEvaluator: { ...(s.gradesByEvaluator || {}) },
      }))
    : [];
  const byId = new Map(sessions.map((session: any) => [session.id, session]));
  for (const e of team?.evaluationEvents || []) {
    if (!e?.tryoutSignupId || !e?.evaluatorId || !e?.grades?.signup) continue;
    const signup = (team?.tryoutSignups || []).find(
      (s: any) => s.id === e.tryoutSignupId,
    );
    const date = signup?.tryoutDate || e.date || "undated";
    const id = tryoutSessionIdForDate(date);
    const session: any = byId.get(id) || {
      id,
      date,
      label: `Tryout · ${date}`,
      createdAt: e.createdAt || Date.now(),
      updatedAt: e.createdAt || Date.now(),
      signupIds: [],
      gradesByEvaluator: {},
    };
    const evaluatorKey = e.evaluatorId;
    const evaluator = session.gradesByEvaluator[evaluatorKey] || {
      coachRole: e.coachRole || "Assistant",
      evaluatorId: e.evaluatorId,
      evaluatorName: e.evaluatorName,
      grades: {},
    };
    evaluator.grades = {
      ...(evaluator.grades || {}),
      [e.tryoutSignupId]: { ...e.grades.signup },
    };
    evaluator.updatedAt = e.createdAt || Date.now();
    session.gradesByEvaluator[evaluatorKey] = evaluator;
    if (!session.signupIds.includes(e.tryoutSignupId))
      session.signupIds.push(e.tryoutSignupId);
    byId.set(id, session);
  }
  return [...byId.values()];
};

export const combinedTryoutGradeForSignup = (
  sessions: any[] | null | undefined,
  signupId: string | null | undefined,
  date?: string,
): any | null => {
  if (!signupId) return null;
  const matches = (sessions || []).filter(
    (s: any) =>
      (!date || s.date === date) &&
      Object.values(s.gradesByEvaluator || {}).some(
        (eg: any) => eg?.grades?.[signupId],
      ),
  );
  const session = matches.sort(
    (a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0),
  )[0];
  if (!session) return null;
  const headGrades: any[] = [];
  const assistantGrades: any[] = [];
  for (const eg of Object.values(session.gradesByEvaluator || {}) as any[]) {
    const g = eg?.grades?.[signupId];
    if (!g) continue;
    if (eg.coachRole === "Head") headGrades.push(g);
    else assistantGrades.push(g);
  }
  const avg = (grades: any[]) => {
    if (!grades.length) return null;
    const out: Record<string, any> = {};
    const keys = new Set<string>();
    grades.forEach((g) => Object.keys(g || {}).forEach((k) => keys.add(k)));
    for (const key of keys) {
      if (key === "notes" || key === "suggestedPositions") {
        const latest = [...grades].reverse().find((g) => g?.[key]);
        if (latest) out[key] = latest[key];
        continue;
      }
      const vals = grades
        .map((g) => g?.[key])
        .filter((v) => typeof v === "number");
      if (vals.length)
        out[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    return out;
  };
  const head = avg(headGrades);
  const assistants = avg(assistantGrades);
  if (head && assistants) {
    const out: Record<string, any> = {};
    const keys = new Set([...Object.keys(head), ...Object.keys(assistants)]);
    for (const key of keys) {
      if (key === "notes" || key === "suggestedPositions")
        out[key] = head[key] ?? assistants[key];
      else {
        const hv = head[key];
        const av = assistants[key];
        if (typeof hv === "number" && typeof av === "number")
          out[key] = Math.round((hv + av) / 2);
        else out[key] = hv ?? av;
      }
    }
    return out;
  }
  return head || assistants;
};

export const evaluatorTryoutGradeForSignup = (
  sessions: any[] | null | undefined,
  signupId: string | null | undefined,
  evaluatorId: string | null | undefined,
  date?: string,
): any | null => {
  if (!signupId || !evaluatorId) return null;
  const session = (sessions || [])
    .filter((s: any) => !date || s.date === date)
    .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .find((s: any) => s.gradesByEvaluator?.[evaluatorId]?.grades?.[signupId]);
  return session?.gradesByEvaluator?.[evaluatorId]?.grades?.[signupId] || null;
};

// Advance-Season eval seeding. The new season starts with a single "Preseason"
// eval round so coaches don't begin blind: each returning player carries their
// MOST RECENT eval from the ending season, and each promoted tryout carries
// their tryout evaluation. Grades are keyed by the (new) player id so the round
// drops straight into evaluationEvents.
//
//   endingEvents     — teamData.evaluationEvents from the season being archived
//   returningPlayers — players kept on the new roster (ids unchanged)
//   promotedPlayers  — new players built from tryouts (carry `tryoutSignupId`)
//
// Returns null when nothing could be seeded (no source grades) so the caller
// can fall back to an empty round list.
export const buildPreseasonSeedRound = (
  endingEvents: any[],
  returningPlayers: any[],
  promotedPlayers: any[],
  meta: { date: string; evaluatorId?: string; tryoutSessions?: any[] },
): any | null => {
  const grades: Record<string, any> = {};

  // Returning players → their latest non-tryout round that actually graded them.
  const roundsNewestFirst = (endingEvents || [])
    .filter((e: any) => !e?.tryoutSignupId && e?.grades)
    .slice()
    .sort(evalRoundRecency);
  for (const p of returningPlayers || []) {
    if (!p?.id) continue;
    for (const r of roundsNewestFirst) {
      const g = r.grades?.[p.id];
      if (g && typeof g === "object" && Object.keys(g).length > 0) {
        grades[p.id] = { ...g };
        break;
      }
    }
  }

  const tryoutSessions =
    meta.tryoutSessions ||
    normalizeTryoutSessions({ evaluationEvents: endingEvents });
  for (const p of promotedPlayers || []) {
    const sid = p?.tryoutSignupId;
    if (!sid || !p?.id) continue;
    const g = combinedTryoutGradeForSignup(tryoutSessions, sid);
    if (g && typeof g === "object" && Object.keys(g).length > 0) {
      grades[p.id] = { ...g };
    }
  }

  if (Object.keys(grades).length === 0) return null;

  return {
    id: "ev-preseason-" + Math.random().toString(36).slice(2, 10),
    date: meta.date,
    createdAt: Date.now(),
    coachRole: "Head",
    evaluatorId: meta.evaluatorId || "",
    // Shown verbatim in the round picker ("Preseason · <date>").
    evaluatorName: "Preseason",
    label: "Preseason",
    grades,
    seededFromAdvance: true,
  };
};

// Cool-off between automated reminder batches. The cadence prompt
// (preseason / biweekly) can stay active for days as coaches catch up;
// without this guard the email fires every time the HC opens the app.
const EMAIL_PROMPT_COOLOFF_DAYS = 7;

export interface EmailPromptStatus {
  active: boolean;
  kind: EvalPromptKind | null;
  // The head's own status (so we know to nudge them too if they haven't
  // submitted this round).
  headDue: boolean;
  // Per-assistant due flags: { [evaluatorId]: boolean }. Only entries
  // where the assistant has NOT submitted this round are emitted.
  assistantsDue: Record<string, boolean>;
  // Reason string when inactive — useful for surfacing a "sent X days
  // ago" hint in Settings.
  reason: string | null;
}

// Whether the team should fire automated reminder emails right now.
// Conditions:
//   1. Eval cadence is active for ANY coach (preseason or biweekly).
//   2. team.emailEvalRemindersDisabled !== true.
//   3. team.lastEvalEmailedAt is missing OR > EMAIL_PROMPT_COOLOFF_DAYS old.
// Recipients = head's email + every coachContacts[].email whose
// assistant hasn't submitted in the current round.
export const emailPromptStatus = (
  team:
    | {
        currentSeason?: string;
        evaluationEvents?: any[];
        ownerId?: string;
        coachContacts?: Array<{ id?: string; name?: string; email?: string }>;
        coachRoles?: Record<string, string>;
        members?: string[];
        lastEvalEmailedAt?: string;
        emailEvalRemindersDisabled?: boolean;
      }
    | null
    | undefined,
  now: Date = new Date(),
): EmailPromptStatus => {
  if (!team) {
    return {
      active: false,
      kind: null,
      headDue: false,
      assistantsDue: {},
      reason: "no team",
    };
  }
  if (team.emailEvalRemindersDisabled === true) {
    return {
      active: false,
      kind: null,
      headDue: false,
      assistantsDue: {},
      reason: "reminders disabled",
    };
  }
  // Cool-off guard: skip if we sent recently.
  if (team.lastEvalEmailedAt) {
    const lastMs = new Date(team.lastEvalEmailedAt).getTime();
    if (Number.isFinite(lastMs)) {
      const elapsedDays = Math.floor((now.getTime() - lastMs) / MS_PER_DAY);
      if (elapsedDays < EMAIL_PROMPT_COOLOFF_DAYS) {
        return {
          active: false,
          kind: null,
          headDue: false,
          assistantsDue: {},
          reason: `cool-off (${EMAIL_PROMPT_COOLOFF_DAYS - elapsedDays} day(s) remaining)`,
        };
      }
    }
  }

  // Head status.
  const headStatus = team.ownerId
    ? evalPromptStatus(team, team.ownerId, "Head", now)
    : { active: false, kind: null };

  // Assistant statuses — anyone in coachRoles marked "assistant", or
  // members other than the owner if coachRoles is absent.
  const assistantUids = new Set<string>();
  const coachRoles = team.coachRoles || {};
  for (const [uid, role] of Object.entries(coachRoles)) {
    if (role === "assistant") assistantUids.add(uid);
  }
  if (assistantUids.size === 0 && Array.isArray(team.members)) {
    for (const uid of team.members) {
      if (uid !== team.ownerId) assistantUids.add(uid);
    }
  }
  const assistantsDue: Record<string, boolean> = {};
  let anyAssistantDue = false;
  let firstActiveKind: EvalPromptKind | null = null;
  for (const uid of assistantUids) {
    const s = evalPromptStatus(team, uid, "Assistant", now);
    if (s.active) {
      assistantsDue[uid] = true;
      anyAssistantDue = true;
      if (!firstActiveKind) firstActiveKind = s.kind;
    }
  }

  const anyDue = headStatus.active || anyAssistantDue;
  if (!anyDue) {
    return {
      active: false,
      kind: null,
      headDue: false,
      assistantsDue: {},
      reason: "no cadence active",
    };
  }
  return {
    active: true,
    kind: headStatus.kind || firstActiveKind || "biweekly",
    headDue: !!headStatus.active,
    assistantsDue,
    reason: null,
  };
};

// ============================================================================
// Game-day reminders — client-side, wall-clock based.
//
// Coaches opt in (per device) to a local notification ahead of upcoming
// games. The app has no backend scheduler (Spark plan, no Cloud Functions),
// so reminders are computed on the client whenever the app is open and fired
// via the Notification API. This helper is the pure core: given the schedule
// and the current time, it returns the games whose reminder window is open
// right now. The hook layer (useScheduleReminders) handles permission,
// dedupe, and the actual Notification call.
//
// Games store `date` as YYYY-MM-DD with no timezone, so the comparison is
// done against the coach's *local* calendar day — mirroring the upcoming-game
// filter on the Home dashboard.
// ============================================================================

export type ReminderLeadTime = "morning_of" | "day_before";

export interface DueGameReminder {
  id: string;
  // Normalized YYYY-MM-DD of the game.
  date: string;
  opponent: string;
  // Human-readable date for the notification body.
  displayDate: string;
  // 0 when the game is today, 1 when it is tomorrow.
  daysUntil: number;
  // "Today" / "Tomorrow" — convenience label for notification copy.
  whenLabel: string;
}

const LEAD_DAYS: Record<ReminderLeadTime, number> = {
  morning_of: 0,
  day_before: 1,
};

// Pure: returns the games that should trigger a reminder at `now` for the
// chosen lead time. A game is in-window when it is not finalized or
// postponed, has a parseable date, and falls between today and `leadDays`
// days out (inclusive). The lower bound is today so a "day before" reminder
// still fires on game day if the coach didn't open the app the day prior.
// Dedupe across repeated calls is the caller's job (see useScheduleReminders).
export const gamesDueForReminder = (
  games:
    | Array<{
        id?: string;
        date?: string;
        opponent?: string;
        status?: string;
        teamScore?: number | string | null;
        opponentScore?: number | string | null;
      }>
    | null
    | undefined,
  leadTime: ReminderLeadTime,
  now: Date = new Date(),
): DueGameReminder[] => {
  if (!Array.isArray(games) || games.length === 0) return [];
  const leadDays = LEAD_DAYS[leadTime] ?? 0;
  const todayLocal = isoToLocalDate(dateToIsoLocal(now));

  const due: DueGameReminder[] = [];
  for (const game of games) {
    if (!game || !game.id) continue;
    if ((game.status || "scheduled") === "postponed") continue;
    if (isGameFinalized(game)) continue;
    const iso = normalizeDateToIso(game.date);
    if (!iso) continue;
    const daysUntil = Math.round(
      (isoToLocalDate(iso).getTime() - todayLocal.getTime()) / MS_PER_DAY,
    );
    if (daysUntil < 0 || daysUntil > leadDays) continue;
    due.push({
      id: game.id,
      date: iso,
      opponent: (game.opponent || "").trim() || "TBD",
      displayDate: formatGameDateDisplay(iso),
      daysUntil,
      whenLabel: daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : iso,
    });
  }
  return due.sort((a, b) => a.date.localeCompare(b.date));
};

// ============================================================================
// Schedule calendar export (.ics).
//
// Reminders fired from the app only land while it's open (Spark plan — no
// backend push). Exporting the schedule as an .ics lets a coach add games to
// their phone/desktop calendar, which then handles reliable native reminders
// even when the app is closed. This builder is pure so it's unit-testable; the
// UI wraps the string in a Blob download.
//
// Games are emitted as all-day events: the stored date has no reliable time or
// timezone, and an all-day event shows on the correct calendar day everywhere.
// Any free-text `time` is appended to the title for the coach's reference
// without affecting scheduling.
// ============================================================================

const icsEscapeText = (value: string): string =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

const icsCompactDate = (iso: string): string => iso.replace(/-/g, "");

// All-day DTEND is exclusive, so it points at the day after DTSTART.
const icsNextDay = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(
    dt.getUTCDate(),
  )}`;
};

const icsStamp = (now: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate(),
  )}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(
    now.getUTCSeconds(),
  )}Z`;
};

// Build an RFC 5545 VCALENDAR string for the team's upcoming games. Finalized
// and postponed games and rows without a parseable date are omitted; events
// are sorted by date. Returns a valid (empty) calendar when nothing qualifies.
export const buildScheduleIcs = (
  games:
    | Array<{
        id?: string;
        date?: string;
        time?: string;
        opponent?: string;
        status?: string;
        teamScore?: number | string | null;
        opponentScore?: number | string | null;
      }>
    | null
    | undefined,
  teamName: string | null | undefined,
  now: Date = new Date(),
): string => {
  const stamp = icsStamp(now);
  const team = (teamName || "").trim() || "Team";

  const events = (Array.isArray(games) ? games : [])
    .filter((g) => g && g.id)
    .filter((g) => (g!.status || "scheduled") !== "postponed")
    .filter((g) => !isGameFinalized(g!))
    .map((g) => ({ g: g!, iso: normalizeDateToIso(g!.date) }))
    .filter((e) => !!e.iso)
    .sort((a, b) => a.iso.localeCompare(b.iso));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Coach's Card//Schedule//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const { g, iso } of events) {
    const opp = (g.opponent || "").trim() || "TBD";
    const time = (g.time || "").trim();
    const summary = `${team} vs ${opp}${time ? ` (${time})` : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:game-${g.id}@coachscard`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsCompactDate(iso)}`,
      `DTEND;VALUE=DATE:${icsNextDay(iso)}`,
      `SUMMARY:${icsEscapeText(summary)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
};

// ============================================================================
// Pitching outing history.
//
// recentPitches/lastPitchDate model only the *most recent* outing (what the
// rest-day rules need). This keeps a rolling log of recent outings on the
// pitcher so coaches can see season pitch-count history. Additive: a pitcher
// with no `log` simply starts one. Entries are deduped by date (re-finalizing
// the same game updates rather than duplicates), sorted newest-first, and
// capped so the team document stays small.
// ============================================================================

// Firestore caps a single document at 1 MiB. The whole team lives in one doc
// (no subcollections), so as rosters / schedules / evals / pitching logs grow
// it can creep toward the cap — at which point a write silently fails. These
// let the client estimate the serialized size and warn before that happens.
export const FIRESTORE_DOC_LIMIT_BYTES = 1_048_576;
export const DOC_SIZE_WARN_RATIO = 0.9;

// Approximate the serialized (UTF-8) byte size of a value as it would be
// stored. Pure; returns 0 for unserializable input rather than throwing.
export const estimateDocSizeBytes = (value: unknown): number => {
  let str: string;
  try {
    str = JSON.stringify(value) ?? "";
  } catch {
    return 0;
  }
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str).length;
  }
  // Fallback: count UTF-8 bytes without TextEncoder.
  return unescape(encodeURIComponent(str)).length;
};

export interface PitchingOuting {
  date: string;
  pitches: number;
  // The game this outing came from. Outings are deduped by gameId so two
  // games on the SAME date (doubleheaders) each keep their own entry, while
  // re-finalizing the same game updates in place. Legacy entries (written
  // before this field existed) have no gameId and are matched by date.
  gameId?: string;
}

const PITCHING_LOG_CAP = 12;

// Pure: returns a new `pitching` object with recentPitches/lastPitchDate set to
// the given outing (unchanged semantics) and the outing recorded in `log`.
// `gameId` keys the log entry so same-date doubleheaders stay distinct; when
// omitted (legacy callers) the prior entry on that date is replaced as before.
export const recordPitchingOuting = (
  pitching: Record<string, any> | null | undefined,
  date: string,
  pitches: number,
  gameId?: string,
): Record<string, any> => {
  const base = pitching || {};
  const all: PitchingOuting[] = Array.isArray(base.log) ? base.log : [];
  const prior = all.filter((o: any) => {
    if (!o || !o.date) return false;
    // With a gameId, only the same game's entry is replaced — other outings
    // (including a different game on the same date) are preserved.
    if (gameId) return o.gameId !== gameId;
    // Legacy path: no gameId, dedupe by date.
    return o.date !== date;
  });
  const entry: PitchingOuting = gameId
    ? { date, pitches, gameId }
    : { date, pitches };
  const log = [...prior, entry]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        String(b.gameId || "").localeCompare(String(a.gameId || "")),
    )
    .slice(0, PITCHING_LOG_CAP);
  return { ...base, recentPitches: pitches, lastPitchDate: date, log };
};

export interface PitchingWorkload {
  outings: number;
  totalPitches: number;
  maxPitches: number;
  lastDate: string | null;
}

// Pure: summarize a pitcher's logged outings into season-workload totals.
// Safe for pitchers with no log (returns zeros). Used to surface at-a-glance
// workload alongside the per-outing history.
export const summarizePitchingWorkload = (
  pitching: { log?: PitchingOuting[] } | null | undefined,
): PitchingWorkload => {
  const log = Array.isArray(pitching?.log) ? pitching!.log! : [];
  let totalPitches = 0;
  let maxPitches = 0;
  let lastDate: string | null = null;
  for (const o of log) {
    const n = Number(o?.pitches) || 0;
    totalPitches += n;
    if (n > maxPitches) maxPitches = n;
    if (o?.date && (!lastDate || o.date > lastDate)) lastDate = o.date;
  }
  return { outings: log.length, totalPitches, maxPitches, lastDate };
};

// Catching outing log — mirrors the pitching log so we can enforce the same-day
// catch<->pitch rule across games (doubleheaders), where the in-lineup rule
// can't reach. Entries are deduped by gameId.
export interface CatchingOuting {
  date: string;
  innings: number;
  gameId?: string;
}
const CATCHING_LOG_CAP = 12;

export const recordCatchingOuting = (
  catching: Record<string, any> | null | undefined,
  date: string,
  innings: number,
  gameId?: string,
): Record<string, any> => {
  const base = catching || {};
  const all: CatchingOuting[] = Array.isArray(base.log) ? base.log : [];
  const prior = all.filter((o: any) => {
    if (!o || !o.date) return false;
    if (gameId) return o.gameId !== gameId;
    return o.date !== date;
  });
  const entry: CatchingOuting = gameId
    ? { date, innings, gameId }
    : { date, innings };
  const log = [...prior, entry]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        String(b.gameId || "").localeCompare(String(a.gameId || "")),
    )
    .slice(0, CATCHING_LOG_CAP);
  return { ...base, lastCatchDate: date, log };
};

// Who pitched / caught on `date` in games OTHER than excludeGameId — drives the
// same-day catch<->pitch rule for doubleheaders (a kid who pitched game 1 can't
// catch game 2 that day, and vice-versa). Reads each player's per-date logs.
export const sameDayRoleSets = (
  players:
    | Array<{
        id: string;
        pitching?: { log?: PitchingOuting[] };
        catching?: { log?: CatchingOuting[] };
      }>
    | null
    | undefined,
  date: string | undefined,
  excludeGameId?: string,
): { pitched: Set<string>; caught: Set<string> } => {
  const pitched = new Set<string>();
  const caught = new Set<string>();
  if (!date) return { pitched, caught };
  for (const p of players || []) {
    const pl = Array.isArray(p.pitching?.log) ? p.pitching!.log! : [];
    if (
      pl.some(
        (o) =>
          o?.date === date &&
          (Number(o?.pitches) || 0) > 0 &&
          o.gameId !== excludeGameId,
      )
    )
      pitched.add(p.id);
    const cl = Array.isArray(p.catching?.log) ? p.catching!.log! : [];
    if (
      cl.some(
        (o) =>
          o?.date === date &&
          (Number(o?.innings) || 0) > 0 &&
          o.gameId !== excludeGameId,
      )
    )
      caught.add(p.id);
  }
  return { pitched, caught };
};

// ---------------------------------------------------------------------------
// Public-form input hygiene.
//
// The Tryouts Portal accepts submissions from anonymous (unauthenticated)
// visitors, so its inputs are untrusted. These keep payloads bounded — JSX
// already escapes rendered text, but capping length avoids oversized writes,
// PII-bloat in exports, and DoS-ish documents. The Firestore rules cap array
// growth; this caps each entry's fields.
// ---------------------------------------------------------------------------
export const SIGNUP_LIMITS = {
  name: 50, // first/last/parent/team names
  email: 254, // RFC 5321 max
  phone: 30,
  notes: 500,
  // Short free-text/dropdown values on the Player Info form (sizes, height,
  // weight, school, grade). Kept tight — these are labels, not prose.
  size: 40,
} as const;

// Trim and hard-clamp a free-text field to a max length.
export const clampText = (value: unknown, max: number): string =>
  String(value ?? "")
    .trim()
    .slice(0, max);

// Pragmatic email shape check (not full RFC 5322) — "x@y.z" with no spaces.
export const isValidEmail = (value: unknown): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());

// Whether a string is a safe CSS color to feed into setProperty — hex, rgb(a),
// or hsl(a). Blocks attempts to smuggle extra declarations via team-supplied
// branding colors (defense-in-depth; setProperty already rejects most junk).
export const isSafeCssColor = (value: unknown): boolean => {
  const v = String(value ?? "").trim();
  return (
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
    /^rgba?\(\s*[\d.,%\s/]+\)$/i.test(v) ||
    /^hsla?\(\s*[\d.,%\s/deg]+\)$/i.test(v)
  );
};

// Whether a logo URL is safe to render in an <img src>. Allows https and
// inline image data URLs; rejects everything else (javascript:, other data:).
export const isSafeImageUrl = (value: unknown): boolean => {
  const v = String(value ?? "").trim();
  return (
    /^https:\/\//i.test(v) ||
    /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);/i.test(v)
  );
};

// ---------- Team finances (money math) ----------
// Pure helpers behind the Finances tab. All amounts are dollars; display
// formatting handles cents. Malformed/missing values read as 0 so a partial
// doc never crashes the tab.

const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// "$1,250" / "$12.50" / "-$80" — whole dollars unless cents are present.
export const formatCurrency = (value: unknown): string => {
  const n = money(value);
  const abs = Math.abs(n);
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${body}`;
};

// Effective cost of one budget item: quantity mode (qty × unitAmount, e.g.
// 8 tournaments × $450 entry) when both fields are present, else the flat
// amount. Single reader for the planner math so the two shapes never drift.
export const budgetItemAmount = (
  item:
    | {
        amount?: number;
        qty?: number;
        unitAmount?: number;
        taxable?: boolean;
      }
    | null
    | undefined,
  salesTaxPct?: number,
): number => {
  if (!item) return 0;
  const base =
    item.qty != null && item.unitAmount != null
      ? Math.max(0, money(item.qty)) * money(item.unitAmount)
      : money(item.amount);
  // Taxable items (pre-tax quotes) project at their real, taxed cost.
  const pct = item.taxable ? Math.max(0, money(salesTaxPct)) : 0;
  return base * (1 + pct / 100);
};

export const budgetTotal = (
  finances: TeamFinances | null | undefined,
): number =>
  (finances?.budgetItems || []).reduce(
    (sum, item) => sum + budgetItemAmount(item, finances?.salesTaxPct),
    0,
  );

// Round up to the next multiple of `increment` (the fee buffer: incidentals
// are covered and the fee lands on a clean $25/$50 number). 0/unset keeps
// the plain next-dollar ceiling.
export const roundUpToIncrement = (n: number, increment?: number): number => {
  const inc = Math.max(0, money(increment));
  if (!(n > 0)) return 0;
  if (inc <= 0) return Math.ceil(n);
  return Math.ceil(n / inc) * inc;
};

// Sponsorships / fundraising / donations — everything received that isn't a
// family's club-fee payment.
export const incomeTotal = (
  finances: TeamFinances | null | undefined,
): number =>
  (finances?.incomes || []).reduce((sum, i) => sum + money(i?.amount), 0);

// THIS season's ledger income flagged as fundraising — the slice of income
// that reduces each family's dues. Split into money attributed to a specific
// child (credits that kid's fee first) and unattributed money (splits evenly).
const fundraisingBreakdown = (
  finances: TeamFinances | null | undefined,
): { byPlayer: Record<string, number>; unattributed: number } => {
  const byPlayer: Record<string, number> = {};
  let unattributed = 0;
  for (const i of finances?.incomes || []) {
    if (!i?.fundraising) continue;
    const amt = money(i?.amount);
    const pid = String(i?.playerId || "");
    if (pid) byPlayer[pid] = (byPlayer[pid] || 0) + amt;
    else unattributed += amt;
  }
  return { byPlayer, unattributed };
};

// Sponsorships pledged toward NEXT season's budget (Budget Planner entries
// with a sponsor name) — the only money that offsets the suggested fee.
export const sponsorshipTotal = (
  finances: TeamFinances | null | undefined,
): number =>
  (finances?.sponsorships || []).reduce((sum, s) => sum + money(s?.amount), 0);

// Suggested NEXT-season fee per paying player. The Budget Planner plans the
// coming year in isolation: planned costs minus sponsorships pledged for that
// year, split across paying players and rounded UP so the club never plans a
// shortfall. The CURRENT year's ledger (this year's fees, fundraising,
// spending) stays out of it — leftover cash carries into the new year's
// ledger when the season advances, it doesn't pre-discount the fee.
// Fee-exempt players (fall-only pickups, scholarships) don't dilute the
// split. 0 when sponsorships cover everything; null when there's nothing to
// split (no budget or no paying players).
export const suggestedFeePerPlayer = (
  finances: TeamFinances | null | undefined,
  players: Array<{ id: string }> | null | undefined,
): number | null => {
  const total = budgetTotal(finances);
  if (total <= 0) return null;
  const payers = plannedPayerCount(finances, players);
  if (payers === 0) return null;
  const uncovered = Math.max(0, total - sponsorshipTotal(finances));
  // The buffer rounds UP to the nearest $25/$50 so incidentals are covered
  // and the fee is a clean number; without one, next-dollar ceiling.
  return roundUpToIncrement(uncovered / payers, finances?.feeBufferIncrement);
};

// The divisor for the suggested-fee split: the coach's anticipated roster
// size for next season when set, otherwise this season's paying players.
export const plannedPayerCount = (
  finances: TeamFinances | null | undefined,
  players: Array<{ id: string }> | null | undefined,
): number => {
  const planned = Math.round(money(finances?.plannedPlayerCount));
  if (planned > 0) return planned;
  const exempt = new Set(finances?.feeExemptIds || []);
  return (players || []).filter((p) => p?.id && !exempt.has(p.id)).length;
};

// Rough next-season budget proposed from THIS season's actual spending:
// one item per budget category that saw money (label kept, amount = the
// larger of plan vs actual, rounded up to a clean $25), plus a single
// "Other" line for unplanned spending. null when the season has no spending
// to learn from. Ids are freshly generated so the proposal never collides
// with existing items.
export const estimateBudgetFromSeason = (
  finances: TeamFinances | null | undefined,
): { items: BudgetItem[]; total: number } | null => {
  const actuals = budgetActuals(finances);
  const items: BudgetItem[] = [];
  for (const item of finances?.budgetItems || []) {
    const spent = money(actuals.byItem[item.id]);
    const planned = budgetItemAmount(item, finances?.salesTaxPct);
    const basis = Math.max(spent, planned);
    if (basis <= 0) continue;
    items.push({
      id: `b-${Math.random().toString(36).slice(2, 10)}`,
      label: item.label,
      amount: roundUpToIncrement(basis, 25),
    });
  }
  if (money(actuals.unplanned) > 0) {
    items.push({
      id: `b-${Math.random().toString(36).slice(2, 10)}`,
      label: "Other (unplanned this season)",
      amount: roundUpToIncrement(actuals.unplanned, 25),
    });
  }
  if (items.length === 0) return null;
  return {
    items,
    total: items.reduce((sum, i) => sum + money(i.amount), 0),
  };
};

export interface FinanceSummary {
  collected: number; // every club-fee payment recorded
  otherIncome: number; // sponsorships / fundraising / donations
  spent: number; // every expense recorded
  balanceNow: number; // collected + otherIncome − spent
  stillOwed: number; // Σ per-player max(0, effective fee − paid)
  balanceOnceAllPaid: number; // balanceNow + stillOwed
  paidByPlayer: Record<string, number>; // playerId → total paid
  // Even-split fundraising credit: unattributed fundraising plus any per-child
  // surplus, divided across paying players — the baseline per-family discount.
  duesCreditPerPlayer: number;
  // clubFee minus the even-split credit (never below 0) — the baseline a family
  // with no fundraising attributed to their child owes this season.
  effectiveFeePerPlayer: number;
  // Per-child total credit (their attributed fundraising, capped at the fee,
  // plus the even-split credit). playerId → dollars.
  creditByPlayer: Record<string, number>;
  // Per-child effective fee: clubFee minus that child's total credit, never
  // below 0. playerId → dollars. The source of truth for what each owes.
  effectiveFeeByPlayer: Record<string, number>;
}

// The P&L tiles + Collections math in one pass. `players` defines who owes
// the club fee; payments from kids no longer on the roster still count toward
// collected/balance (money is money) but add nothing to stillOwed.
export const financeSummary = (
  finances: TeamFinances | null | undefined,
  players: Array<{ id: string }> | null | undefined,
): FinanceSummary => {
  const fee = Math.max(0, money(finances?.clubFee));
  const paidByPlayer: Record<string, number> = {};
  let collected = 0;
  for (const pay of finances?.payments || []) {
    const amt = money(pay?.amount);
    collected += amt;
    const pid = String(pay?.playerId || "");
    if (pid) paidByPlayer[pid] = (paidByPlayer[pid] || 0) + amt;
  }
  const otherIncome = incomeTotal(finances);
  let spent = 0;
  for (const e of finances?.expenses || []) spent += money(e?.amount);
  // Fee-exempt players (fall pickups, scholarships) never owe the club fee.
  const exempt = new Set(finances?.feeExemptIds || []);
  const payers = (players || []).filter((p) => p?.id && !exempt.has(p.id));
  const payerIds = new Set(payers.map((p) => p.id));
  // Fundraising comes off dues — the money is already in the balance (it's
  // income), so it only shrinks what's still owed. Money attributed to a child
  // credits that kid's fee first (capped at the fee); the unattributed money
  // and any per-child surplus pool into an even split across all families.
  const { byPlayer: rawAttributed, unattributed } =
    fundraisingBreakdown(finances);
  const attributedCredit: Record<string, number> = {};
  let evenPool = unattributed;
  for (const [pid, rawAmt] of Object.entries(rawAttributed)) {
    if (!payerIds.has(pid)) {
      // Credited to an exempt or off-roster kid (no fee to offset) — the whole
      // amount rolls into the team's even split.
      evenPool += rawAmt;
      continue;
    }
    attributedCredit[pid] = Math.min(rawAmt, fee);
    evenPool += Math.max(0, rawAmt - fee); // surplus over the fee → team pool
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const duesCreditPerPlayer =
    payers.length > 0 ? round2(evenPool / payers.length) : 0;
  const effectiveFeePerPlayer = Math.max(0, fee - duesCreditPerPlayer);
  const creditByPlayer: Record<string, number> = {};
  const effectiveFeeByPlayer: Record<string, number> = {};
  let stillOwed = 0;
  for (const p of payers) {
    const credit = (attributedCredit[p.id] || 0) + duesCreditPerPlayer;
    creditByPlayer[p.id] = round2(credit);
    const eff = Math.max(0, fee - credit);
    effectiveFeeByPlayer[p.id] = eff;
    stillOwed += Math.max(0, eff - (paidByPlayer[p.id] || 0));
  }
  const balanceNow = collected + otherIncome - spent;
  return {
    collected,
    otherIncome,
    spent,
    balanceNow,
    stillOwed,
    balanceOnceAllPaid: balanceNow + stillOwed,
    paidByPlayer,
    duesCreditPerPlayer,
    effectiveFeePerPlayer,
    creditByPlayer,
    effectiveFeeByPlayer,
  };
};

// Dashboard-facing rollup of where the season's Team Fees stand, including
// the optional up-front deposit slice. Built on financeSummary so the money
// math (fundraising credit, fee-exempt players, partial payments) stays in
// one place. `depositOwed*` only matter when a deposit amount is configured.
export interface TeamFeesStatus {
  hasFee: boolean; // a club fee is configured (> 0)
  effectiveFee: number; // per-player fee after fundraising credit
  stillOwed: number; // Σ outstanding on the full fee
  fullOwedCount: number; // # paying families with any balance left
  depositAmount: number; // configured deposit slice (0 = none)
  depositOutstanding: number; // Σ of unmet deposit slices
  depositOwedCount: number; // # families who haven't met the deposit yet
  depositDueDate: string | null;
  feeDueDate: string | null;
}

export const teamFeesStatus = (
  finances: TeamFinances | null | undefined,
  players: Array<{ id: string }> | null | undefined,
): TeamFeesStatus => {
  const s = financeSummary(finances, players);
  const exempt = new Set(finances?.feeExemptIds || []);
  const payers = (players || []).filter((p) => p?.id && !exempt.has(p.id));
  // Deposit can't exceed a family's effective fee — a family that's met the fee
  // has met the deposit by definition. With per-child fundraising credit the
  // effective fee varies, so the deposit is capped per family.
  const baseDeposit = Math.max(0, money(finances?.depositAmount));
  let fullOwedCount = 0;
  let depositOwedCount = 0;
  let depositOutstanding = 0;
  for (const p of payers) {
    const paid = s.paidByPlayer[p.id] || 0;
    const eff = s.effectiveFeeByPlayer[p.id] ?? s.effectiveFeePerPlayer;
    if (eff - paid > 0) fullOwedCount++;
    const deposit = Math.min(baseDeposit, eff);
    if (deposit > 0) {
      const short = deposit - paid;
      if (short > 0) {
        depositOwedCount++;
        depositOutstanding += short;
      }
    }
  }
  // Headline deposit slice for display (capped at the baseline effective fee).
  const depositAmount = Math.min(baseDeposit, s.effectiveFeePerPlayer);
  return {
    hasFee: s.effectiveFeePerPlayer > 0,
    effectiveFee: s.effectiveFeePerPlayer,
    stillOwed: s.stillOwed,
    fullOwedCount,
    depositAmount,
    depositOutstanding: Math.round(depositOutstanding * 100) / 100,
    depositOwedCount,
    depositDueDate: finances?.depositDueDate || null,
    feeDueDate: finances?.feeDueDate || null,
  };
};

export interface LedgerRow {
  id: string;
  date: string;
  label: string;
  amount: number;
  direction: "in" | "out";
  // Which finances array this row lives in. Club-fee payments are managed
  // from Collections, so only income/expense rows are deletable in the ledger.
  source: "payment" | "income" | "expense";
  // Club balance after this transaction, walking everything received and
  // spent in date order (ties keep entry order: money in before money out).
  balanceAfter: number;
  // Income rows flagged as fundraising (they reduce per-player dues).
  fundraising?: boolean;
  // Display name of the child a fundraising row is credited to (when attributed
  // to a specific player); absent when it splits evenly.
  creditedTo?: string;
}

// One dated ledger of EVERYTHING received (club-fee payments, sponsorships,
// fundraising) and spent, with a running club balance. `players` resolves
// payment rows to kid names for display.
export const transactionLedger = (
  finances: TeamFinances | null | undefined,
  players?: Array<{ id: string; name?: string }> | null,
): LedgerRow[] => {
  const nameOf = (pid: string): string => {
    const p = (players || []).find((x) => x?.id === pid);
    return p?.name ? String(p.name) : "Player";
  };
  const rows: Array<Omit<LedgerRow, "balanceAfter">> = [];
  for (const pay of finances?.payments || []) {
    if (!pay) continue;
    rows.push({
      id: pay.id,
      date: String(pay.date || ""),
      label: `Team fee — ${nameOf(String(pay.playerId || ""))}`,
      amount: money(pay.amount),
      direction: "in",
      source: "payment",
    });
  }
  for (const inc of finances?.incomes || []) {
    if (!inc) continue;
    rows.push({
      id: inc.id,
      date: String(inc.date || ""),
      label: String(inc.label || "Income"),
      amount: money(inc.amount),
      direction: "in",
      source: "income",
      ...(inc.fundraising ? { fundraising: true } : {}),
      ...(inc.fundraising && inc.playerId
        ? { creditedTo: nameOf(String(inc.playerId)) }
        : {}),
    });
  }
  for (const exp of finances?.expenses || []) {
    if (!exp) continue;
    rows.push({
      id: exp.id,
      date: String(exp.date || ""),
      label: String(exp.label || "Expense"),
      amount: money(exp.amount),
      direction: "out",
      source: "expense",
    });
  }
  // Stable sort: date order; ties keep push order (in-rows precede out-rows).
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i)
    .map((x) => x.r);
  let running = 0;
  return sorted.map((r) => {
    running += r.direction === "in" ? r.amount : -r.amount;
    return { ...r, balanceAfter: running };
  });
};

// Roll the club's money into a new SEASON YEAR. The season year runs Fall →
// Spring, so this fires only when the season advances INTO a Fall
// (Spring→Fall); the mid-year Fall→Spring advance leaves finances running
// untouched. On a roll:
//   - the closing balance carries over (an opening "Carried over" income
//     entry — or an expense when the club ended in the red),
//   - the fee-collection cycle resets (payments clear; last year's checks
//     never look like this year's fees) and fee waivers clear with it,
//   - the Budget Planner's "next season's fee" is promoted to the active
//     club fee, and the budget plan is kept as the new season's reference,
//   - the year's totals are archived as a compact FinancePastSeason row.
// Pass-through when there's nothing recorded, so teams that never opened
// the Finances tab are untouched.
// Budget vs actual: how much has actually been spent against each Budget
// Planner category (expenses linked via budgetItemId), plus the unplanned
// bucket for everything spent outside the plan.
export const budgetActuals = (
  finances: TeamFinances | null | undefined,
): { byItem: Record<string, number>; unplanned: number } => {
  const ids = new Set((finances?.budgetItems || []).map((b) => b.id));
  const byItem: Record<string, number> = {};
  let unplanned = 0;
  for (const e of finances?.expenses || []) {
    const amt = money(e?.amount);
    const link = e?.budgetItemId;
    if (link && ids.has(link)) byItem[link] = (byItem[link] || 0) + amt;
    else unplanned += amt;
  }
  return { byItem, unplanned };
};

export interface YearComparisonRow {
  label: string;
  in: number; // collected fees + sponsorships/other income
  out: number;
  closing: number;
}

// Year-over-year money picture: every archived season (rolled at the Fall
// advance) plus the current year so far.
export const yearComparison = (
  finances: TeamFinances | null | undefined,
  players: Array<{ id: string }> | null | undefined,
): YearComparisonRow[] => {
  const rows: YearComparisonRow[] = (finances?.pastSeasons || []).map((ps) => ({
    label: String(ps?.season || ""),
    in: money(ps?.collected) + money(ps?.otherIncome),
    out: money(ps?.spent),
    closing: money(ps?.closingBalance),
  }));
  const s = financeSummary(finances, players);
  if (s.collected + s.otherIncome + s.spent > 0 || rows.length > 0) {
    rows.push({
      label: "This year",
      in: s.collected + s.otherIncome,
      out: s.spent,
      closing: s.balanceNow,
    });
  }
  return rows;
};

export interface CashflowMonth {
  month: string; // "2026-03"
  label: string; // "Mar"
  in: number;
  out: number;
  balanceEnd: number;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Monthly money in / money out / end-of-month balance, derived from the
// dated transaction ledger (already sorted with a running balance). Months
// with no activity between the first and last are filled in so the chart
// has a continuous axis.
export const monthlyCashflow = (
  finances: TeamFinances | null | undefined,
  players?: Array<{ id: string; name?: string }> | null,
): CashflowMonth[] => {
  const rows = transactionLedger(finances, players).filter((r) =>
    /^\d{4}-\d{2}/.test(r.date),
  );
  if (rows.length === 0) return [];
  const byMonth = new Map<string, CashflowMonth>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    let m = byMonth.get(month);
    if (!m) {
      const mi = Math.max(0, Math.min(11, parseInt(month.slice(5, 7), 10) - 1));
      m = { month, label: MONTH_LABELS[mi], in: 0, out: 0, balanceEnd: 0 };
      byMonth.set(month, m);
    }
    if (r.direction === "in") m.in += r.amount;
    else m.out += r.amount;
    m.balanceEnd = r.balanceAfter; // rows arrive in date order
  }
  // Fill silent months so the axis is continuous, carrying the balance.
  const keys = [...byMonth.keys()].sort();
  const out: CashflowMonth[] = [];
  let [y, mo] = keys[0].split("-").map((x) => parseInt(x, 10));
  const last = keys[keys.length - 1];
  let carry = 0;
  for (;;) {
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    const m = byMonth.get(key);
    if (m) {
      out.push(m);
      carry = m.balanceEnd;
    } else {
      out.push({
        month: key,
        label: MONTH_LABELS[mo - 1],
        in: 0,
        out: 0,
        balanceEnd: carry,
      });
    }
    if (key === last) break;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
    if (out.length > 36) break; // safety: never build an unbounded axis
  }
  return out;
};

// One-tap dues reminder: a copyable list of every family that still owes,
// skipping waived and settled players, with the total at the end.
export const owesReminderText = (
  finances: TeamFinances | null | undefined,
  players: Array<{ id: string; name?: string }> | null | undefined,
  season?: string,
): string => {
  const s = financeSummary(finances, players);
  const exempt = new Set(finances?.feeExemptIds || []);
  const lines: string[] = [];
  for (const p of players || []) {
    if (!p?.id || exempt.has(p.id)) continue;
    // Fundraising credit already applied: each family owes their effective fee
    // (which varies when fundraising is credited to specific children).
    const fee = s.effectiveFeeByPlayer[p.id] ?? s.effectiveFeePerPlayer;
    const owed = Math.max(0, fee - (s.paidByPlayer[p.id] || 0));
    if (owed > 0) lines.push(`${p.name || "Player"}: ${formatCurrency(owed)}`);
  }
  if (lines.length === 0) return "All team fees are paid in full. 🎉";
  const header = `Team fee reminder${season ? ` — ${season}` : ""} (fee ${formatCurrency(
    s.effectiveFeePerPlayer,
  )}${
    s.duesCreditPerPlayer > 0
      ? ` after ${formatCurrency(s.duesCreditPerPlayer)} fundraising credit`
      : ""
  }):`;
  return [
    header,
    ...lines,
    `Total outstanding: ${formatCurrency(s.stillOwed)}`,
  ].join("\n");
};

// Full ledger as a spreadsheet for records/treasurer handoff.
export const ledgerCsv = (
  finances: TeamFinances | null | undefined,
  players?: Array<{ id: string; name?: string }> | null,
): string => {
  const esc = (val: unknown): string => {
    const str = String(val ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const rows = transactionLedger(finances, players).map((r) =>
    [
      esc(r.date),
      esc(r.label),
      r.direction === "in" ? r.amount.toFixed(2) : "",
      r.direction === "out" ? r.amount.toFixed(2) : "",
      r.balanceAfter.toFixed(2),
    ].join(","),
  );
  return ["Date,Entry,In,Out,Balance", ...rows].join("\n");
};

export const rollFinancesForNewSeason = (
  finances: TeamFinances | null | undefined,
  archivedSeason: string,
  dateIso: string,
): TeamFinances | null | undefined => {
  const hadActivity =
    (finances?.payments || []).length > 0 ||
    (finances?.incomes || []).length > 0 ||
    (finances?.expenses || []).length > 0;
  const hasPlannedFee = finances?.nextClubFee != null;
  const hasPlannedDeposit =
    finances?.nextDepositAmount != null || !!finances?.nextDepositDueDate;
  if (!finances || (!hadActivity && !hasPlannedFee && !hasPlannedDeposit))
    return finances;
  const date = String(dateIso || "").slice(0, 10);
  // Sponsorship pledges planned for the incoming year become real income
  // entries in the new year's ledger, named after the sponsor.
  const pledgedIncomes = (finances.sponsorships || [])
    .filter((sp) => money(sp?.amount) > 0)
    .map((sp) => ({
      id: `inc-${sp.id}`,
      date,
      label: `Sponsorship — ${sp.sponsor || "Sponsor"}`,
      amount: money(sp.amount),
    }));
  if (!hadActivity) {
    // Plan-only roll: the coach set next season's fee before recording any
    // money. Promote it so Fall Collections opens on the planned fee; there
    // is no balance to carry and no year worth archiving.
    const {
      nextClubFee: promoted,
      nextDepositAmount: promotedDeposit,
      nextDepositDueDate: promotedDepositDueDate,
      feeExemptIds: _cleared,
      sponsorships: _converted,
      ...rest
    } = finances;
    return {
      ...rest,
      clubFee: promoted != null ? promoted : finances.clubFee,
      depositAmount:
        promotedDeposit != null ? promotedDeposit : finances.depositAmount,
      depositDueDate: promotedDepositDueDate || finances.depositDueDate,
      payments: [],
      incomes: pledgedIncomes,
      expenses: [],
    };
  }
  // Label the archived year by its closing season ("through Spring 2027").
  const yearLabel = `through ${archivedSeason}`;
  // stillOwed isn't part of the carry-over (unpaid fees die with the year),
  // so the players list is irrelevant here.
  const s = financeSummary(finances, []);
  const balance = Math.round(s.balanceNow * 100) / 100;
  const carryId = `carry-${date}-${Math.random().toString(36).slice(2, 8)}`;
  const incomes = [
    ...(balance > 0
      ? [
          {
            id: carryId,
            date,
            label: `Carried over (${yearLabel})`,
            amount: balance,
          },
        ]
      : []),
    ...pledgedIncomes,
  ];
  const expenses =
    balance < 0
      ? [
          {
            id: carryId,
            date,
            label: `Debt carried over (${yearLabel})`,
            amount: Math.abs(balance),
          },
        ]
      : [];
  const {
    nextClubFee: _promoted,
    nextDepositAmount: _promotedDeposit,
    nextDepositDueDate: _promotedDepositDueDate,
    feeExemptIds: _cleared,
    sponsorships: _rolled,
    ...rest
  } = finances;
  return {
    ...rest,
    clubFee:
      finances.nextClubFee != null ? finances.nextClubFee : finances.clubFee,
    depositAmount:
      finances.nextDepositAmount != null
        ? finances.nextDepositAmount
        : finances.depositAmount,
    depositDueDate: finances.nextDepositDueDate || finances.depositDueDate,
    payments: [],
    incomes,
    expenses,
    pastSeasons: [
      ...(finances.pastSeasons || []),
      {
        season: yearLabel,
        collected: s.collected,
        otherIncome: s.otherIncome,
        spent: s.spent,
        closingBalance: balance,
      },
    ],
  };
};

// ---------- Team-list safety (user settings doc) ----------

export type TeamListEntry = { id: string; name?: string };

// Union several {id, name} team lists into one, preserving first-seen order
// and never dropping an id. Every writer of the user-settings `teams` array
// (create team, join by code, bootstrap) MUST build its payload through this
// from the server's current list — writing `[...localTeams, newEntry]` from
// React state was how a transiently-empty list overwrote the settings doc and
// orphaned a coach's real team ("all my players were deleted").
export const mergeTeamEntries = (
  ...lists: Array<TeamListEntry[] | null | undefined>
): { id: string; name: string }[] => {
  const out: { id: string; name: string }[] = [];
  const indexById = new Map<string, number>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const id = entry && typeof entry.id === "string" ? entry.id.trim() : "";
      if (!id) continue;
      const name =
        entry && typeof entry.name === "string" ? entry.name.trim() : "";
      const at = indexById.get(id);
      if (at === undefined) {
        indexById.set(id, out.length);
        out.push({ id, name });
      } else if (name && !out[at].name) {
        out[at] = { id, name };
      }
    }
  }
  return out.map((e) => ({ id: e.id, name: e.name || "My Team" }));
};

// Roster-wipe guard for team-doc writes. Returns a human-readable reason when
// a write carrying an EMPTY players array must be blocked, or null when the
// write is safe. Empty-roster writes are only ever legitimate when the team's
// doc has actually loaded on this device AND the loaded roster is already
// empty — anything else is a placeholder/default leaking into a save (the
// data-loss class of bug) and gets refused. Deliberate destructive flows
// (Advance Season, backup restore) opt out explicitly at the call site.
export const blockedRosterWipeReason = (
  updates: { players?: unknown },
  currentPlayers: unknown,
  teamLoaded: boolean,
): string | null => {
  if (!Array.isArray(updates.players) || updates.players.length > 0)
    return null;
  if (!teamLoaded)
    return "this team's data hasn't finished loading on this device yet";
  const prev = Array.isArray(currentPlayers) ? currentPlayers : [];
  if (prev.length === 0) return null;
  return `it would erase ${prev.length} player${prev.length === 1 ? "" : "s"}`;
};
