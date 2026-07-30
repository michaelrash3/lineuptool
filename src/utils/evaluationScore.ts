import type { GradeMap, Player, PlayerStats } from "../types";
import {
  calculateTotalScore,
  calcPitcherScore,
  calcCatcherScore,
  totalScoreMaxFor,
  PITCHER_EVAL_MAX,
  CATCHER_EVAL_MAX,
  type ExtraScoredCategory,
} from "../lineupEngine";
import { playerIsPitcher, playerIsCatcher } from "../constants/ui";

export const playerTopMph = (player: Player): number | undefined => {
  const pitching = (player as { pitching?: { topMph?: number } }).pitching;
  return pitching?.topMph;
};

// Shared version of the existing EvaluationTab card score. It starts from the
// engine's current 1-100 Total Score (calculateTotalScore), then expands the
// denominator for applicable pitcher/catcher buckets so every entered signal is
// used without averaging raw measurements directly into 1-5 grades.
// `extraCategories` carries the team's own eval categories (scoredCustomCategories
// in utils/evalCategories.ts). Omitted — as every caller did before per-team
// categories existed — the math is unchanged to the bit: the universal
// denominator stays TOTAL_SCORE_MAX and calculateTotalScore adds nothing.
export const currentEvaluationScore100 = (
  grades: GradeMap | null | undefined,
  player: Player,
  teamAge?: string,
  statsOverride?: PlayerStats | null,
  extraCategories?: ReadonlyArray<ExtraScoredCategory> | null,
): number | null => {
  if (!grades) return null;
  const stats = statsOverride ?? player?.stats ?? null;
  // Rescale by the SAME denominator calculateTotalScore normalized against, so
  // a graded team category widens both sides of the fraction together.
  const universalMax = totalScoreMaxFor(grades, extraCategories);
  let earned =
    (calculateTotalScore(grades, stats, extraCategories) / 100) * universalMax;
  let possible = universalMax;

  if (playerIsPitcher(player)) {
    earned += calcPitcherScore(grades, stats, {
      topMph: stats?.pTopMph ?? playerTopMph(player),
      teamAge,
      neutralFill: true,
    });
    possible += PITCHER_EVAL_MAX;
  }

  if (playerIsCatcher(player)) {
    earned += calcCatcherScore(grades, stats);
    possible += CATCHER_EVAL_MAX;
  }

  if (!Number.isFinite(earned) || !Number.isFinite(possible) || possible <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((earned / possible) * 100)));
};
