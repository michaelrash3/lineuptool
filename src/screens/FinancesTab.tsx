import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useUI, useToast, useConfirm } from "../contexts";
import { FinanceHero, MoneyMeter } from "../components/financeViz";
import {
  formatCurrency,
  budgetTotal,
  nextBudgetTotal,
  feeFundedBudgetTotal,
  fundraisingGoalSummary,
  nextFundraisingGoalTotal,
  budgetItemAmount,
  budgetActuals,
  monthlyCashflow,
  yearComparison,
  sponsorshipTotal,
  feeOffsetSponsorshipTotal,
  suggestedFeePerPlayer,
  suggestedNextFeePerPlayer,
  externalOrgFeeContext,
  nextExternalOrgFeeContext,
  draftBudgetFromCurrent,
  plannedPayerCount,
  buildPlayerFeeBreakdown,
  estimateBudgetFromSeason,
  budgetByCategory,
  incomeByCategory,
  financeSummary,
  financeIntegrity,
  isFamilyPayoutEarmark,
  isVoided,
  seasonOutlook,
  reimbursementsSummary,
  passThroughSummary,
  freeCashSummary,
  reconciliationStatus,
  transactionLedger,
  dateToIsoLocal,
  isValidIsoDate,
  parseMoneyInput,
  round2,
} from "../utils/helpers";
import type { LedgerRow } from "../utils/helpers";
import type { BudgetItem, Player, Team, TeamFinances } from "../types";
import type { FinanceSetFields } from "../utils/financeUpdates";
import { type RevenueCategoryId } from "../constants/financeCategories";
import { SectionCard } from "./finances/SectionCard";
import { CashFlowSection } from "./finances/CashFlowSection";
import { SponsorshipSection } from "./finances/SponsorshipSection";
import { FeeCollectionSection } from "./finances/FeeCollectionSection";
import { FeeAdjustmentsCard } from "./finances/FeeAdjustmentsCard";
import { ReimbursementQueueSection } from "./finances/ReimbursementQueueSection";
import { FeeReliefCard } from "./finances/FeeReliefCard";
import { ReconciliationSection } from "./finances/ReconciliationSection";
import { LedgerSection } from "./finances/LedgerSection";
import { PlannedRosterCard } from "./finances/budget/PlannedRosterCard";
import { BudgetPresetsCard } from "./finances/budget/BudgetPresetsCard";
import { BudgetItemsCard } from "./finances/budget/BudgetItemsCard";
import { SeasonOutlookCard } from "./finances/budget/SeasonOutlookCard";
import { useBudgetListEditor } from "./finances/budget/useBudgetListEditor";
import {
  newId,
  parseAmount,
  parseCount,
  monthLabel,
  LEDGER_RENDER_CAP,
} from "./finances/financeHelpers";
import type { LedgerSortKey, BudgetSortKey } from "./finances/financeHelpers";
import { Button } from "../components/shared";

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

  // Edit stamp for an in-place ledger edit — the creation stamps are preserved,
  // this records who last touched the row (audit finding 3.7).
  const editStamp = () => ({
    lastEditedBy: user?.uid as string | undefined,
    lastEditedAt: new Date().toISOString(),
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
  // Data-health check for the reconcile nudge: finance rows pointing at a
  // deleted player or budget item. Non-blocking; the money math is unaffected.
  const integrity = useMemo(
    () => financeIntegrity(finances, players),
    [finances, players],
  );
  const orphanCount =
    integrity.orphanPlayerRefs +
    integrity.orphanExpenseLinks +
    integrity.orphanFeeReliefLinks;
  // Forward-looking projection for the Budget Planner (pure-derived, no writes).
  const outlook = useMemo(
    () => seasonOutlook(finances, players),
    [finances, players],
  );
  const toast = useToast();
  const { promptText, confirm } = useConfirm();
  // THIS club year's working budget and its fee guidance (what clubFee should
  // be). Sponsorship pledges are next-season money — they never offset this.
  // `budget` stays the FULL plan (meters want the whole picture); the fee
  // guidance divides only the fee-funded slice, and fundraise-marked lines
  // roll up into the fundraising goal card below.
  const budget = budgetTotal(finances);
  const feeFundedBudget = feeFundedBudgetTotal(finances);
  const fundraiseGoal = useMemo(
    () => fundraisingGoalSummary(finances),
    [finances],
  );
  const suggested = suggestedFeePerPlayer(finances, players);
  // NEXT club year's draft and its suggested fee. Next-season planning is
  // deliberately isolated from this year's ledger: only sponsorships pledged
  // for the coming year offset the draft's suggested fee. The draft's own
  // fundraising goal is a total only — no progress, the year hasn't happened.
  const draftBudget = nextBudgetTotal(finances);
  const draftFundraiseGoal = nextFundraisingGoalTotal(finances);
  const draftSuggested = suggestedNextFeePerPlayer(finances, players);
  const sponsored = sponsorshipTotal(finances);
  // The slice of pledges whose own switch offsets the fee — what the planner
  // math line shows. Pledges held as club income are excluded.
  const sponsoredOffset = feeOffsetSponsorshipTotal(finances);
  // The parent-facing fee sheet needs both priced expenses and a per-player
  // fee (next-season fee, or the planner's suggestion) to spread across them.
  const feeSheetReady = useMemo(
    () => buildPlayerFeeBreakdown(finances, players) != null,
    [finances, players],
  );
  const clubFee = Math.max(0, Number(finances.clubFee) || 0);
  // Outside-org fee context (display only): what families pay DIRECTLY to the
  // parent organization. Surfaces beside the fee decisions so the coach sees
  // total family burden; deliberately absent from every money aggregate. The
  // draft's burden context prefers the staged next-season value and falls
  // back to this one.
  const orgFee = externalOrgFeeContext(finances);
  const draftOrgFee = nextExternalOrgFeeContext(finances);
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

  // Outside-org fee editor (planner settings): label + amount, committed on
  // blur/Enter. Both empty → the field clears. Writes only the display-only
  // externalOrgFee context — no ledger entry, no totals.
  const [orgFeeLabelInput, setOrgFeeLabelInput] = useState<string | null>(null);
  const [orgFeeAmountInput, setOrgFeeAmountInput] = useState<string | null>(
    null,
  );
  const commitExternalOrgFee = () => {
    if (orgFeeLabelInput == null && orgFeeAmountInput == null) return;
    const label = (
      orgFeeLabelInput ??
      finances.externalOrgFee?.label ??
      ""
    ).trim();
    const rawAmount =
      orgFeeAmountInput ??
      (finances.externalOrgFee?.amount
        ? String(finances.externalOrgFee.amount)
        : "");
    const amount = round2(Math.max(0, parseAmount(rawAmount) ?? 0));
    if (!label && amount <= 0) setFinanceFields({ externalOrgFee: null });
    else setFinanceFields({ externalOrgFee: { label, amount } });
    setOrgFeeLabelInput(null);
    setOrgFeeAmountInput(null);
  };

  // STAGED next-season org fee (draft planner) — the nextClubFee pattern:
  // written to nextExternalOrgFee, promoted to externalOrgFee at the fall
  // roll. Both fields empty → cleared, and the draft's burden context falls
  // back to the current externalOrgFee.
  const [nextOrgFeeLabelInput, setNextOrgFeeLabelInput] = useState<
    string | null
  >(null);
  const [nextOrgFeeAmountInput, setNextOrgFeeAmountInput] = useState<
    string | null
  >(null);
  const commitNextExternalOrgFee = () => {
    if (nextOrgFeeLabelInput == null && nextOrgFeeAmountInput == null) return;
    const label = (
      nextOrgFeeLabelInput ??
      finances.nextExternalOrgFee?.label ??
      ""
    ).trim();
    const rawAmount =
      nextOrgFeeAmountInput ??
      (finances.nextExternalOrgFee?.amount
        ? String(finances.nextExternalOrgFee.amount)
        : "");
    const amount = round2(Math.max(0, parseAmount(rawAmount) ?? 0));
    if (!label && amount <= 0) setFinanceFields({ nextExternalOrgFee: null });
    else setFinanceFields({ nextExternalOrgFee: { label, amount } });
    setNextOrgFeeLabelInput(null);
    setNextOrgFeeAmountInput(null);
  };

  const toggleFeeWaiver = (playerId: string) => {
    const cur = new Set(finances.feeExemptIds || []);
    if (cur.has(playerId)) cur.delete(playerId);
    else cur.add(playerId);
    setFinanceFields({ feeExemptIds: [...cur] });
  };

  // ---- Budget list editors: one for this season's working budget, one for
  // next season's draft. Each carries its own add form (preset prefill,
  // quantity mode, +tax, category), inline edit, stepper, and sort state, and
  // every mutation targets its own array — a draft edit can never touch the
  // live list (see useBudgetListEditor).
  const liveBudgetEditor = useBudgetListEditor(
    "budgetItems",
    updateFinances,
    players.length,
  );
  const draftBudgetEditor = useBudgetListEditor(
    "nextBudgetItems",
    updateFinances,
    players.length,
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
  // Money-in entries earmarked as pass-through fee relief: held to be paid
  // back out to families, never a dues credit. Mutually exclusive with the
  // fundraising flag — turning one on turns the other off.
  const [txnEarmark, setTxnEarmarkRaw] = useState(false);
  const setTxnFundraisingExclusive = (on: boolean) => {
    setTxnFundraising(on);
    if (on) setTxnEarmarkRaw(false);
  };
  const setTxnEarmark = (on: boolean) => {
    setTxnEarmarkRaw(on);
    if (on) {
      setTxnFundraising(false);
      setTxnCreditPlayerId("");
    }
  };
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
  // First tap sorts text columns ascending and money columns descending
  // (biggest first); tapping again flips. (Budget-column sorting lives in the
  // per-list editors above.)
  const toggleLedgerSort = (key: LedgerSortKey) =>
    setLedgerSort((cur) =>
      cur.key === key
        ? { key, asc: !cur.asc }
        : { key, asc: key === "date" || key === "label" },
    );

  // Whether voided (soft-deleted) rows are shown in the ledger. Hidden by
  // default to declutter; a toggle reveals them (struck through) for review.
  const [showVoided, setShowVoided] = useState(false);
  const voidedCount = useMemo(
    () => ledger.reduce((n, r) => n + (r.voided ? 1 : 0), 0),
    [ledger],
  );

  const sortedLedger = useMemo(() => {
    // Voided rows only appear when the coach opts to show them.
    const base = showVoided ? ledger : ledger.filter((r) => !r.voided);
    const { key, asc } = ledgerSort;
    if (key === "date" && asc) return base; // already date-asc, stable ties
    const dir = asc ? 1 : -1;
    const val = (r: LedgerRow): string | number => {
      if (key === "date") return r.date;
      if (key === "label") return r.label.toLowerCase();
      // Direction columns: rows of the other direction sink to the bottom.
      if (key === "in") return r.direction === "in" ? r.amount : -1;
      if (key === "out") return r.direction === "out" ? r.amount : -1;
      return r.balanceAfter;
    };
    return [...base].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [ledger, ledgerSort, showVoided]);

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
  // read the same numbers. Shared by the live list and the draft (which has
  // no actuals — every draft row's spent is 0).
  const sortBudgetRows = (
    rows: { item: BudgetItem; planned: number; spent: number }[],
    sort: { key: BudgetSortKey; asc: boolean } | null,
  ) => {
    if (!sort) return rows;
    const { key, asc } = sort;
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
  };
  const budgetRows = useMemo(
    () =>
      sortBudgetRows(
        (finances.budgetItems || []).map((item) => ({
          item,
          planned: budgetItemAmount(item, finances.salesTaxPct),
          spent: actuals.byItem[item.id] || 0,
        })),
        liveBudgetEditor.budgetSort,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      finances.budgetItems,
      finances.salesTaxPct,
      actuals,
      liveBudgetEditor.budgetSort,
    ],
  );
  const draftRows = useMemo(
    () =>
      sortBudgetRows(
        (finances.nextBudgetItems || []).map((item) => ({
          item,
          planned: budgetItemAmount(item, finances.salesTaxPct),
          spent: 0,
        })),
        draftBudgetEditor.budgetSort,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      finances.nextBudgetItems,
      finances.salesTaxPct,
      draftBudgetEditor.budgetSort,
    ],
  );

  // Budget-vs-actual rolled up by spending area (the by-category summary).
  const categoryRows = useMemo(() => budgetByCategory(finances), [finances]);
  // Accountant view of money in: every dollar of revenue attributed to a
  // source (dues from the payment tracker, tagged or inferred ledger income).
  const revenueRows = useMemo(() => incomeByCategory(finances), [finances]);

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

  // Rough next-season starting point learned from this season's money — one
  // of the two ways to seed the DRAFT (never the live list).
  const budgetEstimate = useMemo(
    () => estimateBudgetFromSeason(finances),
    [finances],
  );

  // ---- Seed actions for an empty draft. Both write nextBudgetItems only —
  // this season's working budget is never overwritten by seeding. The items
  // are computed BEFORE the op so the map is a constant (updateFinances runs
  // it twice: optimistic apply + payload build).
  const seedDraftFromCurrentBudget = () => {
    const items = draftBudgetFromCurrent(finances);
    if (items.length === 0) return;
    updateFinances({
      op: "mapEntries",
      key: "nextBudgetItems",
      map: () => items,
    });
  };
  const seedDraftFromEstimate = () => {
    if (!budgetEstimate) return;
    updateFinances({
      op: "mapEntries",
      key: "nextBudgetItems",
      map: () => budgetEstimate.items,
    });
  };

  // ---- Surplus carried over from last season, not yet applied to dues.
  // The season roll writes the closing balance as a "Carried over" income
  // entry; one tap flags it as fundraising so it splits across paying
  // families and discounts this year's dues. Debt carries as an expense and
  // never touches dues — that's the club's problem, not the parents'.
  const isCarryover = (i: { id?: string; label?: string; earmark?: string }) =>
    // Pass-through money is never a dues-discount candidate: the roll writes
    // it as its own earmarked entries (own ids/labels), and this guard keeps
    // the prompt away even if an earmarked row ever matched the pattern.
    !i.earmark &&
    (String(i.id || "").startsWith("carry-") ||
      /^Carried over/.test(String(i.label || "")));
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
      // The fee-relief earmark and the fundraising dues credit are mutually
      // exclusive; the earmark branch wins (held-for-families money never
      // credits dues).
      const incomeEntry = {
        ...entry,
        ...(txnRevenueCategory ? { category: txnRevenueCategory } : {}),
        ...(txnEarmark
          ? { earmark: "familyPayout" as const }
          : txnFundraising
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
    setTxnEarmarkRaw(false);
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

  // Soft-delete / restore a ledger row. Voiding keeps the row as an audit trail
  // but counts it for $0 everywhere (isVoided in utils/finances.ts); hard
  // delete (removeLedgerRow) stays available for a genuine mistake. mapEntries
  // is used per key so a concurrent edit to a DIFFERENT row is preserved.
  // Voiding an income with linked feeRelief payout rows also REMOVES the
  // unpaid ones — a promised payout from a fundraiser that never really
  // happened was never a real liability, and leaving it would keep it in
  // "owed to families" and markable-as-paid. PAID rows stay: they posted real
  // expenses and are history. That removal doesn't come back on unvoid, so
  // this one variant confirms first (same danger-confirm the app uses for
  // other destructive actions).
  const voidLedgerRow = async (
    source: "income" | "expense" | "payment",
    id: string,
  ) => {
    const apply = <T extends { id: string }>(items: T[]): T[] =>
      items.map((x) =>
        x.id === id
          ? { ...x, voidedBy: user?.uid, voidedAt: new Date().toISOString() }
          : x,
      );
    if (source === "income") {
      const unpaidLinked = (finances.reimbursements || []).filter(
        (r) =>
          r.kind === "feeRelief" &&
          r.sourceIncomeId === id &&
          r.status !== "paid" &&
          !isVoided(r),
      );
      if (unpaidLinked.length > 0) {
        const income = (finances.incomes || []).find((i) => i.id === id);
        const total = round2(
          unpaidLinked.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
        );
        const n = unpaidLinked.length;
        const ok = await confirm({
          title: `Void ${income?.label || "this fundraiser"}?`,
          message: `${n === 1 ? "One queued fee-relief payout" : `${n} queued fee-relief payouts`} (${formatCurrency(total)}) drawn from it will be removed — that money was never paid out. Payouts already paid stay as history.`,
          confirmLabel: "Void fundraiser",
          danger: true,
        });
        if (!ok) return;
        updateFinances({ op: "mapEntries", key: "incomes", map: apply });
        const removeIds = new Set(unpaidLinked.map((r) => r.id));
        updateFinances({
          op: "mapEntries",
          key: "reimbursements",
          map: (items) => items.filter((r) => !removeIds.has(r.id)),
        });
        toast.push({
          kind: "success",
          title: "Fundraiser voided",
          message: `Removed ${n === 1 ? "its queued fee-relief payout" : `${n} queued fee-relief payouts`} (${formatCurrency(total)}); payouts already paid stay in the ledger.`,
        });
        return;
      }
      updateFinances({ op: "mapEntries", key: "incomes", map: apply });
    } else if (source === "expense")
      updateFinances({ op: "mapEntries", key: "expenses", map: apply });
    else updateFinances({ op: "mapEntries", key: "payments", map: apply });
  };
  const unvoidLedgerRow = (
    source: "income" | "expense" | "payment",
    id: string,
  ) => {
    // undefined clears the stamps — scrubbed from the write, so isVoided reads
    // false again and the row rejoins every total.
    const apply = <T extends { id: string }>(items: T[]): T[] =>
      items.map((x) =>
        x.id === id
          ? {
              ...x,
              voidedBy: undefined,
              voidedAt: undefined,
              voidReason: undefined,
            }
          : x,
      );
    if (source === "income")
      updateFinances({ op: "mapEntries", key: "incomes", map: apply });
    else if (source === "expense")
      updateFinances({ op: "mapEntries", key: "expenses", map: apply });
    else updateFinances({ op: "mapEntries", key: "payments", map: apply });
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
    earmark: false,
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
      // Earmark precedence mirrors the read side: a row carrying both flags
      // opens as pass-through only, so saving it can't resurrect the credit.
      fundraising: !!inc?.fundraising && !isFamilyPayoutEarmark(inc),
      earmark: isFamilyPayoutEarmark(inc),
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
            p.id === id
              ? { ...p, date, amount: round2(amount), ...editStamp() }
              : p,
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
                    ...editStamp(),
                    // Fundraising and the fee-relief earmark are mutually
                    // exclusive here exactly as on the create form
                    // (addTransaction): the earmark wins, so a plain income
                    // can be promoted to pass-through and an earmarked one
                    // deliberately demoted. undefined values are scrubbed
                    // from the write.
                    earmark: editDraft.earmark
                      ? ("familyPayout" as const)
                      : undefined,
                    fundraising: editDraft.earmark
                      ? false
                      : editDraft.fundraising,
                    // Credit only applies to fundraising entries; clear otherwise.
                    playerId:
                      !editDraft.earmark &&
                      editDraft.fundraising &&
                      editDraft.playerId
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
                    ...editStamp(),
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

  // ---- Per-player fee adjustments (scholarships / sibling discounts).
  const [adjPlayerId, setAdjPlayerId] = useState("");
  const [adjKind, setAdjKind] = useState<
    "scholarship" | "sibling" | "override"
  >("scholarship");
  const [adjMode, setAdjMode] = useState<"amount" | "pct">("amount");
  const [adjValue, setAdjValue] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const addFeeAdjustment = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!adjPlayerId) return;
    const num = Number(String(adjValue).replace(/[$%,\s]/g, ""));
    if (!Number.isFinite(num) || num <= 0) return;
    if (adjMode === "pct" && num > 100) return;
    const entry = {
      id: newId("adj"),
      playerId: adjPlayerId,
      kind: adjKind,
      ...(adjMode === "pct" ? { pct: round2(num) } : { amount: round2(num) }),
      ...(adjNote.trim() ? { note: adjNote.trim() } : {}),
      ...recordedStamp(),
    };
    // One active adjustment per player: replace any existing for them.
    updateFinances({
      op: "mapEntries",
      key: "feeAdjustments",
      map: (items) => [
        ...items.filter((a) => a.playerId !== adjPlayerId),
        entry,
      ],
    });
    setAdjPlayerId("");
    setAdjValue("");
    setAdjNote("");
  };
  const removeFeeAdjustment = (id: string) =>
    updateFinances({ op: "removeById", key: "feeAdjustments", id });

  // ---- Volunteer reimbursements (money owed back to coaches/parents).
  const reimb = useMemo(() => reimbursementsSummary(finances), [finances]);
  const [reimbTo, setReimbTo] = useState("");
  const [reimbAmount, setReimbAmount] = useState("");
  const [reimbNote, setReimbNote] = useState("");
  const addReimbursement = (e?: React.FormEvent) => {
    e?.preventDefault();
    const amount = parseAmount(reimbAmount);
    const to = reimbTo.trim();
    if (!to || amount == null) return;
    updateFinances({
      op: "append",
      key: "reimbursements",
      entry: {
        id: newId("reimb"),
        to,
        amount,
        status: "unpaid",
        date: dateToIsoLocal(new Date()),
        ...(reimbNote.trim() ? { note: reimbNote.trim() } : {}),
        ...recordedStamp(),
      },
    });
    setReimbTo("");
    setReimbAmount("");
    setReimbNote("");
  };
  const markReimbursementPaid = (id: string) => {
    const r = (finances.reimbursements || []).find((x) => x.id === id);
    if (!r || r.status === "paid") return;
    const expenseId = newId("exp");
    const paidDate = dateToIsoLocal(new Date());
    // One cash event: post the expense ONCE, then flip the row to paid.
    // A fee-relief payout is money going back OUT to a family, not a
    // volunteer reimbursement — the expense says which.
    updateFinances({
      op: "append",
      key: "expenses",
      entry: {
        id: expenseId,
        date: paidDate,
        label: `${r.kind === "feeRelief" ? "Fee relief" : "Reimbursement"} — ${r.to}`,
        amount: round2(Number(r.amount) || 0),
        ...recordedStamp(),
      },
    });
    updateFinances({
      op: "mapEntries",
      key: "reimbursements",
      map: (items) =>
        items.map((x) =>
          x.id === id
            ? { ...x, status: "paid", paidDate, linkedExpenseId: expenseId }
            : x,
        ),
    });
  };
  const removeReimbursement = (id: string) =>
    updateFinances({ op: "removeById", key: "reimbursements", id });

  // ---- Pass-through fee-relief fundraisers (IncomeEntry.earmark).
  const passThrough = useMemo(() => passThroughSummary(finances), [finances]);
  // Free cash = balanceNow − unpaid volunteer reimbursements − undisbursed
  // pass-through (unpaid feeRelief payouts already live inside the latter).
  const freeCash = useMemo(
    () => freeCashSummary(finances, players),
    [finances, players],
  );
  // Current paying families — the distribute action's default even split.
  const payingFamilies = useMemo(
    () =>
      players
        .filter((p) => !exemptIds.has(p.id))
        .map((p) => ({ id: p.id, name: p.name || "Player" })),
    [players, exemptIds],
  );
  // Create the unpaid feeRelief payout rows for one earmarked fundraiser.
  // Over-allocation is REFUSED here (against the fundraiser's remaining
  // balance right now), not merely clamped for display.
  const distributeFeeRelief = (
    incomeId: string,
    rows: Array<{ playerId: string; name: string; amount: number }>,
  ): boolean => {
    const fundraiser = passThrough.fundraisers.find((f) => f.id === incomeId);
    if (!fundraiser) return false;
    const total = round2(rows.reduce((sum, r) => sum + r.amount, 0));
    if (total <= 0) return false;
    if (total > fundraiser.remaining) {
      toast.push({
        kind: "error",
        title: "That's more than the fundraiser has left",
        message: `${formatCurrency(fundraiser.remaining)} of ${fundraiser.label} is still unallocated — distribute that much or less.`,
      });
      return false;
    }
    const date = dateToIsoLocal(new Date());
    for (const r of rows) {
      updateFinances({
        op: "append",
        key: "reimbursements",
        entry: {
          id: newId("relief"),
          to: r.name,
          amount: round2(r.amount),
          status: "unpaid",
          kind: "feeRelief",
          playerId: r.playerId,
          sourceIncomeId: incomeId,
          date,
          ...recordedStamp(),
        },
      });
    }
    toast.push({
      kind: "success",
      title: "Fee-relief payouts created",
      message: `${formatCurrency(total)} of ${fundraiser.label} is queued to pay back to ${rows.length} ${rows.length === 1 ? "family" : "families"}.`,
    });
    return true;
  };

  // ---- Month-end reconciliation against the real bank balance.
  const reconRows = useMemo(
    () => reconciliationStatus(finances, players),
    [finances, players],
  );
  const reconcileMonth = async (month: string, ledgerBalanceNow: number) => {
    const raw = await promptText({
      title: `Reconcile ${monthLabel(month)}`,
      message: `Enter the real bank/cash balance at the end of ${monthLabel(
        month,
      )}. The ledger shows ${formatCurrency(ledgerBalanceNow)}.`,
      label: "Bank balance",
      placeholder: String(ledgerBalanceNow),
      confirmLabel: "Save",
    });
    if (raw == null) return;
    // A bank balance can legitimately be negative (overdrawn), so parse
    // directly rather than through the positive-only money parser.
    const bank = Number(String(raw).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(bank)) {
      toast.push({ kind: "error", title: "Enter a valid bank balance" });
      return;
    }
    updateFinances({
      op: "mapEntries",
      key: "reconciliations",
      // Dedupe by month: replace any existing entry for this month.
      map: (items) => [
        ...items.filter((r) => r.month !== month),
        {
          id: newId("rec"),
          month,
          bankBalance: round2(bank),
          ledgerBalanceAtReconcile: ledgerBalanceNow,
          ...recordedStamp(),
        },
      ],
    });
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
        // The free-cash / held-for-families split only exists (and only
        // renders) when a pass-through fundraiser is on the books.
        freeCash={freeCash.hasPassThrough ? freeCash.freeCash : null}
        heldForFamilies={
          freeCash.hasPassThrough ? freeCash.heldForFamilies : null
        }
      />

      {/* Reconcile nudge: finance rows pointing at something since deleted.
          Non-blocking — the money still counts; this only flags rows to review. */}
      {orphanCount > 0 && (
        <div
          role="status"
          className="cc-card flex items-start gap-2.5 p-3 border border-warnfg/30"
          style={{
            background: "color-mix(in srgb, var(--warn-fg) 8%, transparent)",
          }}
        >
          <Icons.Alert className="w-4 h-4 shrink-0 mt-0.5 text-warnfg" />
          <p className="t-meta text-ink-2">
            {orphanCount} record{orphanCount === 1 ? "" : "s"} reference a
            removed player or budget item, or a fee-relief payout whose
            fundraiser was voided. They still count toward the totals — review
            the Ledger and payout queue to re-attribute or remove them.
          </p>
        </div>
      )}

      {/* Desktop control-panel: two-column layout.
          Left (7/12): Collections + Ledger — the operational data.
          Right (5/12): Cash Flow charts — visual summaries.
          On mobile/tablet the columns stack in natural document order. */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-6 space-y-6 lg:space-y-0">
        {/* Left column: Collections + Ledger */}
        <div className="lg:col-span-7 space-y-6">
          {/* Collections */}
          <FeeCollectionSection
            finances={finances}
            players={players}
            team={team}
            summary={summary}
            clubFee={clubFee}
            effectiveFee={effectiveFee}
            totalEffectiveFees={totalEffectiveFees}
            payerCount={payerCount}
            exemptIds={exemptIds}
            feeFor={feeFor}
            recordPayment={recordPayment}
            recordRefund={recordRefund}
            toggleFeeWaiver={toggleFeeWaiver}
            openPlayerProfile={openPlayerProfile}
            feeInput={feeInput}
            setFeeInput={setFeeInput}
            depositInput={depositInput}
            setDepositInput={setDepositInput}
            commitClubFee={commitClubFee}
            commitDeposit={commitDeposit}
            payInputs={payInputs}
            setPayInputs={setPayInputs}
            orgFeeLabelInput={orgFeeLabelInput}
            setOrgFeeLabelInput={setOrgFeeLabelInput}
            orgFeeAmountInput={orgFeeAmountInput}
            setOrgFeeAmountInput={setOrgFeeAmountInput}
            commitExternalOrgFee={commitExternalOrgFee}
            setFinanceFields={setFinanceFields}
            toast={toast}
            carryoverPendingTotal={carryoverPendingTotal}
            carryoverChoice={carryoverChoice}
            setCarryoverChoice={setCarryoverChoice}
            applyCarryoverDiscount={applyCarryoverDiscount}
            dismissCarryoverDiscount={dismissCarryoverDiscount}
            carryoverAppliedTotal={carryoverAppliedTotal}
            reverseCarryoverDiscount={reverseCarryoverDiscount}
          />

          {/* Per-player scholarships / sibling discounts */}
          <FeeAdjustmentsCard
            players={players}
            adjustments={finances.feeAdjustments || []}
            clubFee={clubFee}
            effectiveFeeByPlayer={summary.effectiveFeeByPlayer}
            addFeeAdjustment={addFeeAdjustment}
            removeFeeAdjustment={removeFeeAdjustment}
            adjPlayerId={adjPlayerId}
            setAdjPlayerId={setAdjPlayerId}
            adjKind={adjKind}
            setAdjKind={setAdjKind}
            adjMode={adjMode}
            setAdjMode={setAdjMode}
            adjValue={adjValue}
            setAdjValue={setAdjValue}
            adjNote={adjNote}
            setAdjNote={setAdjNote}
          />

          {/* Fee-relief fundraisers held for families (invisible without one) */}
          <FeeReliefCard
            passThrough={passThrough}
            payers={payingFamilies}
            distribute={distributeFeeRelief}
            externalOrgLabel={orgFee?.label}
          />

          {/* Money owed back out: volunteer reimbursements + family payouts */}
          <ReimbursementQueueSection
            reimbursements={finances.reimbursements || []}
            outstanding={reimb.outstanding}
            feeReliefOutstanding={reimb.feeReliefUnpaid}
            addReimbursement={addReimbursement}
            markReimbursementPaid={markReimbursementPaid}
            removeReimbursement={removeReimbursement}
            reimbTo={reimbTo}
            setReimbTo={setReimbTo}
            reimbAmount={reimbAmount}
            setReimbAmount={setReimbAmount}
            reimbNote={reimbNote}
            setReimbNote={setReimbNote}
          />

          {/* Ledger — money in & money out */}
          <LedgerSection
            finances={finances}
            players={players}
            team={team}
            user={user}
            toast={toast}
            ledger={ledger}
            sortedLedger={sortedLedger}
            visibleLedger={visibleLedger}
            ledgerCapped={ledgerCapped}
            years={years}
            ledgerSort={ledgerSort}
            toggleLedgerSort={toggleLedgerSort}
            setShowAllLedger={setShowAllLedger}
            addTransaction={addTransaction}
            removeLedgerRow={removeLedgerRow}
            voidLedgerRow={voidLedgerRow}
            unvoidLedgerRow={unvoidLedgerRow}
            showVoided={showVoided}
            setShowVoided={setShowVoided}
            voidedCount={voidedCount}
            startLedgerEdit={startLedgerEdit}
            saveLedgerEdit={saveLedgerEdit}
            editRow={editRow}
            setEditRow={setEditRow}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            txnDate={txnDate}
            setTxnDate={setTxnDate}
            txnLabel={txnLabel}
            setTxnLabel={setTxnLabel}
            txnAmount={txnAmount}
            setTxnAmount={setTxnAmount}
            txnDir={txnDir}
            setTxnDir={setTxnDir}
            txnCategory={txnCategory}
            setTxnCategory={setTxnCategory}
            txnRevenueCategory={txnRevenueCategory}
            setTxnRevenueCategory={setTxnRevenueCategory}
            txnFundraising={txnFundraising}
            setTxnFundraising={setTxnFundraisingExclusive}
            txnEarmark={txnEarmark}
            setTxnEarmark={setTxnEarmark}
            txnCreditPlayerId={txnCreditPlayerId}
            setTxnCreditPlayerId={setTxnCreditPlayerId}
          />

          {/* Month-end reconciliation against the real bank balance */}
          <ReconciliationSection
            rows={reconRows}
            reconcileMonth={reconcileMonth}
          />
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

      {/* This season's working budget: the plan behind the current club fee,
          with budget-vs-actual meters. Mid-season edits (umpire count 8 → 10
          in January) are normal and only touch this year's numbers. */}
      <SectionCard
        icon={Icons.Clipboard}
        title="Budget — this season"
        subtitle="The current year's plan — meters track spending against it"
      >
        <div className="p-4 sm:p-5 space-y-3">
          <BudgetItemsCard
            finances={finances}
            players={players}
            team={team}
            summary={summary}
            feeSheetReady={feeSheetReady}
            budgetRows={budgetRows}
            categoryRows={categoryRows}
            budgetSort={liveBudgetEditor.budgetSort}
            toggleBudgetSort={liveBudgetEditor.toggleBudgetSort}
            itemEdit={liveBudgetEditor.itemEdit}
            setItemEdit={liveBudgetEditor.setItemEdit}
            startItemEdit={liveBudgetEditor.startItemEdit}
            saveItemEdit={liveBudgetEditor.saveItemEdit}
            stepBudgetQty={liveBudgetEditor.stepBudgetQty}
            toggleItemTax={liveBudgetEditor.toggleItemTax}
            toggleItemFunding={liveBudgetEditor.toggleItemFunding}
            removeBudgetItem={liveBudgetEditor.removeBudgetItem}
            toast={toast}
          />
          <BudgetPresetsCard
            applyPreset={liveBudgetEditor.applyPreset}
            addBudgetItem={liveBudgetEditor.addBudgetItem}
            qtyMode={liveBudgetEditor.qtyMode}
            setQtyMode={liveBudgetEditor.setQtyMode}
            budgetTaxable={liveBudgetEditor.budgetTaxable}
            setBudgetTaxable={liveBudgetEditor.setBudgetTaxable}
            budgetLabel={liveBudgetEditor.budgetLabel}
            setBudgetLabel={liveBudgetEditor.setBudgetLabel}
            budgetQty={liveBudgetEditor.budgetQty}
            setBudgetQty={liveBudgetEditor.setBudgetQty}
            budgetAmount={liveBudgetEditor.budgetAmount}
            setBudgetAmount={liveBudgetEditor.setBudgetAmount}
            unitNoun={liveBudgetEditor.unitNoun}
            budgetCategory={liveBudgetEditor.budgetCategory}
            setBudgetCategory={liveBudgetEditor.setBudgetCategory}
          />
          {/* THIS year's fee guidance: what the working budget costs per
              paying family — the number clubFee should track. Sponsorship
              pledges (next-season money) never discount it. */}
          {budget > 0 && (
            <div className="t-body text-ink-2 pt-2 border-t border-line">
              Budget total:{" "}
              <span className="font-black text-ink tabular-nums">
                {formatCurrency(budget)}
              </span>
              {/* When lines are marked for fundraising, the fee only answers
                  for the fee-funded slice — say so before the fee math. */}
              {fundraiseGoal.goal > 0 && (
                <>
                  {" "}
                  ({formatCurrency(feeFundedBudget)} from fees +{" "}
                  {formatCurrency(fundraiseGoal.goal)} fundraised)
                </>
              )}
              {suggested != null && (
                <>
                  {" "}
                  → covered by{" "}
                  <span className="font-black text-ink tabular-nums">
                    {formatCurrency(suggested)}
                  </span>{" "}
                  per paying player × {payerCount}
                  {bufferInc > 0 && (
                    <span className="t-meta text-ink-3">
                      {" "}
                      (rounded up to the next ${bufferInc} as buffer)
                    </span>
                  )}
                </>
              )}
              {suggested != null && clubFee > 0 && (
                <div className="t-meta text-ink-3 mt-1">
                  The team fee is currently{" "}
                  <span className="font-black tabular-nums">
                    {formatCurrency(clubFee)}
                  </span>
                  {suggested > clubFee
                    ? " — under what this budget needs per family."
                    : "."}
                </div>
              )}
              {/* Outside-org fee context — display only, so the fee decision
                  is made with the TOTAL family burden in view. */}
              {orgFee && (
                <div className="t-meta text-ink-3 mt-1">
                  Families also pay{" "}
                  <span className="font-black tabular-nums">
                    {formatCurrency(orgFee.amount)}
                  </span>{" "}
                  to {orgFee.label} directly
                  {clubFee > 0 && (
                    <>
                      {" "}
                      — total family cost{" "}
                      <span className="font-black tabular-nums">
                        {formatCurrency(round2(clubFee + orgFee.amount))}
                      </span>
                    </>
                  )}
                  .
                </div>
              )}
            </div>
          )}
          {/* Fundraising goal + progress for THIS season: the fundraise-marked
              budget lines vs qualifying ledger income. The copy states exactly
              what counts so the meter is never mysterious (see
              fundraisingGoalSummary). */}
          {fundraiseGoal.goal > 0 && (
            <div className="rounded-xl border border-line bg-surface-2/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="t-eyebrow text-ink-3">Fundraising goal</span>
                <span className="t-meta text-ink-3 tabular-nums">
                  raised {formatCurrency(fundraiseGoal.raised)} of{" "}
                  {formatCurrency(fundraiseGoal.goal)}
                </span>
              </div>
              <MoneyMeter
                value={fundraiseGoal.raised}
                max={fundraiseGoal.goal}
                ariaLabel="Fundraising goal progress"
              />
              <p className="t-meta text-ink-3">
                {fundraiseGoal.remaining > 0 ? (
                  <>
                    <span className="font-black tabular-nums">
                      {formatCurrency(fundraiseGoal.remaining)}
                    </span>{" "}
                    still to raise for the budget lines marked
                    &ldquo;fundraise&rdquo;.{" "}
                  </>
                ) : (
                  <>Goal covered — every fundraise-marked line is funded. </>
                )}
                Counts plain Fundraiser income from the ledger; money that
                reduces dues and pass-through fee-relief money serve other
                purposes and aren&apos;t counted.
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Next season's DRAFT: editable any time (the natural workflow starts
          in spring) without disturbing this year's meters or fee. Consumed at
          the fall roll, when it becomes the new year's working budget. */}
      <SectionCard
        icon={Icons.Clipboard}
        title="Budget draft — next season"
        subtitle="Plan the coming club year — nothing here touches this season"
      >
        <div className="p-4 sm:p-5 space-y-3">
          {draftRows.length === 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
              <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
                No draft yet. Start next season&apos;s budget when you&apos;re
                ready — this season&apos;s budget stays untouched.
              </p>
              {(finances.budgetItems || []).length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Copy this season's budget into the draft"
                  onClick={seedDraftFromCurrentBudget}
                >
                  <Icons.Plus className="w-4 h-4" /> Copy this season&apos;s
                  budget
                </Button>
              )}
              {budgetEstimate && (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Seed draft from this season's actual spending"
                  onClick={seedDraftFromEstimate}
                >
                  <Icons.Plus className="w-4 h-4" /> Estimate from actuals (
                  {formatCurrency(budgetEstimate.total)})
                </Button>
              )}
            </div>
          )}
          <BudgetItemsCard
            finances={finances}
            players={players}
            team={team}
            summary={summary}
            feeSheetReady={false}
            budgetRows={draftRows}
            categoryRows={[]}
            budgetSort={draftBudgetEditor.budgetSort}
            toggleBudgetSort={draftBudgetEditor.toggleBudgetSort}
            itemEdit={draftBudgetEditor.itemEdit}
            setItemEdit={draftBudgetEditor.setItemEdit}
            startItemEdit={draftBudgetEditor.startItemEdit}
            saveItemEdit={draftBudgetEditor.saveItemEdit}
            stepBudgetQty={draftBudgetEditor.stepBudgetQty}
            toggleItemTax={draftBudgetEditor.toggleItemTax}
            toggleItemFunding={draftBudgetEditor.toggleItemFunding}
            removeBudgetItem={draftBudgetEditor.removeBudgetItem}
            toast={toast}
            labelSuffix=" (draft)"
            showSpendReference
            showSpent={false}
          />
          <BudgetPresetsCard
            applyPreset={draftBudgetEditor.applyPreset}
            addBudgetItem={draftBudgetEditor.addBudgetItem}
            qtyMode={draftBudgetEditor.qtyMode}
            setQtyMode={draftBudgetEditor.setQtyMode}
            budgetTaxable={draftBudgetEditor.budgetTaxable}
            setBudgetTaxable={draftBudgetEditor.setBudgetTaxable}
            budgetLabel={draftBudgetEditor.budgetLabel}
            setBudgetLabel={draftBudgetEditor.setBudgetLabel}
            budgetQty={draftBudgetEditor.budgetQty}
            setBudgetQty={draftBudgetEditor.setBudgetQty}
            budgetAmount={draftBudgetEditor.budgetAmount}
            setBudgetAmount={draftBudgetEditor.setBudgetAmount}
            unitNoun={draftBudgetEditor.unitNoun}
            budgetCategory={draftBudgetEditor.budgetCategory}
            setBudgetCategory={draftBudgetEditor.setBudgetCategory}
            labelSuffix=" (draft)"
          />
          {/* Sponsorships reduce fees. "This season" entries post as
              fundraising income (lowering current dues); "next season" entries
              offset the draft's planned fee and convert to income when the
              season advances. */}
          <SponsorshipSection
            finances={finances}
            sponsorWhen={sponsorWhen}
            setSponsorWhen={setSponsorWhen}
            currentSponsors={currentSponsors}
            currentSponsorTotal={currentSponsorTotal}
            sponsored={sponsored}
            toggleCurrentSponsorReduces={toggleCurrentSponsorReduces}
            removeCurrentSponsor={removeCurrentSponsor}
            togglePledgeReduces={togglePledgeReduces}
            removeSponsorship={removeSponsorship}
            addSponsorship={addSponsorship}
            sponsorName={sponsorName}
            setSponsorName={setSponsorName}
            sponsorAmount={sponsorAmount}
            setSponsorAmount={setSponsorAmount}
            sponsorReduces={sponsorReduces}
            setSponsorReduces={setSponsorReduces}
          />
          {/* Planner settings, next-season deposit, and the draft-total →
              suggested-fee summary (extracted; Fragment keeps the DOM identical). */}
          <PlannedRosterCard
            finances={finances}
            setFinanceFields={setFinanceFields}
            bufferInc={bufferInc}
            payerCount={payerCount}
            plannedCount={plannedCount}
            budget={draftBudget}
            fundraiseGoal={draftFundraiseGoal}
            sponsoredOffset={sponsoredOffset}
            suggested={draftSuggested}
            nextFee={nextFee}
            taxInput={taxInput}
            setTaxInput={setTaxInput}
            commitSalesTax={commitSalesTax}
            plannedInput={plannedInput}
            setPlannedInput={setPlannedInput}
            commitPlannedPlayers={commitPlannedPlayers}
            nextDepositInput={nextDepositInput}
            setNextDepositInput={setNextDepositInput}
            commitNextDeposit={commitNextDeposit}
            orgFee={draftOrgFee}
            nextOrgFeeLabelInput={nextOrgFeeLabelInput}
            setNextOrgFeeLabelInput={setNextOrgFeeLabelInput}
            nextOrgFeeAmountInput={nextOrgFeeAmountInput}
            setNextOrgFeeAmountInput={setNextOrgFeeAmountInput}
            commitNextExternalOrgFee={commitNextExternalOrgFee}
          />
          {/* Forward-looking projection built from the draft above. */}
          <SeasonOutlookCard outlook={outlook} />
        </div>
      </SectionCard>
    </div>
  );
});
FinancesTab.displayName = "FinancesTab";
