import { describe, it, expect } from "vitest";
import { TOGGLEABLE_FEATURES, featureEnabled, toggleFeature } from "./features";

describe("TOGGLEABLE_FEATURES", () => {
  it("has unique, labelled entries", () => {
    const ids = TOGGLEABLE_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of TOGGLEABLE_FEATURES) {
      expect(f.label.trim()).not.toBe("");
      expect(f.description.trim()).not.toBe("");
    }
  });

  it("never offers a core surface as toggleable", () => {
    // Dashboard, roster, schedule, evals, and settings are the app — a team
    // with them switched off would be unusable.
    const ids = new Set<string>(TOGGLEABLE_FEATURES.map((f) => f.id));
    for (const core of [
      "home",
      "roster",
      "schedule",
      "evaluation",
      "settings",
    ]) {
      expect(ids.has(core)).toBe(false);
    }
  });
});

describe("featureEnabled", () => {
  it("is on by default — absent or empty disabled list", () => {
    expect(featureEnabled(undefined, "finances")).toBe(true);
    expect(featureEnabled({}, "tryouts")).toBe(true);
    expect(featureEnabled({ disabledFeatures: [] }, "tryouts")).toBe(true);
  });

  it("is off when listed in disabledFeatures", () => {
    const team = { disabledFeatures: ["tryouts", "finances"] };
    expect(featureEnabled(team, "tryouts")).toBe(false);
    expect(featureEnabled(team, "finances")).toBe(false);
    expect(featureEnabled(team, "practices")).toBe(true);
  });

  it("core/unknown ids are ALWAYS on — a bad stored entry can't brick a tab", () => {
    const team = { disabledFeatures: ["home", "roster", "bogus"] };
    expect(featureEnabled(team, "home")).toBe(true);
    expect(featureEnabled(team, "roster")).toBe(true);
    expect(featureEnabled(team, "bogus")).toBe(true);
  });
});

describe("toggleFeature", () => {
  it("adds on disable and removes on enable, in stable catalog order", () => {
    let disabled = toggleFeature([], "finances", false);
    expect(disabled).toEqual(["finances"]);
    disabled = toggleFeature(disabled, "tryouts", false);
    // Catalog order (tryouts precedes finances), regardless of toggle order.
    expect(disabled).toEqual(["tryouts", "finances"]);
    disabled = toggleFeature(disabled, "finances", true);
    expect(disabled).toEqual(["tryouts"]);
    expect(toggleFeature(disabled, "tryouts", true)).toEqual([]);
  });

  it("is idempotent and drops non-toggleable ids from the stored list", () => {
    expect(toggleFeature(["finances"], "finances", false)).toEqual([
      "finances",
    ]);
    expect(toggleFeature(["home", "bogus", "stats"], "stats", false)).toEqual([
      "stats",
    ]);
    expect(toggleFeature(null, "stats", true)).toEqual([]);
  });
});
