import type { Dispatch, SetStateAction } from "react";
import { Icons } from "../../../icons";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../../components/shared";
import { MoneyMeter } from "../../../components/financeViz";
import { SortHeader } from "../SortHeader";
import { downloadPlayerFeeSheetPdf } from "../../../finances/feeSheetPdf";
import {
  formatCurrency,
  budgetItemCategory,
  budgetByCategory,
  estimateBudgetFromSeason,
  financeSummary,
} from "../../../utils/helpers";
import {
  FINANCE_CATEGORIES,
  categoryLabel,
  type FinanceCategoryId,
} from "../../../constants/financeCategories";
import type {
  BudgetItem,
  Player,
  Team,
  TeamFinances,
  ToastContextValue,
} from "../../../types";
import type { BudgetSortKey, BudgetItemEdit } from "../financeHelpers";

interface BudgetItemsCardProps {
  finances: TeamFinances;
  players: Player[];
  team: Team;
  summary: ReturnType<typeof financeSummary>;
  feeSheetReady: boolean;
  budgetEstimate: ReturnType<typeof estimateBudgetFromSeason>;
  budgetRows: { item: BudgetItem; planned: number; spent: number }[];
  categoryRows: ReturnType<typeof budgetByCategory>;
  budgetSort: { key: BudgetSortKey; asc: boolean } | null;
  toggleBudgetSort: (key: BudgetSortKey) => void;
  itemEdit: BudgetItemEdit | null;
  setItemEdit: Dispatch<SetStateAction<BudgetItemEdit | null>>;
  startItemEdit: (item: BudgetItem) => void;
  saveItemEdit: () => void;
  stepBudgetQty: (id: string, delta: number) => void;
  toggleItemTax: (id: string) => void;
  removeBudgetItem: (id: string) => void;
  seedBudgetFromEstimate: () => void;
  toast: ToastContextValue;
}

// The head of the Budget Planner card: the estimate/reference lead, the
// budget-items table (quantity stepper, inline edit, +tax, spent-of-planned
// meter), the by-category budget-vs-actual rollup, and the printable player
// fee sheet. Presentational — every value and handler threads in from
// FinancesTab; returns a Fragment of the exact elements it replaced.
export const BudgetItemsCard = ({
  finances,
  players,
  team,
  summary,
  feeSheetReady,
  budgetEstimate,
  budgetRows,
  categoryRows,
  budgetSort,
  toggleBudgetSort,
  itemEdit,
  setItemEdit,
  startItemEdit,
  saveItemEdit,
  stepBudgetQty,
  toggleItemTax,
  removeBudgetItem,
  seedBudgetFromEstimate,
  toast,
}: BudgetItemsCardProps) => (
  <>
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
          onClick={seedBudgetFromEstimate}
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
                              d ? { ...d, unitAmount: e.target.value } : d,
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
                        ? "text-win-ink bg-win/10"
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
                    className="inline-flex items-center justify-center min-w-[24px] min-h-[24px] text-ink-3 hover:text-ink transition-colors"
                  >
                    <Icons.Edit className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    onClick={() => removeBudgetItem(item.id)}
                    className="inline-flex items-center justify-center min-w-[24px] min-h-[24px] text-ink-3 hover:text-loss transition-colors"
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
                      ariaLabel={`${item.label}: spent of planned`}
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
                <span className="font-bold text-ink truncate">{r.label}</span>
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
                <MoneyMeter
                  value={r.spent}
                  max={r.planned}
                  ariaLabel={`${r.label}: spent of planned`}
                />
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
          Hand families a one-page PDF showing where a player&apos;s fee goes.
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
  </>
);
