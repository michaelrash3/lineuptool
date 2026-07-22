// Stats export — turn the Player Stats table into a shareable CSV. Pure and
// unit-testable; the screen wires a download button over it. Mirrors the
// eval-round CSV (utils/evalExport.ts) and the finance ledgerCsv shape.

import { fmt, type Col, type StatRow } from "./statColumns";

// RFC-4180-style escaping: wrap in quotes and double any embedded quote when
// the value contains a comma, quote, or newline. Same rule the ledger uses.
const esc = (val: unknown): string => {
  const str = String(val ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

interface CsvCategory {
  label: string;
  cols: Col[];
  defaultKey: string;
}

// Same ordering as the on-screen table's initial sort: the category's marquee
// stat in its higher/lower-is-better direction, missing values sunk to the
// bottom, names as the tiebreak.
const compareBy =
  (col: Col) =>
  (a: StatRow, b: StatRow): number => {
    const av = col.get(a);
    const bv = col.get(b);
    if (av === undefined && bv === undefined)
      return String(a.name).localeCompare(String(b.name));
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    if (av === bv) return String(a.name).localeCompare(String(b.name));
    return (av - bv) * (col.hi ? -1 : 1);
  };

// One row per player with anything to show for this category (a stat or an
// eval Total Score); columns are Player, Number, Overall, then the category's
// stat columns formatted exactly as the table renders them.
export const statsTableCsv = (
  rows: StatRow[] | null | undefined,
  category: CsvCategory,
): string => {
  const cols = category.cols;
  const sortCol = cols.find((c) => c.key === category.defaultKey) || cols[0];
  const kept = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.total > 0 || cols.some((c) => c.get(r) !== undefined))
    .sort(compareBy(sortCol));
  const header = ["Player", "Number", "Overall", ...cols.map((c) => c.label)]
    .map(esc)
    .join(",");
  const lines = kept.map((r) =>
    [
      esc(r.name || ""),
      esc(r.number ?? ""),
      esc(r.total > 0 ? r.total : ""),
      ...cols.map((c) => {
        const v = c.get(r);
        return esc(v === undefined ? "" : fmt(v, c.kind));
      }),
    ].join(","),
  );
  return [header, ...lines].join("\n");
};

// Suggested download filename, safe for any filesystem — e.g.
// "hawks-stats-batting-kid-pitch.csv". The scope suffix is omitted for the
// default all-formats view.
export const statsCsvFilename = (
  teamName?: string,
  categoryLabel?: string,
  scopeLabel?: string,
): string => {
  const slug = (s: string) =>
    s
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  const team = teamName ? `${slug(teamName)}-` : "";
  const cat = categoryLabel ? slug(categoryLabel) : "players";
  const scope =
    scopeLabel && scopeLabel !== "All Formats" ? `-${slug(scopeLabel)}` : "";
  return `${team}stats-${cat}${scope}.csv`;
};
