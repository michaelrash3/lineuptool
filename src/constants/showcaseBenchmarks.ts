// Showcase-station benchmarks — the coach-provided per-age charts that turn a
// raw measured number (stopwatch, radar gun, strike count) into a 1–5 grade on
// the same scale as the eval card. Pitch VELOCITY keeps its own existing chart
// (AGE_VELOCITY_BENCHMARKS in constants/ui.ts, scored age-relative by the
// engine); everything here covers the other measured stations.
//
// Band semantics (from the charts): value ≥ band[k] (or ≤ for timed metrics)
// earns grade k+1. Ages outside 7–14 clamp to the nearest row, matching
// ageFromTeamAge's clamping behavior.

import { ageFromTeamAge } from "./ui";
import type { TryoutMeasurements } from "../types";

// The basepath each age group actually runs (drives the home-to-first
// expectation): ≤8U 60 ft, 9–10U 65 ft, 11–12U 70 ft, 13U+ 90 ft.
export const basepathForAge = (teamAge?: string): number => {
  const age = ageFromTeamAge(teamAge);
  if (age <= 8) return 60;
  if (age <= 10) return 65;
  if (age <= 12) return 70;
  return 90;
};

// A grade band: the minimum value earning each grade 2..5 (grade 1 is
// "worse than the grade-2 threshold"). For ascending metrics (mph) a value
// must be ≥ the threshold; for descending metrics (seconds) ≤.
type Bands = [number, number, number, number];

const clampAge = (age: number): number => Math.min(14, Math.max(7, age));

// Home-to-first (seconds over the age's basepath; 1=Very Slow … 5=Elite).
// Grade-2..5 thresholds = the FASTEST end of each chart band boundary:
// e.g. age 7 → 2: ≤5.1, 3: ≤4.8, 4: ≤4.5, 5: ≤4.2 (slower than 5.1 → 1).
const RUN_TO_FIRST_BANDS: Record<number, Bands> = {
  7: [5.1, 4.8, 4.5, 4.2],
  8: [4.9, 4.6, 4.3, 4.0],
  9: [5.1, 4.8, 4.5, 4.2],
  10: [4.9, 4.6, 4.3, 4.0],
  11: [5.0, 4.7, 4.4, 4.1],
  12: [4.8, 4.5, 4.2, 3.9],
  13: [5.9, 5.5, 5.1, 4.7],
  14: [5.1, 4.7, 4.3, 4.0],
};

// Exit velocity (mph; 1=Poor … 5=Elite). Thresholds = each band's minimum:
// e.g. age 10 → 2: ≥42, 3: ≥47, 4: ≥52, 5: ≥57.
const EXIT_VELO_BANDS: Record<number, Bands> = {
  7: [30, 35, 40, 45],
  8: [34, 39, 44, 49],
  9: [38, 43, 48, 53],
  10: [42, 47, 52, 57],
  11: [46, 51, 56, 61],
  12: [51, 56, 61, 66],
  13: [56, 62, 68, 74],
  14: [63, 69, 75, 81],
};

// Max throw velocity (mph, any position; 1=Poor … 5=Elite). Distinct from
// pitch velocity.
const MAX_THROW_VELO_BANDS: Record<number, Bands> = {
  7: [30, 35, 40, 45],
  8: [33, 38, 43, 48],
  9: [37, 42, 47, 52],
  10: [41, 46, 51, 56],
  11: [45, 50, 55, 60],
  12: [49, 54, 59, 64],
  13: [53, 58, 65, 71],
  14: [60, 65, 72, 78],
};

// Pitch accuracy: expected strikes out of 10 mapping to an AVERAGE (grade 3),
// age-adjusted so 8U throwing 5/10 scores like 12U throwing 7/10. Seeded
// defaults the user can tune; each grade band is expected−2 … expected+2
// strike counts around the age's expectation.
export const EXPECTED_STRIKES_OF_10: Record<number, number> = {
  7: 4,
  8: 5,
  9: 5,
  10: 6,
  11: 6,
  12: 7,
  13: 7,
  14: 8,
};

// Grade an ascending-is-better value (mph) against a band row.
const gradeAscending = (value: number, bands: Bands): number => {
  let grade = 1;
  for (let i = 0; i < bands.length; i += 1) {
    if (value >= bands[i]) grade = i + 2;
  }
  return grade;
};

