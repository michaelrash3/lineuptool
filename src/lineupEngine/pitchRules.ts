// lineupEngine/pitchRules.ts
// Pitch-count rule sets (daily max + required rest by age / league), same-day
// eligibility, pitching plans, and arm-care workload analysis. Pure.
import type { Game, Player } from "../types";

// ---------- Pitch count eligibility ----------

// Little League / Pitch Smart daily max by age — the default rule set. Also the
// `limits` of the littleLeague preset below.
export const PITCH_LIMITS: Record<string, number> = {
  "6U": 50,
  "7U": 50,
  "8U": 50,
  "9U": 75,
  "10U": 75,
  "11U to 12U": 85,
  "13U to 14U": 95,
  "15U to 18U": 105,
};

// A league's pitch-count rules: daily max by age + the rest-days tiers (most
// pitches first). Coaches pick a preset or "custom" per team so eligibility,
// the in-game limit, the lineup card, and the availability planner all match
// their league instead of one hardcoded spec.
export interface PitchRuleSet {
  id: string;
  label: string;
  limits: Record<string, number>;
  fallbackLimit: number;
  restTiers: Array<{ min: number; days: number }>;
}

export const LITTLE_LEAGUE_REST: Array<{ min: number; days: number }> = [
  { min: 66, days: 4 },
  { min: 51, days: 3 },
  { min: 36, days: 2 },
  { min: 21, days: 1 },
];

export const PITCH_RULE_SETS: Record<string, PitchRuleSet> = {
  littleLeague: {
    id: "littleLeague",
    label: "Little League / Pitch Smart",
    limits: PITCH_LIMITS,
    fallbackLimit: 105,
    restTiers: LITTLE_LEAGUE_REST,
  },
};

export const DEFAULT_PITCH_RULE_SET = PITCH_RULE_SETS.littleLeague;

// Resolve a team's effective rule set. "custom" uses team.customPitchLimit (one
// daily max for the team's age group) plus optional team.customRestTiers;
// any named preset is looked up; anything unknown/absent falls back to Little
// League — so existing teams keep today's behavior.
export function resolvePitchRuleSet(
  team:
    | {
        pitchRuleSet?: string;
        customPitchLimit?: number | string;
        customRestTiers?: { min: number; days: number }[];
      }
    | null
    | undefined,
): PitchRuleSet {
  const id = team?.pitchRuleSet;
  if (id === "custom") {
    const lim = Number(team?.customPitchLimit);
    const tiers =
      Array.isArray(team?.customRestTiers) && team.customRestTiers.length
        ? [...team.customRestTiers].sort((a, b) => b.min - a.min)
        : LITTLE_LEAGUE_REST;
    return {
      id: "custom",
      label: "Custom",
      limits: {},
      fallbackLimit: Number.isFinite(lim) && lim > 0 ? lim : 105,
      restTiers: tiers,
    };
  }
  return (id ? PITCH_RULE_SETS[id] : undefined) || DEFAULT_PITCH_RULE_SET;
}

export function maxPitchesForAge(
  age: string,
  ruleSet: PitchRuleSet = DEFAULT_PITCH_RULE_SET,
): number {
  return ruleSet.limits[age] ?? ruleSet.fallbackLimit;
}
export function requiredRestDays(
  p: number,
  ruleSet: PitchRuleSet = DEFAULT_PITCH_RULE_SET,
): number {
  for (const t of ruleSet.restTiers) if (p >= t.min) return t.days;
  return 0;
}

// The stored workload every function here reads: the rolling outing log plus
// the legacy single-day mirror fields kept for data saved before the log
// existed. Structurally compatible with Player.pitching.
export interface PitchingRecord {
  log?: Array<{ date?: string; pitches?: number; gameId?: string }>;
  recentPitches?: number;
  // null is the stored "hasn't pitched" state (see Player.pitching).
  lastPitchDate?: string | null;
}

