import React from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icons } from "../../icons";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../components/shared";
import { YearComparisonChart } from "../../components/financeViz";
import {
  formatCurrency,
  isValidIsoDate,
  ledgerCsv,
  yearComparison,
} from "../../utils/helpers";
import type { LedgerRow } from "../../utils/helpers";
import { monthLabel } from "./financeHelpers";
import type { LedgerSortKey } from "./financeHelpers";
import { SectionCard } from "./SectionCard";
import { SortHeader } from "./SortHeader";
import { downloadTreasurerReportPdf } from "../../finances/treasurerReportPdf";
import {
  EXPENSE_LABEL_SUGGESTIONS,
  INCOME_LABEL_SUGGESTIONS,
  REVENUE_CATEGORIES,
  type RevenueCategoryId,
} from "../../constants/financeCategories";
import type {
  Player,
  Team,
  TeamFinances,
  ToastContextValue,
} from "../../types";

interface EditRow {
  source: "payment" | "income" | "expense";
  id: string;
}
interface EditDraft {
  date: string;
  label: string;
  amount: string;
  budgetItemId: string;
  fundraising: boolean;
  playerId: string;
}
interface LedgerSort {
  key: LedgerSortKey;
  asc: boolean;
}

interface LedgerSectionProps {
  finances: TeamFinances;
  players: Player[];
  team: Team;
  user: { uid: string } | null;
  toast: ToastContextValue;
  ledger: LedgerRow[];
  sortedLedger: LedgerRow[];
  visibleLedger: LedgerRow[];
  ledgerCapped: boolean;
  years: ReturnType<typeof yearComparison>;
  ledgerSort: LedgerSort;
  toggleLedgerSort: (key: LedgerSortKey) => void;
  setShowAllLedger: Dispatch<SetStateAction<boolean>>;
  addTransaction: (e?: FormEvent) => void;
  removeLedgerRow: (
    source: "income" | "expense" | "payment",
    id: string,
  ) => void;
  voidLedgerRow: (source: "income" | "expense" | "payment", id: string) => void;
  unvoidLedgerRow: (
    source: "income" | "expense" | "payment",
    id: string,
  ) => void;
  showVoided: boolean;
  setShowVoided: Dispatch<SetStateAction<boolean>>;
  voidedCount: number;
  startLedgerEdit: (row: {
    source: "payment" | "income" | "expense";
    id: string;
    date: string;
    label: string;
    amount: number;
  }) => void;
  saveLedgerEdit: () => void;
  editRow: EditRow | null;
  setEditRow: Dispatch<SetStateAction<EditRow | null>>;
  editDraft: EditDraft;
  setEditDraft: Dispatch<SetStateAction<EditDraft>>;
  txnDate: string;
  setTxnDate: Dispatch<SetStateAction<string>>;
  txnLabel: string;
  setTxnLabel: Dispatch<SetStateAction<string>>;
  txnAmount: string;
  setTxnAmount: Dispatch<SetStateAction<string>>;
  txnDir: "in" | "out";
  setTxnDir: Dispatch<SetStateAction<"in" | "out">>;
  txnCategory: string;
  setTxnCategory: Dispatch<SetStateAction<string>>;
  txnRevenueCategory: RevenueCategoryId | "";
  setTxnRevenueCategory: Dispatch<SetStateAction<RevenueCategoryId | "">>;
  txnFundraising: boolean;
  setTxnFundraising: Dispatch<SetStateAction<boolean>>;
  txnCreditPlayerId: string;
  setTxnCreditPlayerId: Dispatch<SetStateAction<string>>;
}

