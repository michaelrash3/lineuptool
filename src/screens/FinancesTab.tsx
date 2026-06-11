import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useUI, useToast } from "../contexts";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
  PlayerAvatar,
} from "../components/shared";
import {
  FinanceHero,
  MoneyMeter,
  CashflowChart,
  SpendingDonut,
  YearComparisonChart,
} from "../components/financeViz";
import {
  formatCurrency,
  budgetTotal,
  budgetItemAmount,
  budgetActuals,
  monthlyCashflow,
  owesReminderText,
  ledgerCsv,
  yearComparison,
  incomeTotal,
  suggestedFeePerPlayer,
  financeSummary,
  transactionLedger,
  dateToIsoLocal,
} from "../utils/helpers";
import type { BudgetItem, TeamFinances } from "../types";

// Finances — head-coach-only money tracker for the club: what the season will
// cost (Budget Planner with per-tournament / per-session quantity planning),
// what each family owes and has paid (Collections, with partial payments),
// and one dated ledger of everything received (fees, sponsorships) and spent.
// Everything lives under `team.finances` on the one team doc.

const newId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

// Common youth-club cost categories. Tapping a chip prefills the add form;
// quantity-mode presets plan as count × per-unit cost (8 tournaments × $450).
// `qtyFromRoster` seeds the count with the roster size (uniforms).
const BUDGET_PRESETS: Array<{
  label: string;
  unitNoun?: string;
  qtyFromRoster?: boolean;
}> = [
  { label: "Tournaments", unitNoun: "per tournament" },
  { label: "Uniforms", unitNoun: "per uniform", qtyFromRoster: true },
  { label: "Field rental", unitNoun: "per session" },
  { label: "Indoor facility", unitNoun: "per session" },
];

