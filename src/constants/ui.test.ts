import { describe, it, expect } from "vitest";
import {
  getEvalCategoriesForPlayer,
  playerIsPitcher,
  playerIsCatcher,
  pitcherRosterPremium,
  PITCHER_ROSTER_PREMIUM_MAX,
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

describe("getEvalCategoriesForPlayer", () => {
  const pitcher = { comfortablePositions: ["P", "SS"] };
  const catcher = { comfortablePositions: ["C", "1B"] };
  const dualThreat = { comfortablePositions: ["P", "C"] };
  const fielder = { comfortablePositions: ["SS", "2B"] };

  it("never includes add-ons on non-Kid-Pitch teams", () => {
    const cats = ids(getEvalCategoriesForPlayer("Machine Pitch", pitcher));
    expect(cats).toContain("contact");
    expect(cats).not.toContain("strikes");
    expect(cats).not.toContain("blocking");
  });

  it("shows Pitching only to pitchers on Kid Pitch", () => {
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", pitcher))).toContain(
      "strikes"
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", fielder))).not.toContain(
      "strikes"
    );
  });

  it("shows Catching only to catchers on Kid Pitch", () => {
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", catcher))).toContain(
      "blocking"
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", fielder))).not.toContain(
      "blocking"
    );
  });

  it("a dual-threat gets both specialties; a plain fielder gets neither", () => {
    const dual = ids(getEvalCategoriesForPlayer("Kid Pitch", dualThreat));
    expect(dual).toEqual(expect.arrayContaining(["strikes", "blocking"]));
    const plain = ids(getEvalCategoriesForPlayer("Kid Pitch", fielder));
    expect(plain).not.toContain("strikes");
    expect(plain).not.toContain("blocking");
    // Universal categories are always present for everyone.
    expect(plain).toContain("contact");
    expect(plain).toContain("coachability");
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
