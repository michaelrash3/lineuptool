import { describe, it, expect } from "vitest";
import {
  calculateTotalScore,
  suggestPrimaryPosition,
  getCombinedGrades,
} from "./lineupEngine";

// A neutral baseline grade object (all 3s) in the new merged v7 model.
const base = {
  contact: 3,
  power: 3,
  approach: 3,
  fielding: 3,
  arm: 3,
  speedBaserunning: 3,
  baseballIQ: 3,
  coachability: 3,
};

describe("calculateTotalScore — v7 eval model", () => {
  it("reads the merged Fielding/Arm grades (not just the old fine-grained ids)", () => {
    const lowFielding = calculateTotalScore({ ...base, fielding: 1, arm: 1 });
    const highFielding = calculateTotalScore({ ...base, fielding: 5, arm: 5 });
    expect(highFielding).toBeGreaterThan(lowFielding);
  });

  it("treats merged Fielding the same as equivalent old Glove+Range", () => {
    const merged = calculateTotalScore({ ...base, fielding: 5 });
    const fineGrained = calculateTotalScore({ ...base, glove: 5, range: 5 });
    expect(merged).toBe(fineGrained);
  });

  it("weights Coachability heavily — it moves the total noticeably", () => {
    const low = calculateTotalScore({ ...base, coachability: 1 });
    const high = calculateTotalScore({ ...base, coachability: 5 });
    // 4-point swing × weight 3.0, normalized — should be a clear gap.
    expect(high - low).toBeGreaterThanOrEqual(10);
  });

  it("still produces a 0–100 score", () => {
    const s = calculateTotalScore(base);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("suggestPrimaryPosition — eval-derived primary", () => {
  it("suggests a premium infield spot for a strong arm + glove + range kid", () => {
    const grades = { ...base, glove: 5, range: 5, armStrength: 5, armAccuracy: 5 };
    const s = suggestPrimaryPosition(
      { comfortablePositions: ["1B", "SS", "RF"] },
      grades
    );
    expect(s?.position).toBe("SS");
  });

  it("only considers the player's comfortable positions", () => {
    const grades = { ...base, glove: 5, range: 5, armStrength: 5 };
    const s = suggestPrimaryPosition({ comfortablePositions: ["RF"] }, grades);
    expect(s?.position).toBe("RF");
  });

  it("suggests catcher when the catching grades stand out", () => {
    const grades = {
      ...base,
      receiving: 5,
      blocking: 5,
      throwing: 5,
      gameCalling: 5,
    };
    const s = suggestPrimaryPosition({ comfortablePositions: ["C", "RF"] }, grades);
    expect(s?.position).toBe("C");
  });

  it("never suggests a ceremonial pitcher for non-Kid-Pitch teams", () => {
    const grades = { ...base, velocity: 5, strikes: 5, composure: 5 };
    const s = suggestPrimaryPosition(
      { comfortablePositions: ["P", "RF"] },
      grades,
      { kidPitch: false }
    );
    expect(s?.position).not.toBe("P");
  });

  it("can suggest pitcher for Kid-Pitch teams with strong pitching grades", () => {
    const grades = { ...base, velocity: 5, strikes: 5, offSpeed: 5, composure: 5 };
    const s = suggestPrimaryPosition(
      { comfortablePositions: ["P", "RF"] },
      grades,
      { kidPitch: true }
    );
    expect(s?.position).toBe("P");
  });

  it("falls back to the field spots when no comfort list is set", () => {
    const grades = { ...base, range: 5, baserunning: 5 };
    const s = suggestPrimaryPosition({}, grades);
    expect(s?.position).toBe("CF");
  });

  it("returns null for a missing player", () => {
    expect(suggestPrimaryPosition(null, base)).toBeNull();
  });
});

describe("Speed / Base Running split (v8)", () => {
  const round = (grades: any) => [
    { id: "e", date: "2026-01-01", coachRole: "Head", grades },
  ];
  const roster = [{ id: "p1", name: "Runner" }] as any;

  it("seeds BOTH speed and baserunning from a legacy merged grade", () => {
    const merged = getCombinedGrades(
      round({ p1: { speedBaserunning: 5 } }) as any,
      roster
    );
    expect(merged.p1.speed).toBe(5);
    expect(merged.p1.baserunning).toBe(5);
  });

  it("carries separate speed and baserunning grades through unchanged", () => {
    const merged = getCombinedGrades(
      round({ p1: { speed: 5, baserunning: 1 } }) as any,
      roster
    );
    expect(merged.p1.speed).toBe(5);
    expect(merged.p1.baserunning).toBe(1);
  });

  it("total score reflects both speed and base running", () => {
    const low = calculateTotalScore({ ...base, speed: 1, baserunning: 1 });
    const high = calculateTotalScore({ ...base, speed: 5, baserunning: 5 });
    const mixed = calculateTotalScore({ ...base, speed: 5, baserunning: 1 });
    expect(high).toBeGreaterThan(low);
    expect(mixed).toBeGreaterThan(low);
    expect(mixed).toBeLessThan(high);
  });
});

describe("advanced stats carry more weight (D)", () => {
  it("quality-of-contact rates move the offensive score more than the slash line", async () => {
    const { getOffensiveScore } = await import("./lineupEngine");
    const slashOnly = getOffensiveScore({ ops: 0.7, avg: 0.25, obp: 0.35 });
    const withAdvanced = getOffensiveScore({
      ops: 0.7,
      avg: 0.25,
      obp: 0.35,
      qab: 0.6,
      hard: 0.35,
    });
    // Same slash line + strong advanced profile must clearly outscore.
    expect(withAdvanced).toBeGreaterThan(slashOnly + 1);
  });

  it("a full stat sample now out-votes a weak eval for pitchers", async () => {
    const { calcPitcherScore } = await import("./lineupEngine");
    const evalOnly = calcPitcherScore({ strikes: 1 }); // 3.5
    const blended = calcPitcherScore(
      { strikes: 1 },
      { pStrikePct: 0.65, pWhip: 1.0, pKbb: 3.0, pSwingMiss: 0.25, pBf: 30 }
    );
    // 60% lean at full sample: elite numbers pull a weak-eval arm above the
    // scale midpoint (32.5 / 2), which the old 50% cap could not.
    expect(blended).toBeGreaterThan(16.25);
    expect(blended).toBeGreaterThan(evalOnly);
    // 30 BF is already a full sample (was 40).
    const at40 = calcPitcherScore(
      { strikes: 1 },
      { pStrikePct: 0.65, pWhip: 1.0, pKbb: 3.0, pSwingMiss: 0.25, pBf: 40 }
    );
    expect(blended).toBeCloseTo(at40);
  });

  it("bat-missing/weak-contact rates outweigh ERA in pitcher stat quality", async () => {
    const { calcPitcherStatsQuality } = await import("./lineupEngine");
    // Elite advanced rates + bad ERA should grade ABOVE the midpoint —
    // the advanced rates describe what the pitcher controls; ERA is noisy.
    const q = calcPitcherStatsQuality({
      pSwingMiss: 0.25,
      pWeak: 0.45,
      pHardPct: 0.15,
      pEra: 8.0,
    });
    expect(q).toBeGreaterThan(0.6);
  });
});