// Same section chrome the Stats tab uses, kept local to the screen.
const SectionCard = ({ icon: Icon, title, subtitle, children }: any) => (
  <div className="glass-card">
    <div
      className="h-1.5 w-full"
      style={{ backgroundColor: "var(--team-primary)" }}
    />
    <div className="p-4 sm:p-5 border-b border-line bg-surface flex items-center gap-3">
      <div
        className="p-2 rounded-full shrink-0"
        style={{ backgroundColor: "var(--team-primary-15)" }}
      >
        <Icon className="w-5 h-5" style={{ color: "var(--team-primary)" }} />
      </div>
      <div className="min-w-0">
        <h2 className="t-h2">{title}</h2>
        {subtitle && <p className="t-eyebrow text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {children}
  </div>
);

// Parse a dollars input; null when not a usable positive amount.
const parseAmount = (raw: string): number | null => {
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
};

// "2026-03" → "March 2026" for the ledger month group headers.
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthLabel = (key: string): string => {
  const mi = parseInt(key.slice(5, 7), 10) - 1;
  return mi >= 0 && mi <= 11 ? `${MONTH_FULL[mi]} ${key.slice(0, 4)}` : key;
};

// Parse a whole-number count; null when not a usable positive integer.
const parseCount = (raw: string): number | null => {
  const n = Math.round(Number(String(raw).replace(/[,\s]/g, "")));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

export const FinancesTab = memo(() => {
  const { team, updateTeam } = useTeam();
  const { openPlayerProfile } = useUI();
  const players: any[] = useMemo(
    () => (team as any).players || [],
    [team]
  );
  const finances: TeamFinances = useMemo(
    () => ((team as any).finances || {}) as TeamFinances,
    [team]
  );

  const writeFinances = (patch: Partial<TeamFinances>) =>
    updateTeam({ finances: { ...finances, ...patch } });

  const summary = useMemo(
    () => financeSummary(finances, players),
    [finances, players]
  );
  const ledger = useMemo(
    () => transactionLedger(finances, players),
    [finances, players]
  );
  const months = useMemo(
    () => monthlyCashflow(finances, players),
    [finances, players]
  );
  const actuals = useMemo(() => budgetActuals(finances), [finances]);
  const years = useMemo(
    () => yearComparison(finances, players),
    [finances, players]
  );
  const toast = useToast();
  const budget = budgetTotal(finances);
  const income = incomeTotal(finances);
  const suggested = suggestedFeePerPlayer(finances, players);
  const clubFee = Math.max(0, Number(finances.clubFee) || 0);
  const nextFee =
    finances.nextClubFee != null
      ? Math.max(0, Number(finances.nextClubFee) || 0)
      : null;
  const exemptIds = useMemo(
    () => new Set(finances.feeExemptIds || []),
    [finances]
  );
  const payerCount = players.filter((p: any) => !exemptIds.has(p.id)).length;
  const bufferInc = Math.max(0, Number(finances.feeBufferIncrement) || 0);
  // Money the fee DOESN'T have to raise, split out for the planner breakdown:
  // sponsorships/income, then everything else projected to be on hand at
  // year end (collected fees + fees still due − spending).
  const moneyOnHand = summary.balanceNow + summary.stillOwed - income;

  // Sales tax % — committed on blur/Enter so partial typing never writes.
  const [taxInput, setTaxInput] = useState<string | null>(null);
  const commitSalesTax = () => {
    if (taxInput == null) return;
    const n = Number(String(taxInput).replace(/[%,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0 && n <= 30) {
      writeFinances({ salesTaxPct: Math.round(n * 100) / 100 });
    }
    setTaxInput(null);
  };

  const toggleItemTax = (id: string) =>
    writeFinances({
      budgetItems: (finances.budgetItems || []).map((b) =>
        b.id === id ? { ...b, taxable: !b.taxable } : b
      ),
    });

  const toggleFeeWaiver = (playerId: string) => {
    const cur = new Set(finances.feeExemptIds || []);
    if (cur.has(playerId)) cur.delete(playerId);
    else cur.add(playerId);
    writeFinances({ feeExemptIds: [...cur] });
  };

  // ---- Budget Planner form state. Quantity mode plans count × per-unit cost
  // (per-tournament planner); flat mode is a single dollar amount.
  const [budgetLabel, setBudgetLabel] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetQty, setBudgetQty] = useState("");
  const [qtyMode, setQtyMode] = useState(false);
  const [unitNoun, setUnitNoun] = useState("per unit");
  // ---- Collections form state (per-player partial payment input)
  const [payInputs, setPayInputs] = useState<Record<string, string>>({});
  const [feeInput, setFeeInput] = useState<string | null>(null);
  // ---- Ledger form state (money in / money out)
  const [txnDir, setTxnDir] = useState<"in" | "out">("out");
  const [txnDate, setTxnDate] = useState(dateToIsoLocal(new Date()));
  const [txnLabel, setTxnLabel] = useState("");
  const [txnAmount, setTxnAmount] = useState("");
  // Budget category for money-out entries ("" = unplanned).
  const [txnCategory, setTxnCategory] = useState("");

  const applyPreset = (preset: (typeof BUDGET_PRESETS)[number]) => {
    setBudgetLabel(preset.label);
    setQtyMode(true);
    setUnitNoun(preset.unitNoun || "per unit");
    setBudgetQty(
      preset.qtyFromRoster && players.length > 0 ? String(players.length) : ""
    );
  };

  const addBudgetItem = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!budgetLabel.trim()) return;
    let item: BudgetItem;
    if (qtyMode) {
      const qty = parseCount(budgetQty);
      const unit = parseAmount(budgetAmount);
      if (qty == null || unit == null) return;
      // `amount` mirrors qty × unitAmount so anything reading only the flat
      // field (exports, older clients) still sees the right cost.
      item = {
        id: newId("b"),
        label: budgetLabel.trim(),
        qty,
        unitAmount: unit,
        amount: qty * unit,
      };
    } else {
      const amount = parseAmount(budgetAmount);
      if (amount == null) return;
      item = { id: newId("b"), label: budgetLabel.trim(), amount };
    }
    writeFinances({ budgetItems: [...(finances.budgetItems || []), item] });
    setBudgetLabel("");
    setBudgetAmount("");
    setBudgetQty("");
    setQtyMode(false);
    setUnitNoun("per unit");
  };

  const removeBudgetItem = (id: string) =>
    writeFinances({
      budgetItems: (finances.budgetItems || []).filter((b) => b.id !== id),
    });

  // Stepper on a quantity item ("how many tournaments?"). Keeps the mirrored
  // flat amount in sync so budgetItemAmount and legacy readers agree.
  const stepBudgetQty = (id: string, delta: number) =>
    writeFinances({
      budgetItems: (finances.budgetItems || []).map((b) => {
        if (b.id !== id || b.qty == null || b.unitAmount == null) return b;
        const qty = Math.max(1, Math.round(b.qty + delta));
        return { ...b, qty, amount: qty * b.unitAmount };
      }),
    });

  const recordPayment = (playerId: string, amount: number) => {
    if (amount <= 0) return;
    writeFinances({
      payments: [
        ...(finances.payments || []),
        {
          id: newId("pay"),
          playerId,
          date: dateToIsoLocal(new Date()),
          amount: Math.round(amount * 100) / 100,
        },
      ],
    });
    setPayInputs((cur) => ({ ...cur, [playerId]: "" }));
  };

  const addTransaction = (e?: React.FormEvent) => {
    e?.preventDefault();
    const amount = parseAmount(txnAmount);
    if (!txnLabel.trim() || amount == null) return;
    const entry = {
      id: newId(txnDir === "in" ? "inc" : "exp"),
      date: txnDate || dateToIsoLocal(new Date()),
      label: txnLabel.trim(),
      amount,
    };
    if (txnDir === "in") {
      writeFinances({ incomes: [...(finances.incomes || []), entry] });
    } else {
      writeFinances({
        expenses: [
          ...(finances.expenses || []),
          txnCategory ? { ...entry, budgetItemId: txnCategory } : entry,
        ],
      });
    }
    setTxnLabel("");
    setTxnAmount("");
    setTxnCategory("");
  };

  const removeLedgerRow = (source: "income" | "expense", id: string) => {
    if (source === "income") {
      writeFinances({
        incomes: (finances.incomes || []).filter((x) => x.id !== id),
      });
    } else {
      writeFinances({
        expenses: (finances.expenses || []).filter((x) => x.id !== id),
      });
    }
  };

  // ---- Inline ledger editing. Income/expense rows edit date+label+amount;
  // payment rows (dues) edit their DATE only — the money itself is managed
  // from Collections.
  const [editRow, setEditRow] = useState<{
    source: "payment" | "income" | "expense";
    id: string;
  } | null>(null);
  const [editDraft, setEditDraft] = useState({
    date: "",
    label: "",
    amount: "",
    budgetItemId: "",
  });
  const startLedgerEdit = (row: {
    source: "payment" | "income" | "expense";
    id: string;
    date: string;
    label: string;
    amount: number;
  }) => {
    setEditRow({ source: row.source, id: row.id });
    const exp =
      row.source === "expense"
        ? (finances.expenses || []).find((x) => x.id === row.id)
        : null;
    setEditDraft({
      date: row.date,
      label: row.label,
      amount: String(row.amount ?? ""),
      budgetItemId: exp?.budgetItemId || "",
    });
  };
  const saveLedgerEdit = () => {
    if (!editRow) return;
    const { source, id } = editRow;
    const date = editDraft.date || dateToIsoLocal(new Date());
    if (source === "payment") {
      writeFinances({
        payments: (finances.payments || []).map((p) =>
          p.id === id ? { ...p, date } : p
        ),
      });
    } else {
      const amount = parseAmount(editDraft.amount);
      const label = editDraft.label.trim();
      if (amount == null || !label) return; // keep editing until valid
      const patch = { date, label, amount };
      if (source === "income") {
        writeFinances({
          incomes: (finances.incomes || []).map((x) =>
            x.id === id ? { ...x, ...patch } : x
          ),
        });
      } else {
        writeFinances({
          expenses: (finances.expenses || []).map((x) =>
            x.id === id
              ? {
                  ...x,
                  ...patch,
                  budgetItemId: editDraft.budgetItemId || undefined,
                }
              : x
          ),
        });
      }
    }
    setEditRow(null);
  };

  const commitClubFee = () => {
    if (feeInput == null) return;
    const n = Number(String(feeInput).replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0) {
      writeFinances({ clubFee: Math.round(n * 100) / 100 });
    }
    setFeeInput(null);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Club balance hero */}
      <FinanceHero
        balanceNow={summary.balanceNow}
        collected={summary.collected}
        otherIncome={summary.otherIncome}
        spent={summary.spent}
        stillOwed={summary.stillOwed}
        balanceOnceAllPaid={summary.balanceOnceAllPaid}
        months={months}
      />

      {/* Insights: monthly cash flow + spending by category */}
      {ledger.length > 0 && (
        <SectionCard
          icon={Icons.Clipboard}
          title="Cash Flow"
          subtitle="Money in (green) and out (red) by month, with the club balance line."
        >
          <div className="p-4 sm:p-5 grid lg:grid-cols-2 gap-6 items-center">
            <CashflowChart months={months} />
            <SpendingDonut
              slices={[
                ...(finances.budgetItems || []).map((b) => ({
                  label: b.label,
                  value: actuals.byItem[b.id] || 0,
                })),
                { label: "Unplanned", value: actuals.unplanned },
              ]}
            />
          </div>
        </SectionCard>
      )}

      {/* Budget Planner */}
      <SectionCard
        icon={Icons.Clipboard}
        title="Budget Planner — next season"
        subtitle="Plan the season that starts in the Fall; whatever this year's money won't cover splits into the new club fee."
      >
        <div className="p-4 sm:p-5 space-y-3">
          {(finances.budgetItems || []).length > 0 && (
            <ul className="divide-y divide-line">
              {(finances.budgetItems || []).map((item) => {
                const isQty = item.qty != null && item.unitAmount != null;
                const planned = budgetItemAmount(item, finances.salesTaxPct);
                const spentSoFar = actuals.byItem[item.id] || 0;
                return (
                  <li key={item.id} className="py-2">
                  <div className="flex items-center gap-3">
                    <span className="t-body-bold text-ink flex-1 truncate">
                      {item.label}
                    </span>
                    {isQty && (
                      <span className="flex items-center gap-1.5 tabular-nums text-sm font-bold text-ink-2">
                        <button
                          type="button"
                          aria-label={`Fewer ${item.label}`}
                          onClick={() => stepBudgetQty(item.id, -1)}
                          className="p-1 rounded-lg bg-surface-2 hover:bg-line text-ink transition-colors"
                        >
                          <Icons.Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="min-w-[1.5rem] text-center font-black text-ink">
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`More ${item.label}`}
                          onClick={() => stepBudgetQty(item.id, 1)}
                          className="p-1 rounded-lg bg-surface-2 hover:bg-line text-ink transition-colors"
                        >
                          <Icons.Plus className="w-3.5 h-3.5" />
                        </button>
                        <span>× {formatCurrency(item.unitAmount)}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Toggle sales tax on ${item.label}`}
                      onClick={() => toggleItemTax(item.id)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors ${
                        item.taxable
                          ? "text-win bg-win/10"
                          : "text-ink-3 bg-surface-2 hover:bg-line"
                      }`}
                    >
                      +tax
                    </button>
                    <span className="tabular-nums font-black text-ink">
                      {formatCurrency(
                        budgetItemAmount(item, finances.salesTaxPct)
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.label}`}
                      onClick={() => removeBudgetItem(item.id)}
                      className="text-ink-3 hover:text-loss transition-colors"
                    >
                      <Icons.X className="w-4 h-4" />
                    </button>
                  </div>
                  {/* Budget vs actual: linked spending against the plan */}
                  {spentSoFar > 0 && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <MoneyMeter
                        value={spentSoFar}
                        max={planned}
                        className="flex-1"
                      />
                      <span
                        className={`t-meta tabular-nums whitespace-nowrap ${
                          spentSoFar > planned ? "text-loss" : "text-ink-3"
                        }`}
                      >
                        spent {formatCurrency(spentSoFar)} of{" "}
                        {formatCurrency(planned)}
                        {spentSoFar > planned && " — over budget"}
                      </span>
                    </div>
                  )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {BUDGET_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest bg-surface-2 hover:bg-line text-ink-2 transition-colors"
              >
                + {preset.label}
              </button>
            ))}
            <button
              type="button"
              aria-label="Toggle count mode"
              onClick={() => setQtyMode((v) => !v)}
              className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
                qtyMode
                  ? "bg-team-primary/15 text-team-primary"
                  : "bg-surface-2 hover:bg-line text-ink-3"
              }`}
              style={
                qtyMode
                  ? {
                      backgroundColor: "var(--team-primary-15)",
                      color: "var(--team-primary)",
                    }
                  : undefined
              }
            >
              × count
            </button>
          </div>
          <form onSubmit={addBudgetItem} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={budgetLabel}
              onChange={(e) => setBudgetLabel(e.target.value)}
              placeholder="Tournaments, uniforms, field rental…"
              aria-label="Budget item"
              className={`${FORM_INPUT_CLASS} flex-1`}
              style={FORM_INPUT_RING_STYLE}
            />
            {qtyMode && (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  value={budgetQty}
                  onChange={(e) => setBudgetQty(e.target.value)}
                  placeholder="How many?"
                  aria-label="Count"
                  className={`${FORM_INPUT_CLASS} sm:w-28 tabular-nums`}
                  style={FORM_INPUT_RING_STYLE}
                />
                <span className="self-center text-ink-3 font-black hidden sm:block">
                  ×
                </span>
              </>
            )}
            <input
              type="text"
              inputMode="decimal"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder={qtyMode ? `$ ${unitNoun}` : "$ amount"}
              aria-label={qtyMode ? "Cost per unit" : "Budget amount"}
              className={`${FORM_INPUT_CLASS} sm:w-40 tabular-nums`}
              style={FORM_INPUT_RING_STYLE}
            />
            <Button type="submit" variant="secondary" size="md">
              <Icons.Plus className="w-4 h-4" /> Add
            </Button>
          </form>
          {/* Planner settings: sales tax on flagged items + fee round-up buffer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 border-t border-line">
            <label className="flex items-center gap-2 t-eyebrow text-ink-3">
              Sales tax
              <input
                type="text"
                inputMode="decimal"
                value={taxInput ?? String(finances.salesTaxPct ?? "")}
                onChange={(e) => setTaxInput(e.target.value)}
                onBlur={commitSalesTax}
                onKeyDown={(e) => e.key === "Enter" && commitSalesTax()}
                placeholder="0"
                aria-label="Sales tax percent"
                className={`${FORM_INPUT_CLASS} w-16 tabular-nums !py-1`}
                style={FORM_INPUT_RING_STYLE}
              />
              <span className="normal-case font-bold">% on “+tax” items</span>
            </label>
            <div className="flex items-center gap-1.5">
              <span className="t-eyebrow text-ink-3">Fee buffer</span>
              {[
                { inc: 0, label: "None" },
                { inc: 25, label: "$25" },
                { inc: 50, label: "$50" },
              ].map((opt) => (
                <button
                  key={opt.inc}
                  type="button"
                  aria-label={`Fee buffer ${opt.label}`}
                  aria-pressed={bufferInc === opt.inc}
                  onClick={() =>
                    writeFinances({ feeBufferIncrement: opt.inc })
                  }
                  className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors ${
                    bufferInc === opt.inc
                      ? "text-win bg-win/10"
                      : "text-ink-3 bg-surface-2 hover:bg-line"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <span className="t-meta text-ink-3 hidden sm:inline">
                rounds the fee up to cover incidentals
              </span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-line">
            <div className="t-body text-ink-2">
              Budget total:{" "}
              <span className="font-black text-ink tabular-nums">
                {formatCurrency(budget)}
              </span>
              {income > 0 && (
                <>
                  {" "}
                  − sponsorships {formatCurrency(income)}
                </>
              )}
              {moneyOnHand > 0 && (
                <>
                  {" "}
                  − other money on hand {formatCurrency(moneyOnHand)}
                </>
              )}
              {suggested != null && (
                <>
                  {" "}
                  → suggested fee{" "}
                  <span className="font-black text-ink tabular-nums">
                    {formatCurrency(suggested)}
                  </span>{" "}
                  × {payerCount} paying player{payerCount === 1 ? "" : "s"}
                  {bufferInc > 0 && (
                    <span className="t-meta text-ink-3">
                      {" "}
                      (rounded up to the next ${bufferInc} as buffer)
                    </span>
                  )}
                </>
              )}
              {nextFee != null && (
                <div className="t-meta text-ink-3 mt-1">
                  Next season's fee is set to{" "}
                  <span className="font-black tabular-nums">
                    {formatCurrency(nextFee)}
                  </span>{" "}
                  — it becomes the club fee when the new season starts in the
                  Fall.
                </div>
              )}
            </div>
            {suggested != null && suggested !== nextFee && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => writeFinances({ nextClubFee: suggested })}
              >
                <Icons.Check className="w-4 h-4" /> Set as next season's fee
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Collections */}
      <SectionCard
        icon={Icons.Users}
        title="Collections — this season"
        subtitle="Who has paid this year's club fee — partial payments add up per family. Waive the fee for fall-only pickups."
      >
        <div className="px-4 sm:px-5 py-3 border-b border-line bg-surface space-y-2">
          {clubFee > 0 && payerCount > 0 && (
            <div className="flex items-center gap-3">
              <MoneyMeter
                value={summary.collected}
                max={clubFee * payerCount}
                className="flex-1 max-w-xs"
              />
              <span className="t-meta text-ink-3 tabular-nums">
                {formatCurrency(summary.collected)} of{" "}
                {formatCurrency(clubFee * payerCount)} ·{" "}
                {
                  players.filter(
                    (p: any) =>
                      !exemptIds.has(p.id) &&
                      clubFee - (summary.paidByPlayer[p.id] || 0) <= 0
                  ).length
                }{" "}
                of {payerCount} paid
              </span>
              {summary.stillOwed > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Copy dues reminder"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        owesReminderText(
                          finances,
                          players,
                          (team as any).currentSeason
                        )
                      );
                      toast.push({
                        kind: "success",
                        title: "Reminder copied",
                        message: "Paste it into your team chat or email.",
                      });
                    } catch {
                      toast.push({
                        kind: "warn",
                        title: "Couldn't access clipboard",
                      });
                    }
                  }}
                >
                  Copy reminder
                </Button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
          <span className="t-eyebrow text-ink-3">Club fee per player</span>
          {feeInput == null ? (
            <button
              type="button"
              onClick={() => setFeeInput(String(clubFee || ""))}
              className="font-black tabular-nums text-ink hover:text-team-primary"
              aria-label="Edit club fee"
            >
              {formatCurrency(clubFee)}
            </button>
          ) : (
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              onBlur={commitClubFee}
              onKeyDown={(e) => e.key === "Enter" && commitClubFee()}
              aria-label="Club fee per player"
              className={`${FORM_INPUT_CLASS} w-28 tabular-nums`}
              style={FORM_INPUT_RING_STYLE}
            />
          )}
          </div>
        </div>
        {players.length === 0 ? (
          <div className="p-6 text-center text-ink-3 font-medium">
            Add players on the Roster tab to track who owes the club fee.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {players.map((p: any) => {
              const waived = exemptIds.has(p.id);
              const paid = summary.paidByPlayer[p.id] || 0;
              const owed = Math.max(0, clubFee - paid);
              const settled = clubFee > 0 && owed === 0;
              return (
                <li
                  key={p.id}
                  className="px-4 sm:px-5 py-2.5 flex flex-wrap items-center gap-2"
                >
                  <PlayerAvatar player={p} size={32} />
                  <button
                    type="button"
                    onClick={() => openPlayerProfile(p.id)}
                    className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate flex-1 min-w-[8rem]"
                  >
                    {p.name}
                    {!waived && clubFee > 0 && (
                      <MoneyMeter
                        value={paid}
                        max={clubFee}
                        className="mt-1 max-w-[10rem]"
                      />
                    )}
                  </button>
                  <span className="tabular-nums text-sm font-bold text-ink-2">
                    {formatCurrency(paid)} paid
                  </span>
                  {waived ? (
                    <>
                      <span className="text-xs font-black uppercase tracking-widest text-ink-3">
                        Fee waived
                      </span>
                      <button
                        type="button"
                        aria-label={`Reinstate fee for ${p.name}`}
                        onClick={() => toggleFeeWaiver(p.id)}
                        className="text-xs font-bold underline text-ink-3 hover:text-ink"
                      >
                        Undo
                      </button>
                    </>
                  ) : settled ? (
                    <span className="text-xs font-black uppercase tracking-widest text-win">
                      Paid full ✓
                    </span>
                  ) : (
                    <>
                      <span className="tabular-nums text-sm font-bold text-loss">
                        {formatCurrency(owed)} owed
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={payInputs[p.id] || ""}
                        onChange={(e) =>
                          setPayInputs((cur) => ({
                            ...cur,
                            [p.id]: e.target.value,
                          }))
                        }
                        placeholder="$"
                        aria-label={`Payment amount for ${p.name}`}
                        className={`${FORM_INPUT_CLASS} w-20 tabular-nums !py-1.5`}
                        style={FORM_INPUT_RING_STYLE}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Record payment for ${p.name}`}
                        onClick={() => {
                          const amt = parseAmount(payInputs[p.id] || "");
                          if (amt != null) recordPayment(p.id, amt);
                        }}
                      >
                        <Icons.Plus className="w-3.5 h-3.5" /> Payment
                      </Button>
                      {owed > 0 && (
                        <Button
                          variant="primary"
                          size="sm"
                          aria-label={`Mark ${p.name} paid in full`}
                          onClick={() => recordPayment(p.id, owed)}
                        >
                          Paid full
                        </Button>
                      )}
                      <button
                        type="button"
                        aria-label={`Waive fee for ${p.name}`}
                        onClick={() => toggleFeeWaiver(p.id)}
                        className="text-xs font-bold underline text-ink-3 hover:text-ink"
                      >
                        Waive
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Ledger — money in & money out */}
      <SectionCard
        icon={Icons.Wallet}
        title="Ledger"
        subtitle="Everything received and spent — fees, sponsorships, fundraising, expenses — with the club balance after each."
      >
        <div className="p-4 sm:p-5 space-y-3">
          <form onSubmit={addTransaction} className="flex flex-col sm:flex-row gap-2">
            <div
              className="flex rounded-xl overflow-hidden border border-line self-start sm:self-auto"
              role="group"
              aria-label="Money direction"
            >
              {(
                [
                  { v: "in", label: "Money in" },
                  { v: "out", label: "Money out" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setTxnDir(opt.v)}
                  aria-pressed={txnDir === opt.v}
                  className={`px-3 py-2 text-xs font-black uppercase tracking-widest transition-colors ${
                    txnDir === opt.v
                      ? opt.v === "in"
                        ? "bg-win/15 text-win"
                        : "bg-loss/15 text-loss"
                      : "bg-surface-2 text-ink-3 hover:bg-line"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={txnDate}
              onChange={(e) => setTxnDate(e.target.value)}
              aria-label="Transaction date"
              className={`${FORM_INPUT_CLASS} sm:w-40`}
              style={FORM_INPUT_RING_STYLE}
            />
            <input
              type="text"
              value={txnLabel}
              onChange={(e) => setTxnLabel(e.target.value)}
              placeholder={
                txnDir === "in"
                  ? "Sponsorship, fundraiser, donation…"
                  : "What was it for?"
              }
              aria-label="Transaction description"
              className={`${FORM_INPUT_CLASS} flex-1`}
              style={FORM_INPUT_RING_STYLE}
            />
            {txnDir === "out" && (finances.budgetItems || []).length > 0 && (
              <select
                value={txnCategory}
                onChange={(e) => setTxnCategory(e.target.value)}
                aria-label="Budget category"
                className={`${FORM_INPUT_CLASS} sm:w-44`}
                style={FORM_INPUT_RING_STYLE}
              >
                <option value="">Category: unplanned</option>
                {(finances.budgetItems || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              inputMode="decimal"
              value={txnAmount}
              onChange={(e) => setTxnAmount(e.target.value)}
              placeholder="$ amount"
              aria-label="Transaction amount"
              className={`${FORM_INPUT_CLASS} sm:w-32 tabular-nums`}
              style={FORM_INPUT_RING_STYLE}
            />
            <Button type="submit" variant="secondary" size="md">
              <Icons.Plus className="w-4 h-4" /> Add
            </Button>
          </form>
          {ledger.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                aria-label="Export ledger CSV"
                onClick={() => {
                  const blob = new Blob([ledgerCsv(finances, players)], {
                    type: "text/csv;charset=utf-8",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "club-ledger.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.push({ kind: "success", title: "Ledger CSV downloaded" });
                }}
                className="text-xs font-black uppercase tracking-widest text-ink-3 hover:text-ink underline"
              >
                Export CSV
              </button>
            </div>
          )}
          {ledger.length === 0 ? (
            <div className="p-4 text-center text-ink-3 font-medium">
              Nothing logged yet. Club-fee payments land here automatically;
              add sponsorships and expenses above.
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                <thead className="bg-app">
                  <tr>
                    <th className="p-2.5 t-eyebrow text-left">Date</th>
                    <th className="p-2.5 t-eyebrow text-left">Entry</th>
                    <th className="p-2.5 t-eyebrow text-right">In</th>
                    <th className="p-2.5 t-eyebrow text-right">Out</th>
                    <th className="p-2.5 t-eyebrow text-right">Balance</th>
                    <th className="p-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.map((row, idx) => {
                    const monthKey = row.date.slice(0, 7);
                    const newMonth =
                      idx === 0 ||
                      ledger[idx - 1].date.slice(0, 7) !== monthKey;
                    const monthHeader = newMonth ? (
                      <tr key={`m-${monthKey}`} className="bg-app">
                        <td
                          colSpan={6}
                          className="px-2 py-1 t-eyebrow text-ink-3"
                        >
                          {monthLabel(monthKey)}
                        </td>
                      </tr>
                    ) : null;
                    const isEditing =
                      editRow != null &&
                      editRow.source === row.source &&
                      editRow.id === row.id;
                    if (isEditing) {
                      // Payments are managed in Collections — only their DATE
                      // is editable here; income/expense rows edit fully.
                      const dateOnly = row.source === "payment";
                      return (
                        <React.Fragment key={`${row.source}-${row.id}`}>
                        {monthHeader}
                        <tr className="bg-surface-2">
                          <td className="p-2">
                            <input
                              type="date"
                              value={editDraft.date}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, date: e.target.value }))
                              }
                              aria-label={`Edit date for ${row.label}`}
                              className={`${FORM_INPUT_CLASS} w-36 !py-1`}
                              style={FORM_INPUT_RING_STYLE}
                            />
                          </td>
                          <td className="p-2">
                            {dateOnly ? (
                              <span className="t-body-bold text-ink">{row.label}</span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editDraft.label}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({ ...d, label: e.target.value }))
                                  }
                                  aria-label={`Edit description for ${row.label}`}
                                  className={`${FORM_INPUT_CLASS} w-full !py-1`}
                                  style={FORM_INPUT_RING_STYLE}
                                />
                                {row.source === "expense" &&
                                  (finances.budgetItems || []).length > 0 && (
                                    <select
                                      value={editDraft.budgetItemId}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          budgetItemId: e.target.value,
                                        }))
                                      }
                                      aria-label={`Edit category for ${row.label}`}
                                      className={`${FORM_INPUT_CLASS} w-36 !py-1`}
                                      style={FORM_INPUT_RING_STYLE}
                                    >
                                      <option value="">Unplanned</option>
                                      {(finances.budgetItems || []).map((b) => (
                                        <option key={b.id} value={b.id}>
                                          {b.label}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-right" colSpan={2}>
                            {dateOnly ? (
                              <span
                                className={`tabular-nums font-bold ${
                                  row.direction === "in" ? "text-win" : "text-loss"
                                }`}
                              >
                                {formatCurrency(row.amount)}
                              </span>
                            ) : (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={editDraft.amount}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, amount: e.target.value }))
                                }
                                aria-label={`Edit amount for ${row.label}`}
                                className={`${FORM_INPUT_CLASS} w-24 !py-1 tabular-nums text-right`}
                                style={FORM_INPUT_RING_STYLE}
                              />
                            )}
                          </td>
                          <td className="p-2 text-right" colSpan={2}>
                            <span className="inline-flex items-center gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                aria-label={`Save entry ${row.label}`}
                                onClick={saveLedgerEdit}
                              >
                                <Icons.Check className="w-3.5 h-3.5" /> Save
                              </Button>
                              <button
                                type="button"
                                aria-label="Cancel edit"
                                onClick={() => setEditRow(null)}
                                className="text-ink-3 hover:text-ink text-xs font-bold underline"
                              >
                                Cancel
                              </button>
                            </span>
                          </td>
                        </tr>
                        </React.Fragment>
                      );
                    }
                    return (
                    <React.Fragment key={`${row.source}-${row.id}`}>
                    {monthHeader}
                    <tr className="hover:bg-surface-2">
                      <td className="p-2 tabular-nums font-bold text-ink-2">
                        {row.date}
                      </td>
                      <td className="p-2 t-body-bold text-ink">
                        <span
                          className={`inline-flex items-center justify-center w-4 h-4 rounded-full mr-1.5 text-[9px] font-black ${
                            row.direction === "in"
                              ? "bg-win/10 text-win"
                              : "bg-loss/10 text-loss"
                          }`}
                        >
                          {row.direction === "in" ? "↑" : "↓"}
                        </span>
                        {row.label}
                      </td>
                      <td className="p-2 text-right tabular-nums font-bold text-win">
                        {row.direction === "in"
                          ? formatCurrency(row.amount)
                          : ""}
                      </td>
                      <td className="p-2 text-right tabular-nums font-bold text-loss">
                        {row.direction === "out"
                          ? formatCurrency(row.amount)
                          : ""}
                      </td>
                      <td
                        className={`p-2 text-right tabular-nums font-black ${
                          row.balanceAfter < 0 ? "text-loss" : "text-ink"
                        }`}
                      >
                        {formatCurrency(row.balanceAfter)}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          aria-label={`Edit entry ${row.label}`}
                          onClick={() => startLedgerEdit(row)}
                          className="text-ink-3 hover:text-ink transition-colors mr-2"
                        >
                          <Icons.Edit className="w-4 h-4" />
                        </button>
                        {row.source !== "payment" && (
                          <button
                            type="button"
                            aria-label={`Delete entry ${row.label}`}
                            onClick={() =>
                              removeLedgerRow(
                                row.source as "income" | "expense",
                                row.id
                              )
                            }
                            className="text-ink-3 hover:text-loss transition-colors"
                          >
                            <Icons.X className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(finances.pastSeasons || []).length > 0 && (
            <div className="pt-3 border-t border-line">
              <div className="t-eyebrow text-ink-3 mb-2">
                Year over year — money in vs out, closing balance under each
              </div>
              <div className="max-w-xl">
                <YearComparisonChart rows={years} />
              </div>
              <div className="t-eyebrow text-ink-3 mb-2 mt-3">Past years</div>
              <ul className="space-y-1">
                {(finances.pastSeasons || []).map((ps) => (
                  <li
                    key={ps.season}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm font-bold text-ink-2 tabular-nums"
                  >
                    <span className="text-ink">{ps.season}</span>
                    <span>
                      in {formatCurrency(ps.collected + ps.otherIncome)} · out{" "}
                      {formatCurrency(ps.spent)} · ended{" "}
                      <span
                        className={
                          ps.closingBalance < 0
                            ? "text-loss font-black"
                            : "text-ink font-black"
                        }
                      >
                        {formatCurrency(ps.closingBalance)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
});
FinancesTab.displayName = "FinancesTab";
