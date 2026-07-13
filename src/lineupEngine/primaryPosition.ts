// lineupEngine/primaryPosition.ts
// Active position lists, position-fit scoring, the eval-suggested primary
// position, and pitcher-pool sizing.
import type { GradeMap, Player, PlayerStats } from "../types";
import {
  canonicalizeOutfield,
  canonicalizePositionList,
} from "../utils/helpers";
import {
  DEFAULT_GRADES,
  armAccuracyOf,
  armStrengthOf,
  baserunningOf,
  gloveOf,
  rangeOf,
} from "./grades";
import type { GradesInput } from "./grades";
import {
  CATCHER_EVAL_MAX,
  PITCHER_EVAL_MAX,
  calcCatcherScore,
  calcPitcherScore,
} from "./evaluation";

// Active position list by team defenseSize. Drives the position chip
// rows on the eval form + the Comfortable Positions grid on the player
// profile. The 11-position superset (P, C, 1B, 2B, 3B, SS, LF, LCF, CF,
// RCF, RF) is wrong for younger divisions: at 8U a team plays either
// 10 defenders (LCF + RCF, no CF) or 9 defenders (a single CF, no
// LCF/RCF). The engine itself reads from positionsToFill which is
// already computed correctly per defenseSize.
export function getActivePositionList(
  defenseSize: string | undefined,
): string[] {
  if (defenseSize === "9")
    return ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  // Default + "10": LC + RC cover center together; no lone CF chip.
  return ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "RCF", "RF"];
}

// ---------- Eval-suggested primary position ----------
// A coach can set a player's primaryPosition by hand; this derives a *suggested*
// primary from the eval grades so the profile can offer a one-tap pick and the
// depth chart has a sensible fallback ordering basis when no primary is set.
//
// Each field position emphasizes the eval categories it actually demands at the
// youth level. We score the fit, normalize it to 0..1 (so a field spot is
// comparable with the dedicated pitcher/catcher scores, which carry their own
// maxes), and return the best one. P and C reuse the same eval scorers the depth
// chart ranks them by, so the suggestion never drifts from the chart.
export const POSITION_FIT_WEIGHTS: Record<string, Record<string, number>> = {
  "1B": {
    glove: 3,
    armAccuracy: 1.25,
    baseballIQ: 1.25,
    range: 0.5,
    armStrength: 0.25,
  },
  "2B": {
    glove: 2.25,
    range: 2.25,
    armAccuracy: 1.75,
    baseballIQ: 1.5,
    baserunning: 0.75,
    armStrength: 0.75,
  },
  "3B": {
    glove: 2.25,
    range: 1.25,
    armStrength: 2.5,
    armAccuracy: 1.75,
    baseballIQ: 1.25,
  },
  SS: {
    glove: 2.75,
    range: 2.75,
    armStrength: 2.25,
    armAccuracy: 1.75,
    baseballIQ: 1.75,
    baserunning: 1,
  },
  LF: {
    glove: 1.75,
    range: 2,
    armAccuracy: 1.25,
    armStrength: 0.75,
    baserunning: 1,
    baseballIQ: 0.75,
  },
  CF: {
    glove: 2,
    range: 3.25,
    armStrength: 1.5,
    armAccuracy: 1.25,
    baserunning: 1.75,
    baseballIQ: 1.5,
  },
  RF: {
    glove: 1.75,
    range: 2,
    armStrength: 2.25,
    armAccuracy: 1.25,
    baserunning: 1,
    baseballIQ: 0.75,
  },
};

export const POSITION_DEMAND_BONUS: Record<string, number> = {
  SS: 0.05,
  CF: 0.035,
  "2B": 0.015,
  "3B": 0.015,
  RF: 0.015,
};

export const FIT_READERS: Record<string, (g: GradesInput) => number> = {
  glove: gloveOf,
  range: rangeOf,
  armStrength: armStrengthOf,
  armAccuracy: armAccuracyOf,
  baserunning: baserunningOf,
  baseballIQ: (g) => g?.baseballIQ ?? 3,
};

export function fieldFitScore(
  pos: string,
  grades: GradeMap | null | undefined,
): number {
  const w = POSITION_FIT_WEIGHTS[canonicalizeOutfield(pos)];
  if (!w) return 0;
  const g = { ...DEFAULT_GRADES, ...(grades || {}) } as Record<string, number>;
  let score = 0;
  let max = 0;
  for (const [k, weight] of Object.entries(w)) {
    score += (FIT_READERS[k]?.(g) ?? 3) * weight;
    max += 5 * weight;
  }
  return max > 0
    ? Math.min(
        1,
        score / max + (POSITION_DEMAND_BONUS[canonicalizeOutfield(pos)] || 0),
      )
    : 0;
}

