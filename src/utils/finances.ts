// Team finances (money math) — pure helpers behind the Finances tab. Extracted
// from utils/helpers.ts to shrink that module; re-exported from there so
// existing `import { ... } from "../utils/helpers"` call sites keep working.
// All amounts are dollars; display formatting handles cents. Malformed/missing
// values read as 0 so a partial doc never crashes the tab.

import type {
  BudgetItem,
  FinancePastSeason,
  Player,
  Team,
  TeamFinances,
} from "../types";
import { genId } from "./id";

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
// Whether a sponsor's money credits dues is that ENTRY's own choice: a sponsor
// income carries `fundraising: true` only when the coach left its "reduces
// team fees" switch on, so this loop needs no sponsor special-casing.
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
// with a sponsor name) — the gross total, for display.
export const sponsorshipTotal = (
  finances: TeamFinances | null | undefined,
): number =>
  (finances?.sponsorships || []).reduce((sum, s) => sum + money(s?.amount), 0);

// The slice of pledged sponsorships that actually offsets the suggested fee:
// each pledge carries its own "reduces team fees" switch (default on), so a
// sponsor whose money the coach wants held as plain club income is skipped.
export const feeOffsetSponsorshipTotal = (
  finances: TeamFinances | null | undefined,
): number =>
  (finances?.sponsorships || []).reduce(
    (sum, s) => (s?.reducesFees === false ? sum : sum + money(s?.amount)),
    0,
  );

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
  // Only pledges whose own "reduces team fees" switch is on offset the fee;
  // the rest are planned as plain club income and families split that part
  // of the budget themselves.
  const uncovered = Math.max(0, total - feeOffsetSponsorshipTotal(finances));
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

// Per-player breakdown for the parent-facing fee sheet: the fee one family
// pays, split across the budget's expected expenses PROPORTIONALLY so the
// lines total EXACTLY the fee. The fee runs a touch above the raw sum of the
// expense shares (the rounding buffer, plus any sponsor offset); spreading it
// proportionally across the lines folds that internal math invisibly into the
// numbers, so a document handed to parents never exposes a "buffer" or
// "sponsorship" line — every dollar of the fee simply maps to a real expense.
// The fee is next season's set fee when present, otherwise the planner's
// suggestion. null when there's no fee or no priced expenses to show.
export const buildPlayerFeeBreakdown = (
  finances: TeamFinances | null | undefined,
  players: Array<{ id: string }> | null | undefined,
): { fee: number; lines: Array<{ label: string; amount: number }> } | null => {
  const items = (finances?.budgetItems || [])
    .map((item) => ({
      label: (item?.label || "").trim() || "Team expense",
      amount: budgetItemAmount(item, finances?.salesTaxPct),
    }))
    .filter((it) => it.amount > 0);
  const total = items.reduce((sum, it) => sum + it.amount, 0);
  if (total <= 0) return null;

  const setFee = money(finances?.nextClubFee);
  const fee = setFee > 0 ? setFee : suggestedFeePerPlayer(finances, players);
  if (fee == null || fee <= 0) return null;

  // Each expense's proportional share of the fee, rounded to cents. Rounding
  // drift (a cent or two) lands on the largest line so the column still sums
  // to the fee exactly — the printed Total always reconciles.
  const lines = items.map((it) => ({
    label: it.label,
    amount: Math.round(((fee * it.amount) / total) * 100) / 100,
  }));
  const allocated = lines.reduce((sum, l) => sum + l.amount, 0);
  const residual = Math.round((fee - allocated) * 100) / 100;
  if (residual !== 0 && lines.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].amount > lines[maxIdx].amount) maxIdx = i;
    }
    lines[maxIdx].amount =
      Math.round((lines[maxIdx].amount + residual) * 100) / 100;
  }
  return { fee, lines };
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
      id: genId("b"),
      label: item.label,
      amount: roundUpToIncrement(basis, 25),
    });
  }
  if (money(actuals.unplanned) > 0) {
    items.push({
      id: genId("b"),
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

// Whether advancing into `nextSeason` should roll the money. The season YEAR
// runs Fall → Spring: the ledger, collections, and fee schedule carry straight
// through the mid-year Fall→Spring advance UNTOUCHED, and the money rolls only
// when a new Fall begins (balance carries over, collections reset, the planned
// fee is promoted, the year is archived). A planned next-season fee triggers
// the roll even with no recorded money — the Budget Planner promised it takes
// effect when the new year starts. No-op when Finances was never used.
// Extracted from TeamProvider.advanceSeason so the fall→spring guarantee is
// unit-testable.
export const shouldRollFinances = (
  nextSeason: string,
  finances: TeamFinances | null | undefined,
): boolean => {
  const rollingIntoFall = String(nextSeason || "")
    .toLowerCase()
    .startsWith("fall");
  if (!rollingIntoFall) return false;
  const hadActivity =
    (finances?.payments || []).length > 0 ||
    (finances?.incomes || []).length > 0 ||
    (finances?.expenses || []).length > 0;
  const hasPlannedFee = finances?.nextClubFee != null;
  return hadActivity || hasPlannedFee;
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
  const carryId = genId(`carry-${date}`);
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
