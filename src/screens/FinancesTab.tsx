import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { Button, FORM_INPUT_CLASS, FORM_INPUT_RING_STYLE } from "../components/shared";
import {
  formatCurrency,
  budgetTotal,
  budgetItemAmount,
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

const Tile = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) => (
  <div className="glass-card p-4 text-center">
    <div className="t-eyebrow text-ink-3">{label}</div>
    <div
      className={`mt-1 text-xl font-black tabular-nums tracking-tight ${
        tone === "good" ? "text-win" : tone === "bad" ? "text-loss" : "text-ink"
      }`}
    >
      {value}
    </div>
  </div>
);

// Parse a dollars input; null when not a usable positive amount.
const parseAmount = (raw: string): number | null => {
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
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
  const budget = budgetTotal(finances);
  const income = incomeTotal(finances);
  const suggested = suggestedFeePerPlayer(finances, players.length);
  const clubFee = Math.max(0, Number(finances.clubFee) || 0);

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
      writeFinances({ expenses: [...(finances.expenses || []), entry] });
    }
    setTxnLabel("");
    setTxnAmount("");
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
      {/* P&L tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile
          label="Balance now"
          value={formatCurrency(summary.balanceNow)}
          tone={summary.balanceNow >= 0 ? "good" : "bad"}
        />
        <Tile label="Fees collected" value={formatCurrency(summary.collected)} />
        <Tile
          label="Sponsorships & income"
          value={formatCurrency(summary.otherIncome)}
        />
        <Tile label="Spent" value={formatCurrency(summary.spent)} />
        <Tile label="Still owed" value={formatCurrency(summary.stillOwed)} />
        <Tile
          label="Balance once all paid"
          value={formatCurrency(summary.balanceOnceAllPaid)}
          tone={summary.balanceOnceAllPaid >= 0 ? "good" : "bad"}
        />
      </div>

      {/* Budget Planner */}
      <SectionCard
        icon={Icons.Clipboard}
        title="Budget Planner"
        subtitle="Plan the season's costs, then split what sponsors don't cover into a per-player club fee."
      >
        <div className="p-4 sm:p-5 space-y-3">
          {(finances.budgetItems || []).length > 0 && (
            <ul className="divide-y divide-line">
              {(finances.budgetItems || []).map((item) => {
                const isQty = item.qty != null && item.unitAmount != null;
                return (
                  <li key={item.id} className="py-2 flex items-center gap-3">
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
                    <span className="tabular-nums font-black text-ink">
                      {formatCurrency(budgetItemAmount(item))}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.label}`}
                      onClick={() => removeBudgetItem(item.id)}
                      className="text-ink-3 hover:text-loss transition-colors"
                    >
                      <Icons.X className="w-4 h-4" />
                    </button>
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-line">
            <div className="t-body text-ink-2">
              Budget total:{" "}
              <span className="font-black text-ink tabular-nums">
                {formatCurrency(budget)}
              </span>
              {income > 0 && (
                <>
                  {" "}
                  − {formatCurrency(income)} sponsorships/income
                </>
              )}
              {suggested != null && (
                <>
                  {" "}
                  → suggested fee{" "}
                  <span className="font-black text-ink tabular-nums">
                    {formatCurrency(suggested)}
                  </span>{" "}
                  × {players.length} player{players.length === 1 ? "" : "s"}
                </>
              )}
            </div>
            {suggested != null && suggested !== clubFee && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => writeFinances({ clubFee: suggested })}
              >
                <Icons.Check className="w-4 h-4" /> Set as club fee
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Collections */}
      <SectionCard
        icon={Icons.Users}
        title="Collections"
        subtitle="Who has paid the club fee — partial payments add up per family."
      >
        <div className="px-4 sm:px-5 py-3 border-b border-line bg-surface flex items-center gap-2">
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
        {players.length === 0 ? (
          <div className="p-6 text-center text-ink-3 font-medium">
            Add players on the Roster tab to track who owes the club fee.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {players.map((p: any) => {
              const paid = summary.paidByPlayer[p.id] || 0;
              const owed = Math.max(0, clubFee - paid);
              const settled = clubFee > 0 && owed === 0;
              return (
                <li
                  key={p.id}
                  className="px-4 sm:px-5 py-2.5 flex flex-wrap items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={() => openPlayerProfile(p.id)}
                    className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate flex-1 min-w-[8rem]"
                  >
                    {p.name}
                  </button>
                  <span className="tabular-nums text-sm font-bold text-ink-2">
                    {formatCurrency(paid)} paid
                  </span>
                  {settled ? (
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
                  {ledger.map((row) => (
                    <tr key={`${row.source}-${row.id}`} className="hover:bg-surface-2">
                      <td className="p-2 tabular-nums font-bold text-ink-2">
                        {row.date}
                      </td>
                      <td className="p-2 t-body-bold text-ink">{row.label}</td>
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
                      <td className="p-2 text-right">
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
});
FinancesTab.displayName = "FinancesTab";
