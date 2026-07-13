import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { HelpTip } from "../components/help/HelpTip";
import { useTeam, useUI, useToast, useConfirm } from "../contexts";
import {
  Button,
  EmptyState,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
  PlayerAvatar,
} from "../components/shared";
import {
  FinanceHero,
  MoneyMeter,
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
  feeOffsetSponsorshipTotal,
  suggestedFeePerPlayer,
  plannedPayerCount,
  buildPlayerFeeBreakdown,
  estimateBudgetFromSeason,
  budgetItemCategory,
  budgetByCategory,
  incomeByCategory,
  financeSummary,
  transactionLedger,
  dateToIsoLocal,
  isValidIsoDate,
  parseMoneyInput,
  round2,
} from "../utils/helpers";
import type { LedgerRow } from "../utils/helpers";
import { downloadPlayerFeeSheetPdf } from "../finances/feeSheetPdf";
import { downloadTreasurerReportPdf } from "../finances/treasurerReportPdf";
import type { BudgetItem, Player, Team, TeamFinances } from "../types";
import type { FinanceSetFields } from "../utils/financeUpdates";
import {
  BUDGET_PRESETS,
  BUDGET_PRESET_GROUPS,
  EXPENSE_LABEL_SUGGESTIONS,
  INCOME_LABEL_SUGGESTIONS,
  DEPOSIT_QUICK_PICKS,
  FINANCE_CATEGORIES,
  groupToCategory,
  categoryLabel,
  REVENUE_CATEGORIES,
  type BudgetPreset,
  type FinanceCategoryId,
  type RevenueCategoryId,
} from "../constants/financeCategories";
import { SectionCard } from "./finances/SectionCard";
import { SortHeader } from "./finances/SortHeader";
import { CashFlowSection } from "./finances/CashFlowSection";
import {
  newId,
  parseAmount,
  monthLabel,
  parseCount,
  LEDGER_RENDER_CAP,
} from "./finances/financeHelpers";
import type { LedgerSortKey, BudgetSortKey } from "./finances/financeHelpers";

// Finances — head-coach-only money tracker for the club: what the season will
// cost (Budget Planner with per-tournament / per-session quantity planning),
// what each family owes and has paid (Collections, with partial payments),
// and one dated ledger of everything received (fees, sponsorships) and spent.
// Everything lives under `team.finances` on the one team doc.

