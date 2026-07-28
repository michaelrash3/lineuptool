import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { BudgetItem } from "../../../types";
import type { FinanceUpdate } from "../../../utils/financeUpdates";
import {
  groupToCategory,
  type BudgetPreset,
  type FinanceCategoryId,
} from "../../../constants/financeCategories";
import { newId, parseAmount, parseCount } from "../financeHelpers";
import type { BudgetItemEdit, BudgetSortKey } from "../financeHelpers";

// Editor state + mutation handlers for ONE budget list — either this club
// year's working budget (`budgetItems`) or next year's draft
// (`nextBudgetItems`). Extracted from FinancesTab so the two planner sections
// share identical machinery (preset prefill, flat / qty × unit add, inline
// edit, quantity stepper, +tax toggle, column sort) without duplicating it:
// each section instantiates the hook with its own key and the ops target that
// list alone. All writes go through updateFinances (narrow, concurrency-safe
// ops — see utils/financeUpdates.ts).
export interface BudgetListEditor {
  // ---- add form (preset-prefillable; quantity mode plans count × per-unit)
  budgetLabel: string;
  setBudgetLabel: Dispatch<SetStateAction<string>>;
  budgetAmount: string;
  setBudgetAmount: Dispatch<SetStateAction<string>>;
  budgetQty: string;
  setBudgetQty: Dispatch<SetStateAction<string>>;
  qtyMode: boolean;
  setQtyMode: Dispatch<SetStateAction<boolean>>;
  unitNoun: string;
  budgetTaxable: boolean;
  setBudgetTaxable: Dispatch<SetStateAction<boolean>>;
  budgetCategory: FinanceCategoryId | "";
  setBudgetCategory: Dispatch<SetStateAction<FinanceCategoryId | "">>;
  applyPreset: (preset: BudgetPreset) => void;
  addBudgetItem: (e?: FormEvent) => void;
  // ---- row ops
  removeBudgetItem: (id: string) => void;
  stepBudgetQty: (id: string, delta: number) => void;
  toggleItemTax: (id: string) => void;
  toggleItemFunding: (id: string) => void;
  // ---- inline edit
  itemEdit: BudgetItemEdit | null;
  setItemEdit: Dispatch<SetStateAction<BudgetItemEdit | null>>;
  startItemEdit: (item: BudgetItem) => void;
  saveItemEdit: () => void;
  // ---- column sort
  budgetSort: { key: BudgetSortKey; asc: boolean } | null;
  toggleBudgetSort: (key: BudgetSortKey) => void;
}

export const useBudgetListEditor = (
  key: "budgetItems" | "nextBudgetItems",
  updateFinances: (update: FinanceUpdate) => void,
  rosterSize: number,
): BudgetListEditor => {
  const [budgetLabel, setBudgetLabel] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetQty, setBudgetQty] = useState("");
  const [qtyMode, setQtyMode] = useState(false);
  const [unitNoun, setUnitNoun] = useState("per unit");
  // Default the new item's `taxable` flag — seeded from a preset (physical
  // goods / tournament entries quote pre-tax), toggleable before adding.
  const [budgetTaxable, setBudgetTaxable] = useState(false);
  // Spending area for the new item. "" = auto (inferred from the label at
  // read time); a preset seeds its own category, and the coach can override.
  const [budgetCategory, setBudgetCategory] = useState<FinanceCategoryId | "">(
    "",
  );

  const applyPreset = (preset: BudgetPreset) => {
    setBudgetLabel(preset.label);
    // A preset with a per-unit noun plans as count × per-unit; one without is
    // a single flat amount (insurance, registration). Only quantity mode
    // seeds a roster count.
    const qty = Boolean(preset.unitNoun);
    setQtyMode(qty);
    setUnitNoun(preset.unitNoun || "per unit");
    setBudgetQty(
      qty && preset.qtyFromRoster && rosterSize > 0 ? String(rosterSize) : "",
    );
    setBudgetTaxable(Boolean(preset.taxable));
    setBudgetCategory(groupToCategory[preset.group]);
  };

  const addBudgetItem = (e?: FormEvent) => {
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
    updateFinances({ op: "append", key, entry: item });
    setBudgetLabel("");
    setBudgetAmount("");
    setBudgetQty("");
    setQtyMode(false);
    setUnitNoun("per unit");
    setBudgetTaxable(false);
    setBudgetCategory("");
  };

  const removeBudgetItem = (id: string) =>
    updateFinances({ op: "removeById", key, id });

  // Stepper on a quantity item ("how many tournaments?"). Keeps the mirrored
  // flat amount in sync so budgetItemAmount and legacy readers agree.
  const stepBudgetQty = (id: string, delta: number) =>
    updateFinances({
      op: "mapEntries",
      key,
      map: (items) =>
        items.map((b) => {
          if (b.id !== id || b.qty == null || b.unitAmount == null) return b;
          const qty = Math.max(1, Math.round(b.qty + delta));
          return { ...b, qty, amount: qty * b.unitAmount };
        }),
    });

  const toggleItemTax = (id: string) =>
    updateFinances({
      op: "mapEntries",
      key,
      map: (items) =>
        items.map((b) => (b.id === id ? { ...b, taxable: !b.taxable } : b)),
    });

  // Flip who covers an item: the team fee (default) or fundraising. The fee
  // side is stored by DROPPING the key (absent = "fees"), so toggled-back
  // items are byte-identical to legacy ones and back-compat can't drift.
  const toggleItemFunding = (id: string) =>
    updateFinances({
      op: "mapEntries",
      key,
      map: (items) =>
        items.map((b) => {
          if (b.id !== id) return b;
          if (b.fundedBy === "fundraising") {
            const { fundedBy: _cleared, ...rest } = b;
            return rest;
          }
          return { ...b, fundedBy: "fundraising" as const };
        }),
    });

  // ---- Inline budget-item editing (label + cost, keeping the item's mode).
  const [itemEdit, setItemEdit] = useState<BudgetItemEdit | null>(null);
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
      key,
      map: (items) =>
        items.map((b) => (b.id === itemEdit.id ? { ...b, ...patch } : b)),
    });
    setItemEdit(null);
  };

  // ---- Sorting. Entry order until a header is tapped; first tap sorts text
  // columns ascending and money columns descending (biggest first).
  const [budgetSort, setBudgetSort] = useState<{
    key: BudgetSortKey;
    asc: boolean;
  } | null>(null);
  const toggleBudgetSort = (key: BudgetSortKey) =>
    setBudgetSort((cur) =>
      cur?.key === key ? { key, asc: !cur.asc } : { key, asc: key === "label" },
    );

  return {
    budgetLabel,
    setBudgetLabel,
    budgetAmount,
    setBudgetAmount,
    budgetQty,
    setBudgetQty,
    qtyMode,
    setQtyMode,
    unitNoun,
    budgetTaxable,
    setBudgetTaxable,
    budgetCategory,
    setBudgetCategory,
    applyPreset,
    addBudgetItem,
    removeBudgetItem,
    stepBudgetQty,
    toggleItemTax,
    toggleItemFunding,
    itemEdit,
    setItemEdit,
    startItemEdit,
    saveItemEdit,
    budgetSort,
    toggleBudgetSort,
  };
};
