import { describe, it, expect } from "vitest";
import {
  getEvalCategoriesForPlayer,
  playerIsPitcher,
  playerIsCatcher,
  pitcherRosterPremium,
  PITCHER_ROSTER_PREMIUM_MAX,
  EVAL_CATEGORIES,
  EVAL_GROUPS_UNIVERSAL,
  EVAL_GROUPS_KID_PITCH_ADDONS,
} from "./ui";

const ids = (cats: { id: string }[]) => cats.map((c) => c.id);

describe("playerIsPitcher / playerIsCatcher", () => {
  it("read the positive position model (P / C in comfortablePositions)", () => {
    expect(playerIsPitcher({ comfortablePositions: ["P", "SS"] })).toBe(true);
    expect(playerIsPitcher({ comfortablePositions: ["SS"] })).toBe(false);
    expect(playerIsCatcher({ comfortablePositions: ["C"] })).toBe(true);
    expect(playerIsCatcher({ comfortablePositions: ["1B"] })).toBe(false);
    expect(playerIsPitcher(undefined)).toBe(false);
    expect(playerIsCatcher({})).toBe(false);
  });
});

describe("eval category groups", () => {
  it("every category's group is a navigable tab (no orphaned add-on group)", () => {
    // The grading UIs render one tab per group; a category whose group isn't in
    // the tab list would be unreachable (the bug when Pitch Velocity's Pitching
    // group was dropped).
    const tabGroups = new Set<string>([
      ...EVAL_GROUPS_UNIVERSAL,
      ...EVAL_GROUPS_KID_PITCH_ADDONS,
    ]);
    for (const c of EVAL_CATEGORIES) {
      expect(tabGroups.has(c.group)).toBe(true);
    }
  });
});

describe("getEvalCategoriesForPlayer", () => {
  const pitcher = { comfortablePositions: ["P", "SS"] };
  const catcher = { comfortablePositions: ["C", "1B"] };
  const dualThreat = { comfortablePositions: ["P", "C"] };
  const fielder = { comfortablePositions: ["SS", "2B"] };

  it("never includes Kid-Pitch add-ons on non-Kid-Pitch teams", () => {
    const cats = ids(getEvalCategoriesForPlayer("Machine Pitch", pitcher));
    expect(cats).toContain("approach");
    expect(cats).not.toContain("pitchVelo");
    expect(cats).not.toContain("blocking");
    expect(cats).not.toContain("receiving");
  });

  it("grades Composure universally (every player, every format)", () => {
    // Composure is now a universal intangible — not gated to kid-pitch pitchers.
    expect(ids(getEvalCategoriesForPlayer("Machine Pitch", fielder))).toContain(
      "composure"
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", pitcher))).toContain(
      "composure"
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", fielder))).toContain(
      "composure"
    );
  });

  it("shows Pitch Velocity only to pitchers on Kid Pitch", () => {
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", pitcher))).toContain(
      "pitchVelo"
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", fielder))).not.toContain(
      "pitchVelo"
    );
  });

  it("shows Catching (Blocking + Receiving) only to catchers on Kid Pitch", () => {
    const c = ids(getEvalCategoriesForPlayer("Kid Pitch", catcher));
    expect(c).toEqual(expect.arrayContaining(["blocking", "receiving"]));
    const f = ids(getEvalCategoriesForPlayer("Kid Pitch", fielder));
    expect(f).not.toContain("blocking");
    expect(f).not.toContain("receiving");
  });

  it("a dual-threat gets both specialties; a plain fielder gets none", () => {
    const dual = ids(getEvalCategoriesForPlayer("Kid Pitch", dualThreat));
    expect(dual).toEqual(
      expect.arrayContaining(["pitchVelo", "blocking", "receiving"])
    );
    const plain = ids(getEvalCategoriesForPlayer("Kid Pitch", fielder));
    expect(plain).not.toContain("pitchVelo");
    expect(plain).not.toContain("blocking");
    expect(plain).not.toContain("receiving");
    // Universal categories — including Composure — are present for everyone.
    expect(plain).toContain("approach");
    expect(plain).toContain("coachability");
    expect(plain).toContain("composure");
  });

  it("no stat-measurable tangibles remain coach-graded (v9)", () => {
    const all = ids(getEvalCategoriesForPlayer("Kid Pitch", dualThreat));
    // Velocity/Strikes/Off-Speed/Throwing are still stats-derived; Pitch
    // Velocity (mph) is the one coach-entered pitching field.
    for (const dropped of [
      "contact", "power", "fielding", "arm",
      "velocity", "strikes", "offSpeed", "throwing", "gameCalling",
    ]) {
      expect(all).not.toContain(dropped);
    }
    expect(all).toEqual(
      expect.arrayContaining([
        "approach", "speed", "baserunning", "baseballIQ", "coachability",
        "composure", "pitchVelo", "blocking", "receiving",
      ])
    );
  });
});

describe("pitcherRosterPremium", () => {
  const W = 6.5; // sum of the pitcher score weights (1.5 + 3.5 + 0.5 + 1.0)

  it("awards nothing for neutral/default or weak pitching (no phantom premium)", () => {
    // All categories at the neutral default (3) — what setGrade seeds for
    // untouched pitching — must add zero.
    expect(pitcherRosterPremium(W * 3, W)).toBe(0);
    // Weak pitching (below neutral) never penalizes either.
    expect(pitcherRosterPremium(W * 1, W)).toBe(0);
    // Ungraded (score 0) adds nothing.
    expect(pitcherRosterPremium(0, W)).toBe(0);
  });

  it("awards the full premium for elite pitching and scales in between", () => {
    expect(pitcherRosterPremium(W * 5, W)).toBe(PITCHER_ROSTER_PREMIUM_MAX);
    // Halfway above neutral (grade 4 of the 3→5 span) ≈ half the premium.
    expect(pitcherRosterPremium(W * 4, W)).toBe(
      Math.round(PITCHER_ROSTER_PREMIUM_MAX / 2)
    );
  });
});
