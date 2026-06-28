// Smart practice planner — turns the team's evaluation grades + drill library
// into a ready-to-tweak practice agenda. Pure functions only (no React, no
// Firestore), so it unit-tests like the lineup engine.
//
// The signal: coaches grade intangibles (Approach, Speed, Base Running,
// Baseball IQ, …) in eval rounds. We average the most recent round per skill
// area and weight practice time toward the weakest ones. Areas with no graded
// signal (Fielding/Pitching are stat-derived, not graded) fall back to a
// neutral baseline so every plan still covers them. With no eval data at all
// the plan is simply balanced — exactly what a coach would build by hand.

import type {
  DrillCategory,
  DrillDefinition,
  DrillLogEntry,
  EvaluationEvent,
} from "../types";
import { EVAL_SCALE_MAX, isKidPitchFormat } from "../constants/ui";
import { genId } from "./id";

export type FocusArea =
  | "Hitting"
  | "Fielding"
  | "Pitching"
  | "Baserunning"
  | "Team";

// Graded eval-category ids that feed each focus area. Empty = no graded signal
// (the skill is stat-derived), so the area uses NEUTRAL_NEED.
const FOCUS_EVAL_MAP: Record<FocusArea, string[]> = {
  Hitting: ["approach"],
  Baserunning: ["speed", "baserunning"],
  Team: ["baseballIQ"],
  Fielding: [],
  Pitching: [],
};

// Stable tiebreak order when two areas are equally weak.
const FOCUS_ORDER: FocusArea[] = [
  "Hitting",
  "Fielding",
  "Pitching",
  "Baserunning",
  "Team",
];

const NEUTRAL_NEED = 0.5;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export interface FocusNeed {
  area: FocusArea;
  need: number; // 0 (strong) .. 1 (weakest — most practice time)
  avgGrade: number | null; // team average 1..5 for the area, null if ungraded
  hasSignal: boolean;
}

export interface TeamSkillProfile {
  focuses: FocusNeed[]; // weakest-first
  roundDate: string | null;
  hasEvalSignal: boolean;
}

// Most recent eval round by date, tie-broken by createdAt.
const latestRound = (
  rounds: EvaluationEvent[] | undefined,
): EvaluationEvent | null => {
  if (!Array.isArray(rounds) || rounds.length === 0) return null;
  return [...rounds]
    .sort((a, b) => {
      const d = (a.date || "").localeCompare(b.date || "");
      if (d !== 0) return d;
      return (a.createdAt || 0) - (b.createdAt || 0);
    })
    .pop() as EvaluationEvent;
};

// Build per-area weakness from the team's latest eval round. `team` is typed
// permissively to mirror the runtime team doc.
export const buildTeamSkillProfile = (team: {
  evaluationEvents?: EvaluationEvent[];
}): TeamSkillProfile => {
  const round = latestRound(team?.evaluationEvents);
  const grades = round?.grades || {};

  const avgFor = (ids: string[]): number | null => {
    if (ids.length === 0) return null;
    let sum = 0;
    let n = 0;
    for (const pid of Object.keys(grades)) {
      const gm = grades[pid] || {};
      for (const id of ids) {
        const v = (gm as Record<string, unknown>)[id];
        if (typeof v === "number" && v > 0) {
          sum += v;
          n += 1;
        }
      }
    }
    return n > 0 ? sum / n : null;
  };

  const focuses: FocusNeed[] = FOCUS_ORDER.map((area) => {
    const avg = avgFor(FOCUS_EVAL_MAP[area]);
    const hasSignal = avg != null;
    const need = hasSignal
      ? clamp01(1 - (avg - 1) / (EVAL_SCALE_MAX - 1))
      : NEUTRAL_NEED;
    return { area, need, avgGrade: avg, hasSignal };
  });

  focuses.sort(
    (a, b) =>
      b.need - a.need ||
      FOCUS_ORDER.indexOf(a.area) - FOCUS_ORDER.indexOf(b.area),
  );

  return {
    focuses,
    roundDate: round?.date ?? null,
    hasEvalSignal: focuses.some((f) => f.hasSignal),
  };
};

