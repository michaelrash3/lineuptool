import { genId, parseMoneyInput } from "../../utils/helpers";

export const newId = (prefix: string) => genId(prefix);

// Parse a dollars input; null when not a usable positive amount. Comma
// handling, the sanity cap, and cent rounding live in parseMoneyInput
// (utils/finances.ts, unit-tested).
export const parseAmount = (raw: string): number | null => parseMoneyInput(raw);

// "2026-03" → "March 2026" for the ledger month group headers.
const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const monthLabel = (key: string): string => {
  const mi = parseInt(key.slice(5, 7), 10) - 1;
  return mi >= 0 && mi <= 11 ? `${MONTH_FULL[mi]} ${key.slice(0, 4)}` : key;
};

// Parse a whole-number count; null when not a usable positive integer.
export const parseCount = (raw: string): number | null => {
  const n = Math.round(Number(String(raw).replace(/[,\s]/g, "")));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

// Ledger rows rendered before the "Show all" toggle kicks in — the math and
// CSV always use the full ledger; only the table render is bounded.
export const LEDGER_RENDER_CAP = 100;

export type LedgerSortKey = "date" | "label" | "in" | "out" | "balance";
export type BudgetSortKey = "label" | "qty" | "planned" | "spent";
