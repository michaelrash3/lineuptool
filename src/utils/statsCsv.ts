// Parse ONE GameChanger stats CSV (a single game's box score, or a season
// export) into per-player stat lines. Pure — returns the parsed lines (matched
// to roster players by the caller). Reuses the same column detection the legacy
// importer used, so it understands both the basic single-section export and the
// two-row Batting/Pitching/Fielding layout (advanced p*/f* stats).

import type { PlayerStats } from "../types";
import {
  parseCsvRecords,
  buildCsvHeaderIndex,
  extractAdvancedStats,
  parsePercent,
} from "./helpers";

export interface ParsedStatLine {
  name: string;
  stats: PlayerStats;
}
export interface ParseStatsResult {
  lines: ParsedStatLine[];
  error?: string;
}

export const parseGameChangerStatsCsv = (text: string): ParseStatsResult => {
  let rows: string[][];
  try {
    rows = parseCsvRecords(String(text || "").replace(/^﻿/, ""));
  } catch {
    return { lines: [], error: "Couldn't read the CSV file." };
  }
  if (rows.length < 2) return { lines: [], error: "The file looks empty." };

  // GameChanger's two-row export: row 0 is "Batting"/"Pitching"/"Fielding"
  // section labels (mostly empty), row 1 the real headers.
  const firstRow = rows[0].map((h) => h.toLowerCase().trim());
  const filledFirstRow = firstRow.filter(Boolean).length;
  const hasSectionLabels = firstRow.some((h) =>
    ["batting", "pitching", "fielding"].includes(h)
  );
  const headerRowIndex =
    hasSectionLabels && filledFirstRow < firstRow.length / 3 ? 1 : 0;
  const rawHeaders = rows[headerRowIndex].map((h) => h.toLowerCase().trim());
  const labelRow = headerRowIndex === 1 ? firstRow : undefined;
  const idx = buildCsvHeaderIndex(rawHeaders);

  if (idx.fn === -1 && idx.ln === -1)
    return { lines: [], error: "Couldn't find player name columns." };
  const isGameChanger = idx.ops !== -1 || idx.avg !== -1 || idx.ab !== -1;
  if (!isGameChanger)
    return {
      lines: [],
      error:
        "This doesn't look like a GameChanger stats export (no OPS/AVG/AB columns).",
    };

  const lines: ParsedStatLine[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const cols = rows[i];
    const fn = (idx.fn !== -1 ? cols[idx.fn] : "").trim();
    const ln = (idx.ln !== -1 ? cols[idx.ln] : "").trim();
    const name = `${fn} ${ln}`.trim();
    if (!name) continue;
    // Skip GameChanger summary/footer rows.
    const lcFn = fn.toLowerCase();
    const lcLn = ln.toLowerCase();
    if (lcFn === "totals" || lcLn === "totals" || lcFn === "glossary" || lcLn === "glossary" || !ln)
      continue;

    const stats: Record<string, number> = {};
    const setNum = (key: string, colIdx: number) => {
      if (colIdx === -1) return;
      const raw = cols[colIdx];
      if (raw === undefined || raw === "" || raw === "-") return;
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) stats[key] = n;
    };
    const setInt = (key: string, colIdx: number) => {
      if (colIdx === -1) return;
      const raw = cols[colIdx];
      if (raw === undefined || raw === "" || raw === "-") return;
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) stats[key] = n;
    };
    const setPct = (key: string, colIdx: number) => {
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
    lines.push({ name, stats: stats as PlayerStats });
  }

  if (lines.length === 0)
    return { lines: [], error: "No player stat rows found in the file." };
  return { lines };
};
