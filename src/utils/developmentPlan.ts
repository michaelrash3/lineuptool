// Player-development-plan helpers: suggest focus areas from the weakest eval
// grades, map focus areas to matching drills in the team library, cap the
// check-in log, and index drill assignments for the practice planner. Pure —
// no React, no Firestore. The persistence lives in useDevelopmentCrud; the
// availability gate (isPlayerHealthOut / isPlayerUnavailable) lives in
// utils/availability.ts with the rest of the who's-out math.

import type { EvalCategory, EvalGroup } from "../constants/ui";
import { evalRoundRecency } from "./evaluations";
import type {
  DevCheckIn,
  DrillDefinition,
  EvalCategoryId,
  GradeMap,
  Player,
} from "../types";

export const FOCUS_AREAS_CAP = 3;
export const DEV_GOALS_CAP = 10;
export const DEV_CHECKINS_CAP = 20;

// The weakest graded categories for one player, catalog order breaking ties —
// the "Suggest weakest" seed for focus areas. Only real grades count: a
// category graded 0/absent is unknown, not weak, and zero-weight catalog
// entries (mph radar readings) are excluded from 1–5 grade math everywhere.
// Pass the player's OWN category list (getEvalCategoriesForPlayer) so a
// non-catcher never gets catching suggested.
export const suggestFocusAreas = (
  grades: GradeMap | null | undefined,
  categories: EvalCategory[] | null | undefined,
  count: number = FOCUS_AREAS_CAP,
): EvalCategoryId[] =>
  (categories || [])
    .filter((c) => c.weight > 0)
    .map((c, idx) => ({ id: c.id, grade: Number(grades?.[c.id]), idx }))
    .filter((x) => Number.isFinite(x.grade) && x.grade > 0)
    .sort((a, b) => a.grade - b.grade || a.idx - b.idx)
    .slice(0, Math.max(0, count))
    .map((x) => x.id as EvalCategoryId);

// The eval group each drill-library category trains — the coarse fallback
// when a drill carries no explicit evalCategory tag. Conditioning drills
// train everything and nothing; they never match a focus area.
const GROUP_TO_DRILL_CATEGORY: Record<EvalGroup, string> = {
  Hitting: "Hitting",
  Fielding: "Fielding",
  Baserunning: "Baserunning",
  Pitching: "Pitching",
  Catching: "Catching",
  Intangibles: "Team",
};

// Drills that train the given focus areas: exact evalCategory tags first
// (strongest signal), then drills whose coarse category matches a focus
// area's eval group. Preserves library order within each band; no dupes.
export const suggestDrillsForFocus = (
  library: DrillDefinition[] | null | undefined,
  focus: EvalCategoryId[] | null | undefined,
  categories: EvalCategory[] | null | undefined,
): DrillDefinition[] => {
  const focusSet = new Set(focus || []);
  if (focusSet.size === 0) return [];
  const groups = new Set(
    (categories || [])
      .filter((c) => focusSet.has(c.id as EvalCategoryId))
      .map((c) => GROUP_TO_DRILL_CATEGORY[c.group])
      .filter(Boolean),
  );
  const exact: DrillDefinition[] = [];
  const byGroup: DrillDefinition[] = [];
  for (const d of library || []) {
    if (d.evalCategory && focusSet.has(d.evalCategory)) exact.push(d);
    else if (groups.has(d.category)) byGroup.push(d);
  }
  return [...exact, ...byGroup];
};

// What a development plan carries across a season rollover: focus areas,
// assigned drills, and still-ACTIVE goals continue into the new season;
// resolved goals (their outcome is archived into the pastSeasons summary —
// see buildPlayerSeasonSummaries) and old-season dated check-ins do not.
// Returns undefined when nothing carries, so the key drops off the doc.
export const rolloverDevPlan = (
  plan: import("../types").PlayerDevPlan | null | undefined,
): import("../types").PlayerDevPlan | undefined => {
  if (!plan) return undefined;
  const next: import("../types").PlayerDevPlan = {};
  if (plan.focusAreas?.length) next.focusAreas = plan.focusAreas;
  const active = (plan.goals || []).filter((g) => g.status === "active");
  if (active.length) next.goals = active;
  if (plan.drillIds?.length) next.drillIds = plan.drillIds;
  return Object.keys(next).length > 0 ? next : undefined;
};

// Newest-first, capped. Applied on every check-in write so the list can
// never grow unbounded on the 1 MB team doc.
export const capCheckIns = (
  list: DevCheckIn[] | null | undefined,
): DevCheckIn[] =>
  [...(list || [])]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, DEV_CHECKINS_CAP);

// First→last grade movement for one player's focus areas, from the head
// coach's rounds (oldest→newest — same selection as EvalTrendPage). Only
// categories with two or more graded rounds appear; consumers decide whether
// a flat first===last reading is worth showing. This is what closes the
// loop: "you set Contact as a focus — it's gone 2→4 since."
export const focusAreaDeltas = (
  evaluationEvents:
    | Array<{
        coachRole?: string;
        date?: string;
        grades?: Record<string, GradeMap>;
      }>
    | null
    | undefined,
  playerId: string,
  focusAreas: EvalCategoryId[] | null | undefined,
): Partial<Record<EvalCategoryId, { first: number; last: number }>> => {
  const out: Partial<Record<EvalCategoryId, { first: number; last: number }>> =
    {};
  if (!focusAreas?.length) return out;
  const rounds = (evaluationEvents || [])
    .filter((e) => e.coachRole === "Head")
    .sort((a, b) => evalRoundRecency(b, a)); // oldest first
  for (const id of focusAreas) {
    const values: number[] = [];
    for (const round of rounds) {
      const grade = round.grades?.[playerId]?.[id];
      if (typeof grade === "number" && Number.isFinite(grade))
        values.push(grade);
    }
    if (values.length >= 2)
      out[id] = { first: values[0], last: values[values.length - 1] };
  }
  return out;
};

// drill library id → names of players assigned that drill, roster order.
// Drives the practice agenda's "Targets: Ava, Sam" annotations.
export const drillAssignmentIndex = (
  players: Player[] | null | undefined,
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const p of players || []) {
    for (const drillId of p.devPlan?.drillIds || []) {
      if (!p.name) continue;
      (out[drillId] ||= []).push(p.name);
    }
  }
  return out;
};
