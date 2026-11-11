// lineupEngine/grades.ts
// Eval-round merging into a combined grade map, stat-derived skill grades, and
// the offensive score. Internal helpers (grade readers, getEffectiveStats,
// applyStatGrades, …) are exported for sibling engine modules but are NOT part
// of the public barrel.
import type {
  EvaluationEvent,
  Game,
  GradeMap,
  Player,
  PlayerStats,
} from "../types";
import { canonicalizePositionList, evalRoundRecency } from "../utils/helpers";

// Coach's Card v3 (eval schema v9) coach-graded categories — ONLY the
// intangibles a stat line can't measure. Every tangible skill is graded from
// imported stats by the stat-derived helpers below and overlaid onto the
// merged grade map in getCombinedGrades.
// Category id list that getCombinedGrades carries from each eval round into the
// merged grade map. The `weight` field is informational only (the engine scores
// via the dedicated helpers — defensiveScore/pitcher/catcher/total — not by
// iterating these). The Kid-Pitch add-ons (Composure for pitching, Game
// Calling for catching) MUST be present here or they get dropped on merge,
// leaving calcPitcherScore/calcCatcherScore with no eval input to score.
export const EVAL_CATEGORIES: ReadonlyArray<{ id: string; weight: number }> = [
  { id: "approach", weight: 1.5 },
  { id: "speed", weight: 1.0 },
  { id: "baserunning", weight: 1.5 },
  { id: "baseballIQ", weight: 2.0 },
  { id: "coachability", weight: 1.0 },
  // Universal intangible (was a kid-pitch add-on)
  { id: "composure", weight: 1.0 },
  // Kid-Pitch add-on — catching (coach-graded; Pitch Velocity is carried
  // separately as a measurement, not averaged here).
  { id: "blocking", weight: 1.5 },
  { id: "receiving", weight: 1.0 },
];

export const DEFAULT_GRADES: Readonly<GradeMap> = Object.freeze({
  approach: 3,
  speed: 3,
  baserunning: 3,
  baseballIQ: 3,
  coachability: 3,
});

// Grade keys that are DATA-DRIVEN, never hand-graded (constants/ui.ts marks
// the matching card categories `dataDriven`). Rounds carry them as seeded
// showcase values; getCombinedGrades treats them like pitchVelo (definitive,
// no head/assistant averaging) and applyStatGrades overrides them once real
// GameChanger samples exist.
export const DATA_DRIVEN_GRADE_KEYS = [
  "power",
  "glove",
  "armStrength",
  "armAccuracy",
] as const;

// Backwards-compat aliases — read the v3 field if present, fall back to the
// v1 alias (e.g. `glove` ← `fielding`), defaulting to the mid-grade. Each
// takes a possibly-undefined grade record (legacy callers pass {} or null).
// Each reads the fine-grained v3 field, falling back to the merged v7 field
// (Glove/Range ← Fielding, Arm Strength/Accuracy ← Arm, Plate Discipline ←
// Approach, Baserunning ← Speed & Baserunning) and finally older aliases, so
// the engine's position scoring keeps working off the simplified coach grades.
// Grade readers accept any GradeMap-shaped record (or null/undefined for
// players with no grades yet). GradeMap is string-indexed numbers, so the
// legacy/merged fallback keys (fielding, arm, speedBaserunning, speedAgility)
// read through the same index without needing `any`.
export type GradesInput = GradeMap | null | undefined;
export const gloveOf = (g: GradesInput): number => g?.glove ?? g?.fielding ?? 3;
export const rangeOf = (g: GradesInput): number => g?.range ?? g?.fielding ?? 3;
export const armStrengthOf = (g: GradesInput): number =>
  g?.armStrength ?? g?.arm ?? 3;
export const armAccuracyOf = (g: GradesInput): number =>
  g?.armAccuracy ?? g?.arm ?? 3;
// Speed and Base Running are graded separately (v8); both fall back to the
// legacy merged "Speed & Baserunning" grade so older rounds still read.
export const speedOf = (g: GradesInput): number =>
  g?.speed ?? g?.speedBaserunning ?? g?.speedAgility ?? 3;
export const baserunningOf = (g: GradesInput): number =>
  g?.baserunning ?? g?.speedBaserunning ?? g?.speedAgility ?? 3;
// Combined athleticism input used by the value/defense scorers, so the split
// is score-neutral for legacy data (where speed === baserunning) and blends the
// two once a coach grades them apart.
export const speedBaseOf = (g: GradesInput): number =>
  (speedOf(g) + baserunningOf(g)) / 2;
