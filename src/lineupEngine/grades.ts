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
    // Enables age-relative velocity grading for the Arm/Velocity overlays.
    teamAge?: string;
    // Per-game import lines; enables the catcher Blocking overlay (PB/game).
    games?: Array<{ playerStats?: Record<string, any> }>;
  },
): Record<string, GradeMap> {
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
      for (const cat of EVAL_CATEGORIES) astSum[cat.id] = 0;
      let participating = 0;
      for (const ev of assistantEvals) {
        const g = ev.grades?.[p.id];
        if (!g) continue;
        for (const cat of EVAL_CATEGORIES)
          astSum[cat.id] += readCat(g, cat.id) ?? 3;
        participating++;
      }
      if (participating > 0) {
        // 50/50 weighting: head's grade counts equally with the average
        // of every assistant who graded this player. If one side hasn't
        // graded (just head or just assistants), that side is 100%.
        for (const cat of EVAL_CATEGORIES) {
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
      for (const cat of EVAL_CATEGORIES) {
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
//       0 ABs:  weight 0   (entirely past driven)
//       10 ABs: weight 0.5 (half past, half current)
//       30 ABs: weight 1.0 (current only)
//       30+ ABs: weight 1.0 (still current only)
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

  const curAB = Number(cur.ab) || 0;
  // Current weight ramps from 0  1 over the first 30 ABs.
  const wCur = Math.min(1, curAB / 30);
  // Past weights scale down as current ramps up.
  const wP1 = past[0] ? 0.5 * (1 - wCur) : 0;
  const wP2 = past[1] ? 0.25 * (1 - wCur) : 0;
  const totalW = wCur + wP1 + wP2;

  // If we somehow have nothing, return whatever the current stats are (or empty).
  if (totalW === 0) return cur;

  // Blend rate stats (avg, ops, obp, contact, ld, hard, qab, babip).
  const blend = (key: string): number => {
    const c = Number(cur[key]) || 0;
    const p1 = past[0]?.stats ? Number(past[0].stats[key]) || 0 : 0;
    const p2 = past[1]?.stats ? Number(past[1].stats[key]) || 0 : 0;
    return (c * wCur + p1 * wP1 + p2 * wP2) / totalW;
  };

  // Cast through any: PlayerStats has a numeric index signature, so the
  // __blended bookkeeping fields fail strict assignability without this.
  return {
    ...cur, // preserve any non blended fields (counting stats etc.)
    avg: blend("avg"),
    ops: blend("ops"),
    obp: blend("obp"),
    contact: blend("contact"),
    ld: blend("ld"),
    hard: blend("hard"),
    qab: blend("qab"),
    babip: blend("babip"),
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
): number | null {
  if (quality == null || !Number.isFinite(quality)) return null;
  const c = Math.min(1, Math.max(0, confidence));
  if (c <= 0) return null;
  const g = 3 + (quality - 0.5) * 4 * c;
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
  }>,
  ignoreZero = false,
): number | null {
  if (!stats) return null;
  let acc = 0;
  let wSum = 0;
  for (const s of specs) {
    const v = numOrNull(stats[s.key]);
    if (v == null || (ignoreZero && v === 0)) continue;
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

// Contact ← AVG / Contact% / QAB% / LD%, quality-of-contact rates weighted
// heaviest (same philosophy as getOffensiveScore: at this level the advanced
// rates describe the swing far better than the slash line).
export function statContactGrade(
  stats: PlayerStats | null | undefined,
): number | null {
  const q = bandedQuality(
    stats,
    [
      { key: "avg", w: 1.0, worst: 0.15, best: 0.45 },
      { key: "contact", w: 0.75, worst: 0.5, best: 0.9 },
      { key: "qab", w: 1.5, worst: 0.2, best: 0.6 },
      { key: "ld", w: 1.0, worst: 0.08, best: 0.3 },
    ],
    true, // batting rates: 0 = not tracked, never "0% quality"
  );
  return qualityToGrade(q, battingConfidence(stats));
}

// Power ← SLG (derived OPS − OBP), extra-base-hit rate, Hard-hit%.
export function statPowerGrade(
  stats: PlayerStats | null | undefined,
): number | null {
  if (!stats) return null;
  const ops = numOrNull(stats.ops);
  const obp = numOrNull(stats.obp);
  const slg = ops != null && obp != null && ops >= obp ? ops - obp : null;
  const ab = Number(stats.ab) || 0;
  const xbh =
    ab > 0
      ? ((Number(stats.doubles) || 0) +
          (Number(stats.triples) || 0) +
          (Number(stats.hr) || 0)) /
        ab
      : null;
  const enriched: PlayerStats = {
    ...stats,
    __slg: slg ?? undefined,
    __xbh: xbh ?? undefined,
  };
  const q = bandedQuality(
    enriched,
    [
      { key: "__slg", w: 1.0, worst: 0.25, best: 0.7 },
      { key: "__xbh", w: 1.0, worst: 0.0, best: 0.2 },
      { key: "hard", w: 1.25, worst: 0.1, best: 0.4 },
    ],
    true, // batting rates: 0 = not tracked (XBH rate keeps 0 via __xbh below)
  );
  return qualityToGrade(q, battingConfidence(stats));
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
  opts?: { teamAge?: string; gamesCaught?: number },
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
  set(statContactGrade(batting), "contact");
  set(statPowerGrade(batting), "power");
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
