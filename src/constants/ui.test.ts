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

  it("never includes Kid-Pitch add-ons on non-Kid-Pitch teams", () => {
    const cats = ids(getEvalCategoriesForPlayer("Machine Pitch", pitcher));
    expect(cats).toContain("approach");
    expect(cats).not.toContain("gameCalling");
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

  it("shows Catching (Game Calling) only to catchers on Kid Pitch", () => {
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", catcher))).toContain(
      "gameCalling"
    );
    expect(ids(getEvalCategoriesForPlayer("Kid Pitch", fielder))).not.toContain(
      "gameCalling"
    );
  });

  it("a dual-threat gets the catching specialty; a plain fielder gets none", () => {
    const dual = ids(getEvalCategoriesForPlayer("Kid Pitch", dualThreat));
    expect(dual).toContain("gameCalling");
    const plain = ids(getEvalCategoriesForPlayer("Kid Pitch", fielder));
    expect(plain).not.toContain("gameCalling");
    // Universal categories — including Composure — are present for everyone.
    expect(plain).toContain("approach");
    expect(plain).toContain("coachability");
    expect(plain).toContain("composure");
  });

  it("only intangibles remain coach-graded (v9): no stat-measurable categories", () => {
    const all = ids(getEvalCategoriesForPlayer("Kid Pitch", dualThreat));
    for (const dropped of [
      "contact", "power", "fielding", "arm",
      "velocity", "strikes", "offSpeed",
      "receiving", "blocking", "throwing",
    ]) {
      expect(all).not.toContain(dropped);
    }
    expect(all).toEqual(
      expect.arrayContaining([
        "approach", "speed", "baserunning", "baseballIQ", "coachability",
        "composure", "gameCalling",
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
