import { describe, expect, it } from "vitest";
import {
  calculateTotalScore,
  hittingTier,
  HITTING_WEIGHTS,
  TOTAL_SCORE_MAX,
  getCombinedGrades,
} from "./lineupEngine";
import { getEffectiveStats } from "./lineupEngine/grades";
import { DEFAULT_GRADES } from "./utils/evalScoring";

// The hitting recalibration, pinned to what the head coach asked for:
//   - on-base is huge; at 9–11U kid pitch a walk is worth about a double,
//     so a walker ranks above a free-swinging slugger;
//   - at machine / coach pitch there are no walks and errors aren't
//     recorded, so on-base is hits only and not striking out matters most;
//   - stats take over gradually (about halfway at ~35 plate appearances);
//   - hitting keeps its ~40% share of the score.

// Neutral intangibles + defense, so only the hitting line moves the score.
const neutral = {
  approach: 3,
  speed: 3,
  baserunning: 3,
  baseballIQ: 3,
  coachability: 3,
  glove: 3,
  range: 3,
  armStrength: 3,
  armAccuracy: 3,
};
const KID_10U = { teamAge: "10U", pitchingFormat: "Kid Pitch" };
const MACHINE_8U = { teamAge: "8U", pitchingFormat: "Machine Pitch" };
const score = (stats: any, ctx: any = KID_10U) =>
  calculateTotalScore(neutral, stats, null, ctx);

// 40 PA each. Walker: .550 OBP, 15% K, one double. Slugger: .380 OBP, 30% K,
// four doubles, a triple and two homers.
const walker = {
  pa: 40,
  ab: 30,
  h: 10,
  bb: 9,
  hbp: 1,
  k: 6,
  doubles: 1,
  triples: 0,
  hr: 0,
  avg: 0.333,
  obp: 0.55,
  slg: 0.367,
};
const slugger = {
  pa: 40,
  ab: 37,
  h: 13,
  bb: 2,
  hbp: 0,
  k: 12,
  doubles: 4,
  triples: 1,
  hr: 2,
  avg: 0.351,
  obp: 0.38,
  slg: 0.73,
};

describe("hitting tiers", () => {
  it("reads machine/coach pitch, kid pitch through 12U, and 13U+", () => {
    expect(hittingTier(MACHINE_8U)).toBe("machine");
    expect(hittingTier({ teamAge: "8U", pitchingFormat: "Coach Pitch" })).toBe(
      "machine",
    );
    expect(hittingTier({ teamAge: "8U", pitchingFormat: "Kid Pitch" })).toBe(
      "kidYouth",
    );
    expect(hittingTier(KID_10U)).toBe("kidYouth");
    expect(hittingTier({ teamAge: "11U to 12U" })).toBe("kidYouth");
    expect(hittingTier({ teamAge: "13U to 14U" })).toBe("kidTeen");
    // No format: 9U+ is always kid pitch, younger is machine/coach pitch.
    expect(hittingTier({ teamAge: "9U" })).toBe("kidYouth");
    expect(hittingTier({ teamAge: "7U" })).toBe("machine");
  });

  it("keeps hitting's share of the score the same in every tier", () => {
    for (const w of Object.values(HITTING_WEIGHTS))
      expect(w.onBase + w.contact + w.power).toBeCloseTo(6.5);
    expect(TOTAL_SCORE_MAX).toBe(115);
    // Approach (2.5) + the stat parts (6.5) = 9 of 23 weight ≈ 39%.
    expect((2.5 + 6.5) / (TOTAL_SCORE_MAX / 5)).toBeCloseTo(0.39, 2);
  });

  it("puts a kid with no stats exactly at neutral", () => {
    expect(score({})).toBe(60);
    expect(score(null)).toBe(60);
  });
});