export const contactOf = (g: GradesInput): number => g?.contact ?? 3;
export const approachOf = (g: GradesInput): number => g?.approach ?? 3;
export const powerOf = (g: GradesInput): number => g?.power ?? 3;
export function getCombinedGrades(
  evaluationEvents: EvaluationEvent[],
  playersList: Player[],
  opts?: {
    // Enables age-relative velocity grading for the Arm/Velocity overlays,
    // and picks the hitting tier (with pitchingFormat) — see hittingTier.
    teamAge?: string;
    pitchingFormat?: string;
    // Per-game import lines; enables the catcher Blocking overlay (PB/game).
    games?: Array<{ playerStats?: Record<string, any> }>;
    // The team's OWN eval categories (src/utils/evalCategories.ts). This list
    // is the only reason a custom category survives the merge: the ids below
    // are a fixed allow-list, so anything absent from it is silently dropped
    // off every grade map. Hidden categories belong here too — hiding is
    // forward-only and their historical values must still merge through.
    // Omitted ⇒ the merge is byte-identical to the pre-config behavior.
    extraCategories?: ReadonlyArray<{ id: string; weight: number }>;
  },
): Record<string, GradeMap> {
  const mergeCategories =
    opts?.extraCategories && opts.extraCategories.length > 0
      ? [...EVAL_CATEGORIES, ...opts.extraCategories]
      : EVAL_CATEGORIES;
  let latestHead = null;
  for (const e of evaluationEvents) {
    if (e.tryoutSignupId || e.tryoutSessionId || e.coachRole !== "Head")
      continue;
    // evalRoundRecency < 0 ⇔ e is strictly newer (createdAt breaks date ties).
    if (!latestHead || evalRoundRecency(e, latestHead) < 0) latestHead = e;
  }

  const latestAssistantByEvaluator = new Map();
  for (const e of evaluationEvents) {
    if (
      e.tryoutSignupId ||
      e.tryoutSessionId ||
      e.coachRole !== "Assistant" ||
      !e.evaluatorId
    )
      continue;
    const cur = latestAssistantByEvaluator.get(e.evaluatorId);
    if (!cur || evalRoundRecency(e, cur) < 0) {
      latestAssistantByEvaluator.set(e.evaluatorId, e);
    }
  }
  const assistantEvals = [...latestAssistantByEvaluator.values()];
  const astCount = assistantEvals.length;

  const out: Record<string, GradeMap> = {};
  for (const p of playersList) {
    const headG = latestHead?.grades?.[p.id];
    const grades: GradeMap = { ...DEFAULT_GRADES };

    // Grade reader with legacy-field fallbacks, so rounds saved before the
    // current schema still feed the kept categories sensibly.
    const readCat = (g: GradesInput, catId: string): number | null => {
      if (!g) return null;
      if (g[catId] != null) return g[catId] ?? null;
      // Speed + Base Running both seed from the legacy merged grade.
      if (catId === "speed" || catId === "baserunning")
        return g.speedBaserunning ?? g.speedAgility ?? null;
      return null;
    };

    let combinedFromAssistants = false;
    if (astCount > 0) {
      const astSum: Record<string, number> = {};
      for (const cat of mergeCategories) astSum[cat.id] = 0;
      let participating = 0;
      for (const ev of assistantEvals) {
        const g = ev.grades?.[p.id];
        if (!g) continue;
        for (const cat of mergeCategories)
          astSum[cat.id] += readCat(g, cat.id) ?? 3;
        participating++;
      }
      if (participating > 0) {
        // 50/50 weighting: head's grade counts equally with the average
        // of every assistant who graded this player. If one side hasn't
        // graded (just head or just assistants), that side is 100%.
        for (const cat of mergeCategories) {
          const astAvg = astSum[cat.id] / participating;
          const headVal = readCat(headG, cat.id);
          if (headVal != null)
            grades[cat.id] = Math.round((headVal + astAvg) / 2);
          else grades[cat.id] = Math.round(astAvg);
        }
        combinedFromAssistants = true;
      }
    }

    if (!combinedFromAssistants && headG) {
      for (const cat of mergeCategories) {
        const v = readCat(headG, cat.id);
        if (v != null) grades[cat.id] = v;
      }
    }
    // Pitch Velocity (mph) is a measurement, not a 1–5 grade — never average it
    // or default a missing reading to a number. Take the head coach's reading
    // when present, else the most recent assistant reading.
    const headVelo = numOrNull(headG?.pitchVelo);
    if (headVelo != null) {
      grades.pitchVelo = headVelo;
    } else {
      for (const ev of assistantEvals) {
        const v = numOrNull(ev.grades?.[p.id]?.pitchVelo);
        if (v != null) {
          grades.pitchVelo = v;
          break;
        }
      }
    }
    // Data-driven tangibles (power / glove / armStrength / armAccuracy) are
    // DEFINITIVE values seeded into rounds from the tryout showcase — no
    // grading UI offers them as hand grades, so they are carried like
    // pitchVelo (head's round first, else the newest assistant round), never
    // averaged against coaches who had no way to grade them. The stat overlay
    // below overrides them the moment real GameChanger samples exist — the
    // bridge precedence is: GameChanger stats > showcase seed > neutral.
    for (const key of DATA_DRIVEN_GRADE_KEYS) {
      const hv = numOrNull(headG?.[key]);
      if (hv != null) {
        grades[key] = hv;
        continue;
      }
      for (const ev of assistantEvals) {
        const v = numOrNull(ev.grades?.[p.id]?.[key]);
        if (v != null) {
          grades[key] = v;
          break;
        }
      }
    }
    // Tangible skills are graded by the imported stats alone (schema v9) —
    // overlay them on top of the coach-graded intangibles.
    out[p.id] = applyStatGrades(grades, p, {
      teamAge: opts?.teamAge,
      pitchingFormat: opts?.pitchingFormat,
      gamesCaught: opts?.games ? countGamesCaught(opts.games, p.id) : undefined,
    });
  }
  return out;
}