// Grade a descending-is-better value (seconds) against a band row.
const gradeDescending = (value: number, bands: Bands): number => {
  let grade = 1;
  for (let i = 0; i < bands.length; i += 1) {
    if (value <= bands[i]) grade = i + 2;
  }
  return grade;
};

export type ShowcaseMetric =
  | "runToFirstSec"
  | "exitVeloMph"
  | "maxThrowVeloMph";

// Raw measurement → 1–5 grade for the team's age. Returns null for
// missing/invalid values (an unrecorded station never grades anyone).
export const scoreMeasurement = (
  kind: ShowcaseMetric,
  value: number | null | undefined,
  teamAge?: string,
): number | null => {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  const age = clampAge(ageFromTeamAge(teamAge));
  if (kind === "runToFirstSec")
    return gradeDescending(v, RUN_TO_FIRST_BANDS[age]);
  if (kind === "exitVeloMph") return gradeAscending(v, EXIT_VELO_BANDS[age]);
  return gradeAscending(v, MAX_THROW_VELO_BANDS[age]);
};

// Strikes-of-N → 1–5 grade around the age's expected count (age-adjusted:
// hitting the expectation = 3; each strike above/below moves one grade,
// scaled when the attempt count isn't 10).
export const scorePitchAccuracy = (
  strikes: number | null | undefined,
  attempts: number | null | undefined,
  teamAge?: string,
): number | null => {
  // Number(null) is 0 — an unrecorded station must stay null, not "0 strikes".
  if (strikes == null) return null;
  const s = Number(strikes);
  const aRaw = Number(attempts);
  const a = Number.isFinite(aRaw) && aRaw > 0 ? aRaw : 10;
  if (!Number.isFinite(s) || s < 0 || s > a) return null;
  const age = clampAge(ageFromTeamAge(teamAge));
  const expected = EXPECTED_STRIKES_OF_10[age];
  // Normalize to a strikes-of-10 equivalent, then grade by distance from the
  // age's expectation.
  const per10 = (s / a) * 10;
  const diff = per10 - expected;
  if (diff <= -2) return 1;
  if (diff < 0) return 2;
  if (diff < 1) return 3;
  if (diff < 2) return 4;
  return 5;
};

// All measurement-derived grades for a signup, keyed by the EXISTING eval
// category ids they seed (no new categories — the v2 card ids power /
// armStrength / glove / armAccuracy are already in the schema):
//   runToFirstSec        → speed
//   exitVeloMph          → power
//   maxThrowVeloMph      → armStrength
//   fieldingGround/Fly   → glove (average of whichever were graded)
//   pitchStrikes/Attempts→ armAccuracy (age-adjusted strikes-of-10)
//   pitchMph             → pitchVelo (raw mph — that category takes a radar
//                          reading, scored age-relative by the engine)
// These are DEFINITIVE: they come from a stopwatch/radar/count, so consumers
// overlay them on top of the subjective grade blend.
export const measurementGrades = (
  m: TryoutMeasurements | null | undefined,
  teamAge?: string,
): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!m) return out;
  const speed = scoreMeasurement("runToFirstSec", m.runToFirstSec, teamAge);
  if (speed != null) out.speed = speed;
  const power = scoreMeasurement("exitVeloMph", m.exitVeloMph, teamAge);
  if (power != null) out.power = power;
  const arm = scoreMeasurement("maxThrowVeloMph", m.maxThrowVeloMph, teamAge);
  if (arm != null) out.armStrength = arm;
  const acc = scorePitchAccuracy(m.pitchStrikes, m.pitchAttempts, teamAge);
  if (acc != null) out.armAccuracy = acc;
  const gb = Number(m.fieldingGround);
  const fb = Number(m.fieldingFly);
  const gbOk = Number.isFinite(gb) && gb >= 1 && gb <= 5;
  const fbOk = Number.isFinite(fb) && fb >= 1 && fb <= 5;
  if (gbOk || fbOk) {
    const sum = (gbOk ? gb : 0) + (fbOk ? fb : 0);
    out.glove = Math.round(sum / ((gbOk ? 1 : 0) + (fbOk ? 1 : 0)));
  }
  const mph = Number(m.pitchMph);
  if (Number.isFinite(mph) && mph > 0) out.pitchVelo = mph;
  return out;
};