export const FinancesTab = memo(() => {
  const { team: teamRaw, updateFinances, user } = useTeam();
  const { openPlayerProfile } = useUI();
  // TeamContextValue.team is intentionally `any` (see types.ts); narrow it to
  // the known Team shape for this screen.
  const team = teamRaw as Team;
  const players: Player[] = useMemo(() => team.players || [], [team]);
  const finances: TeamFinances = useMemo(() => team.finances || {}, [team]);

  // All mutations go through updateFinances (utils/financeUpdates.ts): narrow
  // per-op Firestore writes instead of re-writing the whole finances object,
  // so two coaches recording money simultaneously can't clobber each other
  // (docs/FINANCES-AUDIT.md finding 3.2). Scalar fields share this shorthand.
  const setFinanceFields = (fields: FinanceSetFields) =>
    updateFinances({ op: "set", fields });

  // Who-entered-this stamps for new money records (audit finding 3.7).
  // Creation only — edits preserve the original stamps. undefined values are
  // scrubbed before the write, so a missing user stays harmless.
  const recordedStamp = () => ({
    recordedBy: user?.uid as string | undefined,
    recordedAt: new Date().toISOString(),
  });

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
  const { promptText } = useConfirm();
  const budget = budgetTotal(finances);
  // Next-season planning is deliberately isolated from this year's ledger:
  // only sponsorships pledged for the coming year offset the suggested fee.
  const sponsored = sponsorshipTotal(finances);
  // The slice of pledges whose own switch offsets the fee — what the planner
  // math line shows. Pledges held as club income are excluded.
  const sponsoredOffset = feeOffsetSponsorshipTotal(finances);
  const suggested = suggestedFeePerPlayer(finances, players);
  // The parent-facing fee sheet needs both priced expenses and a per-player
  // fee (next-season fee, or the planner's suggestion) to spread across them.
  const feeSheetReady = useMemo(
    () => buildPlayerFeeBreakdown(finances, players) != null,
    [finances, players],
  );
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
  const payerCount = players.filter((p) => !exemptIds.has(p.id)).length;
  const bufferInc = Math.max(0, Number(finances.feeBufferIncrement) || 0);
  // Per-child effective fee (varies when fundraising is credited to specific
  // kids); falls back to the baseline even-split fee. The Collections meter
  // totals these so its target reflects the actual sum families owe.
  const feeFor = (pid: string) =>
    summary.effectiveFeeByPlayer[pid] ?? effectiveFee;
  const totalEffectiveFees = round2(
    players.reduce(
      (sum: number, p) => (exemptIds.has(p.id) ? sum : sum + feeFor(p.id)),
      0,
    ),
  );

  // Sales tax % — committed on blur/Enter so partial typing never writes.
  const [taxInput, setTaxInput] = useState<string | null>(null);
  const commitSalesTax = () => {
    if (taxInput == null) return;
    const n = Number(String(taxInput).replace(/[%,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0 && n <= 30) {
      setFinanceFields({ salesTaxPct: round2(n) });
    }
    setTaxInput(null);
  };

  const toggleItemTax = (id: string) =>
    updateFinances({
      op: "mapEntries",
      key: "budgetItems",
      map: (items) =>
        items.map((b) => (b.id === id ? { ...b, taxable: !b.taxable } : b)),
    });

  const toggleFeeWaiver = (playerId: string) => {
    const cur = new Set(finances.feeExemptIds || []);
    if (cur.has(playerId)) cur.delete(playerId);
    else cur.add(playerId);
    setFinanceFields({ feeExemptIds: [...cur] });
  };

  // ---- Budget Planner form state. Quantity mode plans count × per-unit cost
  // (per-tournament planner); flat mode is a single dollar amount.
  const [budgetLabel, setBudgetLabel] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetQty, setBudgetQty] = useState("");
  const [qtyMode, setQtyMode] = useState(false);
  const [unitNoun, setUnitNoun] = useState("per unit");
  // Default the new item's `taxable` flag — seeded from a preset (physical
  // goods / tournament entries quote pre-tax), toggleable before adding.
  const [budgetTaxable, setBudgetTaxable] = useState(false);
  // Spending area for the new item. "" = auto (inferred from the label at read
  // time); a preset seeds its own category, and the coach can override.
  const [budgetCategory, setBudgetCategory] = useState<FinanceCategoryId | "">(
    "",
  );
  // ---- Sponsorships (next season) form state
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorAmount, setSponsorAmount] = useState("");
  // Which season a new sponsor applies to: "this" posts a fundraising income
  // that lowers current dues; "next" pledges toward next season's planned fee.
  // Defaults to "next" — this section is the next-season planner.
  const [sponsorWhen, setSponsorWhen] = useState<"this" | "next">("next");
  // Per-sponsor choice for the NEW entry: whether this sponsor's money lowers
  // what families pay (default yes). Each recorded sponsor keeps its own
  // switch afterward — it's never all-or-nothing across sponsors.
  const [sponsorReduces, setSponsorReduces] = useState(true);
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
  // Revenue source for money-in entries ("" = infer from the label).
  const [txnRevenueCategory, setTxnRevenueCategory] = useState<
    RevenueCategoryId | ""
  >("");
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

  // Render cap (audit finding 3.8): the full ledger stays the source for all
  // math and the CSV; only the RENDERED rows are bounded. On the default
  // date-asc sort the window is the tail (the most recent entries) so the
  // running balance column reads naturally; on other sorts it's the head.
  const [showAllLedger, setShowAllLedger] = useState(false);
  const ledgerCapped =
    !showAllLedger && sortedLedger.length > LEDGER_RENDER_CAP;
  const visibleLedger = !ledgerCapped
    ? sortedLedger
    : ledgerSort.key === "date" && ledgerSort.asc
      ? sortedLedger.slice(-LEDGER_RENDER_CAP)
      : sortedLedger.slice(0, LEDGER_RENDER_CAP);

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

  // Budget-vs-actual rolled up by spending area (the by-category summary).
  const categoryRows = useMemo(() => budgetByCategory(finances), [finances]);
  // Accountant view of money in: every dollar of revenue attributed to a
  // source (dues from the payment tracker, tagged or inferred ledger income).
  const revenueRows = useMemo(() => incomeByCategory(finances), [finances]);

  // ---- Inline budget-item editing (label + cost, keeping the item's mode).
  const [itemEdit, setItemEdit] = useState<{
    id: string;
    mode: "qty" | "flat";
    label: string;
    qty: string;
    unitAmount: string;
    amount: string;
    category: FinanceCategoryId | "";
  } | null>(null);
  const startItemEdit = (item: BudgetItem) =>
    setItemEdit({
      id: item.id,
      mode: item.qty != null && item.unitAmount != null ? "qty" : "flat",
      label: item.label,
      qty: item.qty != null ? String(item.qty) : "",
      unitAmount: item.unitAmount != null ? String(item.unitAmount) : "",
      amount: item.amount != null ? String(item.amount) : "",
      // "" = auto (fall back to inference); a stored category preselects.
      category: item.category ?? "",
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
    // "" clears any stored category (reverts to inference); undefined is
    // scrubbed by the finance sanitizer before it reaches Firestore.
    patch.category = itemEdit.category || undefined;
    updateFinances({
      op: "mapEntries",
      key: "budgetItems",
      map: (items) =>
        items.map((b) => (b.id === itemEdit.id ? { ...b, ...patch } : b)),
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
    if (n >= 0) setFinanceFields({ plannedPlayerCount: n });
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
      (finances.incomes || []).filter(
        (i) => isCarryover(i) && !i.fundraising && !i.dismissed,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finances.incomes],
  );
  const carryoverPendingTotal = carryoverPending.reduce(
    (sum, i) => sum + (Number(i.amount) || 0),
    0,
  );
  // Two-tap confirm for the pending prompt: the first Yes/No swaps the row to a
  // confirm message; tapping the same answer again commits. Null = the initial
  // question. Resets whenever the pending set changes (apply/dismiss/new roll).
  const [carryoverChoice, setCarryoverChoice] = useState<
    null | "apply" | "skip"
  >(null);
  const applyCarryoverDiscount = () => {
    updateFinances({
      op: "mapEntries",
      key: "incomes",
      map: (items) =>
        items.map((i) =>
          isCarryover(i) && !i.fundraising ? { ...i, fundraising: true } : i,
        ),
    });
    setCarryoverChoice(null);
    toast.push({
      kind: "success",
      title: "Carryover applied to team fees",
      message: "Last season's surplus now discounts every family's fee.",
    });
  };

  // "No, skip" — leave the surplus in the bank as plain income and stop asking.
  // Flags the pending carryover entries as dismissed so the prompt never
  // returns; the money still counts toward the club balance.
  const dismissCarryoverDiscount = () => {
    updateFinances({
      op: "mapEntries",
      key: "incomes",
      map: (items) =>
        items.map((i) =>
          isCarryover(i) && !i.fundraising && !i.dismissed
            ? { ...i, dismissed: true }
            : i,
        ),
    });
    setCarryoverChoice(null);
    toast.push({
      kind: "success",
      title: "Left in the bank",
      message: "Last season's surplus stays in the bank — we won't ask again.",
    });
  };

  // ---- Reverse the apply above. Applying flips the carryover entry to
  // `fundraising: true`; this flips it back so the surplus sits in the bank
  // again instead of discounting dues. Lets a coach undo a mistaken tap
  // without hand-editing the ledger.
  const carryoverApplied = useMemo(
    () =>
      (finances.incomes || []).filter((i) => isCarryover(i) && i.fundraising),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finances.incomes],
  );
  const carryoverAppliedTotal = carryoverApplied.reduce(
    (sum, i) => sum + (Number(i.amount) || 0),
    0,
  );
  const reverseCarryoverDiscount = () => {
    updateFinances({
      op: "mapEntries",
      key: "incomes",
      map: (items) =>
        items.map((i) =>
          isCarryover(i) && i.fundraising ? { ...i, fundraising: false } : i,
        ),
    });
    toast.push({
      kind: "success",
      title: "Carryover discount reversed",
      message: "Last season's surplus is back in the bank, not on dues.",
    });
  };

  const applyPreset = (preset: BudgetPreset) => {
    setBudgetLabel(preset.label);
    // A preset with a per-unit noun plans as count × per-unit; one without is a
    // single flat amount (insurance, registration). Only quantity mode seeds a
    // roster count.
    const qty = Boolean(preset.unitNoun);
    setQtyMode(qty);
    setUnitNoun(preset.unitNoun || "per unit");
    setBudgetQty(
      qty && preset.qtyFromRoster && players.length > 0
        ? String(players.length)
        : "",
    );
    setBudgetTaxable(Boolean(preset.taxable));
    setBudgetCategory(groupToCategory[preset.group]);
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
        ...(budgetTaxable ? { taxable: true } : {}),
        ...(budgetCategory ? { category: budgetCategory } : {}),
      };
    } else {
      const amount = parseAmount(budgetAmount);
      if (amount == null) return;
      item = {
        id: newId("b"),
        label: budgetLabel.trim(),
        amount,
        ...(budgetTaxable ? { taxable: true } : {}),
        ...(budgetCategory ? { category: budgetCategory } : {}),
      };
    }
    updateFinances({ op: "append", key: "budgetItems", entry: item });
    setBudgetLabel("");
    setBudgetAmount("");
    setBudgetQty("");
    setQtyMode(false);
    setUnitNoun("per unit");
    setBudgetTaxable(false);
    setBudgetCategory("");
  };

  const removeBudgetItem = (id: string) =>
    updateFinances({ op: "removeById", key: "budgetItems", id });

  const addSponsorship = (e?: React.FormEvent) => {
    e?.preventDefault();
    const amount = parseAmount(sponsorAmount);
    const name = sponsorName.trim();
    if (!name || amount == null) return;
    if (sponsorWhen === "this") {
      // Current-season sponsor income, flagged `sponsor` so the planner lists
      // it as one. Its own "reduces team fees" switch decides whether it's a
      // fundraising credit against dues or plain club income.
      updateFinances({
        op: "append",
        key: "incomes",
        entry: {
          id: newId("inc"),
          date: dateToIsoLocal(new Date()),
          label: name,
          amount,
          ...(sponsorReduces ? { fundraising: true } : {}),
          sponsor: true,
          ...recordedStamp(),
        },
      });
    } else {
      updateFinances({
        op: "append",
        key: "sponsorships",
        entry: {
          id: newId("sp"),
          sponsor: name,
          amount,
          date: dateToIsoLocal(new Date()),
          ...(sponsorReduces ? {} : { reducesFees: false }),
        },
      });
    }
    toast.push({
      kind: "success",
      title: sponsorReduces
        ? "Sponsor added — fees reduced"
        : "Sponsor added as club income",
      message: !sponsorReduces
        ? `${name} adds ${formatCurrency(amount)} to the club — team fees are unchanged.`
        : sponsorWhen === "this"
          ? `${name} lowers this season's fees by ${formatCurrency(amount)}.`
          : `${name} offsets next season's planned fee by ${formatCurrency(amount)}.`,
    });
    setSponsorName("");
    setSponsorAmount("");
  };

  const removeSponsorship = (id: string) =>
    updateFinances({ op: "removeById", key: "sponsorships", id });

  // Flip an existing NEXT-season pledge's own "reduces team fees" switch.
  const togglePledgeReduces = (id: string) =>
    updateFinances({
      op: "mapEntries",
      key: "sponsorships",
      map: (items) =>
        items.map((s) =>
          s.id === id ? { ...s, reducesFees: s.reducesFees === false } : s,
        ),
    });

  // Current-season sponsors live in the income ledger but are surfaced here
  // with their own remove + fee-switch controls. Filtered on the sponsor flag
  // alone so sponsors held as plain income (no fundraising credit) still list.
  const currentSponsors = useMemo(
    () => (finances.incomes || []).filter((i) => i.sponsor),
    [finances.incomes],
  );

  // Flip an existing THIS-season sponsor between fee-crediting fundraising and
  // plain club income. The `fundraising` flag on the income IS its switch —
  // the ledger badge and the dues math both follow it.
  const toggleCurrentSponsorReduces = (id: string) =>
    updateFinances({
      op: "mapEntries",
      key: "incomes",
      map: (items) =>
        items.map((i) =>
          i.id === id
            ? i.fundraising
              ? (() => {
                  const { fundraising: _off, playerId: _kid, ...rest } = i;
                  return rest;
                })()
              : { ...i, fundraising: true }
            : i,
        ),
    });
  const currentSponsorTotal = useMemo(
    () =>
      currentSponsors.reduce((sum, sp) => sum + (Number(sp.amount) || 0), 0),
    [currentSponsors],
  );
  const removeCurrentSponsor = (id: string) =>
    updateFinances({ op: "removeById", key: "incomes", id });

  // Stepper on a quantity item ("how many tournaments?"). Keeps the mirrored
  // flat amount in sync so budgetItemAmount and legacy readers agree.
  const stepBudgetQty = (id: string, delta: number) =>
    updateFinances({
      op: "mapEntries",
      key: "budgetItems",
      map: (items) =>
        items.map((b) => {
          if (b.id !== id || b.qty == null || b.unitAmount == null) return b;
          const qty = Math.max(1, Math.round(b.qty + delta));
          return { ...b, qty, amount: qty * b.unitAmount };
        }),
    });

  const recordPayment = (playerId: string, amount: number) => {
    if (amount <= 0) return;
    updateFinances({
      op: "append",
      key: "payments",
      entry: {
        id: newId("pay"),
        playerId,
        date: dateToIsoLocal(new Date()),
        amount: round2(amount),
        ...recordedStamp(),
      },
    });
    setPayInputs((cur) => ({ ...cur, [playerId]: "" }));
  };

  // Money returned to a family (drop-out, overpayment, returned deposit).
  // Recorded as a payment with `refund: true` — a positive amount that all
  // math treats as negative — never as a fake expense, which would corrupt
  // the budget's category spend. Capped at what the family has net-paid.
  const recordRefund = async (playerId: string, name: string, paid: number) => {
    const raw = await promptText({
      title: `Refund ${name}`,
      message: `They've paid ${formatCurrency(paid)} so far. The refund shows in the ledger as money out and raises what they owe.`,
      label: "Refund amount",
      placeholder: String(paid),
      confirmLabel: "Record refund",
    });
    if (raw == null) return;
    const amount = parseMoneyInput(raw);
    if (amount == null) {
      toast.push({ kind: "error", title: "Enter a valid refund amount" });
      return;
    }
    if (round2(amount - paid) > 0) {
      toast.push({
        kind: "error",
        title: "Refund exceeds what they've paid",
        message: `${name} has paid ${formatCurrency(paid)} — refund that much or less.`,
      });
      return;
    }
    updateFinances({
      op: "append",
      key: "payments",
      entry: {
        id: newId("ref"),
        playerId,
        date: dateToIsoLocal(new Date()),
        amount,
        refund: true,
        ...recordedStamp(),
      },
    });
    toast.push({
      kind: "success",
      title: `Refunded ${formatCurrency(amount)} to ${name}`,
    });
  };

  const addTransaction = (e?: React.FormEvent) => {
    e?.preventDefault();
    const amount = parseAmount(txnAmount);
    if (!txnLabel.trim() || amount == null) return;
    const entry = {
      id: newId(txnDir === "in" ? "inc" : "exp"),
      // A cleared/malformed date input falls back to today rather than
      // writing an undated entry (audit finding 3.4).
      date: isValidIsoDate(txnDate) ? txnDate : dateToIsoLocal(new Date()),
      label: txnLabel.trim(),
      amount,
      ...recordedStamp(),
    };
    if (txnDir === "in") {
      const incomeEntry = {
        ...entry,
        ...(txnRevenueCategory ? { category: txnRevenueCategory } : {}),
        ...(txnFundraising
          ? {
              fundraising: true,
              ...(txnCreditPlayerId ? { playerId: txnCreditPlayerId } : {}),
            }
          : {}),
      };
      updateFinances({ op: "append", key: "incomes", entry: incomeEntry });
    } else {
      updateFinances({
        op: "append",
        key: "expenses",
        entry: txnCategory ? { ...entry, budgetItemId: txnCategory } : entry,
      });
    }
    setTxnLabel("");
    setTxnAmount("");
    setTxnCategory("");
    setTxnRevenueCategory("");
    setTxnFundraising(false);
    setTxnCreditPlayerId("");
  };

  const removeLedgerRow = (
    source: "income" | "expense" | "payment",
    id: string,
  ) => {
    const key =
      source === "income"
        ? ("incomes" as const)
        : source === "expense"
          ? ("expenses" as const)
          : ("payments" as const);
    updateFinances({ op: "removeById", key, id });
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
    // A cleared date input keeps the row in edit mode — same "keep editing
    // until valid" stance as the amount and label below (audit finding 3.4).
    if (!isValidIsoDate(editDraft.date)) return;
    const date = editDraft.date;
    if (source === "payment") {
      const amount = parseAmount(editDraft.amount);
      if (amount == null || amount < 0) return; // keep editing until valid
      updateFinances({
        op: "mapEntries",
        key: "payments",
        map: (items) =>
          items.map((p) =>
            p.id === id ? { ...p, date, amount: round2(amount) } : p,
          ),
      });
    } else {
      const amount = parseAmount(editDraft.amount);
      const label = editDraft.label.trim();
      if (amount == null || !label) return; // keep editing until valid
      const patch = { date, label, amount };
      if (source === "income") {
        updateFinances({
          op: "mapEntries",
          key: "incomes",
          map: (items) =>
            items.map((x) =>
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
        updateFinances({
          op: "mapEntries",
          key: "expenses",
          map: (items) =>
            items.map((x) =>
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

  // Fee/deposit commits accept 0 as "clear the fee" (allowZero).
  const commitClubFee = () => {
    if (feeInput == null) return;
    const n = parseMoneyInput(feeInput, { allowZero: true });
    if (n != null) setFinanceFields({ clubFee: n });
    setFeeInput(null);
  };

  const commitDeposit = () => {
    if (depositInput == null) return;
    const n = parseMoneyInput(depositInput, { allowZero: true });
    if (n != null) setFinanceFields({ depositAmount: n });
    setDepositInput(null);
  };

  const commitNextDeposit = () => {
    if (nextDepositInput == null) return;
    const n = parseMoneyInput(nextDepositInput, { allowZero: true });
    if (n != null) setFinanceFields({ nextDepositAmount: n });
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
          <SectionCard
            icon={Icons.Users}
            title={
              <>
                Collections — this season{" "}
                <HelpTip topicId="budget-fees" label="About finances" />
              </>
            }
          >
            <div className="py-3 border-b border-line space-y-2">
              {carryoverPendingTotal > 0 && payerCount > 0 && (
                <div className="flex flex-wrap items-center gap-3 py-2 pl-3 border-l-2 border-line-strong">
                  {carryoverChoice === null ? (
                    <>
                      <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
                        Last season left{" "}
                        <span className="font-black text-ink tabular-nums">
                          {formatCurrency(carryoverPendingTotal)}
                        </span>{" "}
                        in the bank. Apply it as a team-fee discount — about{" "}
                        <span className="font-black text-win tabular-nums">
                          {formatCurrency(carryoverPendingTotal / payerCount)}{" "}
                          off per family
                        </span>
                        ?
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label="Apply carryover as team-fee discount"
                          onClick={() => setCarryoverChoice("apply")}
                        >
                          <Icons.Check className="w-4 h-4" /> Yes
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Skip carryover discount"
                          onClick={() => setCarryoverChoice("skip")}
                        >
                          No
                        </Button>
                      </div>
                    </>
                  ) : carryoverChoice === "apply" ? (
                    <>
                      <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
                        Apply{" "}
                        <span className="font-black text-ink tabular-nums">
                          {formatCurrency(carryoverPendingTotal)}
                        </span>{" "}
                        as a team-fee discount? This lowers every family&apos;s
                        fee — you can reverse it later.
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label="Confirm apply carryover discount"
                          onClick={applyCarryoverDiscount}
                        >
                          <Icons.Check className="w-4 h-4" /> Yes, apply
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Cancel carryover choice"
                          onClick={() => setCarryoverChoice(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
                        Keep{" "}
                        <span className="font-black text-ink tabular-nums">
                          {formatCurrency(carryoverPendingTotal)}
                        </span>{" "}
                        in the bank and stop asking?
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label="Confirm skip carryover discount"
                          onClick={dismissCarryoverDiscount}
                        >
                          No, skip
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Cancel carryover choice"
                          onClick={() => setCarryoverChoice(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {carryoverAppliedTotal > 0 && (
                <div className="flex flex-wrap items-center gap-3 py-2 pl-3 border-l-2 border-line-strong">
                  <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
                    Last season&apos;s{" "}
                    <span className="font-black text-ink tabular-nums">
                      {formatCurrency(carryoverAppliedTotal)}
                    </span>{" "}
                    surplus is applied as a team-fee discount. Reverse it if
                    that was a mistake.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Reverse carryover team-fee discount"
                    onClick={reverseCarryoverDiscount}
                  >
                    <Icons.Refresh className="w-4 h-4" /> Reverse discount
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
                        (p) =>
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
                              team.currentSeason,
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
                      setFinanceFields({ depositDueDate: e.target.value })
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
                      setFinanceFields({ feeDueDate: e.target.value })
                    }
                    aria-label="All fees due date"
                    className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
                    style={FORM_INPUT_RING_STYLE}
                  />
                </label>
              </div>
            </div>
            {players.length === 0 ? (
              <EmptyState
                glyph="📊"
                title="No Players Yet"
                body="Add players on the Roster tab to track who owes the team fee."
              />
            ) : (
              <ul className="divide-y divide-line">
                {players.map((p) => {
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
                        <>
                          <span className="text-xs font-black uppercase tracking-widest text-win">
                            Paid full ✓
                          </span>
                          <button
                            type="button"
                            aria-label={`Refund ${p.name}`}
                            onClick={() =>
                              void recordRefund(p.id, p.name, paid)
                            }
                            className="text-xs font-bold underline text-ink-3 hover:text-ink"
                          >
                            Refund
                          </button>
                        </>
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
                          {paid > 0 && (
                            <button
                              type="button"
                              aria-label={`Refund ${p.name}`}
                              onClick={() =>
                                void recordRefund(p.id, p.name, paid)
                              }
                              className="text-xs font-bold underline text-ink-3 hover:text-ink"
                            >
                              Refund
                            </button>
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
          <SectionCard icon={Icons.Wallet} title="Ledger">
            <div className="pt-4 space-y-3">
              <form
                onSubmit={addTransaction}
                className="flex flex-col sm:flex-row sm:flex-wrap gap-2"
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
                  // Autocomplete from the youth-baseball catalog — the income
                  // ways-to-raise list for money in, the spend catalog for money
                  // out. Free text is still allowed; these are just suggestions.
                  list={
                    txnDir === "in"
                      ? "ledger-income-suggestions"
                      : "ledger-expense-suggestions"
                  }
                  className={`${FORM_INPUT_CLASS} flex-1 sm:min-w-[12rem]`}
                  style={FORM_INPUT_RING_STYLE}
                />
                <datalist id="ledger-income-suggestions">
                  {INCOME_LABEL_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <datalist id="ledger-expense-suggestions">
                  {EXPENSE_LABEL_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
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
                  <select
                    value={txnRevenueCategory}
                    onChange={(e) =>
                      setTxnRevenueCategory(
                        e.target.value as RevenueCategoryId | "",
                      )
                    }
                    aria-label="Revenue source"
                    title="Where this money came from — feeds the by-source accounting rollup"
                    className={`${FORM_INPUT_CLASS} sm:w-44`}
                    style={FORM_INPUT_RING_STYLE}
                  >
                    <option value="">Source: auto</option>
                    {REVENUE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
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
                    {players.map((p) => (
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
                <div className="flex justify-end gap-4">
                  <button
                    type="button"
                    aria-label="Download treasurer report PDF"
                    onClick={() =>
                      void downloadTreasurerReportPdf({
                        team,
                        finances,
                        players,
                        toast,
                      })
                    }
                    className="text-xs font-black uppercase tracking-widest text-ink-3 hover:text-ink underline"
                  >
                    Treasurer report
                  </button>
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
                      {visibleLedger.map((row, idx) => {
                        // Undated legacy rows sort to the bottom and group
                        // under one "No date" header.
                        const monthKey = isValidIsoDate(row.date)
                          ? row.date.slice(0, 7)
                          : "undated";
                        // Month group headers only make sense in date order.
                        const prevRow = idx > 0 ? visibleLedger[idx - 1] : null;
                        const prevMonthKey = !prevRow
                          ? null
                          : isValidIsoDate(prevRow.date)
                            ? prevRow.date.slice(0, 7)
                            : "undated";
                        const newMonth =
                          ledgerSort.key === "date" &&
                          prevMonthKey !== monthKey;
                        const monthHeader = newMonth ? (
                          <tr key={`m-${monthKey}`} className="bg-app">
                            <td
                              colSpan={6}
                              className="px-2 py-1 t-eyebrow text-ink-3"
                            >
                              {monthKey === "undated"
                                ? "No date"
                                : monthLabel(monthKey)}
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
                                            {players.map((p) => (
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
                            <tr
                              className="hover:bg-surface-2"
                              title={
                                row.recordedBy || row.recordedAt
                                  ? `Recorded${
                                      row.recordedAt
                                        ? ` ${String(row.recordedAt).slice(0, 10)}`
                                        : ""
                                    } by ${
                                      row.recordedBy === user?.uid
                                        ? "you"
                                        : "another coach"
                                    }`
                                  : undefined
                              }
                            >
                              <td className="p-2 tabular-nums font-bold text-ink-2">
                                {isValidIsoDate(row.date)
                                  ? row.date
                                  : "No date"}
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
                  {ledgerCapped && (
                    <div className="pt-2 text-center">
                      <button
                        type="button"
                        onClick={() => setShowAllLedger(true)}
                        className="text-xs font-bold underline text-ink-3 hover:text-ink transition-colors"
                      >
                        Show all {sortedLedger.length} entries
                      </button>
                    </div>
                  )}
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
                        className="text-sm font-bold text-ink-2 tabular-nums"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
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
                        </div>
                        {(ps.outstanding?.length ?? 0) > 0 && (
                          <details className="mt-0.5 text-xs text-ink-3">
                            <summary className="cursor-pointer select-none">
                              Closed with{" "}
                              {formatCurrency(
                                (ps.outstanding || []).reduce(
                                  (sum, o) => sum + o.owed,
                                  0,
                                ),
                              )}{" "}
                              unpaid ({(ps.outstanding || []).length}{" "}
                              {(ps.outstanding || []).length === 1
                                ? "family"
                                : "families"}
                              )
                            </summary>
                            <ul className="mt-1 pl-4 space-y-0.5">
                              {(ps.outstanding || []).map((o) => (
                                <li key={o.playerId}>
                                  {o.name}: {formatCurrency(o.owed)}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
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
        <CashFlowSection
          ledger={ledger}
          months={months}
          finances={finances}
          revenueRows={revenueRows}
        />
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
                  updateFinances({
                    op: "mapEntries",
                    key: "budgetItems",
                    map: () => budgetEstimate.items,
                  })
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
                          <select
                            value={itemEdit.category}
                            onChange={(e) =>
                              setItemEdit((d) =>
                                d
                                  ? {
                                      ...d,
                                      category: e.target.value as
                                        | FinanceCategoryId
                                        | "",
                                    }
                                  : d,
                              )
                            }
                            aria-label={`Edit category for ${item.label}`}
                            className={`${FORM_INPUT_CLASS} sm:w-40 !py-1.5`}
                            style={FORM_INPUT_RING_STYLE}
                          >
                            <option value="">Category: auto</option>
                            {FINANCE_CATEGORIES.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
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
                        <div className="flex-1 min-w-0">
                          <div className="t-body-bold text-ink truncate">
                            {item.label}
                          </div>
                          <div className="t-meta text-ink-3">
                            {categoryLabel(budgetItemCategory(item))}
                          </div>
                        </div>
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
          {/* By-category rollup: planned vs actual spend per spending area, so
              the coach sees where the money goes without scanning every line.
              Legacy/untagged items are folded in by their inferred category. */}
          {categoryRows.length > 0 && (
            <div className="rounded-xl border border-line bg-surface-2/40 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="t-eyebrow text-ink-3">By category</div>
                <div className="t-meta text-ink-3">spent / planned</div>
              </div>
              <ul className="space-y-2">
                {categoryRows.map((r) => (
                  <li key={r.category} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-bold text-ink truncate">
                        {r.label}
                      </span>
                      <span className="tabular-nums whitespace-nowrap text-ink-3">
                        {r.planned > 0 ? (
                          <>
                            <span
                              className={
                                r.spent > r.planned
                                  ? "text-loss font-black"
                                  : "text-ink-2 font-bold"
                              }
                            >
                              {formatCurrency(r.spent)}
                            </span>
                            {" / "}
                            <span>{formatCurrency(r.planned)}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-ink-2 font-bold">
                              {formatCurrency(r.spent)}
                            </span>
                            {" unplanned"}
                          </>
                        )}
                      </span>
                    </div>
                    {r.planned > 0 && (
                      <MoneyMeter value={r.spent} max={r.planned} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Parent-facing handout: one player's fee spread across the
              expected expenses, as a printable/shareable PDF. */}
          {feeSheetReady && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 p-3">
              <p className="t-meta text-ink-3 flex-1 min-w-[14rem]">
                Hand families a one-page PDF showing where a player&apos;s fee
                goes.
              </p>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Download player fee breakdown PDF"
                onClick={() =>
                  downloadPlayerFeeSheetPdf({ team, finances, players, toast })
                }
              >
                <Icons.Printer className="w-4 h-4" /> Player fee sheet
              </Button>
            </div>
          )}
          {/* Quick-add catalog: tap a common youth-baseball line item to
              prefill the add form. Grouped by spending area and scrollable so
              the full catalog never dominates the tab. */}
          <div className="space-y-2 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface-2/40 p-3">
            {BUDGET_PRESET_GROUPS.map((group) => (
              <div key={group} className="space-y-1.5">
                <div className="t-eyebrow text-ink-3">{group}</div>
                <div className="flex flex-wrap gap-1.5">
                  {BUDGET_PRESETS.filter((p) => p.group === group).map(
                    (preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-surface-2 hover:bg-line text-ink-2 transition-colors"
                      >
                        + {preset.label}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* Mode toggles for a manual add: quantity planning + a taxable
              default (seeded by the preset, editable here before adding). */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Toggle count mode"
              aria-pressed={qtyMode}
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
                      color: "var(--team-ink)",
                    }
                  : undefined
              }
            >
              × count
            </button>
            <button
              type="button"
              aria-label="Toggle sales tax on the new item"
              aria-pressed={budgetTaxable}
              title="Add this item's cost pre-tax; sales tax is applied in the planner totals."
              onClick={() => setBudgetTaxable((v) => !v)}
              className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
                budgetTaxable
                  ? "bg-win/10 text-win"
                  : "bg-surface-2 hover:bg-line text-ink-3"
              }`}
            >
              +tax
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
            {/* Spending area for by-category reporting. "Auto" leaves it to be
                inferred from the name; a preset preselects its own area. */}
            <select
              value={budgetCategory}
              onChange={(e) =>
                setBudgetCategory(e.target.value as FinanceCategoryId | "")
              }
              aria-label="New item category"
              className={`${FORM_INPUT_CLASS} sm:w-44`}
              style={FORM_INPUT_RING_STYLE}
            >
              <option value="">Category: auto</option>
              {FINANCE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" size="md">
              <Icons.Plus className="w-4 h-4" /> Add
            </Button>
          </form>
          {/* Sponsorships reduce fees. "This season" entries post as
              fundraising income (lowering current dues); "next season" entries
              offset the planned fee and convert to income when the season
              advances. */}
          <div className="pt-2 border-t border-line space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="t-eyebrow text-ink-3">Sponsorships</div>
              <div className="flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
                {(
                  [
                    ["this", "This season"],
                    ["next", "Next season"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    aria-label={`Sponsor applies to ${label.toLowerCase()}`}
                    aria-pressed={sponsorWhen === val}
                    onClick={() => setSponsorWhen(val)}
                    className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
                      sponsorWhen === val
                        ? "bg-surface text-ink shadow-sm"
                        : "text-ink-3 hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="t-meta text-ink-3">
              {sponsorWhen === "this"
                ? "Posts to this season's ledger. Each sponsor has its own switch for whether the money lowers what families owe."
                : "Pledged toward next season's budget; becomes income when the season advances. Each pledge has its own switch for whether it offsets the planned fee."}
            </p>
            {currentSponsors.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="t-eyebrow text-ink-3">This season</span>
                  <span className="t-eyebrow tabular-nums text-win">
                    {formatCurrency(currentSponsorTotal)} total
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {currentSponsors.map((sp) => (
                    <li key={sp.id} className="py-2 flex items-center gap-3">
                      <span className="t-body-bold text-ink flex-1 truncate">
                        {sp.label}
                      </span>
                      <button
                        type="button"
                        aria-pressed={!!sp.fundraising}
                        aria-label={`${sp.label}: ${sp.fundraising ? "reduces team fees — tap to hold as club income" : "held as club income — tap to reduce team fees"}`}
                        title={
                          sp.fundraising
                            ? "Credits this season's dues. Tap to hold as plain club income instead."
                            : "Plain club income — fees unchanged. Tap to credit this season's dues."
                        }
                        onClick={() => toggleCurrentSponsorReduces(sp.id)}
                        className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-colors ${
                          sp.fundraising
                            ? "bg-win/10 text-win"
                            : "bg-surface-2 text-ink-3 hover:text-ink"
                        }`}
                      >
                        {sp.fundraising ? "reduces fees" : "club income"}
                      </button>
                      <span className="tabular-nums font-black text-win">
                        {formatCurrency(sp.amount)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove this-season sponsor ${sp.label}`}
                        onClick={() => removeCurrentSponsor(sp.id)}
                        className="text-ink-3 hover:text-loss transition-colors"
                      >
                        <Icons.X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(finances.sponsorships || []).length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="t-eyebrow text-ink-3">Next season</span>
                  <span className="t-eyebrow tabular-nums text-win">
                    {formatCurrency(sponsored)} total
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {(finances.sponsorships || []).map((sp) => (
                    <li key={sp.id} className="py-2 flex items-center gap-3">
                      <span className="t-body-bold text-ink flex-1 truncate">
                        {sp.sponsor}
                      </span>
                      <button
                        type="button"
                        aria-pressed={sp.reducesFees !== false}
                        aria-label={`${sp.sponsor}: ${sp.reducesFees !== false ? "offsets the planned fee — tap to hold as club income" : "held as club income — tap to offset the planned fee"}`}
                        title={
                          sp.reducesFees !== false
                            ? "Offsets next season's suggested fee. Tap to plan as plain club income instead."
                            : "Planned as club income — the suggested fee ignores it. Tap to offset the fee."
                        }
                        onClick={() => togglePledgeReduces(sp.id)}
                        className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-colors ${
                          sp.reducesFees !== false
                            ? "bg-win/10 text-win"
                            : "bg-surface-2 text-ink-3 hover:text-ink"
                        }`}
                      >
                        {sp.reducesFees !== false
                          ? "reduces fees"
                          : "club income"}
                      </button>
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
              </div>
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
              <label
                className="flex items-center gap-1.5 self-center text-xs font-bold text-ink-2 whitespace-nowrap cursor-pointer"
                title={
                  sponsorWhen === "this"
                    ? "Checked: credits this season's dues. Unchecked: plain club income — fees unchanged."
                    : "Checked: offsets next season's suggested fee. Unchecked: planned as plain club income."
                }
              >
                <input
                  type="checkbox"
                  checked={sponsorReduces}
                  onChange={(e) => setSponsorReduces(e.target.checked)}
                  aria-label="This sponsor reduces team fees"
                  className="accent-[var(--team-primary)]"
                />
                Reduces team fees
              </label>
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
                  onClick={() =>
                    setFinanceFields({ feeBufferIncrement: opt.inc })
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
            <div className="flex flex-col gap-1">
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
              {/* One-tap common deposit slices — sets the amount immediately. */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {DEPOSIT_QUICK_PICKS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    aria-label={`Set next season deposit to ${formatCurrency(amt)}`}
                    aria-pressed={finances.nextDepositAmount === amt}
                    onClick={() => {
                      setNextDepositInput(null);
                      setFinanceFields({ nextDepositAmount: amt });
                    }}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black tabular-nums transition-colors ${
                      finances.nextDepositAmount === amt
                        ? "bg-win/10 text-win"
                        : "bg-surface-2 hover:bg-line text-ink-3"
                    }`}
                  >
                    {formatCurrency(amt)}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="t-eyebrow text-ink-3">
                Next season deposit due
              </span>
              <input
                type="date"
                value={finances.nextDepositDueDate || ""}
                onChange={(e) =>
                  setFinanceFields({ nextDepositDueDate: e.target.value })
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
              {sponsoredOffset > 0 && (
                <> − sponsorships {formatCurrency(sponsoredOffset)}</>
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
                onClick={() => setFinanceFields({ nextClubFee: suggested })}
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
