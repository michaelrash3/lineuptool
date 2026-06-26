import { describe, expect, it } from "vitest";
import { currentEvaluationScore100 } from "./evaluationScore";
import type { GradeMap, Player } from "../types";

const pitcher: Player = {
  id: "p1",
  name: "Pitcher One",
  comfortablePositions: ["P"],
  stats: { pTopMph: 34 },
};

const grades: GradeMap = {
  approach: 5,
  speed: 4,
  baserunning: 4,
  baseballIQ: 5,
  coachability: 5,
  composure: 4,
};

describe("currentEvaluationScore100", () => {
  it("uses the existing current eval score model instead of averaging raw fields", () => {
    const score = currentEvaluationScore100(grades, pitcher, "9U");
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
    expect(score!).toBeLessThanOrEqual(100);
  });
});
