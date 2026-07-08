import { describe, it, expect } from "vitest";
import {
  BUDGET_PRESETS,
  BUDGET_PRESET_GROUPS,
  EXPENSE_LABEL_SUGGESTIONS,
  INCOME_LABEL_SUGGESTIONS,
  DEPOSIT_QUICK_PICKS,
  FINANCE_CATEGORIES,
  groupToCategory,
  categoryLabel,
  inferCategory,
  REVENUE_CATEGORIES,
  revenueCategoryLabel,
  inferRevenueCategory,
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

describe("finance categories", () => {
  it("maps every preset group to a category and labels every category", () => {
    for (const g of BUDGET_PRESET_GROUPS) {
      const cat = groupToCategory[g];
      expect(cat).toBeTruthy();
      // The group's own name is the category's label (they mirror each other).
      expect(categoryLabel(cat)).toBe(g);
    }
    // Every catalog id resolves to a non-blank label.
    for (const c of FINANCE_CATEGORIES) {
      expect(categoryLabel(c.id)).toBe(c.label);
    }
  });

  it("includes an 'other' catch-all not tied to any preset group", () => {
    expect(FINANCE_CATEGORIES.some((c) => c.id === "other")).toBe(true);
    expect(Object.values(groupToCategory)).not.toContain("other");
  });
});

describe("inferCategory", () => {
  it("resolves exact catalog labels to their group's category", () => {
    expect(inferCategory("Umpire fees")).toBe("tournaments");
    expect(inferCategory("game jerseys")).toBe("uniforms"); // case-insensitive
    expect(inferCategory("Team insurance")).toBe("league-admin");
  });

  it("falls back to keyword heuristics for free text", () => {
    expect(inferCategory("Hotel block for state finals")).toBe("travel");
    expect(inferCategory("New catcher's mitt")).toBe("gear");
    expect(inferCategory("Batting cage rental")).toBe("facilities"); // cage beats bat
    expect(inferCategory("Spring registration")).toBe("league-admin");
    expect(inferCategory("End of year trophies")).toBe("team-events");
  });

  it("returns 'other' for blank or unrecognizable labels", () => {
    expect(inferCategory("")).toBe("other");
    expect(inferCategory(null)).toBe("other");
    expect(inferCategory("Misc widget 42")).toBe("team-events"); // 'misc' keyword
    expect(inferCategory("zxcv")).toBe("other");
  });
});

describe("revenue categories", () => {
  it("is a separate list from the spend taxonomy with unique labelled ids", () => {
    const ids = REVENUE_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of REVENUE_CATEGORIES) {
      expect(revenueCategoryLabel(c.id)).toBe(c.label);
    }
    // No overlap with the spend-side ids — two lists, in vs out.
    const spendIds = new Set(FINANCE_CATEGORIES.map((c) => c.id as string));
    for (const id of ids) expect(spendIds.has(id)).toBe(false);
    expect(ids).toContain("dues");
    expect(ids[ids.length - 1]).toBe("other-income"); // catch-all last
  });
});

describe("inferRevenueCategory", () => {
  it("maps every income suggestion to a real source (never the catch-all)", () => {
    for (const s of INCOME_LABEL_SUGGESTIONS) {
      expect(inferRevenueCategory(s)).not.toBe("other-income");
    }
  });

  it("resolves common income labels by keyword", () => {
    expect(inferRevenueCategory("Team banner sponsor")).toBe("sponsorship");
    expect(inferRevenueCategory("Spring registration")).toBe("dues");
    expect(inferRevenueCategory("spirit wear sale")).toBe("merchandise"); // case-insensitive
    expect(inferRevenueCategory("Concessions & snack bar")).toBe("concessions");
    expect(inferRevenueCategory("Restaurant fundraiser night")).toBe(
      "fundraiser",
    );
    expect(inferRevenueCategory("50/50 draw")).toBe("fundraiser");
    expect(inferRevenueCategory("Booster club gift")).toBe("donation");
    expect(inferRevenueCategory("Tournament prize payout")).toBe("winnings");
    expect(inferRevenueCategory("Bank interest")).toBe("interest");
    expect(inferRevenueCategory("County rec grant")).toBe("grant");
  });

  it("returns 'other-income' for blank or unrecognizable labels", () => {
    expect(inferRevenueCategory("")).toBe("other-income");
    expect(inferRevenueCategory(null)).toBe("other-income");
    expect(inferRevenueCategory(undefined)).toBe("other-income");
    expect(inferRevenueCategory("zxcv")).toBe("other-income");
  });
});