// Compute "effective" stats for a player by blending current season stats with
// recent past seasons. This addresses the small sample problem early in a
// season (when current AB counts are tiny) AND the recency problem (where last
// year's stats matter less than this year's).
//
// Weighting strategy:
//   Past season N 1 (most recent past): weight 0.5 baseline
//   Past season N 2: weight 0.25 baseline
//   Past seasons further back: ignored
//   Current season: weight scales with sample size
//       0 PA:   weight 0   (entirely past driven)
//       ~15 PA: weight 0.5 (half past, half current)
//       30 PA:  weight 1.0 (current only)
//       30+ PA: weight 1.0 (still current only)
//   When current weight is high, past weights scale down so totals don't double count.
//
// All stats use AB weighted averaging where appropriate. Counting stats
// (H, HR, RBI, etc.) come straight from current  they don't need blending.
export function getEffectiveStats(player: Player): PlayerStats & {
  __blended?: boolean;
  __blendWeights?: { current: number; past1: number; past2: number };
} {
  const cur: PlayerStats = player?.stats || {};
  const pastAll = Array.isArray(player?.pastSeasons) ? player.pastSeasons : [];
  // Take up to two most recent past seasons. Sort by descending season string.
  const past = [...pastAll]
    .filter((p) => p && p.stats)
    .sort((a, b) => String(b.season).localeCompare(String(a.season)))
    .slice(0, 2);

  // Current weight ramps from 0 → 1 over the first 30 plate appearances
  // (PA, not AB, so a kid who walks a lot isn't treated as a thinner sample).
  const curPA = plateAppearances(cur);
  const wCur = Math.min(1, curPA / 30);
  // Past weights scale down as current ramps up.
  const wP1 = past[0] ? 0.5 * (1 - wCur) : 0;
  const wP2 = past[1] ? 0.25 * (1 - wCur) : 0;
  const totalW = wCur + wP1 + wP2;

  // If we somehow have nothing, return whatever the current stats are (or empty).
  if (totalW === 0) return cur;

  // Blend a rate stat across the seasons that actually HAVE it. A season that
  // never tracked QAB% (or LD%) used to count as 0 here and drag the blend
  // down; now it simply doesn't take part. Undefined when no season has it.
  const blend = (key: string): number | undefined => {
    let acc = 0;
    let w = 0;
    const add = (st: PlayerStats | undefined, wt: number) => {
      const v = numOrNull(st?.[key]);
      if (v == null || wt <= 0) return;
      acc += v * wt;
      w += wt;
    };
    add(cur, wCur);
    add(past[0]?.stats, wP1);
    add(past[1]?.stats, wP2);
    return w > 0 ? acc / w : undefined;
  };
  const rates: Record<string, number> = {};
  for (const key of [
    "avg",
    "ops",
    "obp",
    "slg",
    "contact",
    "ld",
    "hard",
    "qab",
    "babip",
  ]) {
    const v = blend(key);
    if (v !== undefined) rates[key] = v;
  }

  // Cast through any: PlayerStats has a numeric index signature, so the
  // __blended bookkeeping fields fail strict assignability without this.
  return {
    ...cur, // preserve any non blended fields (counting stats etc.)
    ...rates,
    __blended: true,
    __blendWeights: { current: wCur, past1: wP1, past2: wP2 },
  } as any;
}

// ---------- Stat-derived grades for tangible skills ----------
// As of eval schema v9, coaches grade only the intangibles. Every tangible
// skill is graded by the imported stats alone, projected onto the same 1–5
// scale the eval grades use:
//   grade = 3 + (quality − 0.5) × 4 × confidence
// where `quality` normalizes the relevant stat against a youth-level band
// (0..1) and `confidence` ramps with sample size. No data, or no sample, →
// null — and every consumer treats null as the neutral 3, so a kid is never
// penalized for a stat that simply hasn't been imported yet.

