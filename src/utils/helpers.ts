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
const padDatePart = (value: string | number): string => String(value).padStart(2, "0");

const isValidDateParts = (year: number, month: number, day: number): boolean => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
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
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
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

export const formatGameDateDisplay = (dateString: string | null | undefined): string => {
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
export const slimPlayer = (p: Partial<Player> | null | undefined): SlimPlayer =>
  p && p.id ? { id: p.id, name: p.name || "", number: p.number } : null;

export const slimInning = (inning: Inning | null | undefined): Inning | null | undefined => {
  if (!inning || typeof inning !== "object") return inning;
  const out: Inning = {};
  for (const pos in inning) {
    if (pos === "BENCH") {
      out.BENCH = (inning.BENCH || []).map((p) => slimPlayer(p as Partial<Player>)).filter(Boolean) as SlimPlayer[];
    } else {
      out[pos] = slimPlayer(inning[pos] as Partial<Player> | null | undefined);
    }
  }
  return out;
};

export const slimGame = <T extends Partial<Game>>(g: T | null | undefined): T | null | undefined => {
  if (!g) return g;
  let next: T = g;
  if (Array.isArray(g.lineup)) {
    next = { ...next, lineup: g.lineup.map(slimInning) } as T;
  }
  if (Array.isArray(g.battingLineup)) {
    next = {
      ...next,
      battingLineup: g.battingLineup.map((p) => slimPlayer(p as Partial<Player>)).filter(Boolean),
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
}

export const buildPublicMirror = (
  team: Record<string, any> | null | undefined
): PublicTeamMirror => ({
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
});

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
  players?: Array<{ id?: string; name?: string }> | null
): Map<PlayerId, BenchImbalanceEntry> => {
  const out = new Map<PlayerId, BenchImbalanceEntry>();

  // Resolve a lineup-snapshot slot's id to the CURRENT roster id. Past
  // finalized games bake the id a player had at the time into their
  // lineup; if that player was deleted and re-added they now carry a
  // fresh id, so accumulating by the raw snapshot id strands all of
  // their pre-deletion bench/defense history under an orphan key the
  // tile's `imbalance.get(p.id)` lookup never matches. We coalesce by
  // name (same id-with-name fallback as lineupSlotMatchesPlayer) so the
  // re-added player's full season shows up. Two live players who share
  // a name stay distinct: the name fallback only fires for ids that are
  // NOT on the current roster.
  const roster = players || [];
  const livePlayerIds = new Set(
    roster.map((p) => p.id).filter((id): id is string => !!id)
  );
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const resolveSlotId = (
    slot: { id?: string; name?: string } | null | undefined
  ): string | undefined => {
    if (!slot || !slot.id) return slot?.id;
    if (livePlayerIds.has(slot.id)) return slot.id;
    const slotName = norm(slot.name);
    if (slotName) {
      const match = roster.find((p) => p.id && norm(p.name) === slotName);
      if (match?.id) return match.id;
    }
    return slot.id;
  };

  for (const g of games || []) {
    if (g.id === currentGameId) continue;
    // Route through the shared isGameFinalized() so legacy games with
    // status === "completed" (from earlier app builds) are counted —
    // the previous `g.status && g.status !== "final"` filter silently
    // skipped them and coaches saw the Bench Equity tile miss past
    // finalized games.
    if (!isGameFinalized(g)) continue;
    if (!g.lineup?.length) continue;

    const attending = new Set<PlayerId>();
    for (const inning of g.lineup) {
      for (const pos in inning) {
        if (pos === "BENCH") continue;
        const p = inning[pos] as SlimPlayer | undefined;
        if (p) {
          const rid = resolveSlotId(p);
          if (rid) attending.add(rid);
        }
      }
      for (const bp of inning.BENCH || []) {
        if (!bp) continue;
        if (g.attendance?.[bp.id] === false) continue;
        const rid = resolveSlotId(bp);
        if (rid) attending.add(rid);
      }
    }
    const playerCount = attending.size;
    if (playerCount === 0) continue;

    const benchSlotsPerInning = (g.lineup[0]?.BENCH || []).length;
    const innings = g.lineup.length;
    const fieldersPerInning = innings > 0
      ? Object.keys(g.lineup[0] || {}).filter((k) => k !== "BENCH").length
      : 0;
    const totalBenchSlots = benchSlotsPerInning * innings;
    const minBenchPerPlayer = Math.floor(totalBenchSlots / playerCount);
    const totalDefenseSlots = fieldersPerInning * innings;
    const expectedDefensePerPlayer = totalDefenseSlots / playerCount;

    const benchCount = new Map<PlayerId, number>();
    for (const id of attending) benchCount.set(id, 0);
    for (const inning of g.lineup) {
      for (const bp of inning.BENCH || []) {
        if (!bp) continue;
        if (g.attendance?.[bp.id] === false) continue;
        const rid = resolveSlotId(bp);
        if (rid && benchCount.has(rid)) {
          benchCount.set(rid, (benchCount.get(rid) || 0) + 1);
        }
      }
    }

    for (const [pid, count] of benchCount) {
      const cur =
        out.get(pid) || {
          extraSits: 0,
          totalBench: 0,
          totalDefense: 0,
          expectedDefense: 0,
          gamesAttended: 0,
        };
      cur.extraSits += Math.max(0, count - minBenchPerPlayer);
      cur.totalBench += count;
      cur.totalDefense += innings - count;
      cur.expectedDefense += expectedDefensePerPlayer;
      cur.gamesAttended += 1;
      out.set(pid, cur);
    }
  }
  return out;
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
  player: { returning?: boolean; playerStatus?: string } | null | undefined
): boolean => {
  if (!player) return false;
  if (player.returning === false) return false;
  if (player.returning === true) return true;
  if (player.playerStatus === "released" || player.playerStatus === "declined") {
    return false;
  }
  return true;
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
    | undefined
): boolean => {
  if (!game) return false;
  if (game.status === "final" || game.status === "completed") return true;
  const ts = game.teamScore;
  const os = game.opponentScore;
  if (ts == null || ts === "" || os == null || os === "") return false;
  return Number.isFinite(Number(ts)) && Number.isFinite(Number(os));
};

export const lineupSlotMatchesPlayer = (
  slot: { id?: string; name?: string } | null | undefined,
  player: { id?: string; name?: string } | null | undefined,
  livePlayerIds: Set<string>
): boolean => {
  if (!slot || !player) return false;
  if (slot.id && player.id && slot.id === player.id) return true;
  // Refuse the name-match fallback unless the slot's id is genuinely
  // orphan (no longer on the roster). This prevents accidental
  // collisions when two live players happen to share a name.
  if (slot.id && livePlayerIds.has(slot.id)) return false;
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const slotName = norm(slot.name);
  const playerName = norm(player.name);
  if (!slotName || !playerName) return false;
  return slotName === playerName;
};

export const calculateBaseballAge = (
  dob: string | null | undefined,
  currentSeasonStr: string | null | undefined
): number | null => {
  if (!dob) return null;
  const parts = (currentSeasonStr || "").split(" ");
  let seasonYear = new Date().getFullYear();
  if (parts.length > 1) {
    seasonYear = parseInt(parts[parts.length - 1], 10);
    if (parts[0].toLowerCase() === "fall") seasonYear += 1;
  }
  const dobDate = new Date(dob);
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

export const parsePercent = (val: unknown): number => {
  if (!val) return 0;
  const raw = parseFloat(String(val).replace("%", ""));
  if (Number.isNaN(raw)) return 0;
  return raw > 1 ? raw / 100 : raw;
};

// Parse a GameChanger past-season CSV. Returns { rows, error }.
export const parseGameChangerPastSeasonCsv = (text: string): CsvImportResult => {
  const csvRows = parseCsvRecords(text);
  if (csvRows.length < 2) return { error: "File appears to be empty.", rows: [] };

  let headerRowIndex = 0;
  const firstRow = csvRows[0].map((h) => h.toLowerCase().trim());
  const filledFirstRow = firstRow.filter(Boolean).length;
  const hasSectionLabels = firstRow.some((h) =>
    ["batting", "pitching", "fielding"].includes(h)
  );
  if (hasSectionLabels && filledFirstRow < firstRow.length / 3)
    headerRowIndex = 1;

  const rawHeaders = csvRows[headerRowIndex].map((h) =>
    h.toLowerCase().trim()
  );
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
  players: Player[]
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

export type EvalPromptKind = "preseason" | "biweekly";

export interface EvalPromptStatus {
  active: boolean;
  kind: EvalPromptKind | null;
  lastSubmittedDate: string | null;
  // ISO date string of next due window when not currently active.
  nextDueDate: string | null;
  // Days until next eval is due (null when active). Negative when overdue.
  daysUntilDue: number | null;
}

const dateToIsoLocal = (d: Date): string => {
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
  now: Date = new Date()
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
    .filter(
      (e) =>
        e.coachRole === coachRole && e.evaluatorId === userUid
    )
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
    const deltaDays = Math.floor(
      (now.getTime() - due.getTime()) / MS_PER_DAY
    );
    // Window is [due - WINDOW, due + WINDOW]. The prompt is fulfilled once the
    // coach files an eval anywhere inside that window — including the days
    // *before* the due date — so the reminder clears as soon as they catch up
    // instead of lingering until the due date physically passes. A later
    // submission (next round already in) counts too, hence the open-ended `>=`.
    const alreadyHit =
      lastSubmittedDate &&
      Math.round(
        (isoToLocalDate(lastSubmittedDate).getTime() - due.getTime()) /
          MS_PER_DAY
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
    const isPreseason =
      activeDue.getMonth() === 1 && activeDue.getDate() === 1;
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
    : Math.ceil(
        (upcomingDue.getTime() - now.getTime()) / MS_PER_DAY
      );
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
  }
>(
  events: T[] | null | undefined
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
  now: Date = new Date()
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
  now: Date = new Date()
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
      (isoToLocalDate(iso).getTime() - todayLocal.getTime()) / MS_PER_DAY
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
    dt.getUTCDate()
  )}`;
};

const icsStamp = (now: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate()
  )}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(
    now.getUTCSeconds()
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
  now: Date = new Date()
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
      "END:VEVENT"
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

export interface PitchingOuting {
  date: string;
  pitches: number;
}

const PITCHING_LOG_CAP = 12;

// Pure: returns a new `pitching` object with recentPitches/lastPitchDate set to
// the given outing (unchanged semantics) and the outing recorded in `log`.
export const recordPitchingOuting = (
  pitching: Record<string, any> | null | undefined,
  date: string,
  pitches: number
): Record<string, any> => {
  const base = pitching || {};
  const prior: PitchingOuting[] = Array.isArray(base.log)
    ? base.log.filter((o: any) => o && o.date && o.date !== date)
    : [];
  const log = [...prior, { date, pitches }]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, PITCHING_LOG_CAP);
  return { ...base, recentPitches: pitches, lastPitchDate: date, log };
};
