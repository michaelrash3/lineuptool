// Shared column definitions + stat formatting for the Stats tab and its
// exports (CSV, stats-report PDF), so every surface renders the same numbers
// the same way. Moved verbatim from StatsTab — behavior is unchanged.

import type { PlayerStats } from "../types";

export type Kind = "int" | "dec1" | "dec3" | "dec2" | "pct" | "ip";

export const numOf = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

// Format a stat the way the rest of the app does: drop the leading 0 on sub-1
// rate stats (.345), percents from 0–1 fractions, IP as 5.2 = 5⅔.
export const fmt = (n: number | undefined, kind: Kind): string => {
  if (n === undefined) return "—";
  switch (kind) {
    case "int":
      return Math.round(n).toString();
    case "dec1":
      return n.toFixed(1);
    case "dec3":
      return n > 0 && n < 1 ? n.toFixed(3).replace(/^0/, "") : n.toFixed(3);
    case "dec2":
      return n.toFixed(2);
    case "pct":
      return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
    case "ip":
      return n.toFixed(1);
  }
};

export interface StatRow {
  id: string;
  name: string;
  number?: string | number;
  primaryPosition?: string;
  stats: PlayerStats;
  total: number; // eval Total Score (0–100)
}

export interface Col {
  key: string;
  label: string;
  kind: Kind;
  hi: boolean; // higher is better → default descending + green-tints not used, just sort dir
  get: (r: StatRow) => number | undefined;
}

// Read a stat field; some columns prefer the section-namespaced advanced field
// (two-row GameChanger export) and fall back to the basic single-section key.
const f = (field: string) => (r: StatRow) => numOf(r.stats?.[field]);
const fb = (adv: string, basic: string) => (r: StatRow) =>
  numOf(r.stats?.[adv]) ?? numOf(r.stats?.[basic]);

export const BATTING_COLS: Col[] = [
  { key: "ab", label: "AB", kind: "int", hi: true, get: f("ab") },
  { key: "avg", label: "AVG", kind: "dec3", hi: true, get: f("avg") },
  { key: "obp", label: "OBP", kind: "dec3", hi: true, get: f("obp") },
  { key: "ops", label: "OPS", kind: "dec3", hi: true, get: f("ops") },
  { key: "h", label: "H", kind: "int", hi: true, get: f("h") },
  { key: "doubles", label: "2B", kind: "int", hi: true, get: f("doubles") },
  { key: "triples", label: "3B", kind: "int", hi: true, get: f("triples") },
  { key: "hr", label: "HR", kind: "int", hi: true, get: f("hr") },
  { key: "rbi", label: "RBI", kind: "int", hi: true, get: f("rbi") },
  { key: "sb", label: "SB", kind: "int", hi: true, get: f("sb") },
  { key: "k", label: "K", kind: "int", hi: false, get: f("k") },
  { key: "qab", label: "QAB%", kind: "pct", hi: true, get: f("qab") },
];

export const PITCHING_COLS: Col[] = [
  { key: "ip", label: "IP", kind: "ip", hi: true, get: fb("pIp", "ip") },
  { key: "era", label: "ERA", kind: "dec2", hi: false, get: fb("pEra", "era") },
  { key: "whip", label: "WHIP", kind: "dec2", hi: false, get: f("pWhip") },
  { key: "spct", label: "S%", kind: "pct", hi: true, get: f("pStrikePct") },
  { key: "fps", label: "FPS%", kind: "pct", hi: true, get: f("pFps") },
  { key: "kbb", label: "K/BB", kind: "dec2", hi: true, get: f("pKbb") },
  { key: "sm", label: "SM%", kind: "pct", hi: true, get: f("pSwingMiss") },
  { key: "weak", label: "WEAK%", kind: "pct", hi: true, get: f("pWeak") },
  { key: "hhb", label: "HHB%", kind: "pct", hi: false, get: f("pHardPct") },
  { key: "goao", label: "GO/AO", kind: "dec2", hi: true, get: f("pGoAo") },
  { key: "baa", label: "BAA", kind: "dec3", hi: false, get: f("pBaa") },
  { key: "top", label: "Top MPH", kind: "dec1", hi: true, get: f("pTopMph") },
  { key: "bf", label: "BF", kind: "int", hi: true, get: f("pBf") },
  { key: "tp", label: "TP", kind: "int", hi: true, get: f("totalPitches") },
];

export const FIELDING_COLS: Col[] = [
  {
    key: "fpct",
    label: "FPCT",
    kind: "dec3",
    hi: true,
    get: fb("fFpct", "fpct"),
  },
  { key: "tc", label: "TC", kind: "int", hi: true, get: fb("fTc", "tc") },
  { key: "po", label: "PO", kind: "int", hi: true, get: fb("fPutouts", "po") },
  { key: "a", label: "A", kind: "int", hi: true, get: fb("fAssists", "a") },
  { key: "e", label: "E", kind: "int", hi: false, get: f("fErrors") },
  { key: "cspct", label: "CS%", kind: "pct", hi: true, get: f("fCsPct") },
  { key: "pb", label: "PB", kind: "int", hi: false, get: f("fPb") },
];

// The eval Total Score column, shared across all three category views.
export const OVERALL_COL: Col = {
  key: "total",
  label: "Overall",
  kind: "int",
  hi: true,
  get: (r) => r.total,
};

export const CATEGORIES = [
  { id: "batting", label: "Batting", cols: BATTING_COLS, defaultKey: "ops" },
  { id: "pitching", label: "Pitching", cols: PITCHING_COLS, defaultKey: "era" },
  {
    id: "fielding",
    label: "Fielding",
    cols: FIELDING_COLS,
    defaultKey: "fpct",
  },
] as const;