export const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function qualityToGrade(
  quality: number | null,
  confidence: number,
  // Where a thin sample sits: the neutral 3 by default, or a prior — e.g. the
  // tryout exit-velo grade for Power — that the stats take over from as the
  // sample grows (center + (fullGrade − center) × confidence).
  center = 3,
): number | null {
  if (quality == null || !Number.isFinite(quality)) return null;
  const c = Math.min(1, Math.max(0, confidence));
  if (c <= 0) return null;
  const full = 3 + (quality - 0.5) * 4;
  const g = center + (full - center) * c;
  // One decimal: smooth enough for ranking, clean enough to display.
  return Math.round(Math.min(5, Math.max(1, g)) * 10) / 10;
}

// Weighted 0..1 quality across whichever banded stats are present. Bands with
// best < worst encode lower-is-better. Missing stats never penalize.
// `ignoreZero` treats a 0 value as missing — getEffectiveStats zero-fills the
// batting rate keys it blends, and a CSV that never tracked QAB%/LD% must not
// read as "0% quality at bats" (same convention as getOffensiveScore).
export function bandedQuality(
  stats: PlayerStats | null | undefined,
  specs: Array<{
    key: keyof PlayerStats;
    w: number;
    worst: number;
    best: number;
    // A real 0 that must count even when `ignoreZero` is on — e.g. a
    // strikeout rate of 0 (no strikeouts) is the BEST value, not "untracked".
    keepZero?: boolean;
  }>,
  ignoreZero = false,
): number | null {
  if (!stats) return null;
  let acc = 0;
  let wSum = 0;
  for (const s of specs) {
    const v = numOrNull(stats[s.key]);
    if (v == null || (ignoreZero && v === 0 && !s.keepZero)) continue;
    const span = s.best - s.worst;
    if (span === 0) continue;
    const norm = Math.min(1, Math.max(0, (v - s.worst) / span));
    acc += norm * s.w;
    wSum += s.w;
  }
  return wSum > 0 ? acc / wSum : null;
}

// Batting sample confidence: ramps over the first 30 AB. When the stats came
// through getEffectiveStats with real past-season influence, the blend itself
// already steadies small samples, so confidence gets a floor of 0.5.
export function battingConfidence(
  stats: PlayerStats | null | undefined,
): number {
  const ab = Number(stats?.ab) || 0;
  const base = Math.min(1, ab / 30);
  const w = (stats as any)?.__blendWeights;
  const pastBlended = w && (Number(w.past1) > 0 || Number(w.past2) > 0);
  return pastBlended ? Math.max(0.5, base) : base;
}

// Pitching sample confidence: full weight at ~30 batters faced (a few
// outings), falling back to innings when BF wasn't imported.
export function pitchingConfidence(
  stats: PlayerStats | null | undefined,
): number {
  const bf = Number(stats?.pBf);
  const ip = Number(stats?.pIp);
  if (Number.isFinite(bf) && bf > 0) return Math.min(1, bf / 30);
  if (Number.isFinite(ip) && ip > 0) return Math.min(1, ip / 8);
  return 0;
}

// ---------- Hitting (recalibrated) ----------
// What wins at the plate in youth baseball, by level:
//   - Getting on base. OBP is the biggest single driver of runs, and at
//     9–12U kid pitch — free steals, passed balls — a walk is worth about a
//     double, so a walk counts as an extra base there too (see the Power
//     grade). At machine / coach pitch there are no walks and nobody really
//     scores errors, so on-base is hits only.
//   - Not striking out: putting the ball in play against defenses that
//     make plays rarely. Strikeout rate is also the earliest stat to become
//     trustworthy.
//   - Power matters more as kids get older.
// Each hitting grade is shrunk toward neutral (or a prior) by sample size —
// confidence = PA / (PA + k) — so a hot first week can't jump a kid to the
// top: stats count about halfway at ~35 plate appearances for on-base.
// Weights per tier live in HITTING_WEIGHTS (totalScore.ts reads them).

export type HittingTier = "machine" | "kidYouth" | "kidTeen";

export interface HittingContext {
  teamAge?: string;
  pitchingFormat?: string;
}