describe("what wins at the plate", () => {
  it("ranks the walker above the free-swinging slugger at 10U kid pitch", () => {
    expect(score(walker)).toBeGreaterThan(score(slugger) + 3);
  });

  it("makes OBP move the score: .350 vs .550 over 60 PA", () => {
    const line = (obp: number) => ({ pa: 60, ab: 50, k: 9, obp, avg: 0.3 });
    expect(score(line(0.55)) - score(line(0.35))).toBeGreaterThanOrEqual(5);
  });

  it("at 13U+ power counts for more than at 10U", () => {
    const TEEN = { teamAge: "13U to 14U", pitchingFormat: "Kid Pitch" };
    const gap10 = score(slugger) - score(walker);
    const gapTeen = score(slugger, TEEN) - score(walker, TEEN);
    expect(gapTeen).toBeGreaterThan(gap10);
  });

  it("at machine pitch, not striking out matters most — and errors don't count", () => {
    const contactKid = { pa: 40, ab: 40, h: 16, k: 2, avg: 0.4, obp: 0.4 };
    const swingAndMiss = { pa: 40, ab: 40, h: 16, k: 14, avg: 0.4, obp: 0.4 };
    expect(score(contactKid, MACHINE_8U)).toBeGreaterThan(
      score(swingAndMiss, MACHINE_8U) + 3,
    );
  });

  it("doesn't let a hot first week jump a kid past a solid season", () => {
    const hotStart = { pa: 6, ab: 6, h: 5, k: 0, obp: 0.833, avg: 0.833 };
    // A clearly good season: .517 OBP, 10% strikeouts over 60 PA.
    const solid = { pa: 60, ab: 50, h: 21, bb: 9, hbp: 1, k: 6, obp: 0.517 };
    expect(score(solid)).toBeGreaterThan(score(hotStart));
  });

  it("trusts on-base about halfway at ~35 plate appearances", () => {
    const at = (pa: number) => score({ pa, obp: 0.62 }) - 60;
    // Full credit would be (5 − 3) × 4.0 weight = 8 raw ≈ 7 points.
    expect(at(35)).toBeGreaterThanOrEqual(3);
    expect(at(35)).toBeLessThanOrEqual(4);
    expect(at(140)).toBeGreaterThan(at(35));
  });
});

describe("stats come first", () => {
  it("a stored placeholder 3 for Power / Contact never buries a real stat line", () => {
    expect(
      calculateTotalScore(
        { ...neutral, power: 3, contact: 3 },
        walker,
        null,
        KID_10U,
      ),
    ).toBe(score(walker));
  });

  it("new rounds no longer seed the stat-graded categories", () => {
    expect(DEFAULT_GRADES).not.toHaveProperty("power");
    expect(DEFAULT_GRADES).not.toHaveProperty("glove");
    expect(DEFAULT_GRADES).not.toHaveProperty("armStrength");
    expect(DEFAULT_GRADES).toHaveProperty("approach", 3);
  });

  it("a tryout exit-velo Power grade is the starting point until there are at-bats", () => {
    const events: any[] = [
      {
        id: "r",
        date: "2026-03-01",
        coachRole: "Head",
        grades: { p1: { approach: 3, power: 5 } },
      },
    ];
    const players: any[] = [
      { id: "p1", name: "Ava", stats: { pa: 2, ab: 2, doubles: 0, hr: 0 } },
    ];
    const g = getCombinedGrades(events, players, KID_10U);
    // Two quiet at-bats barely move a 5 exit-velo reading.
    expect(g.p1.power).toBeGreaterThan(4.8);
  });
});

describe("season blending", () => {
  it("a stat last season didn't track no longer drags this season's down", () => {
    const eff = getEffectiveStats({
      id: "p",
      name: "P",
      stats: { pa: 10, ab: 10, qab: 0.6 },
      pastSeasons: [{ season: "2025", stats: { ab: 40, avg: 0.3 } }],
    } as any);
    // Only this season has QAB% — the blend is just this season's value.
    expect(eff.qab).toBeCloseTo(0.6);
  });
});
