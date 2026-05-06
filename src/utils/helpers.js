// Pure helpers (formatting, parsing) extracted from App.jsx Section 3.

export const formatStat = (val) => {
  if (val === undefined || val === null || val === "") return ".000";
  const str = (Number(val) || 0).toFixed(3);
  return str.startsWith("0.") ? str.substring(1) : str;
};

// Normalize a date string to YYYY-MM-DD (the format `<input type="date">`
// requires). Handles common imports: ISO (2026-04-27), US slash (04/27/2026
// or 4/27/26), ISO with time (2026-04-27T...). Returns "" if unparseable.
export const normalizeDateToIso = (dateString) => {
  if (!dateString || typeof dateString !== "string") return "";
  const trimmed = dateString.trim();
  if (!trimmed) return "";
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const isoLooseMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoLooseMatch) {
    const y = isoLooseMatch[1];
    const m = isoLooseMatch[2].padStart(2, "0");
    const d = isoLooseMatch[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, "0");
    const d = slashMatch[2].padStart(2, "0");
    let y = slashMatch[3];
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? "19" : "20") + y;
    return `${y}-${m}-${d}`;
  }
  // Last-resort fallback: ambiguous dates may misread due to timezones.
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return "";
};

export const formatGameDateDisplay = (dateString) => {
  if (!dateString) return "";
  const iso = normalizeDateToIso(dateString);
  if (!iso) return dateString;
  try {
    const [y, m, d] = iso.split("-");
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
};

// Slim helpers: strip embedded player objects in saved lineups down to the
// minimum needed for display (id + name + number). Full player data lives on
// team.players and is rehydrated by lookup. Keeps Firestore docs under 1MB.
export const slimPlayer = (p) =>
  p ? { id: p.id, name: p.name, number: p.number } : null;

export const slimInning = (inning) => {
  if (!inning || typeof inning !== "object") return inning;
  const out = {};
  for (const pos in inning) {
    if (pos === "BENCH") {
      out.BENCH = (inning.BENCH || []).map(slimPlayer).filter(Boolean);
    } else {
      out[pos] = slimPlayer(inning[pos]);
    }
  }
  return out;
};

export const slimGame = (g) => {
  if (!g) return g;
  let next = g;
  if (Array.isArray(g.lineup)) {
    next = { ...next, lineup: g.lineup.map(slimInning) };
  }
  if (Array.isArray(g.battingLineup)) {
    next = {
      ...next,
      battingLineup: g.battingLineup.map(slimPlayer).filter(Boolean),
    };
  }
  if (Array.isArray(g.originalLineup)) {
    next = {
      ...next,
      originalLineup: g.originalLineup.map(slimInning),
    };
  }
  return next;
};

// Recursively remove undefined values from an object/array tree. Firestore
// rejects documents containing undefined (only null and missing keys are
// valid). Scrub the data right before save.
export const scrubUndefined = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(scrubUndefined).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    if (value.constructor && value.constructor !== Object) return value;
    const out = {};
    for (const k in value) {
      const cleaned = scrubUndefined(value[k]);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
};

export const buildSeasonBenchImbalance = (games, currentGameId) => {
  const out = new Map();
  for (const g of games || []) {
    if (g.id === currentGameId) continue;
    if (g.status && g.status !== "final") continue;
    if (!g.lineup?.length) continue;

    const attending = new Set();
    for (const inning of g.lineup) {
      for (const pos in inning) {
        if (pos === "BENCH") continue;
        const p = inning[pos];
        if (p) attending.add(p.id);
      }
      for (const bp of inning.BENCH || []) {
        if (g.attendance?.[bp.id] === false) continue;
        attending.add(bp.id);
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

    const benchCount = new Map();
    for (const id of attending) benchCount.set(id, 0);
    for (const inning of g.lineup) {
      for (const bp of inning.BENCH || []) {
        if (g.attendance?.[bp.id] === false) continue;
        if (benchCount.has(bp.id)) {
          benchCount.set(bp.id, benchCount.get(bp.id) + 1);
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

export const calculateBaseballAge = (dob, currentSeasonStr) => {
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

export const parseCsvLine = (text) => {
  const result = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && inQuotes && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) {
      result.push(cell);
      cell = "";
    } else cell += char;
  }
  result.push(cell.trim());
  return result;
};

export const buildCsvHeaderIndex = (headers) => {
  const find = (...keys) => {
    for (const k of keys) {
      const i = headers.indexOf(k);
      if (i !== -1) return i;
    }
    return -1;
  };
  const findContains = (substring) =>
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

export const parsePercent = (val) => {
  if (!val) return 0;
  const raw = parseFloat(String(val).replace("%", ""));
  if (Number.isNaN(raw)) return 0;
  return raw > 1 ? raw / 100 : raw;
};

// Parse a GameChanger past-season CSV. Returns { rows, error }.
export const parseGameChangerPastSeasonCsv = (text) => {
  text = (text || "").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: "File appears to be empty.", rows: [] };

  let headerRowIndex = 0;
  const firstRow = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const filledFirstRow = firstRow.filter(Boolean).length;
  const hasSectionLabels = firstRow.some((h) =>
    ["batting", "pitching", "fielding"].includes(h)
  );
  if (hasSectionLabels && filledFirstRow < firstRow.length / 3)
    headerRowIndex = 1;

  const rawHeaders = parseCsvLine(lines[headerRowIndex]).map((h) =>
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

  const rows = [];
  const dataStart = headerRowIndex + 1;
  for (let i = dataStart; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
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

    const stats = {};
    const setNum = (key, colIdx) => {
      if (colIdx === -1) return;
      const raw = cols[colIdx];
      if (raw === undefined || raw === "" || raw === "-") return;
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) stats[key] = n;
    };
    const setInt = (key, colIdx) => {
      if (colIdx === -1) return;
      const raw = cols[colIdx];
      if (raw === undefined || raw === "" || raw === "-") return;
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) stats[key] = n;
    };
    const setPct = (key, colIdx) => {
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
    rows.push({
      csvName: name,
      number: idx.num !== -1 ? cols[idx.num] || "" : "",
      stats,
    });
  }
  return { rows };
};

// Suggest a likely match between a CSV row name and existing players.
export const suggestPlayerMatch = (csvName, players) => {
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
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

export const blankStats = () => ({
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