const firstAgeNumber = (teamAge: string | undefined): number | null => {
  const m = String(teamAge || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
};

// machine = machine / coach pitch; kidYouth = kid pitch through 12U (an
// "11U to 12U" team included); kidTeen = kid pitch 13U and up. Without a
// pitching format, 9U and older is kid pitch (as allowedPitchingFormats
// enforces) and younger is machine/coach pitch; with neither, kid pitch.
export function hittingTier(ctx?: HittingContext | null): HittingTier {
  const age = firstAgeNumber(ctx?.teamAge);
  const fmt = String(ctx?.pitchingFormat || "").toLowerCase();
  const kidPitch = fmt ? fmt.includes("kid") : age == null || age >= 9;
  if (!kidPitch) return "machine";
  return age != null && age >= 13 ? "kidTeen" : "kidYouth";
}

// How much each stat-graded hitting part counts, on top of the coach's
// Approach grade (2.5). Each tier sums to 6.5, the same share the old
// offensive score + contact + power slots had, so the 0–100 scale, the
// pitcher/catcher blend and every cut line keep their meaning.
export const HITTING_WEIGHTS: Record<
  HittingTier,
  { onBase: number; contact: number; power: number }
> = {
  machine: { onBase: 2.25, contact: 3.5, power: 0.75 },
  kidYouth: { onBase: 4.0, contact: 1.75, power: 0.75 },
  kidTeen: { onBase: 3.0, contact: 1.5, power: 2.0 },
};

// [worst, best] per tier. Judgment defaults — there are no published youth
// distributions; strikeout bands follow common youth-coaching rules of thumb.
const ON_BASE_BAND: Record<HittingTier, [number, number]> = {
  machine: [0.3, 0.7],
  kidYouth: [0.28, 0.62],
  kidTeen: [0.24, 0.52],
};
const STRIKEOUT_BAND: Record<HittingTier, [number, number]> = {
  machine: [0.3, 0.05],
  kidYouth: [0.32, 0.1],
  kidTeen: [0.28, 0.08],
};
// Extra bases per plate appearance (a double = 1, a triple = 2, a homer = 3,
// and at kidYouth a walk or hit-by-pitch = 1).
const EXTRA_BASE_BAND: Record<HittingTier, [number, number]> = {
  machine: [0, 0.25],
  kidYouth: [0, 0.3],
  kidTeen: [0, 0.3],
};

// Sample sizes (plate appearances) at which each part counts halfway.
export const HITTING_SAMPLE_K = { onBase: 35, contact: 20, power: 60 };

const countOr = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n != null && n >= 0 ? n : null;
};

// Plate appearances, falling back to AB + walks + HBP when PA wasn't imported.
export function plateAppearances(
  stats: PlayerStats | null | undefined,
): number {
  if (!stats) return 0;
  const pa = countOr(stats.pa);
  if (pa != null && pa > 0) return pa;
  return (
    (countOr(stats.ab) ?? 0) +
    (countOr(stats.bb) ?? 0) +
    (countOr(stats.hbp) ?? 0)
  );
}

// confidence = n / (n + k). Stats that came through getEffectiveStats with real
// past-season influence are already steadied by that blend, so they keep a
// floor of 0.5 (same convention as battingConfidence).
function hittingConfidence(
  stats: PlayerStats | null | undefined,
  n: number,
  k: number,
): number {
  const base = n > 0 ? n / (n + k) : 0;
  const w = (stats as any)?.__blendWeights;
  const pastBlended = w && (Number(w.past1) > 0 || Number(w.past2) > 0);
  return pastBlended ? Math.max(0.5, base) : base;
}

// On-base ← OBP (or (H + BB + HBP) / PA from the counts when OBP is missing).
export function statOnBaseGrade(
  stats: PlayerStats | null | undefined,
  ctx?: HittingContext | null,
): number | null {
  if (!stats) return null;
  const tier = hittingTier(ctx);
  const pa = plateAppearances(stats);
  const h = countOr(stats.h);
  let obp = numOrNull(stats.obp);
  // A blended / zero-filled 0 with no counts is "not tracked"; with counts,
  // compute it (a real 0-for-10 stays a real 0).
  if ((obp == null || obp === 0) && h != null && pa > 0) {
    obp = (h + (countOr(stats.bb) ?? 0) + (countOr(stats.hbp) ?? 0)) / pa;
  } else if (obp === 0) {
    obp = null;
  }
  if (obp == null) return null;
  const [worst, best] = ON_BASE_BAND[tier];
  const q = Math.min(1, Math.max(0, (obp - worst) / (best - worst)));
  return qualityToGrade(
    q,
    hittingConfidence(stats, pa, HITTING_SAMPLE_K.onBase),
  );
}

