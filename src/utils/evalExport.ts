// Eval export — turn a saved eval round into a shareable CSV grade grid
// (docs/EVALUATIONS-AUDIT.md §4, approved feature). Pure and unit-testable; the
// screen wires a download button over it. Mirrors the finance ledgerCsv shape.

interface ExportPlayer {
  id: string;
  name?: string;
  number?: string | number;
}

interface ExportCategory {
  id: string;
  label: string;
}

interface ExportRound {
  date?: string;
  grades?: Record<string, Record<string, unknown> | undefined>;
}

// RFC-4180-style escaping: wrap in quotes and double any embedded quote when the
// value contains a comma, quote, or newline. Same rule the ledger export uses.
const esc = (val: unknown): string => {
  const str = String(val ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// One row per player; columns are Player, Number, each category's grade (blank
// when ungraded), then free-text Notes. Category order follows `categories` so
// the caller controls which set (universal vs + Kid-Pitch add-ons) is emitted.
export const evalRoundCsv = (
  round: ExportRound | null | undefined,
  players: ExportPlayer[] | null | undefined,
  categories: ExportCategory[] | null | undefined,
): string => {
  const cats = Array.isArray(categories) ? categories : [];
  const roster = Array.isArray(players) ? players : [];
  const header = ["Player", "Number", ...cats.map((c) => c.label), "Notes"]
    .map(esc)
    .join(",");
  const rows = roster.map((p) => {
    const g = round?.grades?.[p.id] || {};
    const cells = [
      esc(p.name || ""),
      esc(p.number ?? ""),
      ...cats.map((c) =>
        typeof g[c.id] === "number" ? esc(g[c.id]) : esc(""),
      ),
      esc(typeof g.notes === "string" ? g.notes : ""),
    ];
    return cells.join(",");
  });
  return [header, ...rows].join("\n");
};

// Suggested download filename for a round's CSV, safe for any filesystem.
export const evalRoundCsvFilename = (
  round: ExportRound | null | undefined,
  teamName?: string,
): string => {
  const slug = (s: string) =>
    s
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  const team = teamName ? `${slug(teamName)}-` : "";
  const date = round?.date ? slug(String(round.date)) : "round";
  return `${team}evaluations-${date}.csv`;
};
