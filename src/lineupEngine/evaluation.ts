// lineupEngine/evaluation.ts
// Pitcher, catcher, and defensive (fielding) scoring — consumed by the
// depth-chart ranking, the engine's pitcher pool, and the eval UI.
import type { GradeMap, PlayerStats } from "../types";
import {
  DEFAULT_GRADES,
  numOrNull,
  speedBaseOf,
  statArmGrade,
  statBlockingGrade,
  statFieldingGrade,
  statOffSpeedGrade,
  statStrikesGrade,
  statThrowingGrade,
  statVelocityGrade,
} from "./grades";

// ---------- Pitcher scoring (Round 2 spec) ----------
// Eval-driven, with strikes weighted highest because dropped-3rd-strike and
// walk damage are the usual differentiators at 9U+ Kid Pitch. `strikes` is the
// merged control/command category from the current eval taxonomy (the v7
// migration folds the old `control`+`command` grades into it), so we weight
// `strikes` here — the previous control/command keys no longer exist on graded
// players and were silently scored as zero.
// Single source of truth for the engine's P-slot picker (D4).
export const PITCHER_SCORE_WEIGHTS: Record<string, number> = {
  velocity: 1.5,
  strikes: 3.5,
  offSpeed: 0.5,
  composure: 1.0,
};

