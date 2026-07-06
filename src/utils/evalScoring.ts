// Pure eval-scoring + grade-record helpers, extracted from EvaluationTab so the
// scoring logic is unit-testable without rendering the ~2,900-line screen (see
// docs/EVALUATIONS-AUDIT.md finding 3.4/3.5). No React, no Firestore.

import {
  EVAL_CATEGORIES,
  EVAL_SCALE_DEFAULT,
  EVAL_SCALE_MAX,
  playerIsPitcher,
  pitcherRosterPremium,
  type EvalCategory,
} from "../constants/ui";
import { calcPitcherScore, PITCHER_SCORE_WEIGHTS } from "../lineupEngine";
import { playerTopMph } from "./evaluationScore";
import type { EvaluationEvent, GradeMap, Player } from "../types";

// A grade record as edited in the UI: the per-category 1–5 grades live under
// arbitrary string keys (number) alongside the free-text notes and the coach's
// suggested-positions chips. Modeled as its own interface (rather than
// GradeMap & …) because the chips array can't satisfy GradeMap's number-only
// index signature.
export interface EvalGradeRecord {
  [categoryId: string]: number | string | string[] | undefined;
  notes?: string;
  suggestedPositions?: string[];
}

// The scoring engine reads only the numeric category grades + notes from a
// record, so an EvalGradeRecord is safe to treat as a GradeMap there. The two
// differ structurally only in the suggested-positions chip array, which the
// engine ignores.
export const asGradeMap = (g: EvalGradeRecord): GradeMap => g as GradeMap;

// EvaluationEvent carries several eval-workflow fields only through its
// `[key: string]: unknown` index signature (tryout linkage + the denormalized
// evaluator name). Narrow them to their real types locally so reads are typed
// without per-access casts.
export interface EvalRound extends EvaluationEvent {
  tryoutSignupId?: string;
  tryoutSessionId?: string;
  evaluatorName?: string;
}

export type DecisionBucket = "strong" | "fit" | "watch" | "younger";

// One row of the Roster Decisions advisory, computed in the panel's useMemo.
// `perfScore` / `teamAvgScore` / `scoreVsTeam` are filled in by the relative
// cut-line pass after the initial per-player map.
export interface DecisionRow {
  player: Player;
  baseballAge: number | null;
  playingUp: boolean;
  // The player's most recent eval score on the 0–100 scale
  // (currentEvaluationScore100), or null when they have no graded round.
  latestEvalScore: number | null;
  totalScore: number;
  decisionScore: number;
  evalTrend: "improving" | "declining" | "flat" | null;
  evalDelta: number | null;
  evalCount: number;
  statsPctVsAvg: number | null;
  statsRatio: number | null;
  bucket: DecisionBucket;
  rationale: string[];
  perfScore?: number;
  teamAvgScore?: number;
  scoreVsTeam?: number | null;
}

export const PITCH_WEIGHT_SUM = Object.values(PITCHER_SCORE_WEIGHTS).reduce(
  (a, b) => a + b,
  0,
);

// Roster-decision premium: pitching WELL puts a kid a leg up when comparing
// players. Additive on top of the universal Total Score (never subtracts), so a
// strong pitcher out-ranks an equal non-pitcher and non-pitchers are unchanged.
// Rewards only ABOVE-neutral pitching — and since Velocity/Strikes/Off-Speed
// are stats-graded (schema v9), the premium now reflects the imported pitching
// stats plus the coach's Composure grade. neutralFill keeps a partial stat
// line comparable against the all-categories neutral baseline; zero-signal
// pitching still earns nothing. Left-handed scarcity is applied only to the
// hidden roster-decision standing below, not to the visible score badge.
export const pitcherPremium = (
  savedGrades: GradeMap,
  player: Player,
  teamAge?: string,
): number => {
  if (!playerIsPitcher(player)) return 0;
  const stats = player?.stats || null;
  const score = calcPitcherScore(savedGrades, stats, {
    topMph: stats?.pTopMph ?? playerTopMph(player),
    teamAge,
    neutralFill: true,
  });
  return pitcherRosterPremium(score, PITCH_WEIGHT_SUM);
};

