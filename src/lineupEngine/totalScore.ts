// lineupEngine/totalScore.ts
// Normalized 0–100 "total score" blending defensive grades with offense.
import type { GradeMap, PlayerStats } from "../types";
import {
  getOffensiveScore,
  numOrNull,
  gloveOf,
  rangeOf,
  armStrengthOf,
  armAccuracyOf,
  speedBaseOf,
  contactOf,
  approachOf,
  powerOf,
  statContactGrade,
  statPowerGrade,
  statFieldingGrade,
  statArmGrade,
} from "./grades";

// Sum of universal-category weights, used to derive the normalized 0–100
// total. Lives next to calculateTotalScore so a weight change here picks up
// the matching divisor automatically.
const TOTAL_SCORE_CATEGORY_WEIGHTS =
  // glove + range + armStr + armAcc + baserunning + baseballIQ +
  // coachability(3.0) + contact + power + plateDiscipline + approach
  2.5 + 2.0 + 1.5 + 1.5 + 1.5 + 2.0 + 3.0 + 1.5 + 1.0 + 1.0 + 1.5;
// Max possible raw total = 5 × sum(category weights) + 10 (max offensive) × 2.
export const TOTAL_SCORE_MAX = 5 * TOTAL_SCORE_CATEGORY_WEIGHTS + 10 * 2.0; // = 105

// A team's own eval categories (src/utils/evalCategories.ts) reach the engine
// as plain id+weight pairs — the engine keeps no label vocabulary.
export interface ExtraScoredCategory {
  id: string;
  weight: number;
}

// Max grade on the 1–5 eval scale. The engine's labelless mirror of
// EVAL_SCALE_MAX in constants/ui.ts.
const EXTRA_CATEGORY_GRADE_MAX = 5;

// How much of `extra` this grade map actually earns, and how much it could.
//
// The load-bearing rule (see the back-compat contract in
// src/utils/evalCategories.ts): a category counts ONLY when the round carries a
// finite grade for it, and when it counts it lands in the numerator AND the
// denominator together. So a round saved before the category existed has
// nothing added on either side and scores exactly what it always did — adding
// a category never restates history.
function extraParts(
  grades: GradeMap,
  extra: ReadonlyArray<ExtraScoredCategory> | null | undefined,
): { earned: number; possible: number } {
  let earned = 0;
  let possible = 0;
  for (const cat of extra || []) {
    const w = Number(cat?.weight);
    if (!Number.isFinite(w) || w <= 0) continue;
    const v = numOrNull(grades[cat.id]);
    if (v == null) continue;
    earned += v * w;
    possible += EXTRA_CATEGORY_GRADE_MAX * w;
  }
  return { earned, possible };
}

// The denominator calculateTotalScore normalized against, exposed so callers
// that re-expand the score (currentEvaluationScore100) rescale by the same
// number. Equals TOTAL_SCORE_MAX exactly when `extra` contributes nothing.
export function totalScoreMaxFor(
  grades: GradeMap | null | undefined,
  extra?: ReadonlyArray<ExtraScoredCategory> | null,
): number {
  if (!grades) return TOTAL_SCORE_MAX;
  return TOTAL_SCORE_MAX + extraParts(grades, extra).possible;
}

export function calculateTotalScore(
  grades: GradeMap | null | undefined,
  stats?: PlayerStats | null,
  // The team's added categories. Omitted / empty ⇒ every number below is
  // bit-for-bit what it was before per-team categories existed.
  extra?: ReadonlyArray<ExtraScoredCategory> | null,
): number {
  if (!grades) return 0;
  const off = getOffensiveScore(stats);
  // Tangible slots (fielding/arm/contact/power) are stats-graded as of schema
  // v9. The grade map carries them when it came through getCombinedGrades'
  // overlay; otherwise (e.g. the live eval form's in-progress grades) they
  // derive directly from `stats` here. Either way the weights — and therefore
  // the 0–100 normalization — are unchanged, and a kid with no stats sits at
  // the neutral 3 exactly like an ungraded eval used to.
  const g: GradeMap = grades ?? {};
  const fielding =
    numOrNull(g.glove) ??
    numOrNull(g.fielding) ??
    statFieldingGrade(stats) ??
    3;
  const arm =
    numOrNull(g.armStrength) ?? numOrNull(g.arm) ?? statArmGrade(stats) ?? 3;
  const contact = numOrNull(g.contact) ?? statContactGrade(stats) ?? 3;
  const power = numOrNull(g.power) ?? statPowerGrade(stats) ?? 3;
  const raw =
    fielding * 2.5 +
    fielding * 2.0 +
    arm * 1.5 +
    arm * 1.5 +
    speedBaseOf(grades) * 1.5 +
    (grades.baseballIQ || 3) * 2.0 +
    (grades.coachability || 3) * 3.0 +
    contact * 1.5 +
    power * 1.0 +
    // The old plateDiscipline slot folded into Approach (v7); Approach keeps
    // the combined weight so the divisor stays stable.
    approachOf(grades) * 1.0 +
    approachOf(grades) * 1.5 +
    off * 2.0;
  const bonus = extraParts(g, extra);
  // Normalize to 0–100 so the surfaced Total Score is intuitive.
  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        ((raw + bonus.earned) / (TOTAL_SCORE_MAX + bonus.possible)) * 100,
      ),
    ),
  );
}