// Pitches on a pitcher's most-recent throwing DAY, summed across outings so a
// doubleheader (two games same date) counts as one day's workload for rest —
// not just the last outing. Prefers the rolling log; falls back to the single
// recentPitches/lastPitchDate fields for data saved before the log existed.
export function mostRecentDayPitches(
  pitching: PitchingRecord | null | undefined,
): { pitches: number; date: string | null } {
  const log = pitching?.log;
  if (Array.isArray(log) && log.length) {
    let maxDate: string | null = null;
    for (const o of log)
      if (o?.date && (!maxDate || o.date > maxDate)) maxDate = o.date;
    if (maxDate) {
      const pitches = log.reduce(
        (s, o) => (o?.date === maxDate ? s + (Number(o.pitches) || 0) : s),
        0,
      );
      return { pitches, date: maxDate };
    }
  }
  return {
    pitches: Number(pitching?.recentPitches) || 0,
    date: pitching?.lastPitchDate || null,
  };
}

// Per-DAY pitch totals: every logged outing summed onto its own date, so two
// games on one date read as ONE day's workload. `excludeGameId` drops a single
// game's own outing — what a surface asks when it wants the load a pitcher
// carries INTO that game (the lineup card, an in-game relief decision) rather
// than after it. The legacy recentPitches/lastPitchDate pair is used only when
// the log holds no dated entry at all, matching mostRecentDayPitches.
function pitchDayTotals(
  pitching: PitchingRecord | null | undefined,
  excludeGameId?: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  const log = pitching?.log;
  if (Array.isArray(log) && log.some((o) => o?.date)) {
    for (const o of log) {
      if (!o?.date) continue;
      if (excludeGameId && o.gameId === excludeGameId) continue;
      totals.set(o.date, (totals.get(o.date) || 0) + (Number(o.pitches) || 0));
    }
    return totals;
  }
  const legacyDate = pitching?.lastPitchDate;
  const legacy = Number(pitching?.recentPitches) || 0;
  if (legacyDate && legacy > 0) totals.set(legacyDate, legacy);
  return totals;
}

