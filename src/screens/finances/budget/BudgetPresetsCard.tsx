import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icons } from "../../../icons";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../../components/shared";
import {
  BUDGET_PRESETS,
  BUDGET_PRESET_GROUPS,
  FINANCE_CATEGORIES,
  type BudgetPreset,
  type FinanceCategoryId,
} from "../../../constants/financeCategories";

interface BudgetPresetsCardProps {
  applyPreset: (preset: BudgetPreset) => void;
  addBudgetItem: (e?: FormEvent) => void;
  qtyMode: boolean;
  setQtyMode: Dispatch<SetStateAction<boolean>>;
  budgetTaxable: boolean;
  setBudgetTaxable: Dispatch<SetStateAction<boolean>>;
  budgetLabel: string;
  setBudgetLabel: Dispatch<SetStateAction<string>>;
  budgetQty: string;
  setBudgetQty: Dispatch<SetStateAction<string>>;
  budgetAmount: string;
  setBudgetAmount: Dispatch<SetStateAction<string>>;
  unitNoun: string;
  budgetCategory: FinanceCategoryId | "";
  setBudgetCategory: Dispatch<SetStateAction<FinanceCategoryId | "">>;
}

// The add-controls of the Budget Planner card: the quick-add preset catalog,
// the count/tax mode toggles, and the manual add-item form. Presentational —
// applyPreset/addBudgetItem and the form state stay in FinancesTab and thread
// in. Returns a Fragment of the exact elements it replaced (DOM identical).
export const BudgetPresetsCard = ({
  applyPreset,
  addBudgetItem,
  qtyMode,
  setQtyMode,
  budgetTaxable,
  setBudgetTaxable,
  budgetLabel,
  setBudgetLabel,
  budgetQty,
  setBudgetQty,
  budgetAmount,
  setBudgetAmount,
  unitNoun,
  budgetCategory,
  setBudgetCategory,
}: BudgetPresetsCardProps) => (
  <>
    {/* Quick-add catalog: tap a common youth-baseball line item to
        prefill the add form. Grouped by spending area and scrollable so
        the full catalog never dominates the tab. */}
    <div className="space-y-2 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface-2/40 p-3">
      {BUDGET_PRESET_GROUPS.map((group) => (
        <div key={group} className="space-y-1.5">
          <div className="t-eyebrow text-ink-3">{group}</div>
          <div className="flex flex-wrap gap-1.5">
            {BUDGET_PRESETS.filter((p) => p.group === group).map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-surface-2 hover:bg-line text-ink-2 transition-colors"
              >
                + {preset.label}
              </button>
            ))}
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
  </>
);