// Contact ← strikeout avoidance (SO / PA), Contact% and QAB%. AVG is left
// out: it's already inside on-base, and at this level it's mostly luck.
export function statContactGrade(
  stats: PlayerStats | null | undefined,
  ctx?: HittingContext | null,
): number | null {
  if (!stats) return null;
  const tier = hittingTier(ctx);
  const pa = plateAppearances(stats);
  const k = countOr(stats.k);
  const kRate = pa > 0 && k != null ? k / pa : null;
  const [kWorst, kBest] = STRIKEOUT_BAND[tier];
  const q = bandedQuality(
    { ...stats, __kRate: kRate ?? undefined },
    [
      { key: "__kRate", w: 2.0, worst: kWorst, best: kBest, keepZero: true },
      { key: "contact", w: 1.0, worst: 0.5, best: 0.9 },
      { key: "qab", w: 0.75, worst: 0.2, best: 0.6 },
    ],
    true, // batting rates: 0 = not tracked, never "0% quality"
  );
  return qualityToGrade(
    q,
    hittingConfidence(stats, pa, HITTING_SAMPLE_K.contact),
  );
}

// Power ← extra bases per plate appearance (at 9–12U kid pitch a walk counts
// as one, like a double), isolated power (SLG − AVG) and Hard-hit%. The
// tryout exit-velo grade, when there is one, is the `prior` the stats take
// over from as at-bats pile up — instead of being replaced after one AB.
export function statPowerGrade(
  stats: PlayerStats | null | undefined,
  ctx?: HittingContext | null,
  opts?: { prior?: number | null },
): number | null {
  if (!stats) return null;
  const tier = hittingTier(ctx);
  const pa = plateAppearances(stats);
  const d = countOr(stats.doubles);
  const t = countOr(stats.triples);
  const hr = countOr(stats.hr);
  const walks = (countOr(stats.bb) ?? 0) + (countOr(stats.hbp) ?? 0);
  const haveCounts = d != null || t != null || hr != null;
  const extraBases =
    (d ?? 0) + 2 * (t ?? 0) + 3 * (hr ?? 0) + (tier === "kidYouth" ? walks : 0);
  const xbRate =
    pa > 0 && (haveCounts || (tier === "kidYouth" && walks > 0))
      ? extraBases / pa
      : null;
  const avg = numOrNull(stats.avg);
  const slg =
    numOrNull(stats.slg) ??
    (() => {
      const ops = numOrNull(stats.ops);
      const obp = numOrNull(stats.obp);
      return ops != null && obp != null && ops >= obp ? ops - obp : null;
    })();
  const iso = slg != null && avg != null && slg >= avg ? slg - avg : null;
  const [xbWorst, xbBest] = EXTRA_BASE_BAND[tier];
  const q = bandedQuality(
    { ...stats, __xbRate: xbRate ?? undefined, __iso: iso ?? undefined },
    [
      { key: "__xbRate", w: 1.5, worst: xbWorst, best: xbBest, keepZero: true },
      // Isolated power leaves walks out, so at kidYouth the walk-as-double
      // rate above carries it alone.
      ...(tier === "kidYouth"
        ? []
        : [{ key: "__iso" as const, w: 1.0, worst: 0, best: 0.3 }]),
      { key: "hard", w: 1.0, worst: 0.1, best: 0.4 },
    ],
    true,
  );
  const prior = numOrNull(opts?.prior);
  return qualityToGrade(
    q,
    hittingConfidence(stats, pa, HITTING_SAMPLE_K.power),
    prior ?? 3,
  );
}

// Fielding (fills both the glove and range slots) ← FPCT, confidence from
// total chances (full at 24 TC; 0.5 when FPCT exists without a TC count).
export function statFieldingGrade(
  stats: PlayerStats | null | undefined,
): number | null {
  if (!stats) return null;
  const fpct = numOrNull(stats.fFpct) ?? numOrNull(stats.fpct);
  if (fpct == null) return null;
  const q = Math.min(1, Math.max(0, (fpct - 0.8) / (0.98 - 0.8)));
  const tc = numOrNull(stats.fTc) ?? numOrNull(stats.tc);
  const confidence = tc != null && tc > 0 ? Math.min(1, tc / 24) : 0.5;
  return qualityToGrade(q, confidence);
}

// Arm — honest limits: youth box scores don't measure an infielder's arm.
// A radar reading (manual or imported) grades it age-relative for anyone who
// has one; a catcher's CS% stands in next; everyone else stays neutral.
export function statArmGrade(
  stats: PlayerStats | null | undefined,
  opts?: { topMph?: number | null; teamAge?: string },
): number | null {
  const velo = calcVelocityQuality(
    opts?.topMph ?? numOrNull(stats?.pTopMph) ?? numOrNull(stats?.pFbMph),
    opts?.teamAge,
  );
  if (velo != null) return qualityToGrade(velo, 1);
  const cs = numOrNull(stats?.fCsPct);
  if (cs != null) {
    const q = Math.min(1, Math.max(0, (cs - 0.15) / (0.55 - 0.15)));
    const att = numOrNull(stats?.fSbAtt);
    const confidence = att != null && att > 0 ? Math.min(1, att / 12) : 0.5;
    return qualityToGrade(q, confidence);
  }
  return null;
}