// Pitches already on the books for one calendar date — every outing that date
// summed. Both halves of a doubleheader land here.
export function pitchesOnDate(
  pitching: PitchingRecord | null | undefined,
  date: string | null | undefined,
  excludeGameId?: string,
): number {
  if (!date) return 0;
  return pitchDayTotals(pitching, excludeGameId).get(date) || 0;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number =>
  Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

export interface PitchBudget {
  // The rule set's daily max for this age group.
  dailyMax: number;
  // Pitches already on the books for the target DATE — game 1 of a
  // doubleheader, whether logged from a box score or folded in from a plan.
  thrownToday: number;
  // What is left of the day's max. Both games of a doubleheader draw from
  // this one bucket.
  remaining: number;
  // The most recent throwing day STRICTLY BEFORE the target date, that day's
  // summed total, and the rest it demands.
  priorDate: string | null;
  priorPitches: number;
  restRequired: number;
  restSatisfied: boolean;
  // Cleared to take the mound on the target date: budget left AND the rest
  // owed to earlier days served.
  eligible: boolean;
}

// The day-budget view of one pitcher on one date — the single place the
// "two games in one day" rule lives.
//
// A calendar day is ONE cumulative bucket: pitches thrown in game 1 count
// against game 2's ceiling, and a kid with budget left may absolutely throw in
// both. Rest is owed only to EARLIER days and is sized by that day's summed
// total (a 30 + 30 doubleheader rests like 60, not like 30), so an outing
// earlier today never by itself blocks the nightcap — only a spent budget or
// an unpaid debt from a previous day does. Pure.
export function pitchBudgetFor(
  pitching: PitchingRecord | null | undefined,
  targetDateStr: string,
  ageGroup: string,
  ruleSet: PitchRuleSet = DEFAULT_PITCH_RULE_SET,
  opts?: { excludeGameId?: string },
): PitchBudget {
  const dailyMax = maxPitchesForAge(ageGroup, ruleSet);
  const totals = pitchDayTotals(pitching, opts?.excludeGameId);
  const thrownToday = (targetDateStr && totals.get(targetDateStr)) || 0;
  const remaining = Math.max(0, dailyMax - thrownToday);

  let priorDate: string | null = null;
  for (const [d, p] of totals) {
    if (p <= 0) continue;
    if (targetDateStr && d >= targetDateStr) continue;
    if (!priorDate || d > priorDate) priorDate = d;
  }
  const priorPitches = priorDate ? totals.get(priorDate) || 0 : 0;
  const restRequired = priorPitches
    ? requiredRestDays(priorPitches, ruleSet)
    : 0;
  // Calendar days between that outing and the target date. Nothing to rest
  // from -> no debt; a missing or unparseable target date can't be measured
  // against, so an existing outing's debt stays unpaid rather than waving a
  // pitcher through (an undated game keeps the conservative answer).
  const gapDays = !priorDate
    ? Number.POSITIVE_INFINITY
    : targetDateStr
      ? dayNumber(targetDateStr) - dayNumber(priorDate)
      : Number.NaN;
  const restSatisfied =
    restRequired === 0 || (Number.isFinite(gapDays) && gapDays > restRequired);

  return {
    dailyMax,
    thrownToday,
    remaining,
    priorDate,
    priorPitches,
    restRequired,
    restSatisfied,
    eligible: remaining > 0 && restSatisfied,
  };
}

// Cleared to take the mound on `targetDateStr`. Thin wrapper over the day
// budget — see pitchBudgetFor for the doubleheader semantics.
export function checkPitchEligibility(
  player: Player,
  targetDateStr: string,
  ageGroup: string,
  ruleSet: PitchRuleSet = DEFAULT_PITCH_RULE_SET,
): boolean {
  return pitchBudgetFor(player?.pitching, targetDateStr, ageGroup, ruleSet)
    .eligible;
}

export interface PitcherAvailability {
  id: string;
  name: string;
  // Mirrors Player.number, which jersey numbers may be stored as either string
  // or number; passed through verbatim from the roster.
  number?: string | number;
  // ready: can pitch on the game date (possibly on a part-spent budget — the
  // second game of a doubleheader). resting: owes rest to an earlier day
  // (eligible again in daysUntilReady). maxed: the game date's pitch budget is
  // gone, so nothing is left for another appearance THAT day.
  status: "ready" | "resting" | "maxed";
  recentPitches: number;
  lastPitchDate: string | null;
  // The rule set's daily max for the age group.
  maxPitches: number;
  // Pitches already on the books for the game DATE — game 1 of a doubleheader,
  // logged or (in the cross-game folds) planned.
  pitchedToday: number;
  // What is left of the daily max for this date: what this arm can actually
  // throw in this game. Equals maxPitches for an arm with nothing yet today.
  remainingToday: number;
  daysUntilReady: number | null;
}

// Pitching plan/availability for a single upcoming game date. Considers players
// cleared to pitch (comfortablePositions includes "P") and classifies each
// against the age rest rules. Ready arms come first (most budget left, then
// freshest) so a coach can line up a rotation; resting arms follow with
// days-until-ready, then arms whose day is spent.
//
// A doubleheader shares one budget: an arm that threw 30 in game 1 comes back
// for game 2 as ready with remainingToday cut by 30, and only drops to "maxed"
// once the day's max is gone. Pure; mirrors checkPitchEligibility's UTC day
// math.
export function buildPitchingPlan(
  players: Player[] | null | undefined,
  gameDateStr: string,
  ageGroup: string,
  ruleSet: PitchRuleSet = DEFAULT_PITCH_RULE_SET,
): PitcherAvailability[] {
  const maxP = maxPitchesForAge(ageGroup, ruleSet);
  const pool = (players || []).filter(
    (p) =>
      Array.isArray(p.comfortablePositions) &&
      p.comfortablePositions.includes("P"),
  );
  const base = new Date(gameDateStr).getTime();
  const out: PitcherAvailability[] = pool.map((p) => {
    const budget = pitchBudgetFor(p.pitching, gameDateStr, ageGroup, ruleSet);
    // Most recent throwing day (doubleheaders summed) — what the roster and
    // arm-care surfaces display as "recent pitches".
    const { pitches: recent, date: last } = mostRecentDayPitches(p.pitching);
    const status: PitcherAvailability["status"] = budget.eligible
      ? "ready"
      : budget.remaining <= 0
        ? "maxed"
        : "resting";
    let daysUntilReady: number | null = null;
    if (status !== "ready") {
      for (let d = 1; d <= 14; d++) {
        const probeStr = new Date(base + d * 86_400_000)
          .toISOString()
          .slice(0, 10);
        if (checkPitchEligibility(p, probeStr, ageGroup, ruleSet)) {
          daysUntilReady = d;
          break;
        }
      }
    }
    return {
      id: p.id,
      name: p.name,
      number: p.number,
      status,
      recentPitches: recent,
      lastPitchDate: last,
      maxPitches: maxP,
      pitchedToday: budget.thrownToday,
      remainingToday: budget.remaining,
      daysUntilReady,
    };
  });
  const rank = { ready: 0, resting: 1, maxed: 2 };
  return out.sort((a, b) => {
    if (rank[a.status] !== rank[b.status])
      return rank[a.status] - rank[b.status];
    if (a.status === "ready") {
      // Fullest budget first, so a doubleheader-spent arm sorts below the
      // untouched ones even though both can pitch.
      if (a.remainingToday !== b.remainingToday)
        return b.remainingToday - a.remainingToday;
      if (a.recentPitches !== b.recentPitches)
        return a.recentPitches - b.recentPitches;
      return (a.lastPitchDate || "").localeCompare(b.lastPitchDate || "");
    }
    if (a.status === "resting")
      return (a.daysUntilReady || 0) - (b.daysUntilReady || 0);
    return 0;
  });
}

// ---------- Arm-care workload analysis ----------

export interface WorkloadAlert {
  kind: "consecutive" | "shortRest";
  message: string;
}
export interface PitchingWorkloadAnalysis {
  totalPitches: number; // season
  outings: number;
  maxDay: number; // heaviest single day
  lastDate: string | null;
  last7: number; // pitches in the 7 days ending asOf
  last7Outings: number;
  consecutiveDays: number; // current run of back-to-back calendar days
  alerts: WorkloadAlert[];
}

// Summarize a pitcher's logged workload and flag overuse, all rule-set aware.
// Doubleheaders are summed per day. Alerts focus on "right now": a 3+ day run,
// and coming back before the rest the most recent outing required. Pure.
export function analyzePitchingWorkload(
  pitching:
    | { log?: Array<{ date?: string; pitches?: number }> }
    | null
    | undefined,
  ruleSet: PitchRuleSet = DEFAULT_PITCH_RULE_SET,
  asOfDate?: string,
): PitchingWorkloadAnalysis {
  const empty: PitchingWorkloadAnalysis = {
    totalPitches: 0,
    outings: 0,
    maxDay: 0,
    lastDate: null,
    last7: 0,
    last7Outings: 0,
    consecutiveDays: 0,
    alerts: [],
  };
  const rawLog = pitching?.log;
  const log = Array.isArray(rawLog) ? rawLog : [];
  const dayMap = new Map<string, number>();
  let outings = 0;
  for (const o of log) {
    if (!o?.date) continue;
    outings++;
    dayMap.set(o.date, (dayMap.get(o.date) || 0) + (Number(o.pitches) || 0));
  }
  if (dayMap.size === 0) return empty;
  const days = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const toDays = (d: string) =>
    Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  const asOfN = toDays(asOfDate || new Date().toISOString().slice(0, 10));

  const totalPitches = days.reduce((s, [, p]) => s + p, 0);
  const maxDay = Math.max(...days.map(([, p]) => p));
  const lastDate = days[days.length - 1][0];
  let last7 = 0;
  for (const [d, p] of days) {
    const diff = asOfN - toDays(d);
    if (diff >= 0 && diff < 7) last7 += p;
  }
  let last7Outings = 0;
  for (const o of log) {
    if (!o?.date) continue;
    const diff = asOfN - toDays(o.date);
    if (diff >= 0 && diff < 7) last7Outings++;
  }
  let consecutiveDays = 1;
  for (let i = days.length - 1; i > 0; i--) {
    if (toDays(days[i][0]) - toDays(days[i - 1][0]) === 1) consecutiveDays++;
    else break;
  }

  const alerts: WorkloadAlert[] = [];
  if (consecutiveDays >= 3)
    alerts.push({
      kind: "consecutive",
      message: `Pitched ${consecutiveDays} days in a row`,
    });
  if (days.length >= 2) {
    const [prevDate, prevP] = days[days.length - 2];
    const gap = toDays(lastDate) - toDays(prevDate);
    const needed = requiredRestDays(prevP, ruleSet);
    if (needed > 0 && gap <= needed)
      alerts.push({
        kind: "shortRest",
        message: `Back on ${gap - 1}d rest after ${prevP} pitches (needs ${needed}d)`,
      });
  }

  return {
    totalPitches,
    outings,
    maxDay,
    lastDate,
    last7,
    last7Outings,
    consecutiveDays,
    alerts,
  };
}