// One-line, honest rationale naming only the weak areas we actually have a
// graded signal for. Used as the modal's subtitle.
export const describeEmphasis = (profile: TeamSkillProfile): string => {
  const signaled = profile.focuses.filter((f) => f.hasSignal && f.need > 0.5);
  if (signaled.length === 0) {
    return "A balanced plan across every area — add eval grades to tailor it.";
  }
  const names = signaled.slice(0, 2).map((f) => f.area);
  const when = profile.roundDate
    ? ` (from your ${profile.roundDate} round)`
    : "";
  return `Weighted toward ${names.join(" & ")} — your lowest grades${when}.`;
};

const envOk = (
  d: DrillDefinition,
  environment: "indoor" | "outdoor",
): boolean =>
  !d.environment || d.environment === "both" || d.environment === environment;

export interface PlanInput {
  profile: TeamSkillProfile;
  minutes: number;
  environment: "indoor" | "outdoor";
  library: DrillDefinition[];
  pitchingFormat?: string;
}

interface PlannedBlock {
  drill: DrillDefinition;
  weight: number;
}

// Build the agenda. Always opens with a warm-up + a throwing/arm-care block and
// closes with a situational ("Team") block; the middle is the weak focus areas,
// weighted by need. Minutes are scaled so the blocks sum to `minutes` exactly.
export const generatePracticePlan = (input: PlanInput): DrillLogEntry[] => {
  const { profile, environment, library } = input;
  const minutes = Math.max(15, Math.round(input.minutes || 0));
  const kidPitch = isKidPitchFormat(input.pitchingFormat);

  const pool = (library || []).filter((d) => envOk(d, environment));
  const used = new Set<string>();
  const pick = (category: DrillCategory): DrillDefinition | null => {
    const hit = pool.find((d) => d.category === category && !used.has(d.id));
    if (hit) used.add(hit.id);
    return hit || null;
  };

  const blocks: PlannedBlock[] = [];
  const add = (drill: DrillDefinition | null, weight: number) => {
    if (drill) blocks.push({ drill, weight });
  };

  // Fixed bookends carry a base weight; the warm-up + throwing keep practices
  // safe regardless of the weak-area math.
  add(pick("Conditioning"), 1);
  add(pick("Pitching"), 1); // long toss / arm care to open arms

  // Weak focus areas in the middle, weakest first. Pitching/Catching emphasis
  // only makes sense for kid-pitch teams.
  for (const f of profile.focuses) {
    if (f.area === "Pitching" && !kidPitch) continue;
    // Pitching warm-up drill may already be used; pick() guards duplicates.
    add(pick(f.area as DrillCategory), 1 + f.need * 2);
  }
  if (kidPitch) add(pick("Catching"), 1.2);

  // Situational closer.
  add(pick("Team"), 1.3);

  // Fallback: an empty/mismatched library still yields a usable single block.
  if (blocks.length === 0) {
    const any = (library || [])[0];
    if (any) blocks.push({ drill: any, weight: 1 });
    else return [];
  }

  // Keep the agenda feasible: a 5-min floor per block means we can only fit
  // floor(minutes / 5) blocks. Trim the lowest-priority tail (closer/catching
  // first) for short practices; the warm-up and weak-area blocks lead.
  const maxBlocks = Math.max(1, Math.floor(minutes / 5));
  const kept = blocks.slice(0, maxBlocks);

  // Allocate minutes with a 5-min floor per block, then distribute the
  // remainder by weight via largest-remainder so the blocks sum to `minutes`
  // exactly (kept.length ≤ floor(minutes / 5), so the floor always fits).
  const MIN = 5;
  const remaining = minutes - MIN * kept.length;
  const totalWeight = kept.reduce((s, b) => s + b.weight, 0) || 1;
  const raw = kept.map((b) => (remaining * b.weight) / totalWeight);
  const extra = raw.map((r) => Math.floor(r));
  let leftover = remaining - extra.reduce((s, e) => s + e, 0);
  // Hand the rounding leftover to the blocks with the largest fractional part.
  const byFrac = kept
    .map((_, i) => i)
    .sort((a, b) => raw[b] - extra[b] - (raw[a] - extra[a]));
  for (const i of byFrac) {
    if (leftover <= 0) break;
    extra[i] += 1;
    leftover -= 1;
  }
  const allocated = extra.map((e) => MIN + e);

  return kept.map((b, i) => ({
    id: genId("dl"),
    name: b.drill.name,
    minutes: allocated[i],
    category: b.drill.category,
    libraryId: b.drill.id,
  }));
};
