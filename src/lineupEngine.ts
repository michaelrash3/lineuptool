// lineupEngine.ts
// =============================================================================
// Pure-function lineup generation engine — the public entry point.
//
// No React, no Firebase, no DOM: fully testable in isolation and trivially
// movable to a Web Worker if the UI thread ever needs to be freed up.
//
// This file is a curated re-export barrel. The implementation lives in the
// src/lineupEngine/ package, split by concern:
//   eligibility · grades · totalScore · pitchRules · evaluation ·
//   primaryPosition · prng · profile · engineContext · battingOrder ·
//   benchSchedule · tournamentPlan · generator
//
// Consumers import named symbols from "…/lineupEngine" unchanged; only the
// public surface below is exposed (internal helpers stay module-private).
//
// Public API
// ----------
//   generateLineup(input)           -> EngineResult   (Rec / Competitive)
//   generateTournamentLineup(input) -> EngineResult   (scripted tournament)
//   generateBattingOnly(input)      -> EngineResult   (batting order only)
//   buildCompetitiveLineup(input)   -> EngineResult   (competitive wrapper)
// Plus the eval / scoring / pitch-rule / position helpers used by the UI.
// =============================================================================

// --- Position eligibility & catcher policy ---
export {
  isPositionBlocked,
  isCatcherEligible,
  resolveCatcherPolicy,
  getPositionsForInning,
} from "./lineupEngine/eligibility";
export type { CatcherPolicy } from "./lineupEngine/eligibility";

// --- Grades & offensive scoring ---
export {
  getCombinedGrades,
  statContactGrade,
  statPowerGrade,
  statFieldingGrade,
  statArmGrade,
  statBlockingGrade,
  countGamesCaught,
  getOffensiveScore,
  calcVelocityQuality,
} from "./lineupEngine/grades";

// --- Total score ---
export {
  calculateTotalScore,
  TOTAL_SCORE_MAX,
} from "./lineupEngine/totalScore";

// --- Pitch-count rules & arm care ---
export {
  resolvePitchRuleSet,
  maxPitchesForAge,
  mostRecentDayPitches,
  checkPitchEligibility,
  buildPitchingPlan,
  analyzePitchingWorkload,
} from "./lineupEngine/pitchRules";
export type {
  PitchRuleSet,
  PitcherAvailability,
  PitchingWorkloadAnalysis,
} from "./lineupEngine/pitchRules";

// --- Pitcher / catcher / defensive evaluation ---
export {
  PITCHER_SCORE_WEIGHTS,
  PITCHER_EVAL_MAX,
  calcPitcherStatsQuality,
  calcPitcherScore,
  CATCHER_EVAL_MAX,
  calcCatcherStatsQuality,
  calcFieldingStatsQuality,
  calcCatcherScore,
  calcDefensiveScore,
} from "./lineupEngine/evaluation";

// --- Position fit & eval-suggested primary position ---
export {
  getActivePositionList,
  fieldFitScore,
  suggestPrimaryPosition,
  getPitcherPoolSize,
} from "./lineupEngine/primaryPosition";
export type { PrimarySuggestion } from "./lineupEngine/primaryPosition";

// --- Generators (entry points) ---
export { generateBattingOnly } from "./lineupEngine/battingOrder";
export { generateTournamentLineup } from "./lineupEngine/tournamentPlan";
export {
  generateLineup,
  buildCompetitiveLineup,
} from "./lineupEngine/generator";
