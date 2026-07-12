import { describe, it, expect } from "vitest";
import {
  allowedPitchingFormats,
  getEvalCategoriesForPlayer,
  handGradedCategoriesForPlayer,
  handGradedCategoriesForTeam,
  playerIsPitcher,
  playerIsCatcher,
  pitcherRosterPremium,
  leftHandedPitcherRosterPremium,
  LEFT_HANDED_PITCHER_ROSTER_PREMIUM,
  PITCHER_ROSTER_PREMIUM_MAX,
  EVAL_CATEGORIES,
  EVAL_GROUPS_UNIVERSAL,
  EVAL_GROUPS_KID_PITCH_ADDONS,
  TRYOUT_GRADE_CATEGORIES,
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

  it("adds the scarcity premium only for left-handed pitchers", () => {
    expect(
      leftHandedPitcherRosterPremium({
        comfortablePositions: ["P"],
        throws: "L",
      }),
    ).toBe(LEFT_HANDED_PITCHER_ROSTER_PREMIUM);
    expect(
      leftHandedPitcherRosterPremium({
        comfortablePositions: ["P"],
        throws: "R",
      }),
    ).toBe(0);
    expect(
      leftHandedPitcherRosterPremium({
        comfortablePositions: ["1B"],
        throws: "L",
      }),
    ).toBe(0);
  });
});

describe("eval category groups", () => {
  it("every HAND-GRADED category's group is a navigable tab (no orphaned add-on group)", () => {
    // The grading UIs render one tab per group; a hand-graded category whose
    // group isn't in the tab list would be unreachable (the bug when Pitch
    // Velocity's Pitching group was dropped). dataDriven categories never
    // render on the grading card, so their groups need no tab.
    const tabGroups = new Set<string>([
      ...EVAL_GROUPS_UNIVERSAL,
      ...EVAL_GROUPS_KID_PITCH_ADDONS,
    ]);
    for (const c of EVAL_CATEGORIES) {
      if (c.dataDriven) continue;
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
      "composure",
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", pitcher))).toContain(
      "composure",
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", fielder))).toContain(
      "composure",
    );
  });

  it("shows Pitch Velocity only to pitchers on Kid Pitch", () => {
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", pitcher))).toContain(
      "pitchVelo",
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", fielder))).not.toContain(
      "pitchVelo",
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
      expect.arrayContaining(["pitchVelo", "blocking", "receiving"]),
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

  it("measurable tangibles are DATA-DRIVEN — in the catalog for scoring, NEVER hand-graded (v9 restored)", () => {
    const all = ids(getEvalCategoriesForPlayer("Kid Pitch", dualThreat));
    // In-game stat lines (velocity/strikes/off-speed/throwing/game-calling and
    // contact) remain stats-derived, never coach-graded.
    for (const dropped of [
      "contact",
      "fielding",
      "arm",
      "velocity",
      "strikes",
      "offSpeed",
      "throwing",
      "gameCalling",
    ]) {
      expect(all).not.toContain(dropped);
    }
    // The showcase-seeded tools live in the FULL catalog so scoring, seeding,
    // and reports carry them (bridge: showcase seed → GameChanger stats)…
    expect(all).toEqual(
      expect.arrayContaining(["power", "glove", "armStrength", "armAccuracy"]),
    );
    for (const id of ["power", "glove", "armStrength", "armAccuracy"]) {
      expect(EVAL_CATEGORIES.find((c) => c.id === id)?.dataDriven).toBe(true);
    }
    // …but a coach's HAND-GRADED list must never grow because a measurable
    // got a data source. Manual rating rows are the eye-test intangibles only.
    const hand = ids(handGradedCategoriesForPlayer("Kid Pitch", dualThreat));
    expect(hand).toEqual([
      "approach",
      "speed",
      "baserunning",
      "baseballIQ",
      "coachability",
      "composure",
      "pitchVelo",
      "blocking",
      "receiving",
    ]);
    expect(ids(handGradedCategoriesForTeam("Machine Pitch"))).toEqual([
      "approach",
      "speed",
      "baserunning",
      "baseballIQ",
      "coachability",
      "composure",
    ]);
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
      Math.round(PITCHER_ROSTER_PREMIUM_MAX / 2),
    );
  });
});

describe("TRYOUT_GRADE_CATEGORIES — the tryout card's hand grades", () => {
  it("is hitting only — every measurable tool comes from the showcase stations", () => {
    // The card grades ONE thing by eye. Speed, power, arm strength, accuracy,
    // pitch velo, and fielding GB/FB are recorded at the measured stations
    // (shared + definitive) and band-score into the ranking on their own;
    // intangibles belong to regular-season rounds. Re-adding a row here means
    // re-introducing the duplication this list exists to prevent.
    expect(ids(TRYOUT_GRADE_CATEGORIES)).toEqual(["approach"]);
    expect(TRYOUT_GRADE_CATEGORIES[0].label).toBe("Hitting");
  });

  it("reuses a real EVAL_CATEGORIES id so tryout grades flow into eval seeding unchanged", () => {
    const catalogIds = new Set(EVAL_CATEGORIES.map((c) => c.id));
    for (const c of TRYOUT_GRADE_CATEGORIES) {
      expect(catalogIds.has(c.id)).toBe(true);
    }
  });
});

describe("allowedPitchingFormats — 9U+ is always kid pitch", () => {
  it("returns Kid Pitch only for 9U and older, in either league", () => {
    for (const league of ["USSSA", "NKB"]) {
      expect(allowedPitchingFormats(league, "9U")).toEqual(["Kid Pitch"]);
      expect(allowedPitchingFormats(league, "10U")).toEqual(["Kid Pitch"]);
    }
  });

  it("handles the range tiers, which string equality cannot", () => {
    // Regression: "11U to 12U" etc. previously fell through to the
    // all-formats branch because nothing parsed the label.
    for (const tier of ["11U to 12U", "13U to 14U", "15U to 18U"]) {
      expect(allowedPitchingFormats("USSSA", tier)).toEqual(["Kid Pitch"]);
    }
  });

  it("keeps NKB 6-8U machine-pitch only", () => {
    for (const tier of ["6U", "7U", "8U"]) {
      expect(allowedPitchingFormats("NKB", tier)).toEqual(["Machine Pitch"]);
    }
  });

  it("keeps USSSA 8U on Kid/Coach", () => {
    expect(allowedPitchingFormats("USSSA", "8U")).toEqual([
      "Kid Pitch",
      "Coach Pitch",
    ]);
  });

  it("offers everything below the special cases, and when age is unknown", () => {
    expect(allowedPitchingFormats("USSSA", "7U")).toEqual([
      "Kid Pitch",
      "Coach Pitch",
      "Machine Pitch",
    ]);
    // Missing age must NOT force Kid-only (ageFromTeamAge defaults to 10).
    expect(allowedPitchingFormats(undefined, undefined)).toEqual([
      "Kid Pitch",
      "Coach Pitch",
      "Machine Pitch",
    ]);
  });

  it("puts the fallback format first", () => {
    // Callers heal a disallowed stored value to allowed[0].
    expect(allowedPitchingFormats("USSSA", "9U")[0]).toBe("Kid Pitch");
    expect(allowedPitchingFormats("NKB", "7U")[0]).toBe("Machine Pitch");
  });
});
