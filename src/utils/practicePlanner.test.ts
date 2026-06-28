import { describe, it, expect } from "vitest";
import {
  buildTeamSkillProfile,
  generatePracticePlan,
  describeEmphasis,
} from "./practicePlanner";
import { DEFAULT_DRILL_LIBRARY } from "../constants/ui";

const roundWith = (grades: Record<string, Record<string, number>>) => ({
  evaluationEvents: [{ id: "r1", date: "2026-06-01", grades } as any],
});

describe("buildTeamSkillProfile", () => {
  it("surfaces the weakest graded areas first", () => {
    const team = roundWith({
      p1: { approach: 2, baseballIQ: 5, speed: 4, baserunning: 4 },
      p2: { approach: 1, baseballIQ: 5, speed: 3, baserunning: 3 },
    });
    const profile = buildTeamSkillProfile(team);
    expect(profile.hasEvalSignal).toBe(true);
    expect(profile.roundDate).toBe("2026-06-01");
    const hitting = profile.focuses.find((f) => f.area === "Hitting")!;
    const teamIq = profile.focuses.find((f) => f.area === "Team")!;
    // Approach avg 1.5 → weak Hitting; Baseball IQ avg 5 → strong Team.
    expect(hitting.need).toBeGreaterThan(teamIq.need);
    expect(profile.focuses[0].need).toBeGreaterThanOrEqual(
      profile.focuses[1].need,
    );
  });

  it("falls back to neutral needs with no eval data", () => {
    const profile = buildTeamSkillProfile({ evaluationEvents: [] });
    expect(profile.hasEvalSignal).toBe(false);
    expect(profile.focuses.every((f) => f.need === 0.5)).toBe(true);
  });

  it("uses the most recent round by date", () => {
    const profile = buildTeamSkillProfile({
      evaluationEvents: [
        { id: "old", date: "2026-01-01", grades: { p1: { approach: 5 } } },
        { id: "new", date: "2026-06-01", grades: { p1: { approach: 1 } } },
      ] as any,
    });
    const hitting = profile.focuses.find((f) => f.area === "Hitting")!;
    expect(hitting.avgGrade).toBe(1);
  });
});

describe("generatePracticePlan", () => {
  const profile = buildTeamSkillProfile(
    roundWith({ p1: { approach: 1, baseballIQ: 5, speed: 2, baserunning: 2 } }),
  );

  it("hits the requested total minutes exactly", () => {
    const plan = generatePracticePlan({
      profile,
      minutes: 90,
      environment: "outdoor",
      library: DEFAULT_DRILL_LIBRARY,
      pitchingFormat: "Kid Pitch",
    });
    const total = plan.reduce((s, d) => s + (d.minutes || 0), 0);
    expect(total).toBe(90);
    expect(plan.length).toBeGreaterThan(2);
  });

  it("opens with a warm-up and includes a situational closer", () => {
    const plan = generatePracticePlan({
      profile,
      minutes: 90,
      environment: "outdoor",
      library: DEFAULT_DRILL_LIBRARY,
      pitchingFormat: "Coach Pitch",
    });
    expect(plan[0].category).toBe("Conditioning");
    expect(plan.some((d) => d.category === "Team")).toBe(true);
  });

  it("respects the practice environment (no outdoor-only drills indoors)", () => {
    const plan = generatePracticePlan({
      profile,
      minutes: 75,
      environment: "indoor",
      library: DEFAULT_DRILL_LIBRARY,
      pitchingFormat: "Kid Pitch",
    });
    const byId = new Map(DEFAULT_DRILL_LIBRARY.map((d) => [d.id, d]));
    for (const entry of plan) {
      const def = byId.get(entry.libraryId!);
      expect(def?.environment === "outdoor").toBeFalsy();
    }
  });

  it("returns an empty agenda for an empty library", () => {
    expect(
      generatePracticePlan({
        profile,
        minutes: 90,
        environment: "outdoor",
        library: [],
      }),
    ).toEqual([]);
  });

  it("keeps blocks feasible (≥5 min, exact total) for a short practice", () => {
    const plan = generatePracticePlan({
      profile,
      minutes: 20,
      environment: "outdoor",
      library: DEFAULT_DRILL_LIBRARY,
      pitchingFormat: "Kid Pitch",
    });
    const total = plan.reduce((s, d) => s + (d.minutes || 0), 0);
    expect(total).toBe(20);
    expect(plan.every((d) => (d.minutes || 0) >= 5)).toBe(true);
    expect(plan.length).toBeLessThanOrEqual(4); // floor(20 / 5)
  });
});

describe("describeEmphasis", () => {
  it("names the weak signaled areas", () => {
    const profile = buildTeamSkillProfile(
      roundWith({
        p1: { approach: 1, speed: 1, baserunning: 1, baseballIQ: 5 },
      }),
    );
    expect(describeEmphasis(profile)).toMatch(/Hitting|Baserunning/);
  });

  it("is balanced when there's no signal", () => {
    const text = describeEmphasis(
      buildTeamSkillProfile({ evaluationEvents: [] }),
    );
    expect(text).toMatch(/balanced/i);
  });
});