// Ledger card: the add-transaction form (money in / out, category, credit),
// the sortable transaction table with inline editing + CSV / treasurer-PDF
// export, and the year-over-year comparison chart. Presentational — all ledger
// state + handlers live in FinancesTab and are threaded in.
export const LedgerSection = ({
  finances,
  players,
  team,
  user,
  toast,
  ledger,
  sortedLedger,
  visibleLedger,
  ledgerCapped,
  years,
  ledgerSort,
  toggleLedgerSort,
  setShowAllLedger,
  addTransaction,
  removeLedgerRow,
  voidLedgerRow,
  unvoidLedgerRow,
  showVoided,
  setShowVoided,
  voidedCount,
  startLedgerEdit,
  saveLedgerEdit,
  editRow,
  setEditRow,
  editDraft,
  setEditDraft,
  txnDate,
  setTxnDate,
  txnLabel,
  setTxnLabel,
  txnAmount,
  setTxnAmount,
  txnDir,
  setTxnDir,
  txnCategory,
  setTxnCategory,
  txnRevenueCategory,
  setTxnRevenueCategory,
  txnFundraising,
  setTxnFundraising,
  txnCreditPlayerId,
  setTxnCreditPlayerId,
}: LedgerSectionProps) => (
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
                    ? "bg-win/15 text-win-ink"
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
        {txnDir === "in" && (
          <select
            value={txnRevenueCategory}
            onChange={(e) =>
              setTxnRevenueCategory(e.target.value as RevenueCategoryId | "")
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
        <div className="flex items-center justify-between gap-4">
          <div>
            {voidedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowVoided((v) => !v)}
                aria-pressed={showVoided}
                className="text-xs font-black uppercase tracking-widest text-ink-3 hover:text-ink underline"
              >
                {showVoided ? "Hide" : "Show"} {voidedCount} voided
              </button>
            )}
          </div>
          <div className="flex gap-4">
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
        </div>
      )}
      {ledger.length === 0 ? (
        <div className="p-4 text-center text-ink-3 font-medium">
          Nothing logged yet. Club-fee payments land here automatically; add
          sponsorships and expenses above.
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
                    aria-sort={
                      ledgerSort.key === col.key
                        ? ledgerSort.asc
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
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
                  ledgerSort.key === "date" && prevMonthKey !== monthKey;
                const monthHeader = newMonth ? (
                  <tr key={`m-${monthKey}`} className="bg-app">
                    <td colSpan={6} className="px-2 py-1 t-eyebrow text-ink-3">
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
                                    <option value="">Split evenly</option>
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
                const attrLine = (
                  verb: string,
                  by?: string,
                  at?: string,
                ): string | null =>
                  by || at
                    ? `${verb}${at ? ` ${String(at).slice(0, 10)}` : ""} by ${
                        by === user?.uid ? "you" : "another coach"
                      }`
                    : null;
                const titleText =
                  [
                    attrLine("Recorded", row.recordedBy, row.recordedAt),
                    row.lastEditedAt
                      ? attrLine("Edited", row.lastEditedBy, row.lastEditedAt)
                      : null,
                    row.voided
                      ? attrLine("Voided", row.voidedBy, row.voidedAt)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined;
                return (
                  <React.Fragment key={`${row.source}-${row.id}`}>
                    {monthHeader}
                    <tr
                      className={`hover:bg-surface-2 ${row.voided ? "opacity-60" : ""}`}
                      title={titleText}
                    >
                      <td className="p-2 tabular-nums font-bold text-ink-2">
                        {isValidIsoDate(row.date) ? row.date : "No date"}
                      </td>
                      <td className="p-2 t-body-bold text-ink">
                        <span
                          className={`inline-flex items-center justify-center w-4 h-4 rounded-full mr-1.5 text-[9px] font-black ${
                            row.direction === "in"
                              ? "bg-win/10 text-win-ink"
                              : "bg-loss/10 text-loss"
                          }`}
                        >
                          {row.direction === "in" ? "↑" : "↓"}
                        </span>
                        <span className={row.voided ? "line-through" : ""}>
                          {row.label}
                        </span>
                        {row.removedRef && (
                          <span
                            className="ml-1.5 t-meta font-bold text-warnfg"
                            title="Names a player who has left the roster"
                          >
                            (removed)
                          </span>
                        )}
                        {row.fundraising && (
                          <span
                            className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-win/10 text-win-ink align-middle"
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
                        {row.voided && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-surface-2 text-ink-3 align-middle">
                            voided
                          </span>
                        )}
                      </td>
                      <td
                        className={`p-2 text-right tabular-nums font-bold ${
                          row.voided
                            ? "text-ink-3 line-through"
                            : "text-win-ink"
                        }`}
                      >
                        {row.direction === "in"
                          ? formatCurrency(row.amount)
                          : ""}
                      </td>
                      <td
                        className={`p-2 text-right tabular-nums font-bold ${
                          row.voided ? "text-ink-3 line-through" : "text-loss"
                        }`}
                      >
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
                        {row.voided ? (
                          <button
                            type="button"
                            aria-label={`Restore entry ${row.label}`}
                            onClick={() => unvoidLedgerRow(row.source, row.id)}
                            className="text-ink-3 hover:text-ink text-[11px] font-bold underline mr-1"
                          >
                            Unvoid
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              aria-label={`Edit entry ${row.label}`}
                              onClick={() => startLedgerEdit(row)}
                              className="inline-flex items-center justify-center min-w-[24px] min-h-[24px] text-ink-3 hover:text-ink transition-colors mr-1"
                            >
                              <Icons.Edit className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Void entry ${row.label}`}
                              onClick={() => voidLedgerRow(row.source, row.id)}
                              title="Void keeps the row as an audit trail but removes it from every total"
                              className="text-ink-3 hover:text-warnfg text-[11px] font-bold underline mr-1"
                            >
                              Void
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          aria-label={`Delete entry ${row.label}`}
                          onClick={() => removeLedgerRow(row.source, row.id)}
                          className="inline-flex items-center justify-center min-w-[24px] min-h-[24px] text-ink-3 hover:text-loss transition-colors"
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
          <div className="t-eyebrow text-ink-3 mb-2 mt-3">Past years</div>
          <ul className="space-y-1">
            {(finances.pastSeasons || []).map((ps) => (
              <li
                key={ps.season}
                className="text-sm font-bold text-ink-2 tabular-nums"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
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
);