// 11 standard positions surfaced as a per-player chip row so the coach
// can flag spots they think this kid should play. Stored on the eval
// round as `grades[playerId].suggestedPositions`. Same vocabulary as
// AssistantEvalModal so head + assistant inputs share a shape.
// Canonical 3-outfielder model — evaluations never split center into LCF/RCF;
// the lineup engine maps a CF-graded player onto those field slots when a
// 10-fielder game is played.
export const SUGGESTED_POSITIONS = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
];

export const DEFAULT_GRADES = EVAL_CATEGORIES.reduce<EvalGradeRecord>(
  // Measurement fields (e.g. Pitch Velocity in mph) are optional and have no
  // default — only 1–5 grades seed a starting value.
  (acc, c) =>
    c.inputKind === "mph" ? acc : { ...acc, [c.id]: EVAL_SCALE_DEFAULT },
  {},
);

// Display name for a round: prefer the coach's denormalized last name
// (written at save time so reads work without an extra auth roundtrip);
// fall back to the legacy free-text label, then to a date-only label
// for ancient rounds with neither field set.
export const formatRoundName = (round: EvalRound | null | undefined) => {
  if (!round) return "";
  if (round.evaluatorName) {
    return `${round.evaluatorName} · ${round.date}`;
  }
  if (round.label) return round.label;
  return `Eval (${round.date})`;
};

export const sanitizeGrades = (g: EvalGradeRecord | null | undefined) => {
  const out: EvalGradeRecord = { ...DEFAULT_GRADES };
  EVAL_CATEGORIES.forEach((c) => {
    // Persisted grades may arrive as number or numeric string; parseInt
    // tolerates both, so read the raw value loosely before coercing.
    const v = parseInt(String(g?.[c.id] ?? ""), 10);
    if (Number.isFinite(v))
      out[c.id] = Math.max(1, Math.min(EVAL_SCALE_MAX, v));
  });
  if (typeof g?.notes === "string" && g.notes.trim()) out.notes = g.notes;
  return out;
};

// Mean of the universal (non-add-on) category grades, ignoring blanks and
// out-of-range values. Returns null when nothing gradeable is present.
export const avgUniversal = (gradeRecord: GradeMap | null | undefined) => {
  if (!gradeRecord) return null;
  const vals = EVAL_CATEGORIES.filter((c) => !c.addOn)
    .map((c) => Number(gradeRecord[c.id]))
    .filter((v) => Number.isFinite(v) && v >= 1 && v <= EVAL_SCALE_MAX);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

// Compute the list of automatic flags from the most-recent two rounds.
// Standouts: average grade up by ≥ 0.75 round-over-round
// Regressions: average grade down by ≥ 0.75 round-over-round
// Per-category alerts: any single category dropped 2+ points round-over-round
export const computeFlags = (
  rounds: EvalRound[],
  players: Player[],
  activeCategories: EvalCategory[],
) => {
  if (!rounds || rounds.length < 2) {
    return { standouts: [], regressions: [], categoryDrops: [] };
  }
  const [latest, previous] = rounds;
  const standouts: Array<{ player: Player; delta: number }> = [];
  const regressions: Array<{ player: Player; delta: number }> = [];
  const categoryDrops: Array<{
    player: Player;
    category: EvalCategory;
    from: number;
    to: number;
  }> = [];
  players.forEach((p: Player) => {
    const latestG = latest.grades?.[p.id];
    const prevG = previous.grades?.[p.id];
    if (!latestG || !prevG) return;
    const a = avgUniversal(latestG);
    const b = avgUniversal(prevG);
    if (a == null || b == null) return;
    const delta = a - b;
    if (delta >= 0.75) standouts.push({ player: p, delta });
    if (delta <= -0.75) regressions.push({ player: p, delta });
    activeCategories.forEach((cat: EvalCategory) => {
      const va = Number(latestG[cat.id]);
      const vb = Number(prevG[cat.id]);
      if (Number.isFinite(va) && Number.isFinite(vb) && vb - va >= 2) {
        categoryDrops.push({
          player: p,
          category: cat,
          from: vb,
          to: va,
        });
      }
    });
  });
  standouts.sort((a, b) => b.delta - a.delta);
  regressions.sort((a, b) => a.delta - b.delta);
  return {
    standouts: standouts.slice(0, 3),
    regressions: regressions.slice(0, 3),
    categoryDrops: categoryDrops.slice(0, 5),
  };
};

export const fmtDelta = (d: number) =>
  `${d >= 0 ? "+" : ""}${d.toFixed(1)}`.replace(/\.0$/, "");
