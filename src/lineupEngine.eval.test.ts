import { describe, it, expect } from "vitest";
import { calculateTotalScore } from "./lineupEngine";

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