// Velocity (pitchers) ← top MPH against the age band. A measurement, not a
// sample — applies at full confidence whenever a reading exists.
export function statVelocityGrade(
  stats: PlayerStats | null | undefined,
  opts?: { topMph?: number | null; teamAge?: string },
): number | null {
  const q = calcVelocityQuality(
    opts?.topMph ?? numOrNull(stats?.pTopMph) ?? numOrNull(stats?.pFbMph),
    opts?.teamAge,
  );
  return qualityToGrade(q, 1);
}

// Strikes (pitchers) ← the control & efficiency cluster.
export function statStrikesGrade(
  stats: PlayerStats | null | undefined,
): number | null {
  const q = bandedQuality(stats, [
    { key: "pStrikePct", w: 1.5, worst: 0.45, best: 0.65 },
    { key: "pFps", w: 1.5, worst: 0.45, best: 0.65 },
    { key: "pBbPerInn", w: 1.5, worst: 1.2, best: 0.2 },
    { key: "pKbb", w: 1.5, worst: 0.5, best: 3.0 },
    { key: "pWhip", w: 1.5, worst: 2.2, best: 1.0 },
  ]);
  return qualityToGrade(q, pitchingConfidence(stats));
}

// Off-Speed (pitchers) ← bats missed / weak contact — the measurable
// footprint of having (and landing) a second pitch.
export function statOffSpeedGrade(
  stats: PlayerStats | null | undefined,
): number | null {
  const q = bandedQuality(stats, [
    { key: "pSwingMiss", w: 1.5, worst: 0.05, best: 0.25 },
    { key: "pKbf", w: 1.25, worst: 0.1, best: 0.35 },
    { key: "pWeak", w: 1.5, worst: 0.15, best: 0.45 },
    { key: "pHardPct", w: 1.5, worst: 0.45, best: 0.15 },
    { key: "pGoAo", w: 1.0, worst: 0.7, best: 2.5 },
  ]);
  return qualityToGrade(q, pitchingConfidence(stats));
}

// Throwing (catchers) ← caught-stealing %, confidence from attempts against.
export function statThrowingGrade(
  stats: PlayerStats | null | undefined,
): number | null {
  const cs = numOrNull(stats?.fCsPct);
  if (cs == null) return null;
  const q = Math.min(1, Math.max(0, (cs - 0.15) / (0.55 - 0.15)));
  const att = numOrNull(stats?.fSbAtt);
  const confidence = att != null && att > 0 ? Math.min(1, att / 12) : 0.5;
  return qualityToGrade(q, confidence);
}

// Blocking (catchers) ← passed balls per game caught. Needs a games-caught
// count (derived from per-game imports); without one there's no fair
// denominator, so it stays neutral.
export function statBlockingGrade(
  stats: PlayerStats | null | undefined,
  gamesCaught?: number | null,
): number | null {
  const pb = numOrNull(stats?.fPb);
  const games = Number(gamesCaught) || 0;
  if (pb == null || games <= 0) return null;
  const perGame = pb / games;
  // Lower is better: 2.0 PB/game is rough, 0.2 is excellent.
  const q = Math.min(1, Math.max(0, (perGame - 2.0) / (0.2 - 2.0)));
  return qualityToGrade(q, Math.min(1, games / 6));
}

// How many games a player has catcher-specific data for, from the per-game
// import lines. The blocking grade's denominator.
export function countGamesCaught(
  games:
    | Array<{
        playerStats?: Record<string, Record<string, number> | undefined>;
      }>
    | null
    | undefined,
  playerId: string,
): number {
  let n = 0;
  for (const g of games || []) {
    const line = g?.playerStats?.[playerId];
    if (!line || typeof line !== "object") continue;
    if (
      line.fPb != null ||
      line.fSbAtt != null ||
      line.fSbAllowed != null ||
      line.fCsPct != null
    )
      n++;
  }
  return n;
}