// Pitcher score scale (1–5 grades × weights). Max ≈ 32.5.
export const PITCHER_EVAL_MAX =
  5 * Object.values(PITCHER_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

// Imported GameChanger pitching stats → 0–1 quality. Each spec is
// (worst, best); best < worst encodes lower-is-better (WHIP/ERA/BAA/BB-INN/
// HHB%). Ranges are youth-level rules of thumb, intentionally easy to tune.
// Only stats actually present count, so a missing stat never penalizes.
export const PITCHER_STAT_SPECS: Array<{
  key: keyof PlayerStats;
  w: number;
  worst: number;
  best: number;
}> = [
  // Control & efficiency (weighted highest)
  { key: "pStrikePct", w: 1.5, worst: 0.45, best: 0.65 },
  { key: "pFps", w: 1.5, worst: 0.45, best: 0.65 },
  { key: "pBbPerInn", w: 1.5, worst: 1.2, best: 0.2 },
  { key: "pKbb", w: 1.5, worst: 0.5, best: 3.0 },
  { key: "pWhip", w: 1.5, worst: 2.2, best: 1.0 },
  // Run prevention. ERA/BAA are the classic "old-school" rates — luck- and
  // defense-dependent at this level, so they carry the LOWEST weight.
  { key: "pEra", w: 0.75, worst: 8.0, best: 2.0 },
  { key: "pBaa", w: 0.75, worst: 0.4, best: 0.18 },
  // Bats-missed / weak contact — the advanced rates that describe what the
  // pitcher actually controls. Weighted up alongside control & efficiency.
  { key: "pKbf", w: 1.25, worst: 0.1, best: 0.35 },
  { key: "pSwingMiss", w: 1.5, worst: 0.05, best: 0.25 },
  { key: "pWeak", w: 1.5, worst: 0.15, best: 0.45 },
  { key: "pHardPct", w: 1.5, worst: 0.45, best: 0.15 },
  { key: "pGoAo", w: 1.0, worst: 0.7, best: 2.5 },
];

export function calcPitcherStatsQuality(
  stats: PlayerStats | null | undefined,
): number | null {
  if (!stats) return null;
  let acc = 0;
  let wSum = 0;
  for (const s of PITCHER_STAT_SPECS) {
    const v = stats[s.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const span = s.best - s.worst;
    if (span === 0) continue;
    const norm = Math.min(1, Math.max(0, (v - s.worst) / span));
    acc += norm * s.w;
    wSum += s.w;
  }
  return wSum > 0 ? acc / wSum : null;
}

// Age-relative velocity quality (0..1). Velocity is meaningless on an absolute
// scale across ages, but a team is a single age group, so we normalize a
// pitcher's top fastball against an age-appropriate band — a hard thrower for
// their level scores high regardless of division. Manually entered (radar) or
// imported. Returns null when there's no reading.
// Internal copy of the age velocity benchmarks (mirrors AGE_VELOCITY_BENCHMARKS
// in src/constants/ui.ts — the engine deliberately keeps its own labelless copy
// so it stays standalone). Returns [floor, ceiling] = [recreational low, elite threshold],
// so a competitive/travel-band reading gets meaningful credit and an elite
// reading scores 1.0.

// Pitcher value (schema v9): Velocity/Strikes/Off-Speed are graded purely from
// the imported stats; Composure is the one coach-graded slot. Each slot reads
// the (stat-overlaid) grade map first, then derives directly from `stats` —
// so callers passing un-overlaid grades still get stats-graded slots. A slot
// with no signal at all contributes nothing, and a player with zero signal
// scores 0 — preserving the engine's "score > 0" pitcher-pool gate so kids
// with no pitching data never enter the staff ranking. Consumed by the
// depth-chart ranking AND the engine's pitcher pool.
export function calcPitcherScore(
  grades: GradeMap | null | undefined,
  stats?: PlayerStats | null,
  opts?: {
    topMph?: number | null;
    teamAge?: string;
    // Fill signal-less slots with the neutral 3 instead of skipping them —
    // used by the roster premium so a partially-imported stat line compares
    // fairly against the all-categories neutral baseline. A player with NO
    // signal at all still scores 0 either way.
    neutralFill?: boolean;
  },
): number {
  const g: GradeMap = grades || {};
  const slots: Record<string, number | null> = {
    velocity:
      numOrNull(g.velocity) ??
      statVelocityGrade(stats, {
        topMph: opts?.topMph,
        teamAge: opts?.teamAge,
      }),
    strikes: numOrNull(g.strikes) ?? statStrikesGrade(stats),
    offSpeed: numOrNull(g.offSpeed) ?? statOffSpeedGrade(stats),
    composure: numOrNull(g.composure),
  };
  const hasSignal = Object.values(slots).some((v) => v != null);
  if (!hasSignal) return 0;
  let score = 0;
  for (const [k, w] of Object.entries(PITCHER_SCORE_WEIGHTS)) {
    const v = slots[k] ?? (opts?.neutralFill ? 3 : null);
    if (v != null) score += v * w;
  }
  return score;
}

// ---------- Catcher scoring ----------
// Mirrors calcPitcherScore: Throwing is graded from imported stats (CS%) with
// a coach Blocking grade (stat-overlaid from PB/game when available) and a
// coach Receiving grade. Game Calling was dropped — not a thing at young ages.
// Blocking and throwing weigh highest because passed balls and stolen bases
// are where weak catching shows up most at Kid Pitch. Single source of truth —
// consumed by the Depth Chart tab (and the engine's dual-role pool logic).
export const CATCHER_SCORE_WEIGHTS: Record<string, number> = {
  blocking: 1.5,
  throwing: 1.5,
  receiving: 1.0,
};

export const CATCHER_EVAL_MAX =
  5 * Object.values(CATCHER_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

// 0..1 normalizer shared by the stat-quality helpers.
export function normUp(v: number, lo: number, hi: number): number {
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

// Same-day dual-role rule: a player never pitches AND catches in the same day.
// Within the game, `st.positions` reflects prior committed innings (and the
// per-inning `used` set blocks same-inning doubles). Across games on the same
// date (doubleheaders), `sameDay` carries who already pitched/caught earlier
// today in OTHER games, with `id` the player being placed.
export function dualRoleBlocked(
  st: { positions?: Record<string, number> } | undefined,
  pos: string,
  id?: string,
  sameDay?: { pitched?: Set<string>; caught?: Set<string> },
): boolean {
  if (pos === "P")
    return (
      (st?.positions?.["C"] || 0) > 0 || (!!id && !!sameDay?.caught?.has(id))
    );
  if (pos === "C")
    return (
      (st?.positions?.["P"] || 0) > 0 || (!!id && !!sameDay?.pitched?.has(id))
    );
  return false;
}

// Caught-stealing % → catcher quality (the one catching rate GameChanger gives
// per player). 0..1, null when absent. Youth band ~15%–55%.
export function calcCatcherStatsQuality(
  stats: PlayerStats | null | undefined,
): number | null {
  const v = stats?.fCsPct;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return normUp(v, 0.15, 0.55);
}

// FPCT → fielding reliability quality. 0..1, null when absent. Youth band
// ~.800–.980.
export function calcFieldingStatsQuality(
  stats: PlayerStats | null | undefined,
): number | null {
  const v = stats?.fFpct;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return normUp(v, 0.8, 0.98);
}

// Catcher value: Throwing from stats (CS%), Blocking from coach (stat-overlaid
// from PB/game when available), Receiving from the coach. Slots read the
// (stat-overlaid) grade map first, then derive from `stats` directly; a slot
// with no signal contributes nothing, so a kid with zero catching signal
// scores 0.
export function calcCatcherScore(
  grades: GradeMap | null | undefined,
  stats?: PlayerStats | null,
  opts?: { gamesCaught?: number },
): number {
  const g: GradeMap = grades || {};
  const slots: Record<string, number | null> = {
    throwing: numOrNull(g.throwing) ?? statThrowingGrade(stats),
    blocking:
      numOrNull(g.blocking) ?? statBlockingGrade(stats, opts?.gamesCaught),
    receiving: numOrNull(g.receiving),
  };
  let score = 0;
  for (const [k, w] of Object.entries(CATCHER_SCORE_WEIGHTS)) {
    const v = slots[k];
    if (v != null) score += v * w;
  }
  return score;
}

// ---------- Defensive (fielding) scoring ----------
// General field-defense rating used to rank position players. Extracted from
// computeProfile so the Depth Chart tab and the engine's profile share one
// formula and never drift. The glove/range/arm slots are stats-graded
// (schema v9) — already carried on the grade map by the getCombinedGrades
// overlay, with a direct-from-stats fallback for callers passing raw grades.
// Speed/Base Running and Baseball IQ remain coach-graded.
export function calcDefensiveScore(
  grades: GradeMap | null | undefined,
  stats?: PlayerStats | null,
): number {
  const g = { ...DEFAULT_GRADES, ...(grades || {}) } as Record<string, number>;
  const fielding = numOrNull(g.glove) ?? statFieldingGrade(stats) ?? 3;
  const range = numOrNull(g.range) ?? statFieldingGrade(stats) ?? 3;
  const arm = numOrNull(g.armStrength) ?? statArmGrade(stats) ?? 3;
  const armAcc = numOrNull(g.armAccuracy) ?? statArmGrade(stats) ?? 3;
  return (
    fielding * 2.0 +
    range * 1.5 +
    arm * 1.5 +
    armAcc * 1.5 +
    speedBaseOf(g) * 1.5 +
    (g.baseballIQ ?? 3) * 2.0
  );
}