export function positionFitSignal(
  pos: string,
  grades: GradeMap | null | undefined,
): number {
  const weights = POSITION_FIT_WEIGHTS[canonicalizeOutfield(pos)];
  const g = { ...DEFAULT_GRADES, ...(grades || {}) } as Record<string, number>;
  if (!weights) {
    const keys =
      pos === "P"
        ? ["velocity", "strikes", "offSpeed", "composure"]
        : ["receiving", "blocking", "throwing", "armAccuracy"];
    const total = keys.reduce(
      (sum, key) => sum + Math.abs((g[key] ?? 3) - 3),
      0,
    );
    return Math.min(1, total / (keys.length * 2));
  }
  let weightedDeviation = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    weightedDeviation += Math.abs((FIT_READERS[key]?.(g) ?? 3) - 3) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0
    ? Math.min(1, weightedDeviation / (totalWeight * 2))
    : 0;
}

export interface PrimarySuggestion {
  position: string | null;
  fit: number; // 0..1 normalized fit, for display / tie-debugging
  confidence: number;
  alternatives: Array<{ position: string; fit: number }>;
  reason?: string;
}

// Suggest a player's best-fit primary from their (combined) eval grades. Only
// positions the kid is cleared for are considered; an empty comfort list falls
// back to the field spots (never auto-suggests C — catching is opt-in — or a
// ceremonial P). Returns null when there are no candidates. Pure.
export function suggestPrimaryPosition(
  player:
    | { comfortablePositions?: string[]; stats?: PlayerStats | null }
    | null
    | undefined,
  grades: GradeMap | null | undefined,
  opts?: { kidPitch?: boolean; teamAge?: string },
): PrimarySuggestion | null {
  if (!player) return null;
  const kidPitch = !!opts?.kidPitch;
  const comfort = Array.isArray(player.comfortablePositions)
    ? canonicalizePositionList(player.comfortablePositions)
    : [];
  const candidates =
    comfort.length > 0 ? comfort : ["1B", "2B", "3B", "SS", "LF", "CF", "RF"];

  const scored: Array<{ position: string; fit: number; signal: number }> = [];
  for (const pos of candidates) {
    let fit: number;
    if (pos === "P") {
      // Coach/machine-pitch P is ceremonial — never a meaningful primary.
      if (!kidPitch) continue;
      fit =
        calcPitcherScore(grades, player.stats, { teamAge: opts?.teamAge }) /
        PITCHER_EVAL_MAX;
    } else if (pos === "C") {
      fit = calcCatcherScore(grades, player.stats) / CATCHER_EVAL_MAX;
    } else {
      fit = fieldFitScore(pos, grades);
    }
    scored.push({ position: pos, fit, signal: positionFitSignal(pos, grades) });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) =>
    b.fit !== a.fit ? b.fit - a.fit : a.position.localeCompare(b.position),
  );
  const [best, second] = scored;
  const margin = second ? best.fit - second.fit : best.signal;
  const confidence = Math.max(0, Math.min(1, margin * 8 + best.signal * 0.55));
  const alternatives = scored
    .slice(1, 4)
    .map(({ position, fit }) => ({ position, fit }));
  const hasSignal = best.signal >= 0.12 || best.fit >= 0.72;
  const separated = scored.length === 1 ? hasSignal : margin >= 0.01;
  if (!hasSignal || !separated) {
    return {
      position: null,
      fit: best.fit,
      confidence,
      alternatives: scored
        .slice(0, 3)
        .map(({ position, fit }) => ({ position, fit })),
      reason: !hasSignal
        ? "not-enough-position-signal"
        : "position-scores-too-close",
    };
  }
  return { position: best.position, fit: best.fit, confidence, alternatives };
}

// Pool size by game type (9U+ Kid Pitch only). Pool = spread across the
// staff so the aces can rest for bracket weekends. Bracket = win-now.
// League = regular-season default.
export function getPitcherPoolSize(gameType: string | undefined): number {
  if (gameType === "pool") return 5;
  if (gameType === "bracket") return 3;
  return 3; // "league" or unset
}
