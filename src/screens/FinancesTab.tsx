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
  sponsorshipTotal,
  suggestedFeePerPlayer,
  plannedPayerCount,
  estimateBudgetFromSeason,
  financeSummary,
  transactionLedger,
  dateToIsoLocal,
} from "../utils/helpers";
import type { LedgerRow } from "../utils/helpers";
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
  <section>
    <div className="pb-3 mb-1 border-b border-line-strong flex items-center gap-3">
      <Icon
        className="w-5 h-5 shrink-0"
        style={{ color: "var(--team-primary)" }}
      />
      <div className="min-w-0">
        <h2 className="t-h2">{title}</h2>
        {subtitle && <p className="t-eyebrow text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {children}
  </section>
);

// Parse a dollars input; null when not a usable positive amount.
const parseAmount = (raw: string): number | null => {
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
};

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

// Clickable column header for the sortable tables (ledger, budget planner).
// Click toggles asc/desc; the active column shows its direction.
const SortHeader = ({
  label,
  active,
  asc,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Sort by ${label}`}
    className={`t-eyebrow inline-flex items-center gap-1 hover:text-ink transition-colors ${
      active ? "text-ink" : ""
    }`}
  >
    {label}
    <span aria-hidden className="text-[9px] w-2">
      {active ? (asc ? "▲" : "▼") : ""}
    </span>
  </button>
);

type LedgerSortKey = "date" | "label" | "in" | "out" | "balance";
type BudgetSortKey = "label" | "qty" | "planned" | "spent";

export const FinancesTab = memo(() => {
  const { team, updateTeam } = useTeam();
  const { openPlayerProfile } = useUI();
  const players: any[] = useMemo(() => (team as any).players || [], [team]);
  const finances: TeamFinances = useMemo(
    () => ((team as any).finances || {}) as TeamFinances,
    [team],
  );

  const writeFinances = (patch: Partial<TeamFinances>) =>
    updateTeam({ finances: { ...finances, ...patch } });

  const summary = useMemo(
    () => financeSummary(finances, players),
    [finances, players],
  );
  const ledger = useMemo(
    () => transactionLedger(finances, players),
    [finances, players],
  );
  const months = useMemo(
    () => monthlyCashflow(finances, players),
    [finances, players],
  );
  const actuals = useMemo(() => budgetActuals(finances), [finances]);
  const years = useMemo(
    () => yearComparison(finances, players),
    [finances, players],
  );
  const toast = useToast();
  const budget = budgetTotal(finances);
  // Next-season planning is deliberately isolated from this year's ledger:
  // only sponsorships pledged for the coming year offset the suggested fee.
  const sponsored = sponsorshipTotal(finances);
  const suggested = suggestedFeePerPlayer(finances, players);
  const clubFee = Math.max(0, Number(finances.clubFee) || 0);
  // What each family actually owes: the club fee minus this season's
  // fundraising credit (fundraising-flagged ledger income ÷ paying players).
  const effectiveFee = summary.effectiveFeePerPlayer;
  const nextFee =
    finances.nextClubFee != null
      ? Math.max(0, Number(finances.nextClubFee) || 0)
      : null;
  const exemptIds = useMemo(
    () => new Set(finances.feeExemptIds || []),
    [finances],
  );
  const payerCount = players.filter((p: any) => !exemptIds.has(p.id)).length;
  const bufferInc = Math.max(0, Number(finances.feeBufferIncrement) || 0);
  // Per-child effective fee (varies when fundraising is credited to specific
  // kids); falls back to the baseline even-split fee. The Collections meter
  // totals these so its target reflects the actual sum families owe.
  const feeFor = (pid: string) =>
    summary.effectiveFeeByPlayer[pid] ?? effectiveFee;
  const totalEffectiveFees = players.reduce(
    (sum: number, p: any) => (exemptIds.has(p.id) ? sum : sum + feeFor(p.id)),
    0,
  );

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
        b.id === id ? { ...b, taxable: !b.taxable } : b,
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
  // ---- Sponsorships (next season) form state
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorAmount, setSponsorAmount] = useState("");
  // ---- Collections form state (per-player partial payment input)
  const [payInputs, setPayInputs] = useState<Record<string, string>>({});
  const [feeInput, setFeeInput] = useState<string | null>(null);
  const [depositInput, setDepositInput] = useState<string | null>(null);
  const [nextDepositInput, setNextDepositInput] = useState<string | null>(null);
  // ---- Ledger form state (money in / money out)
  const [txnDir, setTxnDir] = useState<"in" | "out">("out");
  const [txnDate, setTxnDate] = useState(dateToIsoLocal(new Date()));
  const [txnLabel, setTxnLabel] = useState("");
  const [txnAmount, setTxnAmount] = useState("");
  // Budget category for money-out entries ("" = unplanned).
  const [txnCategory, setTxnCategory] = useState("");
  // Money-in entries flagged as fundraising reduce each family's dues.
  const [txnFundraising, setTxnFundraising] = useState(false);
  // Optional child a fundraising entry is credited to (blank = even split).
  const [txnCreditPlayerId, setTxnCreditPlayerId] = useState("");

  // ---- Sorting. The ledger defaults to date order (running balance reads
  // naturally); the planner defaults to entry order until a header is tapped.
  const [ledgerSort, setLedgerSort] = useState<{
    key: LedgerSortKey;
    asc: boolean;
  }>({ key: "date", asc: true });
  const [budgetSort, setBudgetSort] = useState<{
    key: BudgetSortKey;
    asc: boolean;
  } | null>(null);
  // First tap sorts text columns ascending and money columns descending
  // (biggest first); tapping again flips.
  const toggleLedgerSort = (key: LedgerSortKey) =>
    setLedgerSort((cur) =>
      cur.key === key
        ? { key, asc: !cur.asc }
        : { key, asc: key === "date" || key === "label" },
    );
  const toggleBudgetSort = (key: BudgetSortKey) =>
    setBudgetSort((cur) =>
      cur?.key === key ? { key, asc: !cur.asc } : { key, asc: key === "label" },
    );

  const sortedLedger = useMemo(() => {
    const { key, asc } = ledgerSort;
    if (key === "date" && asc) return ledger; // already date-asc, stable ties
    const dir = asc ? 1 : -1;
    const val = (r: LedgerRow): string | number => {
      if (key === "date") return r.date;
      if (key === "label") return r.label.toLowerCase();
      // Direction columns: rows of the other direction sink to the bottom.
      if (key === "in") return r.direction === "in" ? r.amount : -1;
      if (key === "out") return r.direction === "out" ? r.amount : -1;
      return r.balanceAfter;
    };
    return [...ledger].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [ledger, ledgerSort]);

  // Planner rows carry their derived planned/spent so sorting and rendering
  // read the same numbers.
  const budgetRows = useMemo(() => {
    const rows = (finances.budgetItems || []).map((item) => ({
      item,
      planned: budgetItemAmount(item, finances.salesTaxPct),
      spent: actuals.byItem[item.id] || 0,
    }));
    if (!budgetSort) return rows;
    const { key, asc } = budgetSort;
    const dir = asc ? 1 : -1;
    const val = (r: (typeof rows)[number]): string | number => {
      if (key === "label") return r.item.label.toLowerCase();
      if (key === "qty") return r.item.qty ?? -1;
      if (key === "planned") return r.planned;
      return r.spent;
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [finances.budgetItems, finances.salesTaxPct, actuals, budgetSort]);

  // ---- Inline budget-item editing (label + cost, keeping the item's mode).
  const [itemEdit, setItemEdit] = useState<{
    id: string;
    mode: "qty" | "flat";
    label: string;
    qty: string;
    unitAmount: string;
    amount: string;
  } | null>(null);
  const startItemEdit = (item: BudgetItem) =>
    setItemEdit({
      id: item.id,
      mode: item.qty != null && item.unitAmount != null ? "qty" : "flat",
      label: item.label,
      qty: item.qty != null ? String(item.qty) : "",
      unitAmount: item.unitAmount != null ? String(item.unitAmount) : "",
      amount: item.amount != null ? String(item.amount) : "",
    });
  const saveItemEdit = () => {
    if (!itemEdit) return;
    const label = itemEdit.label.trim();
    if (!label) return; // keep editing until valid
    let patch: Partial<BudgetItem>;
    if (itemEdit.mode === "qty") {
      const qty = parseCount(itemEdit.qty);
      const unit = parseAmount(itemEdit.unitAmount);
      if (qty == null || unit == null) return;
      patch = { label, qty, unitAmount: unit, amount: qty * unit };
    } else {
      const amount = parseAmount(itemEdit.amount);
      if (amount == null) return;
      patch = { label, amount };
    }
    writeFinances({
      budgetItems: (finances.budgetItems || []).map((b) =>
        b.id === itemEdit.id ? { ...b, ...patch } : b,
      ),
    });
    setItemEdit(null);
  };

  // ---- Anticipated next-season roster size (suggested-fee divisor).
  const [plannedInput, setPlannedInput] = useState<string | null>(null);
  const commitPlannedPlayers = () => {
    if (plannedInput == null) return;
    const raw = plannedInput.trim();
    // Blank clears the override back to "current paying roster".
    const n = raw === "" ? 0 : (parseCount(raw) ?? -1);
    if (n >= 0) writeFinances({ plannedPlayerCount: n });
    setPlannedInput(null);
  };
  const plannedCount = plannedPayerCount(finances, players);

  // Rough next-season starting point learned from this season's money.
  const budgetEstimate = useMemo(
    () => estimateBudgetFromSeason(finances),
    [finances],
  );

  // ---- Surplus carried over from last season, not yet applied to dues.
  // The season roll writes the closing balance as a "Carried over" income
  // entry; one tap flags it as fundraising so it splits across paying
  // families and discounts this year's dues. Debt carries as an expense and
  // never touches dues — that's the club's problem, not the parents'.
  const isCarryover = (i: { id?: string; label?: string }) =>
    String(i.id || "").startsWith("carry-") ||
    /^Carried over/.test(String(i.label || ""));
  const carryoverPending = useMemo(
    () =>
      (finances.incomes || []).filter((i) => isCarryover(i) && !i.fundraising),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finances.incomes],
  );
  const carryoverPendingTotal = carryoverPending.reduce(
    (sum, i) => sum + (Number(i.amount) || 0),
    0,
  );
  const applyCarryoverDiscount = () => {
    writeFinances({
      incomes: (finances.incomes || []).map((i) =>
        isCarryover(i) && !i.fundraising ? { ...i, fundraising: true } : i,
      ),
    });
    toast.push({
      kind: "success",
      title: "Carryover applied to team fees",
      message: "Last season's surplus now discounts every family's fee.",
    });
  };

  const applyPreset = (preset: (typeof BUDGET_PRESETS)[number]) => {
    setBudgetLabel(preset.label);
    setQtyMode(true);
    setUnitNoun(preset.unitNoun || "per unit");
    setBudgetQty(
      preset.qtyFromRoster && players.length > 0 ? String(players.length) : "",
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

  const addSponsorship = (e?: React.FormEvent) => {
    e?.preventDefault();
    const amount = parseAmount(sponsorAmount);
    if (!sponsorName.trim() || amount == null) return;
    writeFinances({
      sponsorships: [
        ...(finances.sponsorships || []),
        {
          id: newId("sp"),
          sponsor: sponsorName.trim(),
          amount,
          date: dateToIsoLocal(new Date()),
        },
      ],
    });
    setSponsorName("");
    setSponsorAmount("");
  };

  const removeSponsorship = (id: string) =>
    writeFinances({
      sponsorships: (finances.sponsorships || []).filter((s) => s.id !== id),
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
      const incomeEntry = txnFundraising
        ? {
            ...entry,
            fundraising: true,
            ...(txnCreditPlayerId ? { playerId: txnCreditPlayerId } : {}),
          }
        : entry;
      writeFinances({
        incomes: [...(finances.incomes || []), incomeEntry],
      });
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
    setTxnFundraising(false);
    setTxnCreditPlayerId("");
  };

  const removeLedgerRow = (
    source: "income" | "expense" | "payment",
    id: string,
  ) => {
    if (source === "income") {
      writeFinances({
        incomes: (finances.incomes || []).filter((x) => x.id !== id),
      });
    } else if (source === "expense") {
      writeFinances({
        expenses: (finances.expenses || []).filter((x) => x.id !== id),
      });
    } else {
      writeFinances({
        payments: (finances.payments || []).filter((x) => x.id !== id),
      });
    }
  };

  // ---- Inline ledger editing. Income/expense rows edit date+label+amount;
  // payment (team-fee) rows edit date + amount so a typo'd payment can be
  // corrected in place (the label is the player's name, which stays fixed).
  const [editRow, setEditRow] = useState<{
    source: "payment" | "income" | "expense";
    id: string;
  } | null>(null);
  const [editDraft, setEditDraft] = useState({
    date: "",
    label: "",
    amount: "",
    budgetItemId: "",
    fundraising: false,
    playerId: "",
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
    const inc =
      row.source === "income"
        ? (finances.incomes || []).find((x) => x.id === row.id)
        : null;
    setEditDraft({
      date: row.date,
      label: row.label,
      amount: String(row.amount ?? ""),
      budgetItemId: exp?.budgetItemId || "",
      fundraising: !!inc?.fundraising,
      playerId: inc?.playerId || "",
    });
  };
  const saveLedgerEdit = () => {
    if (!editRow) return;
    const { source, id } = editRow;
    const date = editDraft.date || dateToIsoLocal(new Date());
    if (source === "payment") {
      const amount = parseAmount(editDraft.amount);
      if (amount == null || amount < 0) return; // keep editing until valid
      writeFinances({
        payments: (finances.payments || []).map((p) =>
          p.id === id
            ? { ...p, date, amount: Math.round(amount * 100) / 100 }
            : p,
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
            x.id === id
              ? {
                  ...x,
                  ...patch,
                  fundraising: editDraft.fundraising,
                  // Credit only applies to fundraising entries; clear otherwise.
                  playerId:
                    editDraft.fundraising && editDraft.playerId
                      ? editDraft.playerId
                      : undefined,
                }
              : x,
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
              : x,
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

  const commitDeposit = () => {
    if (depositInput == null) return;
    const n = Number(String(depositInput).replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0) {
      writeFinances({ depositAmount: Math.round(n * 100) / 100 });
    }
    setDepositInput(null);
  };

  const commitNextDeposit = () => {
    if (nextDepositInput == null) return;
    const n = Number(String(nextDepositInput).replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0) {
      writeFinances({ nextDepositAmount: Math.round(n * 100) / 100 });
    }
    setNextDepositInput(null);
  };

  return (
    <div className="max-w-5xl mx-auto lg:max-w-none space-y-6">
      {/* Club balance hero — full width */}
      <FinanceHero
        balanceNow={summary.balanceNow}
        collected={summary.collected}
        otherIncome={summary.otherIncome}
        spent={summary.spent}
        stillOwed={summary.stillOwed}
        balanceOnceAllPaid={summary.balanceOnceAllPaid}
        months={months}
      />

      {/* Desktop control-panel: two-column layout.
          Left (7/12): Collections + Ledger — the operational data.
          Right (5/12): Cash Flow charts — visual summaries.
          On mobile/tablet the columns stack in natural document order. */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-6 space-y-6 lg:space-y-0">
        {/* Left column: Collections + Ledger */}
        <div className="lg:col-span-7 space-y-6">
          {/* Collections */}
          <SectionCard icon={Icons.Users} title="Collections — this season">
            <div className="py-3 border-b border-line space-y-2">
              {carryoverPendingTotal > 0 && payerCount > 0 && (
                <div className="flex flex-wrap items-center gap-3 py-2 pl-3 border-l-2 border-line-strong">
                  <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
                    Last season left{" "}
                    <span className="font-black text-ink tabular-nums">
                      {formatCurrency(carryoverPendingTotal)}
                    </span>{" "}
                    in the bank. Apply it as a team-fee discount — about{" "}
                    <span className="font-black text-win tabular-nums">
                      {formatCurrency(carryoverPendingTotal / payerCount)} off
                      per family
                    </span>
                    ?
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Apply carryover as team-fee discount"
                    onClick={applyCarryoverDiscount}
                  >
                    <Icons.Check className="w-4 h-4" /> Apply as team-fee
                    discount
                  </Button>
                </div>
              )}
              {clubFee > 0 && payerCount > 0 && (
                <div className="flex items-center gap-3">
                  <MoneyMeter
                    value={summary.collected}
                    max={totalEffectiveFees}
                    className="flex-1 max-w-xs"
                  />
                  <span className="t-meta text-ink-3 tabular-nums">
                    {formatCurrency(summary.collected)} of{" "}
                    {formatCurrency(totalEffectiveFees)} ·{" "}
                    {
                      players.filter(
                        (p: any) =>
                          !exemptIds.has(p.id) &&
                          feeFor(p.id) - (summary.paidByPlayer[p.id] || 0) <= 0,
                      ).length
                    }{" "}
                    of {payerCount} paid
                  </span>
                  {summary.stillOwed > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label="Copy team-fees reminder"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            owesReminderText(
                              finances,
                              players,
                              (team as any).currentSeason,
                            ),
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
                <span className="t-eyebrow text-ink-3">
                  Team fee per player
                </span>
                {feeInput == null ? (
                  <button
                    type="button"
                    onClick={() => setFeeInput(String(clubFee || ""))}
                    className="font-black tabular-nums text-ink hover:text-team-primary"
                    aria-label="Edit team fee"
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
                    aria-label="Team fee per player"
                    className={`${FORM_INPUT_CLASS} w-28 tabular-nums`}
                    style={FORM_INPUT_RING_STYLE}
                  />
                )}
                {summary.duesCreditPerPlayer > 0 && (
                  <span className="t-meta text-ink-3 tabular-nums">
                    − {formatCurrency(summary.duesCreditPerPlayer)} fundraising
                    credit →{" "}
                    <span className="font-black text-win">
                      {formatCurrency(effectiveFee)} each
                    </span>
                  </span>
                )}
              </div>
              {summary.duesCreditPerPlayer > 0 && (
                <p className="t-meta text-ink-3">
                  Fundraising entries split evenly across the {payerCount}{" "}
                  paying famil{payerCount === 1 ? "y" : "ies"} and come off each
                  one&apos;s team fees — unless an entry is credited to a
                  specific child, in which case it comes off that child&apos;s
                  fees first.
                </p>
              )}

              {/* Team Fee schedule — optional up-front deposit + due dates. The
              deposit is the first slice a family is expected to cover by its
              date; payments still count toward the single fee total. */}
              <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="t-eyebrow text-ink-3">
                    Deposit per player
                  </span>
                  {depositInput == null ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDepositInput(String(finances.depositAmount || ""))
                      }
                      className="text-left font-black tabular-nums text-ink hover:text-team-primary"
                      aria-label="Edit deposit amount"
                    >
                      {finances.depositAmount
                        ? formatCurrency(finances.depositAmount)
                        : "—"}
                    </button>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      value={depositInput}
                      onChange={(e) => setDepositInput(e.target.value)}
                      onBlur={commitDeposit}
                      onKeyDown={(e) => e.key === "Enter" && commitDeposit()}
                      aria-label="Deposit per player"
                      className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
                      style={FORM_INPUT_RING_STYLE}
                    />
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="t-eyebrow text-ink-3">Deposit due</span>
                  <input
                    type="date"
                    value={finances.depositDueDate || ""}
                    onChange={(e) =>
                      writeFinances({ depositDueDate: e.target.value })
                    }
                    aria-label="Deposit due date"
                    className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
                    style={FORM_INPUT_RING_STYLE}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="t-eyebrow text-ink-3">All fees due</span>
                  <input
                    type="date"
                    value={finances.feeDueDate || ""}
                    onChange={(e) =>
                      writeFinances({ feeDueDate: e.target.value })
                    }
                    aria-label="All fees due date"
                    className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
                    style={FORM_INPUT_RING_STYLE}
                  />
                </label>
              </div>
            </div>
            {players.length === 0 ? (
              <div className="p-6 text-center text-ink-3 font-medium">
                <div
                  className="text-4xl leading-none mb-3 opacity-80"
                  aria-hidden
                >
                  📊
                </div>
                Add players on the Roster tab to track who owes the team fee.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {players.map((p: any) => {
                  const waived = exemptIds.has(p.id);
                  const paid = summary.paidByPlayer[p.id] || 0;
                  // Per-child effective fee (fundraising credited to this kid lowers
                  // it); waived families owe nothing.
                  const playerFee = waived ? 0 : feeFor(p.id);
                  const owed = Math.max(0, playerFee - paid);
                  const settled = playerFee > 0 && owed === 0;
                  return (
                    <li
                      key={p.id}
                      className="py-2.5 flex flex-wrap items-center gap-2"
                    >
                      <PlayerAvatar player={p} size={32} />
                      <button
                        type="button"
                        onClick={() => openPlayerProfile(p.id)}
                        className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate flex-1 min-w-[8rem]"
                      >
                        {p.name}
                        {!waived && playerFee > 0 && (
                          <MoneyMeter
                            value={paid}
                            max={playerFee}
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
          <SectionCard icon={Icons.Wallet} title="Ledger">
            <div className="pt-4 space-y-3">
              <form
                onSubmit={addTransaction}
                className="flex flex-col sm:flex-row gap-2"
              >
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
                {txnDir === "out" &&
                  (finances.budgetItems || []).length > 0 && (
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
                {txnDir === "in" && (
                  <label
                    className="flex items-center gap-1.5 self-center text-xs font-bold text-ink-2 whitespace-nowrap cursor-pointer"
                    title="Splits evenly across paying players and reduces each family's team fees"
                  >
                    <input
                      type="checkbox"
                      checked={txnFundraising}
                      onChange={(e) => setTxnFundraising(e.target.checked)}
                      aria-label="Fundraising — reduces player team fees"
                      className="accent-[var(--team-primary)]"
                    />
                    Fundraising · reduces team fees
                  </label>
                )}
                {txnDir === "in" && txnFundraising && players.length > 0 && (
                  <select
                    value={txnCreditPlayerId}
                    onChange={(e) => setTxnCreditPlayerId(e.target.value)}
                    aria-label="Credit fundraising to a specific player"
                    title="Credit this money to one child's fees (blank = split evenly)"
                    className={`${FORM_INPUT_CLASS} sm:w-44`}
                    style={FORM_INPUT_RING_STYLE}
                  >
                    <option value="">Credit: split evenly</option>
                    {players.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        Credit: {p.name}
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
                      toast.push({
                        kind: "success",
                        title: "Ledger CSV downloaded",
                      });
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
                        {(
                          [
                            { key: "date", label: "Date", right: false },
                            { key: "label", label: "Entry", right: false },
                            { key: "in", label: "In", right: true },
                            { key: "out", label: "Out", right: true },
                            { key: "balance", label: "Balance", right: true },
                          ] as Array<{
                            key: LedgerSortKey;
                            label: string;
                            right: boolean;
                          }>
                        ).map((col) => (
                          <th
                            key={col.key}
                            className={`p-2.5 ${col.right ? "text-right" : "text-left"}`}
                          >
                            <SortHeader
                              label={col.label}
                              active={ledgerSort.key === col.key}
                              asc={ledgerSort.asc}
                              onClick={() => toggleLedgerSort(col.key)}
                            />
                          </th>
                        ))}
                        <th className="p-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {sortedLedger.map((row, idx) => {
                        const monthKey = row.date.slice(0, 7);
                        // Month group headers only make sense in date order.
                        const newMonth =
                          ledgerSort.key === "date" &&
                          (idx === 0 ||
                            sortedLedger[idx - 1].date.slice(0, 7) !==
                              monthKey);
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
                          // Team-fee payment rows keep their label (player name)
                          // fixed but allow date + amount edits; income/expense
                          // rows edit fully.
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
                                      setEditDraft((d) => ({
                                        ...d,
                                        date: e.target.value,
                                      }))
                                    }
                                    aria-label={`Edit date for ${row.label}`}
                                    className={`${FORM_INPUT_CLASS} w-36 !py-1`}
                                    style={FORM_INPUT_RING_STYLE}
                                  />
                                </td>
                                <td className="p-2">
                                  {dateOnly ? (
                                    <span className="t-body-bold text-ink">
                                      {row.label}
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={editDraft.label}
                                        onChange={(e) =>
                                          setEditDraft((d) => ({
                                            ...d,
                                            label: e.target.value,
                                          }))
                                        }
                                        aria-label={`Edit description for ${row.label}`}
                                        className={`${FORM_INPUT_CLASS} w-full !py-1`}
                                        style={FORM_INPUT_RING_STYLE}
                                      />
                                      {row.source === "expense" &&
                                        (finances.budgetItems || []).length >
                                          0 && (
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
                                            {(finances.budgetItems || []).map(
                                              (b) => (
                                                <option key={b.id} value={b.id}>
                                                  {b.label}
                                                </option>
                                              ),
                                            )}
                                          </select>
                                        )}
                                      {row.source === "income" && (
                                        <label className="flex items-center gap-1 text-[10px] font-bold text-ink-2 whitespace-nowrap cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={editDraft.fundraising}
                                            onChange={(e) =>
                                              setEditDraft((d) => ({
                                                ...d,
                                                fundraising: e.target.checked,
                                              }))
                                            }
                                            aria-label={`Edit fundraising flag for ${row.label}`}
                                            className="accent-[var(--team-primary)]"
                                          />
                                          Fundraising
                                        </label>
                                      )}
                                      {row.source === "income" &&
                                        editDraft.fundraising &&
                                        players.length > 0 && (
                                          <select
                                            value={editDraft.playerId}
                                            onChange={(e) =>
                                              setEditDraft((d) => ({
                                                ...d,
                                                playerId: e.target.value,
                                              }))
                                            }
                                            aria-label={`Credit fundraising to a player for ${row.label}`}
                                            className={`${FORM_INPUT_CLASS} w-36 !py-1`}
                                            style={FORM_INPUT_RING_STYLE}
                                          >
                                            <option value="">
                                              Split evenly
                                            </option>
                                            {players.map((p: any) => (
                                              <option key={p.id} value={p.id}>
                                                {p.name}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                    </span>
                                  )}
                                </td>
                                <td className="p-2 text-right" colSpan={2}>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editDraft.amount}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        amount: e.target.value,
                                      }))
                                    }
                                    aria-label={`Edit amount for ${row.label}`}
                                    className={`${FORM_INPUT_CLASS} w-24 !py-1 tabular-nums text-right`}
                                    style={FORM_INPUT_RING_STYLE}
                                  />
                                </td>
                                <td className="p-2 text-right" colSpan={2}>
                                  <span className="inline-flex items-center gap-2">
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      aria-label={`Save entry ${row.label}`}
                                      onClick={saveLedgerEdit}
                                    >
                                      <Icons.Check className="w-3.5 h-3.5" />{" "}
                                      Save
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
                                {row.fundraising && (
                                  <span
                                    className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-win/10 text-win align-middle"
                                    title={
                                      row.creditedTo
                                        ? `Credited to ${row.creditedTo}'s team fees`
                                        : "Splits across paying players and reduces each family's team fees"
                                    }
                                  >
                                    {row.creditedTo
                                      ? `credit → ${row.creditedTo}`
                                      : "team-fee credit"}
                                  </span>
                                )}
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
                                  row.balanceAfter < 0
                                    ? "text-loss"
                                    : "text-ink"
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
                                <button
                                  type="button"
                                  aria-label={`Delete entry ${row.label}`}
                                  onClick={() =>
                                    removeLedgerRow(row.source, row.id)
                                  }
                                  className="text-ink-3 hover:text-loss transition-colors"
                                >
                                  <Icons.X className="w-4 h-4" />
                                </button>
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
                  <div className="t-eyebrow text-ink-3 mb-2 mt-3">
                    Past years
                  </div>
                  <ul className="space-y-1">
                    {(finances.pastSeasons || []).map((ps) => (
                      <li
                        key={ps.season}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm font-bold text-ink-2 tabular-nums"
                      >
                        <span className="text-ink">{ps.season}</span>
                        <span>
                          in {formatCurrency(ps.collected + ps.otherIncome)} ·
                          out {formatCurrency(ps.spent)} · ended{" "}
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
        {/* end left col */}

        {/* Right column: Cash Flow charts */}
        <div className="lg:col-span-5 space-y-6">
          {ledger.length > 0 && (
            <SectionCard icon={Icons.Clipboard} title="Cash Flow">
              <div className="pt-4 space-y-6">
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
        </div>
        {/* end right col */}
      </div>
      {/* end desktop grid */}

      {/* Budget Planner */}
      <SectionCard icon={Icons.Clipboard} title="Budget Planner — next season">
        <div className="p-4 sm:p-5 space-y-3">
          {/* Rough estimate learned from this season's money. Empty planner →
              one-tap seed; otherwise a reference line beside the plan. */}
          {(finances.budgetItems || []).length === 0 && budgetEstimate ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
              <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
                Based on this season&apos;s money, a rough starting budget is{" "}
                <span className="font-black text-ink tabular-nums">
                  {formatCurrency(budgetEstimate.total)}
                </span>
                . Seed the planner with it and tune from there.
              </p>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Seed budget from this season"
                onClick={() =>
                  writeFinances({ budgetItems: budgetEstimate.items })
                }
              >
                <Icons.Plus className="w-4 h-4" /> Seed from this season
              </Button>
            </div>
          ) : summary.spent > 0 ? (
            <p className="t-meta text-ink-3">
              For reference, this season&apos;s actual spend so far is{" "}
              <span className="font-black tabular-nums">
                {formatCurrency(summary.spent)}
              </span>
              .
            </p>
          ) : null}
          {budgetRows.length > 0 && (
            <>
              <div className="flex items-center gap-3 pb-1 border-b border-line">
                <span className="flex-1">
                  <SortHeader
                    label="Item"
                    active={budgetSort?.key === "label"}
                    asc={budgetSort?.asc ?? true}
                    onClick={() => toggleBudgetSort("label")}
                  />
                </span>
                <SortHeader
                  label="Count"
                  active={budgetSort?.key === "qty"}
                  asc={budgetSort?.asc ?? true}
                  onClick={() => toggleBudgetSort("qty")}
                />
                <SortHeader
                  label="Spent"
                  active={budgetSort?.key === "spent"}
                  asc={budgetSort?.asc ?? true}
                  onClick={() => toggleBudgetSort("spent")}
                />
                <SortHeader
                  label="Planned"
                  active={budgetSort?.key === "planned"}
                  asc={budgetSort?.asc ?? true}
                  onClick={() => toggleBudgetSort("planned")}
                />
              </div>
              <ul className="divide-y divide-line">
                {budgetRows.map(({ item, planned, spent: spentSoFar }) => {
                  const isQty = item.qty != null && item.unitAmount != null;
                  if (itemEdit?.id === item.id) {
                    return (
                      <li key={item.id} className="py-2">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={itemEdit.label}
                            onChange={(e) =>
                              setItemEdit((d) =>
                                d ? { ...d, label: e.target.value } : d,
                              )
                            }
                            aria-label={`Edit label for ${item.label}`}
                            className={`${FORM_INPUT_CLASS} flex-1 !py-1.5`}
                            style={FORM_INPUT_RING_STYLE}
                          />
                          {itemEdit.mode === "qty" ? (
                            <>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={itemEdit.qty}
                                onChange={(e) =>
                                  setItemEdit((d) =>
                                    d ? { ...d, qty: e.target.value } : d,
                                  )
                                }
                                aria-label={`Edit count for ${item.label}`}
                                className={`${FORM_INPUT_CLASS} sm:w-24 tabular-nums !py-1.5`}
                                style={FORM_INPUT_RING_STYLE}
                              />
                              <span className="self-center text-ink-3 font-black hidden sm:block">
                                ×
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={itemEdit.unitAmount}
                                onChange={(e) =>
                                  setItemEdit((d) =>
                                    d
                                      ? { ...d, unitAmount: e.target.value }
                                      : d,
                                  )
                                }
                                aria-label={`Edit cost per unit for ${item.label}`}
                                className={`${FORM_INPUT_CLASS} sm:w-32 tabular-nums !py-1.5`}
                                style={FORM_INPUT_RING_STYLE}
                              />
                            </>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={itemEdit.amount}
                              onChange={(e) =>
                                setItemEdit((d) =>
                                  d ? { ...d, amount: e.target.value } : d,
                                )
                              }
                              aria-label={`Edit amount for ${item.label}`}
                              className={`${FORM_INPUT_CLASS} sm:w-32 tabular-nums !py-1.5`}
                              style={FORM_INPUT_RING_STYLE}
                            />
                          )}
                          <Button
                            variant="primary"
                            size="sm"
                            aria-label={`Save ${item.label}`}
                            onClick={saveItemEdit}
                          >
                            <Icons.Check className="w-3.5 h-3.5" /> Save
                          </Button>
                          <button
                            type="button"
                            aria-label="Cancel item edit"
                            onClick={() => setItemEdit(null)}
                            className="text-ink-3 hover:text-ink text-xs font-bold underline"
                          >
                            Cancel
                          </button>
                        </div>
                      </li>
                    );
                  }
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
                          {formatCurrency(planned)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Edit ${item.label}`}
                          onClick={() => startItemEdit(item)}
                          className="text-ink-3 hover:text-ink transition-colors"
                        >
                          <Icons.Edit className="w-4 h-4" />
                        </button>
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
            </>
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
          <form
            onSubmit={addBudgetItem}
            className="flex flex-col sm:flex-row gap-2"
          >
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
          {/* Sponsorships pledged toward next season's budget. Named after the
              sponsor; they reduce the suggested fee and convert into ledger
              income when the season advances. */}
          <div className="pt-2 border-t border-line space-y-2">
            <div className="t-eyebrow text-ink-3">
              Sponsorships — money pledged toward this budget
            </div>
            {(finances.sponsorships || []).length > 0 && (
              <ul className="divide-y divide-line">
                {(finances.sponsorships || []).map((sp) => (
                  <li key={sp.id} className="py-2 flex items-center gap-3">
                    <span className="t-body-bold text-ink flex-1 truncate">
                      {sp.sponsor}
                    </span>
                    <span className="tabular-nums font-black text-win">
                      {formatCurrency(sp.amount)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove sponsorship from ${sp.sponsor}`}
                      onClick={() => removeSponsorship(sp.id)}
                      className="text-ink-3 hover:text-loss transition-colors"
                    >
                      <Icons.X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={addSponsorship}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={sponsorName}
                onChange={(e) => setSponsorName(e.target.value)}
                placeholder="Sponsor name (business, family…)"
                aria-label="Sponsor name"
                className={`${FORM_INPUT_CLASS} flex-1`}
                style={FORM_INPUT_RING_STYLE}
              />
              <input
                type="text"
                inputMode="decimal"
                value={sponsorAmount}
                onChange={(e) => setSponsorAmount(e.target.value)}
                placeholder="$ amount"
                aria-label="Sponsorship amount"
                className={`${FORM_INPUT_CLASS} sm:w-40 tabular-nums`}
                style={FORM_INPUT_RING_STYLE}
              />
              <Button type="submit" variant="secondary" size="md">
                <Icons.Plus className="w-4 h-4" /> Add Sponsor
              </Button>
            </form>
          </div>
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
                  onClick={() => writeFinances({ feeBufferIncrement: opt.inc })}
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
            <label className="flex items-center gap-2 t-eyebrow text-ink-3">
              Players next season
              <input
                type="text"
                inputMode="numeric"
                value={
                  plannedInput ??
                  (finances.plannedPlayerCount
                    ? String(finances.plannedPlayerCount)
                    : "")
                }
                onChange={(e) => setPlannedInput(e.target.value)}
                onBlur={commitPlannedPlayers}
                onKeyDown={(e) => e.key === "Enter" && commitPlannedPlayers()}
                placeholder={String(payerCount || "")}
                aria-label="Anticipated players next season"
                className={`${FORM_INPUT_CLASS} w-16 tabular-nums !py-1`}
                style={FORM_INPUT_RING_STYLE}
              />
              <span className="normal-case font-bold">
                splits the fee (blank = current roster)
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2/40 p-3">
            <label className="flex flex-col gap-1">
              <span className="t-eyebrow text-ink-3">Next season deposit</span>
              {nextDepositInput == null ? (
                <button
                  type="button"
                  onClick={() =>
                    setNextDepositInput(
                      String(finances.nextDepositAmount || ""),
                    )
                  }
                  className="text-left font-black tabular-nums text-ink hover:text-team-primary"
                  aria-label="Edit next season deposit amount"
                >
                  {finances.nextDepositAmount
                    ? formatCurrency(finances.nextDepositAmount)
                    : "Add amount"}
                </button>
              ) : (
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={nextDepositInput}
                  onChange={(e) => setNextDepositInput(e.target.value)}
                  onBlur={commitNextDeposit}
                  onKeyDown={(e) => e.key === "Enter" && commitNextDeposit()}
                  aria-label="Next season deposit"
                  className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
                  style={FORM_INPUT_RING_STYLE}
                />
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-eyebrow text-ink-3">
                Next season deposit due
              </span>
              <input
                type="date"
                value={finances.nextDepositDueDate || ""}
                onChange={(e) =>
                  writeFinances({ nextDepositDueDate: e.target.value })
                }
                aria-label="Next season deposit due date"
                className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
                style={FORM_INPUT_RING_STYLE}
              />
            </label>
            <p className="sm:col-span-2 t-meta text-ink-3">
              Offer letters use these next-season deposit values. They promote
              into the current collection schedule when you advance seasons.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-line">
            <div className="t-body text-ink-2">
              Budget total:{" "}
              <span className="font-black text-ink tabular-nums">
                {formatCurrency(budget)}
              </span>
              {sponsored > 0 && (
                <> − sponsorships {formatCurrency(sponsored)}</>
              )}
              {suggested != null && (
                <>
                  {" "}
                  → suggested fee{" "}
                  <span className="font-black text-ink tabular-nums">
                    {formatCurrency(suggested)}
                  </span>{" "}
                  × {plannedCount}{" "}
                  {Number(finances.plannedPlayerCount) > 0
                    ? "anticipated"
                    : "paying"}{" "}
                  player{plannedCount === 1 ? "" : "s"}
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
                  — it becomes the team fee when the new season starts in the
                  Fall.
                </div>
              )}
              {finances.nextDepositAmount != null &&
                finances.nextDepositAmount > 0 && (
                  <div className="t-meta text-ink-3 mt-1">
                    Next season's deposit is set to{" "}
                    <span className="font-black tabular-nums">
                      {formatCurrency(finances.nextDepositAmount)}
                    </span>
                    {finances.nextDepositDueDate && (
                      <> due {finances.nextDepositDueDate}</>
                    )}
                    .
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
    </div>
  );
});
FinancesTab.displayName = "FinancesTab";
