// Pure helpers (formatting, parsing) extracted from App.jsx Section 3.

import {
  CsvImportResult,
  Game,
  Inning,
  Player,
  PlayerId,
  PlayerStats,
  SlimPlayer,
} from "../types";
import { genId } from "./id";
// genId lives in its own leaf module (see utils/id.ts) so utils/finances.ts
// can share it without an import cycle; re-exported here so the many existing
// `import { ... } from "../utils/helpers"` call sites keep working.
export { genId };
import { APP_NAME } from "../constants/ui";

// Date / calendar helpers now live in ./dates. Imported here so the many
// in-module callers keep working, and re-exported so existing
// `from "./helpers"` import sites are unchanged.
import {
  normalizeDateToIso,
  formatGameDateDisplay,
  formatDateDisplay,
  calculateBaseballAge,
  buildMonthGrid,
  dateToIsoLocal,
  isoToLocalDate,
  MS_PER_DAY,
} from "./dates";
export {
  normalizeDateToIso,
  formatGameDateDisplay,
  formatDateDisplay,
  calculateBaseballAge,
  buildMonthGrid,
  dateToIsoLocal,
};

// Availability / scheduled-absence helpers now live in ./availability,
// re-exported so existing `from "./helpers"` import sites are unchanged.
export {
  availabilityBlockOverlapsEvent,
  isPlayerScheduledOut,
  addAbsenceDateRange,
  removeAbsenceDates,
  foldAbsenceRanges,
  isDepartedPlayer,
  countAvailableOnDate,
  isShortHandedOnDate,
  playersOutOnDate,
} from "./availability";

// Game-status predicates now live in ./gameStatus (imported for the many
// in-module callers, re-exported for existing import sites).
import { isGameFinalized, countsTowardStats } from "./gameStatus";
export { isGameFinalized, countsTowardStats };

// Schedule .ics export now lives in ./ics, re-exported here.
export { buildScheduleIcs } from "./ics";

// CSV import + game-line aggregation now live in ./stats. Three CSV parsers
// are used by parseGameChangerPastSeasonCsv (below), so import those; the
// rest are pure re-exports for existing import sites.
import {
  parseCsvRecords,
  buildCsvHeaderIndex,
  extractAdvancedStats,
  parsePercent,
} from "./stats";
export { parseCsvRecords, buildCsvHeaderIndex, extractAdvancedStats };
export {
  buildStatsPatchFromCsvRow,
  parseGameChangerStatsCsv,
  stripPitchingStatsForFormat,
  aggregateGameLines,
  teamStatAverages,
  deriveSeasonFromGameLines,
  latestGameLineMovement,
  seasonSeriesFromGameLines,
  recentGameLines,
} from "./stats";
export type { CsvHeaderIndex } from "./stats";

// Season reports + returning-status helpers now live in ./season,
// re-exported so existing `from "./helpers"` import sites are unchanged.
export {
  buildSeasonBenchImbalance,
  buildSeasonPositionVariety,
  recordWinningPercentage,
  compareRecordsByWinningPercentage,
  buildSeasonSummary,
  isReturning,
  getReturningDecision,
} from "./season";

// Tryouts / public-mirror / player-info helpers now live in ./tryouts,
// re-exported so existing `from "./helpers"` import sites are unchanged.
export {
  dedupePlayerInfoSubmissions,
  normalizeTryoutDateLinks,
  resolveTryoutDateForSlug,
  buildPublicMirror,
  normalizeTryoutSessions,
  combinedTryoutGradeForSignup,
  evaluatorTryoutGradeForSignup,
} from "./tryouts";
export type { TryoutDateLink, PublicTeamMirror } from "./tryouts";

// Evaluation cadence / seeding / reminder-email helpers now live in
// ./evaluations, re-exported here.
export {
  evalStatHint,
  evalDueDatesForYear,
  evalPromptStatus,
  evalRoundDateForSave,
  restampEvalDueDates,
  evalRoundRecency,
  buildPreseasonSeedRound,
  emailPromptStatus,
} from "./evaluations";
export type { EvalPromptStatus, EmailPromptStatus } from "./evaluations";
export type {
  BenchImbalanceEntry,
  PositionVarietyEntry,
  TeamRecordLike,
  SeasonSummary,
  ReturningDecision,
} from "./season";

export const formatStat = (val: unknown): string => {
  if (val === undefined || val === null || val === "") return ".000";
  const str = (Number(val) || 0).toFixed(3);
  return str.startsWith("0.") ? str.substring(1) : str;
};

// Cryptographically-strong random string over an explicit alphabet. Uses
// rejection sampling so every character is uniformly distributed — a naive
// `byte % alphabet.length` skews toward the first `256 % len` characters.
// Used for the team join code (which gates self-join) and tryout share tokens,
// so they shouldn't be predictable from a weak PRNG. Falls back to Math.random
// only if Web Crypto is unavailable (it isn't in any supported browser).
export const randomCode = (length: number, alphabet: string): string => {
  if (length <= 0 || !alphabet) return "";
  const cryptoObj =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    let out = "";
    for (let i = 0; i < length; i++)
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }
  // Largest multiple of alphabet.length that fits in a byte; bytes at or above
  // it are rejected to keep the distribution uniform.
  const limit = 256 - (256 % alphabet.length);
  const buf = new Uint8Array(length);
  let out = "";
  while (out.length < length) {
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      if (buf[i] < limit) out += alphabet[buf[i] % alphabet.length];
    }
  }
  return out;
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

// True when a SlimPlayer (or any { id, name } slot from game.lineup or a
// bench list) refers to the given roster player. Primary check is on
// id; fallback handles the orphan-id case where a roster player was
// deleted and re-added with a fresh id — past finalized games' lineups
// still carry the old id baked into the snapshot. We only fall through
// to name match when the slot's id is NOT in the current roster
// (`livePlayerIds`); two siblings who share a first+last name and are
// both still on the roster stay correctly distinguished by their
// live ids.

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

// Team finances (money math) live in ./finances; re-exported here so existing
// `import { ... } from "../utils/helpers"` call sites keep resolving.
export * from "./finances";

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
