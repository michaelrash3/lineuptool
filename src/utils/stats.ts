// GameChanger CSV import + game-line stat aggregation, extracted from
// helpers.ts. Self-contained: pure parsing/aggregation over the stat shapes,
// with no dependency on the rest of the helpers grab-bag.

import type { PlayerStats, CsvImportResult } from "../types";

// Parse a percentage-ish cell ("75%", "0.75", "75") into a 0..1 fraction.
export const parsePercent = (val: unknown): number => {
  if (!val) return 0;
  const raw = parseFloat(String(val).replace("%", ""));
  if (Number.isNaN(raw)) return 0;
  return raw > 1 ? raw / 100 : raw;
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
