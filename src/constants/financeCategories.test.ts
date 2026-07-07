import { describe, it, expect } from "vitest";
import {
  BUDGET_PRESETS,
  BUDGET_PRESET_GROUPS,
  EXPENSE_LABEL_SUGGESTIONS,
  INCOME_LABEL_SUGGESTIONS,
  DEPOSIT_QUICK_PICKS,
} from "./financeCategories";

describe("BUDGET_PRESETS", () => {
  it("every preset has a non-blank label and a known group", () => {
    const groups = new Set(BUDGET_PRESET_GROUPS);
    for (const p of BUDGET_PRESETS) {
      expect(p.label.trim()).not.toBe("");
      expect(groups.has(p.group)).toBe(true);
    }
  });

  it("labels are unique (they double as the money-out autocomplete list)", () => {
    const labels = BUDGET_PRESETS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("every group is represented by at least one preset", () => {
    for (const g of BUDGET_PRESET_GROUPS) {
      expect(BUDGET_PRESETS.some((p) => p.group === g)).toBe(true);
    }
  });

  it("roster-seeded presets are quantity-mode (carry a unitNoun)", () => {
    // qtyFromRoster only makes sense in quantity mode, which a unitNoun opens.
    for (const p of BUDGET_PRESETS) {
      if (p.qtyFromRoster) expect(p.unitNoun).toBeTruthy();
    }
  });

  it("has real breadth — the point of the feature", () => {
    expect(BUDGET_PRESETS.length).toBeGreaterThanOrEqual(35);
  });
});

describe("ledger suggestion lists", () => {
  it("expense suggestions mirror the preset labels exactly", () => {
    expect(EXPENSE_LABEL_SUGGESTIONS).toEqual(
      BUDGET_PRESETS.map((p) => p.label),
    );
  });

  it("income suggestions are non-empty, non-blank, and unique", () => {
    expect(INCOME_LABEL_SUGGESTIONS.length).toBeGreaterThan(0);
    for (const s of INCOME_LABEL_SUGGESTIONS) expect(s.trim()).not.toBe("");
    expect(new Set(INCOME_LABEL_SUGGESTIONS).size).toBe(
      INCOME_LABEL_SUGGESTIONS.length,
    );
  });
});

describe("DEPOSIT_QUICK_PICKS", () => {
  it("is a sorted list of positive, distinct dollar amounts", () => {
    expect(DEPOSIT_QUICK_PICKS.length).toBeGreaterThan(0);
    expect(new Set(DEPOSIT_QUICK_PICKS).size).toBe(DEPOSIT_QUICK_PICKS.length);
    for (const n of DEPOSIT_QUICK_PICKS) expect(n).toBeGreaterThan(0);
    expect([...DEPOSIT_QUICK_PICKS].sort((a, b) => a - b)).toEqual(
      DEPOSIT_QUICK_PICKS,
    );
  });
});