// Overlay the stat-derived tangible grades onto a player's (eval-sourced)
// grade map. Writes BOTH the merged ids the UI shows (fielding, arm) and the
// fine-grained ids the engine's readers consult (glove/range, armStrength/
// armAccuracy), so every consumer — total score, position fit, depth charts,
// pitcher/catcher rankings — sees stats-graded tangibles with zero special
// cases. Null stat-grades set nothing; the readers' neutral-3 default holds.
export function applyStatGrades(
  grades: GradeMap | null | undefined,
  player: Player | null | undefined,
  opts?: { teamAge?: string; pitchingFormat?: string; gamesCaught?: number },
): GradeMap {
  const out: GradeMap = { ...(grades || {}) };
  if (!player) return out;
  const batting = getEffectiveStats(player);
  const raw: PlayerStats = player.stats || {};
  const topMph =
    numOrNull(raw.pTopMph) ??
    numOrNull(raw.pFbMph) ??
    numOrNull(player?.pitching?.topMph) ??
    // Coach-entered Pitch Velocity from the eval form, when no imported radar
    // reading exists — feeds the same age-relative velocity grading.
    numOrNull(grades?.pitchVelo);

  const set = (v: number | null, ...keys: string[]) => {
    if (v == null) return;
    for (const k of keys) out[k] = v;
  };
  const hitCtx = {
    teamAge: opts?.teamAge,
    pitchingFormat: opts?.pitchingFormat,
  };
  set(statOnBaseGrade(batting, hitCtx), "onBase");
  set(statContactGrade(batting, hitCtx), "contact");
  // The carried Power value (a tryout exit-velo seed) is the prior.
  set(
    statPowerGrade(batting, hitCtx, { prior: numOrNull(grades?.power) }),
    "power",
  );
  set(statFieldingGrade(raw), "fielding", "glove", "range");
  set(
    statArmGrade(raw, { topMph, teamAge: opts?.teamAge }),
    "arm",
    "armStrength",
    "armAccuracy",
  );
  set(statVelocityGrade(raw, { topMph, teamAge: opts?.teamAge }), "velocity");
  set(statStrikesGrade(raw), "strikes");
  set(statOffSpeedGrade(raw), "offSpeed");
  set(statThrowingGrade(raw), "throwing");
  set(statBlockingGrade(raw, opts?.gamesCaught), "blocking");
  return out;
}

export function getOffensiveScore(stats?: PlayerStats | null): number {
  if (!stats) return 5;
  const num = (v: number | undefined) => Number(v) || 0;
  const ops = num(stats.ops);
  const avg = num(stats.avg);
  const obp = num(stats.obp);
  const contact = num(stats.contact);
  const ld = num(stats.ld);
  const hard = num(stats.hard);
  const qab = num(stats.qab);
  const babip = num(stats.babip);

  if (ops === 0 && avg === 0 && qab === 0) return 5;

  const opsScore = Math.min(10, ops * 5);
  const avgScore = Math.min(10, avg * 10);
  const obpScore = Math.min(10, obp * 10);
  const conScore = Math.min(10, contact * 10);
  const advanced = Math.max(ld * 25, hard * 20, qab * 15);
  const hasAdv = ld > 0 || hard > 0 || qab > 0;

  // When advanced quality-of-contact data exists (LD% / Hard% / QAB%), it
  // carries the LARGEST share — those rates describe how a kid is actually
  // swinging far better than the old-school slash line, which luck and tiny
  // samples whip around at this level. Without them, the slash line is all
  // we have.
  const weighted = hasAdv
    ? opsScore * 0.3 +
      avgScore * 0.1 +
      obpScore * 0.2 +
      Math.min(10, advanced) * 0.4
    : opsScore * 0.4 + avgScore * 0.25 + obpScore * 0.2 + conScore * 0.15;

  const hr = num(stats.hr);
  const doubles = num(stats.doubles);
  const triples = num(stats.triples);
  const xbBonus = Math.min(1.5, hr * 0.5 + triples * 0.3 + doubles * 0.1);
  const unlucky =
    (ld > 0.15 || hard > 0.15) && babip < 0.3
      ? Math.min(2, (0.3 - babip) * 5)
      : 0;

  return Math.min(10, Math.max(1, Math.round(weighted + xbBonus + unlucky)));
}

// Age-relative velocity quality — shared by stat grades and pitcher scoring.
export function veloBandForAge(teamAge: string | undefined): [number, number] {
  const n = (() => {
    const m = String(teamAge || "").match(/(\d+)/g);
    return Math.min(15, Math.max(7, m ? parseInt(m[m.length - 1], 10) : 10));
  })();
  const BANDS: Record<number, [number, number]> = {
    7: [30, 50],
    8: [30, 50],
    9: [35, 55],
    10: [40, 58],
    11: [43, 60],
    12: [45, 65],
    13: [50, 70],
    14: [55, 75],
    15: [55, 75],
  };
  return BANDS[n];
}
export function calcVelocityQuality(
  topMph: number | null | undefined,
  teamAge: string | undefined,
): number | null {
  if (typeof topMph !== "number" || !Number.isFinite(topMph) || topMph <= 0)
    return null;
  const [lo, hi] = veloBandForAge(teamAge);
  return Math.min(1, Math.max(0, (topMph - lo) / (hi - lo)));
}
