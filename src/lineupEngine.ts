// The public-surface function signatures are fully typed against src/types.ts,
// so consumers (App.tsx, ScheduleTab, EvaluationTab, lineupEngine.test.js) see
// strict input/output contracts. As of the engine-types PR this file is fully
// type-checked (the `@ts-nocheck` directive is gone): the internal logic uses
// pragmatic `any` at the genuinely heterogeneous boundaries (lineup/state
// maps, profile bags) but is otherwise type-safe, backed by the 320-test
// suite + fuzz invariants. Tightening those remaining `any`s is optional
// follow-up.
//
// lineupEngine.ts
// =============================================================================
// Pure function lineup generation engine.
// No React, no Firebase, no DOM — fully testable in isolation and trivially
// movable to a Web Worker if the UI thread ever needs to be freed up.
//
// Public API
// ----------
//   generateLineup(input)  -> EngineResult
//   generateBattingOrder(profiledPlayers, battingSize, opts) -> { order, reasons }
//
// Plus exported helpers (`getPositionsForInning`, `getCombinedGrades`,
// `getOffensiveScore`, `calculateTotalScore`, etc.) used by the UI.
//
// TypeScript conversion notes (Phase 8 first-pass):
//   - Public-surface signatures are fully typed against shared types in
//     src/types.ts.
//   - Internal helpers stay loosely typed (`any` / inferred) where strict
//     annotations would require a 50-line refactor. Tightening internals is
//     iterative follow-up work.
//   - Backwards-compat readers (gloveOf etc.) accept any shape, since they
//     fall back to v1 field names.
// =============================================================================

import type {
  EngineInput,
  EngineResult,
  EvaluationEvent,
  GradeMap,
  Game,
  Inning,
  Player,
  PlayerProfile,
  PlayerStats,
  Position,
  SlimPlayer,
  TournamentPlan,
  TournamentSubstitution,
} from "./types";
import {
  canonicalizeOutfield,
  canonicalizePositionList,
  evalRoundRecency,
} from "./utils/helpers";

// Shape of the per-player batting order annotation the engine attaches.
type BattingReason = {
  role: string;
  note: string;
  effective?: Record<string, number>;
  blendNote?: string;
};

// Local alias: a Player with a pre-computed profile bag attached by the engine.
type ProfiledPlayer = Player & {
  profile: PlayerProfile;
  battingReason?: BattingReason;
};

// Per-player seasonal bench/defense accumulator built by buildExtraSitHistory.
type ExtraSitEntry = {
  extraSits: number;
  benchInn: number;
  defInn: number;
  expectedDef: number;
};

// Per-player state tracked across innings inside tryBuildLineup.
type PlayerState = {
  bench: number;
  positions: Record<string, number>;
  history: string[];
};

// Failure record emitted per attempt by tryBuildLineup.
type BenchFailure = {
  type: string;
  position?: string;
  inning?: number;
  playerName?: string;
};

// Inning-block representation for catcher rotation (back-to-back stints).
type CatcherBlock = number[];

// Options for the internal bench-schedule pre-computation pass.
type BenchScheduleOpts = {
  profiled: ProfiledPlayer[];
  totalInnings: number;
  numToBench: number;
  competitive?: boolean;
  priorExtraSits: Map<string, ExtraSitEntry>;
  firstInningBenchHx: Map<string, number>;
  topHalfIds: Set<string>;
  catcherInningBlocks: CatcherBlock[] | null;
  catcherCap: number;
  enforceCatcherCap: boolean;
  positionsToFill: string[];
  rand: () => number;
  forcedBenchInning0: Set<string> | null;
  firstInningOverridesById: Record<string, string>;
};

// Context passed to each tryBuildLineup attempt.
type TryBuildCtx = {
  profiled: ProfiledPlayer[];
  positionsToFill: string[];
  numToBench: number;
  totalInnings: number;
  isStarter: Set<string>;
  firstInningOverridesById: Record<string, string>;
  positionHistory: Map<string, Map<string, { total: number; bigGame: number }>>;
  firstInningBenchHx: Map<string, number>;
  benchHistory: Map<string, ExtraSitEntry>;
  headGrades: Record<string, GradeMap>;
  defenseSize: string;
  positionLock?: string;
  leagueRuleSet?: string;
  teamAge?: string;
  targetDateStr: string;
  leftyPenalty?: number;
  isBigGame?: boolean;
  competitive?: boolean;
  pitcherPoolIds?: Set<string> | null;
  depthChartRank?: Map<string, Map<string, number>>;
  chartedPlayerIds?: Set<string>;
  isKidPitch?: boolean;
  pitchRules?: PitchRuleSet;
  sameDayRoles?: { pitched?: Set<string>; caught?: Set<string> };
  catcherPolicy?: CatcherPolicy;
  rand: () => number;
  fromInning?: number;
  currentLineup?: Inning[] | null;
};

// ---------- Constants ----------
const POS_10: Position[] = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "LCF",
  "RCF",
  "RF",
];
const POS_9: Position[] = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const OF_POSITIONS = new Set<string>(["LF", "LCF", "RCF", "RF", "CF"]);
const INFIELD_NON_1B = new Set<string>(["C", "2B", "SS", "3B"]);

const POS_DIFFICULTY: Record<string, number> = {
  P: 5,
  "1B": 5,
  SS: 5,
  C: 4,
  "2B": 4,
  "3B": 4,
  LCF: 2,
  RCF: 2,
  CF: 2,
  LF: 1,
  RF: 1,
};

// Resolve whether a player is blocked from a position. v4 teams store
// the positive list (comfortablePositions); legacy teams store the
// negative list (restrictions). Empty/missing comfortablePositions =
// "no preference, consider anywhere", matching the UI's "leave empty"
// helper text.
export function isPositionBlocked(
  p: { comfortablePositions?: string[]; restrictions?: string[] },
  pos: string,
): boolean {
  const comfort = Array.isArray(p.comfortablePositions)
    ? p.comfortablePositions
    : null;
  // Canonicalize outfield so a player who accepts CF is eligible for the LCF/RCF
  // field slots in a 10-fielder game, and a player who accepts LCF/RCF (legacy
  // data) is eligible for CF in a 9-fielder game. Corners (LF/RF) stay distinct.
  if (comfort && comfort.length > 0) {
    const target = canonicalizeOutfield(pos);
    return !comfort.some((c) => canonicalizeOutfield(c) === target);
  }
  const restr = Array.isArray(p.restrictions) ? p.restrictions : null;
  if (restr && restr.length > 0) {
    const target = canonicalizeOutfield(pos);
    return restr.some((c) => canonicalizeOutfield(c) === target);
  }
  return false;
}

// Catcher eligibility. Catcher is just another entry in a player's
// comfortable-positions list — there is no separate flag. A kid may be
// seated at C ONLY when "C" is explicitly present in comfortablePositions.
// Unlike every other position, an EMPTY comfortable list does NOT make a
// player catcher-eligible: catching is strictly opt-in, so a kid the coach
// never cleared for C can never end up behind the plate. A legacy negative
// "C" restriction still wins as a hard block.
export function isCatcherEligible(p: {
  comfortablePositions?: string[];
  restrictions?: string[];
}): boolean {
  if (Array.isArray(p?.restrictions) && p.restrictions.includes("C")) {
    return false;
  }
  return (
    Array.isArray(p?.comfortablePositions) &&
    p.comfortablePositions.includes("C")
  );
}

// Resolved catcher playing-time policy.
//   cap          max innings any one kid catches (Infinity = no limit)
//   consecutive  a catcher's innings must form contiguous block(s) — the
//                engine tiles the game into blocks of `cap` innings and gives
//                each block a single catcher (back-to-back)
//   enforceCap   hard-cap a single kid's catching innings during the
//                pre-pick. Only the explicit settings enforce it; "auto"
//                keeps the legacy lenient reuse so existing teams see ZERO
//                behavior change.
export interface CatcherPolicy {
  cap: number;
  consecutive: boolean;
  enforceCap: boolean;
}

// Resolve the catcher policy from the two team/game settings.
//   catcherMaxInnings: "auto" (default) | "1".."6" | "none"
//   catcherConsecutive: boolean toggle — only consulted for an explicit cap.
// "auto" reproduces the historical behavior exactly: 10-fielder uses
// back-to-back catcher pairs (cap 2, lenient reuse when catchers are scarce),
// every other alignment caps at 3 with a free-rotating catcher.
export function resolveCatcherPolicy(
  catcherMaxInnings: string | number | undefined | null,
  catcherConsecutive: boolean | undefined,
  defenseSize: string | undefined,
  profiledLength: number,
): CatcherPolicy {
  const setting =
    catcherMaxInnings === undefined ||
    catcherMaxInnings === null ||
    catcherMaxInnings === ""
      ? "auto"
      : String(catcherMaxInnings);

  if (setting === "auto") {
    return {
      cap: defenseSize === "10" ? 2 : 3,
      consecutive: defenseSize === "10" && profiledLength >= 10,
      enforceCap: false,
    };
  }
  if (setting === "none") {
    return { cap: Infinity, consecutive: false, enforceCap: false };
  }
  const n = parseInt(setting, 10);
  const cap = Number.isFinite(n) && n > 0 ? n : 3;
  return { cap, consecutive: catcherConsecutive !== false, enforceCap: true };
}

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
const EVAL_CATEGORIES: ReadonlyArray<{ id: string; weight: number }> = [
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

const DEFAULT_GRADES: Readonly<GradeMap> = Object.freeze({
  approach: 3,
  speed: 3,
  baserunning: 3,
  baseballIQ: 3,
  coachability: 3,
});

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
type GradesInput = GradeMap | null | undefined;
const gloveOf = (g: GradesInput): number => g?.glove ?? g?.fielding ?? 3;
const rangeOf = (g: GradesInput): number => g?.range ?? g?.fielding ?? 3;
const armStrengthOf = (g: GradesInput): number => g?.armStrength ?? g?.arm ?? 3;
const armAccuracyOf = (g: GradesInput): number => g?.armAccuracy ?? g?.arm ?? 3;
// Speed and Base Running are graded separately (v8); both fall back to the
// legacy merged "Speed & Baserunning" grade so older rounds still read.
const speedOf = (g: GradesInput): number =>
  g?.speed ?? g?.speedBaserunning ?? g?.speedAgility ?? 3;
const baserunningOf = (g: GradesInput): number =>
  g?.baserunning ?? g?.speedBaserunning ?? g?.speedAgility ?? 3;
// Combined athleticism input used by the value/defense scorers, so the split
// is score-neutral for legacy data (where speed === baserunning) and blends the
// two once a coach grades them apart.
const speedBaseOf = (g: GradesInput): number =>
  (speedOf(g) + baserunningOf(g)) / 2;
const contactOf = (g: GradesInput): number => g?.contact ?? 3;
const approachOf = (g: GradesInput): number => g?.approach ?? 3;
const powerOf = (g: GradesInput): number => g?.power ?? 3;

// ---------- Public helpers (re exported for the UI) ----------

export function getPositionsForInning(
  playerCount: number,
  defSize: string,
): Position[] {
  const base = defSize === "10" ? POS_10 : POS_9;
  if (defSize === "10") {
    if (playerCount >= 10) return [...base];
    if (playerCount === 9) return base.filter((p) => p !== "RF");
    if (playerCount === 8) return base.filter((p) => p !== "RF" && p !== "LF");
    return base.filter((p) => p !== "RF" && p !== "LF" && p !== "RCF");
  }
  if (playerCount >= 9) return [...base];
  if (playerCount === 8) return base.filter((p) => p !== "RF");
  return base.filter((p) => p !== "RF" && p !== "LF");
}

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
    const headVelo = numOrNull((headG as any)?.pitchVelo);
    if (headVelo != null) {
      (grades as any).pitchVelo = headVelo;
    } else {
      for (const ev of assistantEvals) {
        const v = numOrNull((ev.grades?.[p.id] as any)?.pitchVelo);
        if (v != null) {
          (grades as any).pitchVelo = v;
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
function getEffectiveStats(player: Player): PlayerStats & {
  __blended?: boolean;
  __blendWeights?: { current: number; past1: number; past2: number };
} {
  const cur: PlayerStats = player?.stats || {};
  const pastAll: any[] = Array.isArray((player as any)?.pastSeasons)
    ? (player as any).pastSeasons
    : [];
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
    const c = +(cur as any)[key] || 0;
    const p1 = past[0]?.stats ? +past[0].stats[key] || 0 : 0;
    const p2 = past[1]?.stats ? +past[1].stats[key] || 0 : 0;
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

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function qualityToGrade(
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
function bandedQuality(
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
function battingConfidence(stats: PlayerStats | null | undefined): number {
  const ab = Number(stats?.ab) || 0;
  const base = Math.min(1, ab / 30);
  const w = (stats as any)?.__blendWeights;
  const pastBlended = w && (Number(w.past1) > 0 || Number(w.past2) > 0);
  return pastBlended ? Math.max(0.5, base) : base;
}

// Pitching sample confidence: full weight at ~30 batters faced (a few
// outings), falling back to innings when BF wasn't imported.
function pitchingConfidence(stats: PlayerStats | null | undefined): number {
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
  } as any;
  const q = bandedQuality(
    enriched,
    [
      { key: "__slg" as any, w: 1.0, worst: 0.25, best: 0.7 },
      { key: "__xbh" as any, w: 1.0, worst: 0.0, best: 0.2 },
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
function statVelocityGrade(
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
function statStrikesGrade(
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
function statOffSpeedGrade(
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
function statThrowingGrade(
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
function applyStatGrades(
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
    numOrNull((player as any)?.pitching?.topMph) ??
    // Coach-entered Pitch Velocity from the eval form, when no imported radar
    // reading exists — feeds the same age-relative velocity grading.
    numOrNull((grades as any)?.pitchVelo);

  const set = (v: number | null, ...keys: string[]) => {
    if (v == null) return;
    for (const k of keys) (out as any)[k] = v;
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

// Sum of universal-category weights, used to derive the normalized 0–100
// total. Lives next to calculateTotalScore so a weight change here picks up
// the matching divisor automatically.
const TOTAL_SCORE_CATEGORY_WEIGHTS =
  // glove + range + armStr + armAcc + baserunning + baseballIQ +
  // coachability(3.0) + contact + power + plateDiscipline + approach
  2.5 + 2.0 + 1.5 + 1.5 + 1.5 + 2.0 + 3.0 + 1.5 + 1.0 + 1.0 + 1.5;
// Max possible raw total = 5 × sum(category weights) + 10 (max offensive) × 2.
export const TOTAL_SCORE_MAX = 5 * TOTAL_SCORE_CATEGORY_WEIGHTS + 10 * 2.0; // = 105

export function calculateTotalScore(
  grades: GradeMap | null | undefined,
  stats?: PlayerStats | null,
): number {
  if (!grades) return 0;
  const off = getOffensiveScore(stats);
  // Tangible slots (fielding/arm/contact/power) are stats-graded as of schema
  // v9. The grade map carries them when it came through getCombinedGrades'
  // overlay; otherwise (e.g. the live eval form's in-progress grades) they
  // derive directly from `stats` here. Either way the weights — and therefore
  // the 0–100 normalization — are unchanged, and a kid with no stats sits at
  // the neutral 3 exactly like an ungraded eval used to.
  const g: GradeMap = grades ?? {};
  const fielding =
    numOrNull(g.glove) ??
    numOrNull(g.fielding) ??
    statFieldingGrade(stats) ??
    3;
  const arm =
    numOrNull(g.armStrength) ?? numOrNull(g.arm) ?? statArmGrade(stats) ?? 3;
  const contact = numOrNull(g.contact) ?? statContactGrade(stats) ?? 3;
  const power = numOrNull(g.power) ?? statPowerGrade(stats) ?? 3;
  const raw =
    fielding * 2.5 +
    fielding * 2.0 +
    arm * 1.5 +
    arm * 1.5 +
    speedBaseOf(grades) * 1.5 +
    (grades.baseballIQ || 3) * 2.0 +
    (grades.coachability || 3) * 3.0 +
    contact * 1.5 +
    power * 1.0 +
    // The old plateDiscipline slot folded into Approach (v7); Approach keeps
    // the combined weight so the divisor stays stable.
    approachOf(grades) * 1.0 +
    approachOf(grades) * 1.5 +
    off * 2.0;
  // Normalize to 0–100 so the surfaced Total Score is intuitive.
  return Math.min(100, Math.max(0, Math.round((raw / TOTAL_SCORE_MAX) * 100)));
}

// ---------- Pitch count eligibility ----------

// Little League / Pitch Smart daily max by age — the default rule set. Also the
// `limits` of the littleLeague preset below.
const PITCH_LIMITS: Record<string, number> = {
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

const LITTLE_LEAGUE_REST: Array<{ min: number; days: number }> = [
  { min: 66, days: 4 },
  { min: 51, days: 3 },
  { min: 36, days: 2 },
  { min: 21, days: 1 },
];

const PITCH_RULE_SETS: Record<string, PitchRuleSet> = {
  littleLeague: {
    id: "littleLeague",
    label: "Little League / Pitch Smart",
    limits: PITCH_LIMITS,
    fallbackLimit: 105,
    restTiers: LITTLE_LEAGUE_REST,
  },
};

const DEFAULT_PITCH_RULE_SET = PITCH_RULE_SETS.littleLeague;

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
function requiredRestDays(
  p: number,
  ruleSet: PitchRuleSet = DEFAULT_PITCH_RULE_SET,
): number {
  for (const t of ruleSet.restTiers) if (p >= t.min) return t.days;
  return 0;
}

// Pitches on a pitcher's most-recent throwing DAY, summed across outings so a
// doubleheader (two games same date) counts as one day's workload for rest —
// not just the last outing. Prefers the rolling log; falls back to the single
// recentPitches/lastPitchDate fields for data saved before the log existed.
export function mostRecentDayPitches(
  pitching:
    | {
        log?: Array<{ date?: string; pitches?: number }>;
        recentPitches?: number;
        lastPitchDate?: string;
      }
    | null
    | undefined,
): { pitches: number; date: string | null } {
  const log = Array.isArray(pitching?.log) ? pitching!.log! : null;
  if (log && log.length) {
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

export function checkPitchEligibility(
  player: Player,
  targetDateStr: string,
  ageGroup: string,
  ruleSet: PitchRuleSet = DEFAULT_PITCH_RULE_SET,
): boolean {
  const pitching = (player as any).pitching;
  // Same-day total (doubleheaders sum together), not just the last outing.
  const { pitches: recent, date: lastDate } = mostRecentDayPitches(pitching);
  if (!lastDate || !recent) return true;
  if (recent >= maxPitchesForAge(ageGroup, ruleSet)) return false;
  const diffDays = Math.floor(
    (new Date(targetDateStr).getTime() - new Date(lastDate).getTime()) /
      86_400_000,
  );
  return diffDays > requiredRestDays(recent, ruleSet);
}

export interface PitcherAvailability {
  id: string;
  name: string;
  // Mirrors Player.number, which jersey numbers may be stored as either string
  // or number; passed through verbatim from the roster.
  number?: string | number;
  // ready: can pitch on the game date. resting: eligible later (daysUntilReady).
  // maxed: at the per-outing pitch ceiling until their next recorded outing.
  status: "ready" | "resting" | "maxed";
  recentPitches: number;
  lastPitchDate: string | null;
  maxPitches: number;
  daysUntilReady: number | null;
}

// Pitching plan/availability for a single upcoming game date. Considers players
// cleared to pitch (comfortablePositions includes "P") and classifies each
// against the age rest rules. Ready arms come first (freshest first) so a coach
// can line up a rotation; resting arms follow with days-until-ready, then maxed.
// Pure; mirrors checkPitchEligibility's UTC day math.
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
    const pitching = p.pitching || {};
    // Same-day total (doubleheaders summed), so "maxed" and the displayed count
    // reflect the day's real workload, matching checkPitchEligibility.
    const { pitches: recent, date: last } = mostRecentDayPitches(pitching);
    let status: PitcherAvailability["status"];
    let daysUntilReady: number | null = null;
    if (checkPitchEligibility(p, gameDateStr, ageGroup, ruleSet)) {
      status = "ready";
    } else if (recent >= maxP) {
      status = "maxed";
    } else {
      status = "resting";
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
      daysUntilReady,
    };
  });
  const rank = { ready: 0, resting: 1, maxed: 2 };
  return out.sort((a, b) => {
    if (rank[a.status] !== rank[b.status])
      return rank[a.status] - rank[b.status];
    if (a.status === "ready") {
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

interface WorkloadAlert {
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
  const log = Array.isArray(pitching?.log) ? pitching!.log! : [];
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
        message: `Back on ${gap}d rest after ${prevP} pitches (needs ${needed + 1}d)`,
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

// ---------- Pitcher scoring (Round 2 spec) ----------
// Eval-driven, with strikes weighted highest because dropped-3rd-strike and
// walk damage are the usual differentiators at 9U+ Kid Pitch. `strikes` is the
// merged control/command category from the current eval taxonomy (the v7
// migration folds the old `control`+`command` grades into it), so we weight
// `strikes` here — the previous control/command keys no longer exist on graded
// players and were silently scored as zero.
// Single source of truth — consumed by both the engine's P-slot picker
// (D4) and the Roster-tab `PitcherRankingPanel` so the UI rank and the
// engine pick never drift.
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
const PITCHER_STAT_SPECS: Array<{
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
function veloBandForAge(teamAge: string | undefined): [number, number] {
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
const CATCHER_SCORE_WEIGHTS: Record<string, number> = {
  blocking: 1.5,
  throwing: 1.5,
  receiving: 1.0,
};

export const CATCHER_EVAL_MAX =
  5 * Object.values(CATCHER_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

// 0..1 normalizer shared by the stat-quality helpers.
function normUp(v: number, lo: number, hi: number): number {
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

// Same-day dual-role rule: a player never pitches AND catches in the same day.
// Within the game, `st.positions` reflects prior committed innings (and the
// per-inning `used` set blocks same-inning doubles). Across games on the same
// date (doubleheaders), `sameDay` carries who already pitched/caught earlier
// today in OTHER games, with `id` the player being placed.
function dualRoleBlocked(
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
const POSITION_FIT_WEIGHTS: Record<string, Record<string, number>> = {
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

const POSITION_DEMAND_BONUS: Record<string, number> = {
  SS: 0.05,
  CF: 0.035,
  "2B": 0.015,
  "3B": 0.015,
  RF: 0.015,
};

const FIT_READERS: Record<string, (g: GradesInput) => number> = {
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

function positionFitSignal(
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
      (sum, key) => sum + Math.abs(((g as any)[key] ?? 3) - 3),
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

// ---------- Lefty infield penalty (precomputed table) ----------

const LEFTY_PENALTY: Record<string, number> = {
  "NKB|6U": 5,
  "NKB|7U": 5,
  "NKB|8U": 10,
  "NKB|9U": 25,
  "USSSA|6U": 20,
  "USSSA|7U": 20,
  "USSSA|8U": 35,
};
function leftyInfieldPenalty(rules: string, age: string): number {
  return LEFTY_PENALTY[`${rules}|${age}`] ?? 50;
}

// ---------- Positional-scarcity reservation ----------
// Two kinds of scarcity drive a good defensive rotation:
//   1. Position-side ("holes"): a slot only a few present kids are cleared
//      for. Handled by the posScarcity ordering in tryBuildLineup — the
//      hardest-to-fill positions are assigned first so they never get
//      stranded.
//   2. Player-side ("kids with few positions"): a glove-limited kid cleared
//      for, say, only 1B/RF. When such a kid AND a play-anywhere kid are both
//      eligible for the slot being filled, we want to seat the less-flexible
//      kid here and reserve the do-anything kid to plug the remaining holes.
// SCARCITY_RESERVE_WEIGHT scores that second dimension: each extra position a
// candidate is eligible for adds a small "save them for elsewhere" penalty, so
// the least-flexible eligible kid wins the slot. Fair mode only — Big Game
// pins strong kids to premium spots by skill, and the 200-attempt retry loop
// already guards feasibility there.
const SCARCITY_RESERVE_WEIGHT = 2;

// Competitive depth-chart bonus (see pickBestForPosition). BASE is an order of
// magnitude larger than every other in-loop term (rotation, comfort, premium
// pull, jitter ≈ tens–hundreds) so a charted player reliably wins their slot;
// STEP keeps the coach's order strict (rank 0 beats rank 1 beats …). The bonus
// is only applied to candidates that already passed every hard eligibility gate,
// so it reorders — never expands — the legal candidate set. (It does not exceed
// the legacy primaryPosition pre-pin, which claims slots earlier; modern teams
// use comfortablePositions and never trigger that pre-pin.)
const DEPTH_CHART_BASE_BONUS = 9000;
const DEPTH_CHART_RANK_STEP = 100;
// Repulsion applied to a charted player at a position they're NOT charted at,
// so they stay available for their charted slot. Smaller than the base bonus so
// it never blocks a slot (a charted-elsewhere player is a valid last resort).
const DEPTH_CHART_AVOID_PENALTY = 6000;
// Position-importance extra pull (Big Game / competitive), on top of the base
// premium pull: the spine is Pitcher > Catcher > 1B, so the strongest players
// fill those before SS/3B. Skill-scaled at the call site.
const PREMIUM_IMPORTANCE_EXTRA: Record<string, number> = {
  P: 10,
  C: 7,
  "1B": 4,
};

// ---------- Seeded PRNG ----------
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Player profile cache ----------

function buildPlayerProfile(
  p: Player,
  grades: GradeMap | null | undefined,
): PlayerProfile {
  // Cast: GradeMap has every value as number|undefined, but the engine always
  // operates on the DEFAULT_GRADES-filled shape internally. Casting to a
  // strict Record<string, number> avoids null-coalescing every access.
  const g = { ...DEFAULT_GRADES, ...(grades || {}) } as Record<string, number>;
  // Use effective (blended) stats: blends current with last 1 to 2 past seasons,
  // weighted by current AB sample size. Smooths out small samples early in
  // the season and decays past season influence as current data accumulates.
  const s: PlayerStats = getEffectiveStats(p);
  const num = (v: number | undefined) => Number(v) || 0;

  const obp = num(s.obp);
  const ops = num(s.ops);
  const avg = num(s.avg);
  const contact = num(s.contact);
  // Counting stats (HR, RBI, etc.) come from current season only — they don't
  // need blending. We keep them as-is from the player.stats object.
  const cs: PlayerStats = p.stats || {};
  const hr = num(cs.hr);
  const rbi = num(cs.rbi);
  const doubles = num(cs.doubles);
  const triples = num(cs.triples);
  const ld = num(s.ld);
  const hard = num(s.hard);
  const qab = num(s.qab);

  const advContact = Math.max(ld * 2.5, hard * 2.0, qab * 1.5);
  const finalContact =
    advContact > 0 ? contact * 10 + advContact * 15 : contact * 25;

  const leadoffScore =
    obp * 50 + speedBaseOf(g) * 2.5 + finalContact * 0.4 + g.baseballIQ * 1.0;
  const powerScore =
    ops * 40 +
    hr * 15 +
    doubles * 4 +
    triples * 5 +
    rbi * 2 +
    hard * 20 +
    powerOf(g) * 1.5;
  const contactScore =
    avg * 30 +
    finalContact +
    speedBaseOf(g) * 1.0 +
    g.baseballIQ * 1.0 +
    contactOf(g) * 2.0;
  const overallScore =
    ops * 30 +
    obp * 20 +
    avg * 15 +
    finalContact +
    rbi * 1.5 +
    g.baseballIQ * 1.5 +
    hard * 10;

  const defensiveScore = calcDefensiveScore(g);

  return {
    grades: g,
    leadoffScore,
    powerScore,
    contactScore,
    overallScore,
    defensiveScore,
  };
}

// ---------- Aggregated history ----------

// Whether a past game counts toward season fairness/rotation history.
// Mirrors utils/helpers.isGameFinalized so the engine agrees with the rest
// of the app: a game finalized with the legacy `status === "completed"`
// writer, or one with both scores entered but no status flip to "final",
// STILL counts. The old strict `status === "final"` check silently dropped
// those, starving the fairness model of history.
function isFinalizedGame(g: Game | null | undefined): boolean {
  if (!g) return false;
  // Scrimmages never feed seasonal fairness/rotation history — they don't
  // count toward bench, defensive innings, or position distribution.
  if (g.isScrimmage) return false;
  if (g.status === "final" || g.status === "completed") return true;
  const ts = g.teamScore;
  const os = g.opponentScore;
  if (ts == null || ts === "" || os == null || os === "") return false;
  return Number.isFinite(Number(ts)) && Number.isFinite(Number(os));
}

// Resolve a past lineup-snapshot slot's id to the CURRENT roster id. Games
// store the id a player had when they were played; if the roster was deleted
// and re-added (a single kid, or the whole team by mistake) those ids are
// orphaned and the re-added players carry fresh ids. Keying season fairness
// by the raw snapshot id then finds NO history for the current roster, so the
// engine sees everyone as neutral and falls back to seating the weakest /
// least-used kids first. Coalesce by unique name (same id-with-name fallback
// as utils/helpers.lineupSlotMatchesPlayer and the Bench Equity tile). Two
// live players who share a name are left un-coalesced — we only remap when the
// snapshot id is no longer on the roster AND the name is unambiguous.
function buildSlotIdResolver(
  roster: { id?: string; name?: string }[],
): (id?: string, name?: string) => string | undefined {
  const live = new Set((roster || []).map((p) => p && p.id).filter(Boolean));
  const norm = (s: unknown) =>
    String(s ?? "")
      .trim()
      .toLowerCase();
  const byName = new Map<string, string>();
  const dupe = new Set<string>();
  for (const p of roster || []) {
    if (!p || !p.id) continue;
    const n = norm(p.name);
    if (!n) continue;
    if (byName.has(n)) dupe.add(n);
    else byName.set(n, p.id);
  }
  return (id, name) => {
    if (!id) return id;
    if (live.has(id)) return id; // still on the roster — keep
    const n = norm(name);
    if (n && !dupe.has(n) && byName.has(n)) return byName.get(n);
    return id; // unmatched orphan — leave as-is
  };
}

const IDENTITY_RESOLVER = (id?: string) => id;

function buildPositionHistory(
  games: Game[],
  currentGameId?: string | null,
  resolveId: (
    id?: string,
    name?: string,
  ) => string | undefined = IDENTITY_RESOLVER,
): Map<string, Map<string, { total: number; bigGame: number }>> {
  const out = new Map<
    string,
    Map<string, { total: number; bigGame: number }>
  >();
  for (const g of games) {
    if (g.id === currentGameId || !g.lineup) continue;
    if (!isFinalizedGame(g)) continue;
    const wasBigGame = g.isBigGame === true;
    for (const inning of g.lineup) {
      // Cast to a positions-only view: we skip BENCH up front, so every
      // remaining slot is SlimPlayer (single player or null).
      const innPos = inning as unknown as Record<string, SlimPlayer>;
      for (const pos in innPos) {
        if (pos === "BENCH") continue;
        const p = innPos[pos];
        if (!p) continue;
        const key = resolveId(p.id, p.name);
        if (!key) continue;
        let m = out.get(key);
        if (!m) {
          m = new Map();
          out.set(key, m);
        }
        const cur = m.get(pos) || { total: 0, bigGame: 0 };
        cur.total += 1;
        if (wasBigGame) cur.bigGame += 1;
        m.set(pos, cur);
      }
    }
  }
  return out;
}

function buildFirstInningBenchHistory(
  games: Game[],
  currentGameId?: string | null,
  resolveId: (
    id?: string,
    name?: string,
  ) => string | undefined = IDENTITY_RESOLVER,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of games) {
    if (g.id === currentGameId || !g.lineup?.length) continue;
    if (!isFinalizedGame(g)) continue;
    const firstBench = g.lineup[0]?.BENCH;
    if (!firstBench) continue;
    for (const bp of firstBench as NonNullable<SlimPlayer>[]) {
      // attendance is keyed by the id stored at game time, so check it on
      // the original slot id; tally under the resolved (current) id.
      if (g.attendance?.[bp.id] === false) continue;
      const key = resolveId(bp.id, bp.name);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

// Aggregate per player {bench, defensive} innings across all final past games.
// Returns Map<playerId, { bench: number, defensive: number }>.
// Used to compute each player's running cumulative bench ratio so the engine
// can prioritize benching players who've sat the least so far this season.
// For each past final game, compute the minimum bench per attending player
// (math floor) and tally each player's "extra sits" = bench count minus minimum.
// Players who weren't present don't count for that game.
// Returns Map<playerId, { extraSits: number }>.
function buildExtraSitHistory(
  games: Game[],
  currentGameId?: string | null,
  resolveId: (
    id?: string,
    name?: string,
  ) => string | undefined = IDENTITY_RESOLVER,
): Map<string, ExtraSitEntry> {
  const out = new Map<string, ExtraSitEntry>();

  for (const g of games) {
    if (g.id === currentGameId || !g.lineup?.length) continue;
    if (!isFinalizedGame(g)) continue;

    // Mid-game removals: a kid marked as injured/ill/left from inning N
    // played innings 0..N-1 and is gone from N onward. Innings before N
    // count toward their season totals; innings after N don't (they
    // weren't there). NKB rules treat them as "skip in batting without
    // penalty," and for fairness purposes their bench/play count must
    // be prorated to the innings they actually played.
    const removedFrom = (pid: string): number | null => {
      const r = (
        g.midGameRemovals as Record<string, { fromInning?: number }>
      )?.[pid];
      const fi = r?.fromInning;
      return Number.isFinite(fi) && fi != null ? fi : null;
    };
    const isActiveAtInning = (pid: string, inn: number) => {
      if (g.attendance?.[pid] === false) return false;
      const rf = removedFrom(pid);
      if (rf !== null && inn >= rf) return false;
      return true;
    };

    // For this game, count attending players and bench slots per inning.
    // Bench slots per inning is constant within a game (driven by defenseSize
    // + roster present), so we read it from the first inning's BENCH array.
    const attending = new Set<string>();
    // Map each original snapshot id → name so we can resolve orphaned ids
    // (from a roster delete+re-add) to the current roster id at accumulation
    // time. All the per-game tallying below stays keyed by the original id so
    // attendance / mid-game-removal lookups (also keyed by the snapshot id)
    // stay correct.
    const idName = new Map<string, string>();
    for (const inning of g.lineup) {
      for (const pos in inning) {
        if (pos === "BENCH") continue;
        const p = inning[pos] as SlimPlayer | undefined;
        if (p) {
          attending.add(p.id);
          idName.set(p.id, p.name);
        }
      }
      for (const bp of (inning.BENCH || []) as NonNullable<SlimPlayer>[]) {
        if (g.attendance?.[bp.id] === false) continue;
        attending.add(bp.id);
        idName.set(bp.id, bp.name);
      }
    }
    const playerCount = attending.size;
    if (playerCount === 0) continue;

    const benchSlotsPerInning = (g.lineup[0]?.BENCH || []).length;
    const innings = g.lineup.length;
    const fieldersPerInning =
      innings > 0
        ? Object.keys(g.lineup[0] || {}).filter((k) => k !== "BENCH").length
        : 0;
    const totalBenchSlots = benchSlotsPerInning * innings;
    const totalDefenseSlots = fieldersPerInning * innings;

    // Math floor for this game: floor(totalBenchSlots / playerCount)
    const minBenchPerPlayer = Math.floor(totalBenchSlots / playerCount);
    // Fair share of defense innings for a kid who played the whole game.
    // Prorated below for kids who were removed mid-game.
    const expectedDefThisGame = totalDefenseSlots / playerCount;

    // Per-player innings-played count: every inning they were active.
    const playedInn = new Map<string, number>();
    for (const id of attending) playedInn.set(id, 0);
    for (let i = 0; i < innings; i++) {
      for (const id of attending) {
        if (isActiveAtInning(id, i)) {
          playedInn.set(id, (playedInn.get(id) || 0) + 1);
        }
      }
    }

    // Tally each attending player's bench count, skipping innings they
    // weren't active for (full absence OR mid-game removal).
    const benchCount = new Map<string, number>();
    for (const id of attending) benchCount.set(id, 0);
    for (let i = 0; i < innings; i++) {
      const inning = g.lineup[i];
      for (const bp of (inning.BENCH || []) as NonNullable<SlimPlayer>[]) {
        if (!isActiveAtInning(bp.id, i)) continue;
        if (benchCount.has(bp.id)) {
          benchCount.set(bp.id, (benchCount.get(bp.id) ?? 0) + 1);
        }
      }
    }

    // Update per player tallies: extraSits, raw bench, raw defense, AND
    // the per game expected defense. expectedDef is prorated by the
    // share of innings the kid actually played, so a kid pulled in the
    // 4th of 6 innings doesn't accumulate a 6-inning fair share.
    for (const [pid, count] of benchCount) {
      const played = playedInn.get(pid) || 0;
      // Key by the CURRENT roster id so a re-added player's pre-delete
      // history isn't stranded under their old (orphaned) id.
      const key = resolveId(pid, idName.get(pid));
      if (!key) continue;
      const cur = out.get(key) || {
        extraSits: 0,
        benchInn: 0,
        defInn: 0,
        expectedDef: 0,
      };
      const extra = Math.max(0, count - minBenchPerPlayer);
      cur.extraSits += extra;
      cur.benchInn += count;
      cur.defInn += Math.max(0, played - count);
      cur.expectedDef +=
        innings > 0 ? (played / innings) * expectedDefThisGame : 0;
      out.set(key, cur);
    }
  }
  return out;
}

// ---------- Batting order ----------

/**
 * Modern analytical batting order builder.
 *
 * Two strategies, auto selected:
 *
 * 1) UNCAPPED (no per inning run limit)  uses Tango/The Book logic:
 * #1: Best OBP (table setter)
 * #2: Second best overall (modern view of #2 as a primary RBI spot)
 * #3: Fourth best overall (the "sacrificed" #3 in modern analytics)
 * #4: Best slugger (cleanup)
 * #5: Next best power
 * #6+: Descending overall score
 *
 * 2) CAPPED (NKB 6U/7U/8U with 7 run per inning cap)  distributes strong
 * hitters more evenly so each inning has a better chance of hitting the
 * cap (rather than clustering all the strength up top and "wasting" hits
 * against the cap). Spreads top tier hitters across the first ~7 spots:
 * #1: Best OBP (still want a baserunner)
 * #2: Best overall remaining
 * #3: Best slugger (move power up; he'll bat with men on)
 * #4: Next best OBP (so we can keep the rally rolling)
 * #5: Next best slugger
 * #6: Next best overall
 * #7: Next best OBP
 * #8+: Descending overall score (weak kids cluster at bottom per config)
 *
 * Both strategies return the order plus per spot reasoning ('why' metadata)
 * accessible via the player's `profile.battingReason` field after generation.
 *
 * `battingSize` matches the existing semantics: "roster" = bat everyone, or
 * a number to limit to top N hitters.
 */
function generateBattingOrder(
  profiledPlayers: ProfiledPlayer[],
  battingSize: string,
  opts: { seed?: number; leagueRuleSet?: string; teamAge?: string } = {},
): ProfiledPlayer[] {
  const { leagueRuleSet, teamAge, seed } = opts;
  const total = profiledPlayers.length;
  const count =
    battingSize === "roster"
      ? total
      : Math.min(parseInt(battingSize, 10) || total, total);

  // Per player plus or minus 2 percent score jitter for re roll variance. A single factor per
  // player applied to every score key  strong/weak ends barely move,
  // similarly rated kids in the middle can swap on a different seed.
  // Same seed  same order (deterministic).
  const rand = mulberry32((seed ?? Date.now()) >>> 0);
  const JITTER = 0.02;
  const factor = new Map();
  for (const p of profiledPlayers) {
    factor.set(p.id, 1 + (rand() * 2 - 1) * JITTER);
  }
  const score = (p: ProfiledPlayer, key: string) =>
    ((p.profile as unknown as Record<string, number>)[key] || 0) *
    factor.get(p.id);
  // OPS lives on raw stats, not in the precomputed profile, so wrap it the
  // same way for jittered selection (only used by the youth strategy).
  const opsScore = (p: ProfiledPlayer) =>
    +(p.stats?.ops ?? 0) * factor.get(p.id);

  const byOverall = [...profiledPlayers].sort(
    (a, b) => score(b, "overallScore") - score(a, "overallScore"),
  );
  const pool = byOverall.slice(0, count);
  const order = new Array(count).fill(null);
  const reasons = new Array(count).fill("");

  function takeBest(scoreKey: string) {
    if (pool.length === 0) return null;
    let bestIdx = 0;
    for (let i = 1; i < pool.length; i++) {
      if (score(pool[i], scoreKey) > score(pool[bestIdx], scoreKey))
        bestIdx = i;
    }
    return pool.splice(bestIdx, 1)[0];
  }

  function takeBestOps() {
    if (pool.length === 0) return null;
    let bestIdx = 0;
    for (let i = 1; i < pool.length; i++) {
      if (opsScore(pool[i]) > opsScore(pool[bestIdx])) bestIdx = i;
    }
    return pool.splice(bestIdx, 1)[0];
  }

  function place(
    idx: number,
    player: ProfiledPlayer | null,
    role: string,
    note: string,
  ) {
    if (player && idx < count) {
      order[idx] = player;
      reasons[idx] = { role, note };
    }
  }

  // Strategy selection:
  //   NKB 6U/7U/8U: youth strategy (continuous roster batting, 7 run
  //     cap, no walks, no real "power"  but OPS still flags genuine
  //     big hitters at this age). Spread strong OPS across the top half
  //     (3, 4, 7) so they bat with runners on without clustering.
  //   Everyone else: existing Tango/Book modern lineup. Unchanged.
  const useYouth =
    leagueRuleSet === "NKB" &&
    (teamAge === "6U" || teamAge === "7U" || teamAge === "8U");

  if (useYouth) {
    if (count > 0)
      place(
        0,
        takeBest("leadoffScore"),
        "Leadoff",
        "Best OBP+speed  set the table",
      );
    if (count > 1)
      place(
        1,
        takeBest("contactScore"),
        "#2 Contact",
        "Top contact  extends the rally",
      );
    if (count > 2)
      place(2, takeBestOps(), "#3 OPS", "Best OPS  bat with runners on");
    if (count > 3)
      place(3, takeBestOps(), "Cleanup OPS", "Second best OPS  drive runs in");
    if (count > 4)
      place(
        4,
        takeBest("leadoffScore"),
        "#5 Turnover",
        "Next best OBP  turn the order over",
      );
    if (count > 5)
      place(
        5,
        takeBest("contactScore"),
        "#6 Sustain",
        "More contact  keep it going",
      );
    if (count > 6)
      place(
        6,
        takeBestOps(),
        "#7 Late OPS",
        "Third big hitter  late inning threat",
      );

    // Tail: descending by composite youthScore (leadoff + contact + OPS).
    // No `powerScore`  HR/SLG/RBI are noise at this age.
    const youthScore = (p: ProfiledPlayer) =>
      score(p, "leadoffScore") + score(p, "contactScore") + opsScore(p) * 100;
    pool.sort((a, b) => youthScore(b) - youthScore(a));
    let descIdx = 0;
    for (let i = 7; i < count; i++) {
      if (order[i] === null && pool.length > 0) {
        order[i] = pool.shift();
        descIdx++;
        reasons[i] = {
          role: descIdx <= 3 ? "Middle" : "Bottom",
          note: `Descending youth composite (#${descIdx})`,
        };
      }
    }
  } else {
    // Modern Tango / Book style strategy for uncapped leagues
    if (count > 0)
      place(0, takeBest("leadoffScore"), "Leadoff", "Best OBP  leadoff");
    if (count > 1)
      place(
        1,
        takeBest("overallScore"),
        "#2 Premium",
        "Best overall  modern #2 spot is a premium RBI position",
      );
    if (count > 3)
      place(3, takeBest("powerScore"), "Cleanup", "Best slugger  cleanup");
    if (count > 2)
      place(
        2,
        takeBest("overallScore"),
        "#3 Modern",
        "Strong bat  modern #3 is the 4th best slot",
      );
    if (count > 4)
      place(
        4,
        takeBest("powerScore"),
        "#5 Power",
        "Next best power  second cleanup",
      );

    // Fill remaining spots descending by overallScore (jittered).
    pool.sort((a, b) => score(b, "overallScore") - score(a, "overallScore"));
    let descIdx = 0;
    for (let i = 0; i < count; i++) {
      if (order[i] === null && pool.length > 0) {
        order[i] = pool.shift();
        descIdx++;
        reasons[i] = {
          role: descIdx <= 3 ? "Middle" : "Bottom",
          note: `Descending overall (#${descIdx})`,
        };
      }
    }
  }

  // Attach structured reasons to the placed players. The UI looks for
  // `battingReason` with shape { role, note, effective: {ops, avg, hard} }.
  for (let i = 0; i < count; i++) {
    const player = order[i];
    if (!player) continue;
    const reason = reasons[i] || { role: "", note: "" };
    const stats = player.stats || {};
    player.battingReason = {
      role: reason.role,
      note: reason.note,
      effective: {
        ops: +stats.ops || 0,
        avg: +stats.avg || 0,
        obp: +stats.obp || 0,
        hard: +stats.hard || 0,
      },
    };
  }
  return order.filter(Boolean);
}

// Lightweight wrapper for "re roll batting only"  builds player profiles
// from raw players + grades and runs generateBattingOrder. Defense side
// state (lineup, bench schedule, etc.) is untouched. Returns the new
// batting order or { error } if the inputs are too thin.
export function generateBattingOnly(input: EngineInput): EngineResult {
  const {
    activePlayers,
    allPlayers,
    evaluationEvents = [],
    leagueRuleSet = "USSSA",
    teamAge = "8U",
    battingSize = "roster",
    seed,
  } = input;

  if (!Array.isArray(activePlayers) || activePlayers.length < 1) {
    return { error: "No active players to build a batting order from." };
  }

  const combinedGrades = getCombinedGrades(
    evaluationEvents,
    allPlayers || activePlayers,
    { teamAge, games: (input.games as any) || [] },
  );
  const profiled = activePlayers.map((p) => ({
    ...p,
    profile: buildPlayerProfile(p, combinedGrades[p.id]),
  }));

  const battingLineup = generateBattingOrder(profiled, battingSize, {
    leagueRuleSet,
    teamAge,
    seed,
  });

  // Mirror the effective stats decoration that generateLineup applies, so
  // the UI sees the same structured `battingReason` shape regardless of
  // which entry point produced the order.
  battingLineup.forEach((player) => {
    if (!player || !player.battingReason) return;
    const eff = getEffectiveStats(player);
    const bw = eff.__blended ? eff.__blendWeights : undefined;
    if (bw && bw.current < 0.95) {
      player.battingReason.blendNote = `Stats blended (current ${Math.round(
        bw.current * 100,
      )}% / past ${Math.round((bw.past1 + bw.past2) * 100)}%)`;
    }
    player.battingReason.effective = {
      ops: +(eff.ops ?? 0),
      avg: +(eff.avg ?? 0),
      obp: +(eff.obp ?? 0),
      ld: +(eff.ld ?? 0),
      hard: +(eff.hard ?? 0),
      qab: +(eff.qab ?? 0),
    };
  });

  return { battingLineup };
}

// ---------- Main generator ----------

// Separate entry point for Tournament (competitive) games. It owns the
// competitive STRATEGY — best-XI/premium defense, a per-game minimum-play floor
// (in precomputeBenchSchedule), ability batting, and no fairness ledger — while
// REUSING every shared SAFETY rail: catcher caps, pitcher rest / pitch-count
// limits, position eligibility, and the per-inning assignment. The app routes
// Tournament games here; Rec/Machine-Pitch games never enter it.
export function buildCompetitiveLineup(input: EngineInput): EngineResult {
  return generateLineup({ ...input, competitive: true });
}

// ---------- Tournament-mode lineup (parallel pipeline) ----------
// A scripted tournament plan instead of the Rec rotation: the best nine start
// at their best positions, every sub enters as a unit in the 3rd inning (each
// shown replacing a specific starter), starters return in the 5th, and a
// ranked relief-pitcher list (pitch-count eligibility included) rides along
// for mid-game pitching changes. Reuses the engine's grade merge, profiles,
// depth chart, eligibility rules, batting order, and pitching plan — but never
// touches the Rec generator's fairness machinery.
export function generateTournamentLineup(input: EngineInput): EngineResult {
  const {
    activePlayers,
    allPlayers,
    games = [],
    evaluationEvents = [],
    currentGame = {} as Partial<Game>,
    totalInnings = 6,
    teamAge = "10U",
    defenseSize = "9",
    battingSize = "roster",
    leagueRuleSet = "USSSA",
    pitchingFormat,
    depthChart,
    pitchRuleSet,
    catcherMaxInnings,
    catcherConsecutive,
    seed,
    // Coach-selected starting pitcher comes through here as { P: playerId },
    // same channel the Rec path uses for first-inning position locks.
    firstInningOverridesById = {},
  } = input as any;

  if (!Array.isArray(activePlayers) || activePlayers.length < 7) {
    return {
      error: "Need at least 7 players present to build a tournament lineup.",
    };
  }

  const grades = getCombinedGrades(
    evaluationEvents,
    allPlayers || activePlayers,
    { teamAge, games },
  );
  const profiled: ProfiledPlayer[] = activePlayers.map((p) => ({
    ...p,
    profile: buildPlayerProfile(p, grades[p.id]),
  }));
  const byId = new Map(profiled.map((p) => [p.id, p]));

  const defSizeNum = parseInt(defenseSize, 10) || 9;
  const positions = getPositionsForInning(
    Math.min(profiled.length, defSizeNum),
    defenseSize,
  );
  const ruleSet = pitchRuleSet || DEFAULT_PITCH_RULE_SET;
  const gameDate = currentGame.date || new Date().toISOString().slice(0, 10);
  const kidPitch = /kid/i.test(String(pitchingFormat || ""));
  const slim = (p: ProfiledPlayer): SlimPlayer => ({
    id: p.id,
    name: p.name,
    number: p.number ?? "",
  });

  const eligibleFor = (pos: string, p: ProfiledPlayer | undefined): boolean => {
    if (!p) return false;
    if (pos === "C") return isCatcherEligible(p);
    if (isPositionBlocked(p, pos)) return false;
    if (pos === "P" && kidPitch)
      return checkPitchEligibility(p, gameDate, teamAge, ruleSet);
    return true;
  };

  // Higher = better for this slot. Depth chart is authoritative when the
  // coach ranked the position; otherwise position-appropriate engine scores.
  const depthRank = (pos: string, pid: string): number => {
    const list = depthChart?.[pos];
    if (!Array.isArray(list)) return -1;
    return list.indexOf(pid);
  };
  const scoreFor = (pos: string, p: ProfiledPlayer): number => {
    let s: number;
    if (pos === "P")
      s = calcPitcherScore(p.profile.grades, p.stats, {
        topMph:
          p.stats?.pTopMph ??
          (p as unknown as { pitching?: { topMph?: number } }).pitching
            ?.topMph ??
          null,
        teamAge,
      });
    else if (pos === "C") s = calcCatcherScore(p.profile.grades, p.stats);
    else s = p.profile.defensiveScore + (p.profile.overallScore || 0) * 0.05;
    const r = depthRank(pos, p.id);
    if (r >= 0) s += 1000 - r * 50;
    return s;
  };

  // Assign starters scarcity-first (fewest eligible candidates first), each
  // pick validated with the bipartite matching so a greedy choice can never
  // strand a later position.
  const eligCount = (pos: string) =>
    profiled.filter((p) => eligibleFor(pos, p)).length;
  const fillOrder = [...positions].sort((a, b) => eligCount(a) - eligCount(b));
  const assigned = new Map<string, ProfiledPlayer>(); // pos → profiled player
  const used = new Set<string>();

  // Honor a coach-selected starting pitcher (Starting Pitcher picker): seat
  // them at P before the scarcity fill so the projected lineup is built around
  // the coach's choice, not the top-ranked arm. Falls back to the normal pick
  // if the chosen player isn't present or isn't eligible to pitch this game.
  const forcedPitcherId = (firstInningOverridesById || {}).P;
  let pendingOrder = fillOrder;
  if (forcedPitcherId && positions.includes("P")) {
    const fp = byId.get(forcedPitcherId);
    if (fp && eligibleFor("P", fp)) {
      assigned.set("P", fp);
      used.add(fp.id);
      pendingOrder = fillOrder.filter((pos) => pos !== "P");
    }
  }

  for (const pos of pendingOrder) {
    const candidates = profiled
      .filter((p) => !used.has(p.id) && eligibleFor(pos, p))
      .sort((a, b) => scoreFor(pos, b) - scoreFor(pos, a));
    if (candidates.length === 0) {
      return {
        error: `No eligible player available for ${pos}. Check Comfortable Positions${
          pos === "P" && kidPitch ? " and pitch-count rest days" : ""
        }.`,
      };
    }
    const remainingPos = fillOrder.filter((x) => x !== pos && !assigned.has(x));
    let picked: ProfiledPlayer | null = null;
    for (const cand of candidates) {
      const remainingIds = profiled
        .filter((p) => !used.has(p.id) && p.id !== cand.id)
        .map((p) => p.id);
      const match = maxPositionMatching(remainingPos, remainingIds, (mp, pid) =>
        eligibleFor(mp, byId.get(pid)),
      );
      if (match.size === remainingPos.length) {
        picked = cand;
        break;
      }
    }
    if (!picked) {
      return {
        error: `Couldn't seat a full defense: assigning ${pos} strands another position. Loosen Comfortable Positions and retry.`,
      };
    }
    assigned.set(pos, picked);
    used.add(picked.id);
  }

  // Scripted sub windows: every sub enters in the 3rd, starters return in the
  // 5th. Short games degrade gracefully (no return stint under 5 innings; no
  // sub stint under 3). P and C are never auto-subbed — pitching changes go
  // through the relief list, and catcher continuity is deliberate.
  const subEnterInning = totalInnings >= 3 ? 3 : null;
  const subLastInning =
    subEnterInning == null ? null : Math.min(4, totalInnings);
  const starterReturnInning = totalInnings >= 5 ? 5 : null;
  const benchPlayers = profiled
    .filter((p) => !used.has(p.id))
    .sort(
      (a, b) => (b.profile.overallScore || 0) - (a.profile.overallScore || 0),
    );
  const replaceableSlots = [...assigned.entries()]
    .filter(([pos]) => pos !== "P" && pos !== "C")
    // Weakest starters give up their innings first.
    .sort((a, b) => scoreFor(a[0], a[1]) - scoreFor(b[0], b[1]));
  const substitutions: TournamentSubstitution[] = [];
  if (subEnterInning != null) {
    const takenSlots = new Set<string>();
    for (const sub of benchPlayers) {
      const slot = replaceableSlots.find(
        ([pos]) =>
          !takenSlots.has(pos) &&
          (pos === "C" ? isCatcherEligible(sub) : !isPositionBlocked(sub, pos)),
      );
      if (!slot) continue; // stays available off the bench all game
      takenSlots.add(slot[0]);
      substitutions.push({
        inning: subEnterInning,
        returnInning: starterReturnInning,
        position: slot[0],
        in: slim(sub),
        out: slim(slot[1]),
      });
    }
  }

  // An EXPLICIT catcher cap (Settings → Catcher Innings, or the per-game
  // override) applies in tournament games too: once the starting catcher
  // hits the cap, the best catcher-eligible bench player takes over for the
  // rest of the game. "auto"/"none" keep tournament catcher continuity
  // (no scripted change). No handoff when nobody on the bench can catch.
  const catcherPolicy = resolveCatcherPolicy(
    catcherMaxInnings,
    catcherConsecutive,
    defenseSize,
    profiled.length,
  );
  const starterC = assigned.get("C");
  let catcherHandoff: TournamentSubstitution | null = null;
  if (
    starterC &&
    catcherPolicy.enforceCap &&
    catcherPolicy.cap < totalInnings
  ) {
    const handoffInning = catcherPolicy.cap + 1;
    const scriptedIn = new Set(substitutions.map((s) => s.in?.id));
    const eligible = benchPlayers
      .filter((p) => isCatcherEligible(p))
      .sort(
        (a, b) =>
          calcCatcherScore(b.profile.grades, b.stats) -
          calcCatcherScore(a.profile.grades, a.stats),
      );
    // Prefer a bench catcher with no scripted field stint; otherwise borrow
    // a scripted sub — their field stint ends when they strap the gear on.
    const pick =
      eligible.find((p) => !scriptedIn.has(p.id)) || eligible[0] || null;
    if (pick) {
      catcherHandoff = {
        inning: handoffInning,
        returnInning: null,
        position: "C",
        in: slim(pick),
        out: slim(starterC),
      };
      const stintIdx = substitutions.findIndex((s) => s.in?.id === pick.id);
      if (stintIdx >= 0) {
        const stint = substitutions[stintIdx];
        if (stint.inning >= handoffInning) {
          // Their whole field stint falls after the handoff — they're catching
          // instead, so the stint never happens.
          substitutions.splice(stintIdx, 1);
        } else if (
          stint.returnInning == null ||
          stint.returnInning > handoffInning
        ) {
          stint.returnInning = handoffInning;
        }
      }
      substitutions.push(catcherHandoff);
    }
  }

  // Materialize the innings grid so the existing lineup card, in-game view,
  // and save flow work unchanged.
  const subByPos = new Map(
    substitutions.filter((s) => s.position !== "C").map((s) => [s.position, s]),
  );
  const reliefCatcherId = catcherHandoff?.in?.id ?? null;
  const innings: Inning[] = [];
  for (let i = 1; i <= totalInnings; i++) {
    const inSubWindow =
      subEnterInning != null &&
      i >= subEnterInning &&
      i <= (subLastInning as number);
    const catcherSwapped =
      catcherHandoff != null && i >= (catcherHandoff.inning as number);
    const inn: Inning = {};
    const benched = new Set(benchPlayers.map((p) => p.id));
    for (const [pos, starter] of assigned) {
      if (pos === "C" && catcherSwapped && catcherHandoff?.in) {
        inn.C = catcherHandoff.in;
        benched.delete(catcherHandoff.in.id);
        benched.add(starter.id);
        continue;
      }
      const s = inSubWindow ? subByPos.get(pos) : undefined;
      // A bench kid can't hold a field stint and catch at once — once the
      // catcher handoff starts, their field slot reverts to its starter.
      if (s && s.in && !(catcherSwapped && s.in.id === reliefCatcherId)) {
        inn[pos] = s.in;
        benched.delete(s.in.id);
        benched.add(starter.id);
      } else {
        inn[pos] = slim(starter);
      }
    }
    inn.BENCH = profiled.filter((p) => benched.has(p.id)).map(slim);
    innings.push(inn);
  }

  const battingLineup = generateBattingOrder(profiled, battingSize, {
    seed,
    leagueRuleSet,
    teamAge,
  });

  const starterPitcherId = assigned.get("P")?.id;
  const reliefOptions = (
    kidPitch ? buildPitchingPlan(activePlayers, gameDate, teamAge, ruleSet) : []
  )
    .filter((r) => r.id !== starterPitcherId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      number: r.number,
      status: r.status,
      recentPitches: r.recentPitches,
      daysUntilReady: r.daysUntilReady,
    }));

  const tournament: TournamentPlan = {
    starters: Object.fromEntries(
      [...assigned.entries()].map(([pos, p]) => [pos, slim(p)]),
    ),
    substitutions,
    reliefOptions,
  };

  return { lineup: innings, battingLineup, tournament };
}

export function generateLineup(input: EngineInput): EngineResult {
  const {
    activePlayers,
    allPlayers,
    games = [],
    evaluationEvents = [],
    currentGame,
    firstInningOverridesById = {},
    totalInnings = 6,
    leagueRuleSet = "USSSA",
    teamAge = "8U",
    defenseSize = "10",
    positionLock = "0",
    battingSize = "roster",
    seed,
    // When true, ignore the cumulative seasonal fairness pressure
    // (priorExtraSits). Useful when constraints have stacked up and the
    // strict fairness solver can't find a valid lineup.
    relaxFairness = false,
    // When true, the lineup is built for a high stakes game:
    //  Seasonal fairness is automatically relaxed
    //  Strong players are pulled toward premium defensive positions
    //   (8U: C/1B/SS, 9U+: P/SS/3B/C/1B)
    //  Weak players are pushed toward the OF
    isBigGame = false,
    // Competitive (Tournament) mode — see EngineInput. Plays best-XI like Big
    // Game, but swaps seasonal fairness for a per-game minimum-play floor and
    // never reads/writes the fairness ledger. All catcher/pitch SAFETY rotation
    // is reused unchanged.
    competitive = false,
    // Team's pitch-count rule set (limits + rest tiers). Defaults to Little
    // League so existing callers are unchanged.
    pitchRuleSet,
    // Who already pitched/caught earlier TODAY in other games (doubleheaders),
    // for the same-day catch<->pitch rule. { pitched: Set, caught: Set }.
    sameDayRoles,
    // Depth Chart (position -> ordered player ids). Competitive-only; see below.
    depthChart,
    // Mid-game rebuild path: when `fromInning > 0` and `currentLineup` is
    // provided, innings 0..fromInning-1 are pre-locked from currentLineup and
    // the engine only fills the remaining innings — seeding its per-player
    // state (catcher cap, position history, bench tally) from the locked
    // innings so all rotation rules carry across the rebuild.
    fromInning = 0,
    currentLineup = null,
    // D4: drives pitcher pool selection for 9U+ Kid Pitch. Pool = top 5,
    // Bracket = top 3, League/unset = top 3. Read from currentGame if not
    // explicitly passed.
    gameType: gameTypeInput,
    pitchingFormat,
    // Catcher playing-time team settings. Default "auto" preserves the
    // historical behavior exactly (see resolveCatcherPolicy).
    catcherMaxInnings,
    catcherConsecutive,
  } = input;
  const pitchRules = (pitchRuleSet as PitchRuleSet) || DEFAULT_PITCH_RULE_SET;
  const sameDay = (sameDayRoles as {
    pitched?: Set<string>;
    caught?: Set<string>;
  }) || { pitched: new Set<string>(), caught: new Set<string>() };
  const gameType =
    (gameTypeInput as string | undefined) ||
    input.currentGame?.gameType ||
    "league";

  if (!Array.isArray(activePlayers) || activePlayers.length < 7) {
    return {
      error: "You need at least 7 active players to generate a lineup.",
    };
  }

  // Every defensive alignment (9- and 10-fielder) fields a catcher, and
  // catcher is gated on "C" being in a player's comfortable positions. If
  // no present player is cleared for C, fail fast with an actionable message rather
  // than letting it surface downstream as a cryptic bench-schedule error.
  if (!activePlayers.some((p) => isCatcherEligible(p))) {
    return {
      error:
        "No present player is set as a catcher. Open a player and check “Catcher” to add them to the catching rotation.",
    };
  }

  const currentGameId = currentGame?.id ?? null;
  const targetDateStr =
    currentGame?.date || new Date().toISOString().split("T")[0];

  const combinedGrades = getCombinedGrades(
    evaluationEvents,
    allPlayers || activePlayers,
    {
      teamAge,
      games,
    },
  );

  // D4 — pitcher pool. For 9U+ Kid Pitch we rank the staff by
  // `calcPitcherScore` (eval-driven), filter to those eligible to pitch
  // on the target date, and slice down to the top-N where N is set by
  // `gameType` (Pool 5, Bracket 3, League 3). The engine's P-slot
  // picker draws exclusively from this pool, preferring the lowest
  // `recentPitches` count within it (fairness across the staff).
  const teamAgeNumForPool = (() => {
    const m = String(teamAge || "").match(/(\d+)/g);
    if (!m) return 99;
    return parseInt(m[m.length - 1], 10);
  })();
  const isKidPitchFormat = /kid/i.test(String(pitchingFormat || ""));
  const usePitcherPool = isKidPitchFormat && teamAgeNumForPool >= 9;
  let pitcherPoolIds: Set<string> = new Set();
  if (usePitcherPool) {
    const ranked = activePlayers
      .map((p) => ({
        p,
        score: calcPitcherScore(combinedGrades[p.id], p.stats, {
          topMph: p.stats?.pTopMph ?? p.pitching?.topMph,
          teamAge,
        }),
      }))
      .filter((row) => row.score > 0)
      .filter((row) =>
        checkPitchEligibility(row.p, targetDateStr, teamAge, pitchRules),
      )
      .sort((a, b) => b.score - a.score);
    const n = getPitcherPoolSize(gameType);
    pitcherPoolIds = new Set(ranked.slice(0, n).map((row) => row.p.id));

    // Dual-role tournament deployment: in a POOL game, save the #1 catcher's
    // arm — they catch in pool and pitch in bracket. Drop them from the pitcher
    // pool so a dual-#1 (your top catcher who's also a pool arm) is steered to C
    // in pool play; the same-day rule then keeps them off the mound that game.
    // Bracket games keep them in the pool, so your ace catcher can pitch to win.
    if (gameType === "pool" && pitcherPoolIds.size > 1) {
      const chartC = depthChart?.["C"];
      let topCatcherId: string | null = null;
      if (Array.isArray(chartC)) {
        for (const id of chartC) {
          const p = activePlayers.find((x) => x.id === id);
          if (p && isCatcherEligible(p)) {
            topCatcherId = id;
            break;
          }
        }
      }
      if (!topCatcherId) {
        let best = -Infinity;
        for (const p of activePlayers) {
          if (!isCatcherEligible(p)) continue;
          const s = calcCatcherScore(combinedGrades[p.id], p.stats);
          if (s > best) {
            best = s;
            topCatcherId = p.id;
          }
        }
      }
      // Only drop them if it leaves a usable pool (don't strand pool play with
      // no arms when the top catcher is also your only listed pitcher).
      if (topCatcherId && pitcherPoolIds.has(topCatcherId)) {
        pitcherPoolIds.delete(topCatcherId);
      }
    }
  }

  // Competitive-only: a per-position rank lookup from the coach's depth chart,
  // outfield-canonicalized so a CF entry covers LCF/RCF (and vice-versa) across
  // 9- vs 10-fielder alignments. pickBestForPosition uses this to make the chart
  // authoritative over skill among already-legal candidates. Built empty on the
  // Rec path (competitive === false), so Rec behavior is unchanged.
  const depthChartRank: Map<string, Map<string, number>> = new Map();
  // Every player who appears in ANY depth-chart position. Used to reserve a
  // charted player for their charted spot(s): they're repelled from positions
  // they're NOT charted at, so an earlier-filled slot can't grab them and
  // strand their charted position with a worse fit.
  const chartedPlayerIds: Set<string> = new Set();
  if (competitive && depthChart) {
    for (const [pos, ids] of Object.entries(depthChart)) {
      if (!Array.isArray(ids) || ids.length === 0) continue;
      const key = canonicalizeOutfield(pos);
      let m = depthChartRank.get(key);
      if (!m) {
        m = new Map();
        depthChartRank.set(key, m);
      }
      // First occurrence wins if a player is listed under both CF and LCF/RCF.
      ids.forEach((id, i) => {
        if (!m!.has(id)) m!.set(id, i);
        chartedPlayerIds.add(id);
      });
    }
  }

  const profiled = activePlayers.map((p) => ({
    ...p,
    profile: buildPlayerProfile(p, combinedGrades[p.id]),
  }));

  // Big Game and Competitive both relax seasonal fairness (Competitive ignores
  // the ledger entirely and uses a per-game floor instead).
  const effectiveRelax = relaxFairness || isBigGame || competitive;

  // Fairness ledger partition (hybrid teams): a game's playing-time history is
  // only shared with games of the SAME mode. So Tournament (USSSA) games never
  // add to — or draw from — the Rec fairness ledger, and vice-versa. (When
  // competitive, the ledger is empty anyway via effectiveRelax; this also keeps
  // a Rec game from counting Tournament games against its fairness.)
  const ledgerGames = games.filter(
    (g) => ((g.leagueRuleSet || leagueRuleSet) === "USSSA") === competitive,
  );

  // Resolver maps orphaned snapshot ids (from a roster delete+re-add) to the
  // current roster id, so season fairness/rotation history follows re-added
  // players instead of stranding it under their old ids.
  const resolveSlotId = buildSlotIdResolver(allPlayers || activePlayers);
  const positionHistory = buildPositionHistory(
    ledgerGames,
    currentGameId,
    resolveSlotId,
  );
  const firstInningBenchHx = effectiveRelax
    ? new Map()
    : buildFirstInningBenchHistory(ledgerGames, currentGameId, resolveSlotId);
  // Cumulative seasonal fairness pressure. When relaxed, we feed the solver
  // an empty history so this game's bench distribution doesn't get skewed by
  // accumulated debt  useful when the strict solver has failed.
  const benchHistory = effectiveRelax
    ? new Map()
    : buildExtraSitHistory(ledgerGames, currentGameId, resolveSlotId);

  // Mid-game rebuild fairness: when fromInning > 0 the engine replays
  // innings 0..fromInning-1 from currentLineup. Those replayed innings'
  // bench tallies are NOT in buildExtraSitHistory (current game is
  // excluded) so the bench scheduler for innings N+ used to plan as if
  // nobody had sat yet this game — which let it bench the same kid
  // again in a later inning even though they'd already sat earlier in
  // the same game. Fold the already-played innings into benchHistory
  // so priorRatio reflects the in-game state on the rebuild path.
  if (
    !effectiveRelax &&
    fromInning > 0 &&
    Array.isArray(currentLineup) &&
    currentLineup.length > 0
  ) {
    const limit = Math.min(fromInning, currentLineup.length, totalInnings);
    for (let i = 0; i < limit; i++) {
      const inn = currentLineup[i] || {};
      for (const pos of Object.keys(inn)) {
        if (pos === "BENCH") continue;
        const p = inn[pos] as SlimPlayer;
        if (!p) continue;
        const cur = benchHistory.get(p.id) || {
          extraSits: 0,
          benchInn: 0,
          defInn: 0,
          expectedDef: 0,
        };
        cur.defInn += 1;
        benchHistory.set(p.id, cur);
      }
      for (const bp of inn.BENCH || []) {
        if (!bp) continue;
        const cur = benchHistory.get(bp.id) || {
          extraSits: 0,
          benchInn: 0,
          defInn: 0,
          expectedDef: 0,
        };
        cur.benchInn += 1;
        benchHistory.set(bp.id, cur);
      }
    }
  }

  const battingLineup = generateBattingOrder(profiled, battingSize, {
    leagueRuleSet,
    teamAge,
    seed,
  });

  // generateBattingOrder now sets `battingReason` on each player directly,
  // including role/note appropriate for the chosen strategy (capped vs Tango).
  // We only need to add the recency blend note here, since that depends on
  // info computed in profiles, not in the order builder.
  battingLineup.forEach((player) => {
    if (!player || !player.battingReason) return;
    const eff = getEffectiveStats(player);
    const bw = eff.__blended ? eff.__blendWeights : undefined;
    if (bw && bw.current < 0.95) {
      player.battingReason.blendNote = `Stats blended (current ${Math.round(
        bw.current * 100,
      )}% / past ${Math.round((bw.past1 + bw.past2) * 100)}%)`;
    }
    // Also enrich effective stats from the player's blended profile (the
    // engine's batting math used these blended numbers; the UI should show
    // the same numbers for transparency).
    player.battingReason.effective = {
      ops: +(eff.ops ?? 0),
      avg: +(eff.avg ?? 0),
      obp: +(eff.obp ?? 0),
      ld: +(eff.ld ?? 0),
      hard: +(eff.hard ?? 0),
      qab: +(eff.qab ?? 0),
    };
  });
  const isStarter = new Set<string>();
  if (battingSize === "roster") {
    for (const p of profiled) isStarter.add(p.id);
  } else {
    const N = Math.min(parseInt(battingSize, 10), profiled.length);
    for (let i = 0; i < N; i++) isStarter.add(battingLineup[i].id);
  }

  let latestHead = null;
  for (const e of evaluationEvents) {
    if (e.coachRole !== "Head") continue;
    if (!latestHead || evalRoundRecency(e, latestHead) < 0) latestHead = e;
  }
  const headGrades = latestHead?.grades || {};

  const positionsToFill = getPositionsForInning(
    activePlayers.length,
    defenseSize,
  );
  const numToBench = Math.max(0, activePlayers.length - positionsToFill.length);
  const leftyPenalty = leftyInfieldPenalty(leagueRuleSet, teamAge);

  // Resolve the catcher playing-time policy (team/game settings). When the
  // coach sets an explicit cap, fail fast with an actionable message if the
  // roster simply doesn't have enough catcher-eligible kids to cover every
  // inning under that cap — this is the one "truly impossible" case where
  // relaxing fairness can't help (catcher supply is independent of fairness).
  const catcherPolicy = resolveCatcherPolicy(
    catcherMaxInnings,
    catcherConsecutive,
    defenseSize,
    activePlayers.length,
  );
  if (catcherPolicy.enforceCap && Number.isFinite(catcherPolicy.cap)) {
    const eligibleCatchers = activePlayers.filter((p) =>
      isCatcherEligible(p),
    ).length;
    const required = Math.ceil(totalInnings / catcherPolicy.cap);
    if (eligibleCatchers < required) {
      return {
        error: `Need at least ${required} catcher-eligible player${
          required === 1 ? "" : "s"
        } for a ${totalInnings}-inning game when each catches at most ${
          catcherPolicy.cap
        } inning${catcherPolicy.cap === 1 ? "" : "s"}. ${eligibleCatchers} ${
          eligibleCatchers === 1 ? "is" : "are"
        } cleared for catcher — open more players and check “Catcher,” or raise the catcher innings limit in Settings.`,
      };
    }
  }

  const baseSeed = (seed ?? Date.now()) >>> 0;
  const MAX_ATTEMPTS = 200;

  // Try generation with given history maps. Returns { lineup, penalty } or null.
  const runAttempts = (
    firstInnHx: Map<string, number>,
    seasonHx: Map<string, ExtraSitEntry>,
  ) => {
    let bestLineup: Inning[] | null = null;
    let bestPenalty = Infinity;
    let bestLockRelaxed: number[] = [];
    const failureReasons: BenchFailure[] = []; // accumulate every failure for diagnostic
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const rand = mulberry32(baseSeed + attempt * 2654435761);
      const result = tryBuildLineup({
        profiled,
        positionsToFill,
        numToBench,
        totalInnings,
        isStarter,
        firstInningOverridesById,
        positionHistory,
        firstInningBenchHx: firstInnHx,
        benchHistory: seasonHx,
        headGrades,
        defenseSize,
        positionLock,
        leagueRuleSet,
        teamAge,
        targetDateStr,
        leftyPenalty,
        // Competitive plays best-XI like Big Game (premium-position pull).
        isBigGame: isBigGame || competitive,
        competitive,
        pitcherPoolIds,
        depthChartRank,
        chartedPlayerIds,
        isKidPitch: isKidPitchFormat,
        pitchRules,
        sameDayRoles: sameDay,
        catcherPolicy,
        rand,
        fromInning,
        currentLineup,
      });
      if (!result || !result.ok) {
        if (result && !result.ok && result.failure)
          failureReasons.push(result.failure as BenchFailure);
        continue;
      }
      const { lineup, penalty, lockRelaxedInnings } = result;
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestLineup = lineup;
        bestLockRelaxed = lockRelaxedInnings || [];
        if (penalty === 0) break;
      }
    }
    if (bestLineup)
      return {
        lineup: bestLineup,
        penalty: bestPenalty,
        lockRelaxedInnings: bestLockRelaxed,
      };
    // No lineup found  pick the most common failure reason for diagnostic
    return { failures: failureReasons };
  };

  // Turn the per-attempt failures accumulated by runAttempts into one
  // human-readable blocker. Picks the most common failure (type + position +
  // inning) — that's the likeliest real cause. Returns both a coach-facing
  // message and the raw dominant type so callers can branch / log on it.
  const describeFailures = (
    failures: BenchFailure[],
  ): {
    msg: string;
    type: string | null;
    position?: string;
    inning?: number;
  } => {
    const counts = new Map();
    for (const f of failures || []) {
      const key = JSON.stringify({
        type: f.type,
        position: f.position,
        inning: f.inning,
        playerName: f.playerName,
      });
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let topKey = null;
    let topCount = 0;
    for (const [k, c] of counts) {
      if (c > topCount) {
        topCount = c;
        topKey = k;
      }
    }
    if (!topKey) return { msg: "Couldn't build a lineup.", type: null };
    const top = JSON.parse(topKey);
    let msg = "Couldn't build a lineup.";
    if (top.type === "no-candidate-for-position") {
      const candidates = activePlayers.filter(
        (p) => !isPositionBlocked(p, top.position),
      );
      const restrictedCount = activePlayers.length - candidates.length;
      msg = `No eligible player for ${top.position} in inning ${top.inning}.`;
      if (restrictedCount > 0) {
        msg += ` ${restrictedCount} present player${
          restrictedCount === 1 ? " is" : "s are"
        } restricted from ${top.position}.`;
      }
      if (candidates.length > 0 && candidates.length <= 2) {
        msg += ` Only ${candidates.map((p) => p.name).join(" and ")} ${
          candidates.length === 1 ? "is" : "are"
        } cleared for ${top.position} — consider adding it to another player's comfortable positions.`;
      }
      msg +=
        " Check player restrictions or first inning setup for this position.";
    } else if (top.type === "first-inning-override-benched") {
      msg = `${top.playerName} is set to play ${top.position} in inning 1 but the bench schedule has them benched. Adjust first inning setup.`;
    } else if (top.type === "bench-schedule-impossible") {
      msg =
        "Bench schedule couldn't satisfy attendance + catcher continuity rules. Check who's marked present.";
    } else if (top.type === "bench-schedule-mismatch") {
      msg = `Bench math doesn't add up in inning ${top.inning}. This usually means too many position locks or first inning overrides.`;
    }
    return { msg, type: top.type, position: top.position, inning: top.inning };
  };

  // First pass: try with the user's chosen fairness settings.
  let attempt = runAttempts(firstInningBenchHx, benchHistory);

  // Second pass: if the user wanted fairness ON but the engine couldn't satisfy
  // all the constraints, internally fall back to relaxed fairness rather than
  // failing. The kid imbalance can be made up over future games  this game
  // just needs a working lineup. We capture WHY the strict pass failed so the
  // UI can show the real blocker instead of a generic note.
  let fairnessRelaxed = false;
  let fairnessRelaxedReason: string | undefined;
  let fairnessRelaxedType: string | null | undefined;
  if (!attempt.lineup && !effectiveRelax) {
    fairnessRelaxed = true;
    const strict = describeFailures(attempt.failures || []);
    fairnessRelaxedReason = strict.msg;
    fairnessRelaxedType = strict.type;
    attempt = runAttempts(new Map(), new Map());
  }

  if (!attempt.lineup) {
    return { error: describeFailures(attempt.failures || []).msg };
  }
  return {
    lineup: attempt.lineup,
    battingLineup,
    fairnessRelaxed,
    // Why strict season-fairness couldn't be scheduled (only set when the
    // engine fell back to one-game balance). Surfaced in the UI toast.
    fairnessRelaxedReason,
    fairnessRelaxedType,
    // Innings (1-based) where the rotation lock was relaxed to keep a valid,
    // fair defense (rather than stranding a scarce position).
    lockRelaxedInnings: attempt.lockRelaxedInnings || [],
    qualityPenalty: attempt.penalty,
  };
}

// ---------- Single attempt builder ----------

/* ----------------------------------------------------------------------------
   precomputeBenchSchedule
   Decides EXACTLY which innings each player sits, before position assignment.
   This produces math optimal bench distribution (everyone sits floor(S/N)
   or ceil(S/N) innings) regardless of roster size.

   Inputs:
     profiled               array of profiled players (already filtered to attendees)
     totalInnings           game length (typically 6)
     numToBench             bench slots per inning (= profiled.length minus defenseSize)
     priorExtraSits         Map<playerId, { extraSits: number }>
     firstInningBenchHx     Map<playerId, number>
     topHalfIds             Set<playerId> (top half by defensive score)
     catcherInningBlocks    Array<number[]> contiguous inning blocks, one
                               catcher each (back-to-back continuity), OR
                               null when the catcher rotates freely
     catcherCap             max innings any one kid may catch (Infinity = none)
     enforceCatcherCap      hard-enforce the cap during pre-pick (explicit
                               settings); false = legacy lenient reuse
     rand                   seeded random function for tiebreakers
     firstInningBenchOverride  Set<playerId> who MUST be benched in inning 0
     firstInningOverridesById  Map of positions locked in inning 0 so we don't bench them

   Returns: { schedule: Map<playerId, Set<inning>>, catcherByInning: Map<inning, playerId> }
   On infeasibility: returns null (caller restarts attempt).
---------------------------------------------------------------------------- */

// Maximum bipartite matching (Kuhn's augmenting-path algorithm) of positions →
// players. `eligible(pos, pid)` is the hard-eligibility predicate. Returns a
// Map of pos → pid; its size is the maximum number of positions that can be
// simultaneously covered. Used to (a) stop the bench schedule from ever
// committing to an inning whose on-field set can't JOINTLY cover every position
// (the old per-position guard missed cases like two kids who are the only
// SS *and* the only 1B options — benching one strands the other), and (b)
// repair a greedy fill that stranded a coverable position. Tiny inputs
// (≤11 players × ≤10 positions), so the simple algorithm is plenty fast.
function maxPositionMatching(
  positions: string[],
  playerIds: string[],
  eligible: (pos: string, pid: string) => boolean,
): Map<string, string> {
  const playerToPos = new Map<string, string>(); // pid → pos it currently holds
  const augment = (pos: string, visited: Set<string>): boolean => {
    for (const pid of playerIds) {
      if (visited.has(pid) || !eligible(pos, pid)) continue;
      visited.add(pid);
      const cur = playerToPos.get(pid);
      if (cur === undefined || augment(cur, visited)) {
        playerToPos.set(pid, pos);
        return true;
      }
    }
    return false;
  };
  for (const pos of positions) augment(pos, new Set());
  const posToPlayer = new Map<string, string>();
  for (const [pid, pos] of playerToPos) posToPlayer.set(pos, pid);
  return posToPlayer;
}

function precomputeBenchSchedule(opts: BenchScheduleOpts): {
  schedule: Map<string, Set<number>>;
  catcherByInning: Map<number, string | null>;
} | null {
  const {
    profiled,
    totalInnings,
    numToBench,
    competitive = false,
    priorExtraSits,
    firstInningBenchHx,
    topHalfIds,
    catcherInningBlocks,
    catcherCap,
    enforceCatcherCap,
    positionsToFill,
    rand,
    forcedBenchInning0,
    firstInningOverridesById,
  } = opts;

  // Field-position "supply": how many present players are eligible for each
  // non-catcher position. Used to steer catcher selection AWAY from kids who
  // are one of the few options for a scarce position (e.g. 1B), so reserving
  // them at C doesn't strand that position. A kid eligible only for plentiful
  // spots (deep OF) is the ideal catcher; a kid who's one of the few 1B
  // options is a poor one. `scarcityDrain` sums 1/supply over the positions a
  // player can field — higher means "more needed elsewhere."
  const posSupply = new Map();
  for (const pos of positionsToFill || []) {
    if (pos === "C") continue;
    let n = 0;
    for (const p of profiled) if (!isPositionBlocked(p, pos)) n++;
    posSupply.set(pos, n);
  }
  const scarcityDrain = (p: Player) => {
    let drain = 0;
    for (const [pos, supply] of posSupply) {
      if (supply > 0 && !isPositionBlocked(p, pos)) drain += 1 / supply;
    }
    return drain;
  };

  // Full per-position eligibility (C included, with its opt-in semantics).
  // Drives the position-coverage guards below: the bench schedule must never
  // sit (or reserve at catcher) the LAST kid who can cover a position — the
  // classic failure was a roster with one SS-cleared kid where every bench
  // schedule sat them in some inning, stranding SS there on every attempt.
  const posEligibleIds = new Map<string, Set<string>>();
  for (const pos of positionsToFill || []) {
    const ids = new Set<string>();
    for (const p of profiled) {
      if (pos === "C" ? isCatcherEligible(p) : !isPositionBlocked(p, pos))
        ids.add(p.id);
    }
    posEligibleIds.set(pos, ids);
  }
  // Anchors: sole eligible player for some position. They can never sit.
  // anchorNonC tracks sole coverage of a FIELD position specifically — those
  // kids also can't be reserved at catcher (catching inning N removes the only
  // SS/1B/… candidate for that inning just as surely as benching them).
  const anchorIds = new Set<string>();
  const anchorNonC = new Set<string>();
  for (const [pos, ids] of posEligibleIds) {
    if (ids.size !== 1) continue;
    for (const id of ids) {
      anchorIds.add(id);
      if (pos !== "C") anchorNonC.add(id);
    }
  }

  const N = profiled.length;
  const totalBenchSlots = numToBench * totalInnings;
  if (numToBench === 0) {
    // No benching to do
    const empty = new Map();
    for (const p of profiled) empty.set(p.id, new Set());
    return { schedule: empty, catcherByInning: new Map() };
  }

  const firstInningMustPlay = new Set();
  const firstInningLockedPos = new Map();
  if (firstInningOverridesById) {
    for (const pos of Object.keys(firstInningOverridesById)) {
      const pid = firstInningOverridesById[pos];
      firstInningMustPlay.add(pid);
      firstInningLockedPos.set(pid, pos);
    }
  }

  // ============================================================
  // Step 1: decide each kid's target sit count.
  //
  // Old approach: every kid gets at least minSits, with extraSittersNeeded
  // kids getting +1 to absorb the remainder.
  //
  // New approach: distribute the total bench slots based on season cumulative
  // playing time disparity. Kids who have been OVER PLAYED (low priorRatio,
  // high defInn vs team avg) absorb MORE than their share. Kids who have
  // been UNDER PLAYED (high priorRatio) absorb LESS  possibly zero  letting
  // them catch up.
  //
  // Constraints:
  //   Total target sits across all kids = totalBenchSlots (math invariant)
  //   No kid sits more than (minSits + 2)  the user's "max 2 extras" rule
  //   When the schedule is empty (no past games), defaults to even split
  // ============================================================
  const minSits = Math.floor(totalBenchSlots / N);
  const maxSits = minSits + 2; // Cap: never more than 2 above minimum

  // Compute each kid's actual vs expected defensive innings across past games.
  // expectedDef is computed per game from games actually attended, so a kid
  // who missed games is NOT shown as under played for those absences.
  // Delta > 0: played more than fair (over played)  take more sits this game
  // Delta < 0: played less than fair (under played)  take fewer sits, even 0
  const playerDeltas = [...profiled].map((p) => {
    const hist = priorExtraSits.get(p.id);
    const benchInn = hist?.benchInn || 0;
    const defInn = hist?.defInn || 0;
    const expectedDef = hist?.expectedDef || 0;
    return {
      p,
      defInn,
      benchInn,
      expectedDef,
      delta: defInn - expectedDef, // positive = over played
      defScore: p.profile.defensiveScore,
      rand: rand(),
    };
  });

  // Sort: most over played first. Ties broken by defensive score (worse
  // defenders sit first, all else equal) and random.
  playerDeltas.sort((a, b) => {
    if (a.delta !== b.delta) return b.delta - a.delta;
    if (a.defScore !== b.defScore) return a.defScore - b.defScore;
    return a.rand - b.rand;
  });

  // Distribute bench slots.
  // Algorithm:
  //   Start with everyone at minSits.
  //   The "extras" needed = totalBenchSlots minus N * minSits.
  //     With evenly divisible math, extras=0 (everyone exactly minSits).
  //     Otherwise some kids get +1.
  //   When season disparity exists, transfer sits from under played kids
  //     (drop their target below minSits, possibly to 0) to over played kids
  //     (raise theirs above, up to maxSits).
  //   Net total stays at totalBenchSlots.
  const targetSits = new Map();
  for (const x of playerDeltas) targetSits.set(x.p.id, minSits);

  const extraSittersNeeded = totalBenchSlots - N * minSits;
  // First: assign the remainder (+1) to over played kids
  for (let i = 0; i < extraSittersNeeded; i++) {
    targetSits.set(
      playerDeltas[i].p.id,
      targetSits.get(playerDeltas[i].p.id) + 1,
    );
  }

  // Now apply seasonal disparity transfer  "rob from over played, give to
  // under played." For each big positive delta (kid played extra), they take
  // an extra sit. For each big negative delta (kid played short), they give
  // up a sit. We pair these one for one to keep the total invariant.
  //
  // A "big" disparity here means at least 1 inning vs team avg. We transfer
  // up to one full sit per pair, capped by maxSits per kid and floor of 0.
  // Apply seasonal disparity transfer  "rob from over played, give to
  // under played." Skip entirely if there's no meaningful disparity (first
  // game of season, or everyone already balanced).
  const hasDisparity = playerDeltas.some((x) => Math.abs(x.delta) >= 1);
  if (hasDisparity) {
    // Identify donors (over played, can take more sits) and recipients
    // (under played, can give up sits).
    const donors = playerDeltas.filter((x) => x.delta >= 1).slice(); // most over played first
    const recipients = playerDeltas
      .filter((x) => x.delta <= -1)
      .slice()
      .sort((a, b) => a.delta - b.delta); // most under played first

    // Pair them: recipient with biggest negative delta gives up a sit;
    // donor with biggest positive delta takes it. Only transfer what helps
    // narrow the disparity AND respects the maxSits/minimum 0 caps.
    let dIdx = 0,
      rIdx = 0;
    while (dIdx < donors.length && rIdx < recipients.length) {
      const donor = donors[dIdx];
      const recipient = recipients[rIdx];
      const donorTarget = targetSits.get(donor.p.id);
      const recipientTarget = targetSits.get(recipient.p.id);
      // Find the minimum target across all kids  we cap at min + 2 so the
      // gap between most sit and least sit kid is never more than 2.
      let minActual = Infinity;
      for (const t of targetSits.values()) {
        if (t < minActual) minActual = t;
      }
      const dynamicMax = Math.max(maxSits, minActual + 2);
      if (donorTarget >= dynamicMax) {
        dIdx++;
        continue;
      }
      // Recipient at 0 already? Can't go below.
      if (recipientTarget <= 0) {
        rIdx++;
        continue;
      }
      // Don't transfer if it would create a gap of more than 2 between
      // the new max (donor + 1) and the new min (recipient minus 1, or any
      // existing kid at the bottom).
      const donorAfter = donorTarget + 1;
      const recipientAfter = recipientTarget - 1;
      // Find the smallest target across all kids EXCEPT the recipient
      // (they're moving). Actual minimum after transfer = min(otherMins, recipientAfter).
      let otherMin = Infinity;
      for (const [pid, t] of targetSits) {
        if (pid === recipient.p.id) continue;
        if (t < otherMin) otherMin = t;
      }
      const newMin = Math.min(otherMin, recipientAfter);
      if (donorAfter - newMin > 2) {
        dIdx++;
        continue;
      }
      // Transfer
      targetSits.set(donor.p.id, donorAfter);
      targetSits.set(recipient.p.id, recipientAfter);
      donor.delta -= 1;
      recipient.delta += 1;
      if (dIdx + 1 < donors.length && donor.delta < donors[dIdx + 1].delta)
        dIdx++;
      if (
        rIdx + 1 < recipients.length &&
        recipient.delta > recipients[rIdx + 1].delta
      )
        rIdx++;
    }
  }

  // COMPETITIVE (Tournament) override: replace the fairness distribution with a
  // minimum-play floor. The weakest defenders absorb the bench slots first, but
  // every kid is capped at floor(totalInnings/2) sits — i.e. plays at least half
  // — so strong kids hold the field while no one is buried. (Which specific
  // innings each sits, plus the no-3-in-a-row spreading and all catcher safety,
  // is handled by the shared scheduling pass below — unchanged.)
  if (competitive) {
    const cap = Math.max(1, Math.floor(totalInnings / 2));
    for (const x of playerDeltas) targetSits.set(x.p.id, 0);
    const weakestFirst = [...playerDeltas].sort(
      (a, b) => a.defScore - b.defScore || a.rand - b.rand,
    );
    let remaining = totalBenchSlots;
    for (const x of weakestFirst) {
      if (remaining <= 0) break;
      const give = Math.min(cap, remaining);
      targetSits.set(x.p.id, give);
      remaining -= give;
    }
    // Pathological rosters (huge bench) where everyone hit the cap: spread the
    // remainder round-robin so the totals still reconcile.
    let guard = 0;
    while (remaining > 0 && guard < 1000) {
      for (const x of weakestFirst) {
        if (remaining <= 0) break;
        targetSits.set(x.p.id, targetSits.get(x.p.id) + 1);
        remaining--;
      }
      guard++;
    }
  }

  // ANCHOR GUARD: a kid who is the only present player cleared for some
  // position can never be benched — whatever inning they'd sit, that position
  // has no candidate and the whole attempt fails (this was the "No eligible
  // player for SS in inning N" hard failure on rosters with one SS kid).
  // Zero their target and push the freed sits onto non-anchor kids with the
  // lowest targets (competitive: weakest first), provided someone can take
  // them. Runs after BOTH the fairness and competitive distributions.
  if (anchorIds.size > 0 && anchorIds.size < N) {
    const nonAnchors = playerDeltas.filter((x) => !anchorIds.has(x.p.id));
    let freed = 0;
    for (const id of anchorIds) {
      const t = targetSits.get(id) || 0;
      if (t > 0) {
        freed += t;
        targetSits.set(id, 0);
      }
    }
    // Each kid can physically sit at most every other inning (no back-to-back
    // benches), so cap re-assignments there.
    const sitCeiling = Math.ceil(totalInnings / 2);
    let guard = 0;
    while (freed > 0 && guard < 1000) {
      guard++;
      // Lowest current target takes the next sit; competitive prefers the
      // weakest defender among ties, fairness the most over-played.
      let best: (typeof nonAnchors)[number] | null = null;
      for (const x of nonAnchors) {
        const t = targetSits.get(x.p.id) || 0;
        if (t >= sitCeiling) continue;
        if (
          !best ||
          t < (targetSits.get(best.p.id) || 0) ||
          (t === (targetSits.get(best.p.id) || 0) &&
            (competitive ? x.defScore < best.defScore : x.delta > best.delta))
        ) {
          best = x;
        }
      }
      if (!best) break; // nobody can absorb more — scheduler will flag infeasible
      targetSits.set(best.p.id, (targetSits.get(best.p.id) || 0) + 1);
      freed--;
    }
  }

  // Sanity: total targets should equal totalBenchSlots
  // (transfers preserve the total, but verify in case of bugs)
  let sumTargets = 0;
  for (const t of targetSits.values()) sumTargets += t;
  if (sumTargets !== totalBenchSlots && anchorIds.size === 0) {
    // Fallback: reset to baseline (minSits with extras to over played first).
    // Skipped when anchors exist — the reset would re-seat a kid who must
    // never sit; a small shortfall is instead absorbed by the overflow path
    // in Step 3 (which excludes anchors).
    targetSits.clear();
    for (const x of playerDeltas) targetSits.set(x.p.id, minSits);
    for (let i = 0; i < extraSittersNeeded; i++) {
      targetSits.set(
        playerDeltas[i].p.id,
        targetSits.get(playerDeltas[i].p.id) + 1,
      );
    }
  }

  // Build sortedForExtra in the legacy shape (downstream catcher logic uses it)
  const sortedForExtra = playerDeltas.map((x) => ({
    p: x.p,
    prior: priorExtraSits.get(x.p.id)?.extraSits || 0,
    defScore: x.defScore,
    rand: x.rand,
  }));

  // ============================================================
  // Step 2: pre pick catchers (consecutive-catcher continuity).
  // Each contiguous block of innings (e.g. (0,1) for the back-to-back cap
  // of 2, or (0,1,2) for a cap of 3) needs a single kid who plays all of
  // them. They cannot be on bench in those innings. We pick catcher kids
  // whose target sit count is LOW (so we use up the must play kids first as
  // catchers). When the coach set an explicit cap, `enforceCatcherCap` is
  // true and no kid may catch more total innings than the cap; under "auto"
  // it's false, preserving the legacy lenient reuse for short-staffed teams.
  // ============================================================
  const catcherByInning = new Map();
  // innings each kid is already committed to catch — drives the hard cap.
  const catcherInnTotals = new Map();
  const offFieldByInning = new Array(totalInnings)
    .fill(null)
    .map(() => new Set());

  if (catcherInningBlocks && catcherInningBlocks.length > 0) {
    // Eligible catcher pool. Coaches who don't want a particular kid catching
    // use the explicit C restriction — primary-infield kids are not
    // auto-excluded (real rosters have catchers whose primary is 2B/SS/3B).
    const eligiblePool = sortedForExtra
      // Only players cleared for catcher ("C" in comfortablePositions).
      .filter(({ p }) => isCatcherEligible(p))
      .sort((a, b) => {
        // Tier 1 wins over tier 2: kids whose primary position is catcher
        // are picked first.
        const aPrimary = a.p.primaryPosition === "C" ? 0 : 1;
        const bPrimary = b.p.primaryPosition === "C" ? 0 : 1;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;

        // Prefer catchers who are NOT scarce elsewhere — reserving a kid who's
        // one of the few options for (say) 1B at C can strand that position.
        // Only acts on a meaningful gap so it doesn't churn near-equal kids.
        const da = scarcityDrain(a.p);
        const db = scarcityDrain(b.p);
        if (Math.abs(da - db) > 0.15) return da - db;

        // Prefer kids with LOW target sit (they need to play more)
        const ta = targetSits.get(a.p.id);
        const tb = targetSits.get(b.p.id);
        if (ta !== tb) return ta - tb;

        // Then prefer higher catcher skill if available (defensive score)
        if (a.defScore !== b.defScore) return b.defScore - a.defScore;
        return a.rand - b.rand;
      });

    for (let bi = 0; bi < catcherInningBlocks.length; bi++) {
      const block = catcherInningBlocks[bi];
      const blockSize = block.length;
      const involvesInning0 = block.includes(0);

      const isAvailable = (p: ProfiledPlayer) => {
        if (involvesInning0) {
          const lockedPos = firstInningLockedPos.get(p.id);
          // If you forced them to play a specific spot that IS NOT catcher in
          // the 1st inning, they can't be the catcher for a block covering it.
          if (lockedPos && lockedPos !== "C") return false;
        }
        // Enough remaining play budget to be on the field every inning of the
        // block (i.e. not benched so much they can't cover it).
        if ((targetSits.get(p.id) || 0) > totalInnings - blockSize) {
          return false;
        }
        // Hard cap: never let a single kid catch more than `catcherCap`
        // innings (only enforced for explicit settings).
        if (
          enforceCatcherCap &&
          Number.isFinite(catcherCap) &&
          (catcherInnTotals.get(p.id) || 0) + blockSize > catcherCap
        ) {
          return false;
        }
        return true;
      };

      const unused = (p: ProfiledPlayer) =>
        (catcherInnTotals.get(p.id) || 0) === 0;

      // 1. Unused primary catcher, then 2. unused secondary catcher — always
      // prefer spreading the work across distinct kids first. Kids who are the
      // ONLY option for a field position are skipped here (reserving them at C
      // strands that position) and only considered as a last resort.
      const free = ({ p }: { p: ProfiledPlayer }) => !anchorNonC.has(p.id);
      let candidate =
        eligiblePool.find(
          (x) =>
            free(x) &&
            x.p.primaryPosition === "C" &&
            unused(x.p) &&
            isAvailable(x.p),
        ) ||
        eligiblePool.find((x) => free(x) && unused(x.p) && isAvailable(x.p)) ||
        eligiblePool.find(
          ({ p }) => p.primaryPosition === "C" && unused(p) && isAvailable(p),
        ) ||
        eligiblePool.find(({ p }) => unused(p) && isAvailable(p));

      // 3. Reuse — only when the cap isn't being hard-enforced (legacy "auto"
      // behavior for short-staffed teams). Prefer reusing a primary catcher.
      if (!candidate && !enforceCatcherCap) {
        candidate =
          eligiblePool.find(
            (x) => free(x) && x.p.primaryPosition === "C" && isAvailable(x.p),
          ) ||
          eligiblePool.find((x) => free(x) && isAvailable(x.p)) ||
          eligiblePool.find(
            ({ p }) => p.primaryPosition === "C" && isAvailable(p),
          ) ||
          eligiblePool.find(({ p }) => isAvailable(p));
      }

      if (!candidate) {
        // Infeasible: not enough catcher-eligible kids (under the cap) to
        // cover this block. Caller restarts the attempt / surfaces an error.
        return null;
      }

      const id = candidate.p.id;
      catcherInnTotals.set(id, (catcherInnTotals.get(id) || 0) + blockSize);
      for (const inn of block) {
        catcherByInning.set(inn, id);
        offFieldByInning[inn].add(id);
      }
    }
  }

  // ============================================================
  // Step 3: distribute each kid's bench innings across the game.
  // We use a greedy round robin: at each inning, pick from kids with
  // (a) remaining bench debt, (b) eligible for this inning.
  // Tiebreaker: prefer kids with higher remaining debt; then top half
  // pairing (avoid two top half on bench together); then random.
  // ============================================================
  const remaining = new Map();
  for (const [pid, target] of targetSits) remaining.set(pid, target);

  const schedule = new Map();
  for (const p of profiled) schedule.set(p.id, new Set());

  // Position-coverage guard: benching `pid` in `inn` must not leave the
  // remaining on-field set unable to JOINTLY cover every position. The old
  // guard checked each position independently and so missed the joint case —
  // two kids who are the only SS *and* the only 1B options: benching one kept
  // "an SS option" and "a 1B option" alive (the same surviving kid), but that
  // kid can't play both, so SS stranded at fill. We verify a full matching
  // exists instead. The pinned catcher (consecutive-block continuity) is
  // pre-assigned to C and removed from the pool.
  const inningMatchable = (
    benchedThisInn: Set<string>,
    inn: number,
  ): boolean => {
    const catcherId = catcherByInning.get(inn);
    const pool: string[] = [];
    for (const p of profiled) {
      if (benchedThisInn.has(p.id)) continue;
      if (catcherId && p.id === catcherId) continue; // committed to C
      pool.push(p.id);
    }
    // Only guard positions that ARE coverable by someone. A position with zero
    // eligible players is a genuine roster gap — let the fill loop surface its
    // specific "no eligible player for X" message rather than masking it as a
    // generic bench-schedule failure here.
    const positions = (positionsToFill || []).filter(
      (pos: string) =>
        !(catcherId && pos === "C") && (posEligibleIds.get(pos)?.size || 0) > 0,
    );
    const matched = maxPositionMatching(
      positions,
      pool,
      (pos, pid) => !!posEligibleIds.get(pos)?.has(pid),
    );
    return matched.size === positions.length;
  };
  // Fast per-candidate guard: benching `pid` must not drop any single position
  // to zero available players (the sole-eligible case). The subtler JOINT case
  // (a few kids who are the only options for several positions) is caught once
  // per inning by the matching-based repair below — running the full matching
  // per candidate here was too slow.
  const wouldStrand = (pid: string, inn: number): boolean => {
    const catcherId = catcherByInning.get(inn);
    for (const [pos, ids] of posEligibleIds) {
      if (!ids.has(pid)) continue;
      let others = 0;
      for (const qid of ids) {
        if (qid === pid) continue;
        if (schedule.get(qid)?.has(inn)) continue;
        if (pos !== "C" && qid === catcherId) continue;
        others++;
        break;
      }
      if (others === 0) return true;
    }
    return false;
  };

  // forcedBenchInning0: kids who must sit in inning 0 (e.g., because
  // they're not in firstInningOverridesById and can't fit otherwise).
  // We honor this by pre assigning them.
  if (forcedBenchInning0) {
    for (const pid of forcedBenchInning0) {
      if (offFieldByInning[0].has(pid)) {
        return null; // can't both catch and sit
      }
      schedule.get(pid).add(0);
      remaining.set(pid, Math.max(0, (remaining.get(pid) || 0) - 1));
    }
  }

  for (let inn = 0; inn < totalInnings; inn++) {
    const slotsThisInning = numToBench;
    const alreadyBenched = new Set<string>();
    for (const pid of schedule.keys()) {
      if (schedule.get(pid).has(inn)) alreadyBenched.add(pid);
    }
    const remainingSlots = slotsThisInning - alreadyBenched.size;
    if (remainingSlots <= 0) continue;

    // Build eligible list for this inning:
    //  has remaining debt
    //  not already benched this inning
    //  not catching this inning
    //  did NOT sit the previous inning (no back to back benches)
    const eligible = [];
    for (const p of profiled) {
      if (alreadyBenched.has(p.id)) continue;
      if (offFieldByInning[inn].has(p.id)) continue;
      // 1st Inning Override safety: Do not bench a kid if the user explicitly forced them into a position in Inning 0
      if (inn === 0 && firstInningMustPlay.has(p.id)) continue;
      // Hard rule: no kid sits two innings in a row.
      if (inn > 0 && schedule.get(p.id).has(inn - 1)) continue;
      // Never bench the last available player for any position.
      if (wouldStrand(p.id, inn)) continue;

      const debt = remaining.get(p.id) || 0;
      if (debt <= 0) continue;
      const hist = priorExtraSits.get(p.id);
      const totalPrior = (hist?.benchInn || 0) + (hist?.defInn || 0);
      // Season ratio: lower means under sat across the season.
      // No history  0.5 (neutral).
      const priorRatio = totalPrior > 0 ? hist!.benchInn / totalPrior : 0.5;
      eligible.push({
        p,
        debt,
        priorRatio,
        // Raw defensive innings played this season  used as a finer grained
        // tiebreaker. Higher defInn = played more = should sit earlier.
        defInn: hist?.defInn || 0,
        priorExtra: priorExtraSits.get(p.id)?.extraSits || 0,
        firstHx: firstInningBenchHx.get(p.id) || 0,
        defScore: p.profile.defensiveScore,
        rand: rand(),
      });
    }

    if (eligible.length < remainingSlots) {
      // Not enough kids with remaining debt to fill this inning's bench.
      // This happens when offFieldByInning constraints over block.
      // Allow kids who have target=minSits AND have already used their
      // minSits to take an extra "overflow" sit by raising their target.
      // (Rare edge case.)
      const overflow = profiled.filter(
        (p: ProfiledPlayer) =>
          !alreadyBenched.has(p.id) &&
          !offFieldByInning[inn].has(p.id) &&
          !(inn === 0 && firstInningMustPlay.has(p.id)) &&
          // No back to back: skip kids who sat the previous inning
          !(inn > 0 && schedule.get(p.id).has(inn - 1)) &&
          // Never bench the last available player for any position.
          !wouldStrand(p.id, inn) &&
          (remaining.get(p.id) || 0) === 0,
      );
      for (const p of overflow) {
        if (eligible.length >= remainingSlots) break;
        const hist = priorExtraSits.get(p.id);
        const totalPrior = (hist?.benchInn || 0) + (hist?.defInn || 0);
        const priorRatio = totalPrior > 0 ? hist!.benchInn / totalPrior : 0.5;
        eligible.push({
          p,
          debt: 1,
          priorRatio,
          defInn: hist?.defInn || 0,
          priorExtra: (priorExtraSits.get(p.id)?.extraSits || 0) + 100, // discourage
          firstHx: firstInningBenchHx.get(p.id) || 0,
          defScore: p.profile.defensiveScore,
          rand: rand(),
        });
        remaining.set(p.id, 1); // they now have 1 to use
      }
      if (eligible.length < remainingSlots) {
        return null; // infeasible
      }
    }

    // Sort eligible:
    //   1. Higher debt first (kids who must sit somewhere this game)
    //   2. Lower season bench ratio (over played kids sit FIRST, naturally
    //     pushing under played kids to the late innings  which may not even
    //     happen due to mercy rules / time limits, helping them catch up)
    //   3. HIGHER defInn first (more raw defensive innings played  sit first.
    //     This is a finer grained tiebreaker for kids with similar ratios.)
    //   4. Lower priorExtra (haven't been the "extra sitter" historically)
    //   5. Inning 0 only: lower firstInningBenchHx (haven't started on bench)
    //   6. Lower defensive score (better defenders stay on field when fair)
    //   7. Random tiebreaker
    eligible.sort((a, b) => {
      if (a.debt !== b.debt) return b.debt - a.debt;
      // Use raw priorRatio (not rounded) so subtle differences differentiate
      // kids who'd otherwise tie. Lower ratio = more played = sit earlier.
      if (a.priorRatio !== b.priorRatio) return a.priorRatio - b.priorRatio;
      // Higher defInn = more played = bench earlier
      if (a.defInn !== b.defInn) return b.defInn - a.defInn;
      if (a.priorExtra !== b.priorExtra) return a.priorExtra - b.priorExtra;
      if (inn === 0 && a.firstHx !== b.firstHx) return a.firstHx - b.firstHx;
      if (a.defScore !== b.defScore) return a.defScore - b.defScore;
      return a.rand - b.rand;
    });

    // Pick with top half pairing constraint:
    // Prefer not to put 2 top half defenders on the bench in one inning,
    // BUT don't override seasonal fairness  if the next eligible kid by
    // fairness is top half but they'd be the 2nd top half on bench, only
    // skip them in favor of a kid with similar fairness ranking. If the
    // alternative would be a notably under played kid (much higher
    // priorRatio), respect fairness instead.
    let benchedThisInning = 0;
    let topHalfCount = 0;
    for (const id of alreadyBenched) if (topHalfIds.has(id)) topHalfCount++;

    // First pass: respect top half cap of 1 per inning, BUT only skip a
    // top half kid if the next kid in line has similar (within 0.05)
    // priorRatio. Otherwise the fairness gap is more important.
    for (let i = 0; i < eligible.length; i++) {
      const e = eligible[i];
      if (benchedThisInning >= remainingSlots) break;
      // Re-check at pick time: benching earlier kids this inning can make
      // this one the last available player for a position.
      if (wouldStrand(e.p.id, inn)) continue;
      if (topHalfIds.has(e.p.id) && topHalfCount >= 1) {
        // Only skip if the next un benched kid in line is within fairness
        // tolerance (so we're not punishing an under played kid)
        let nextKidRatio = null;
        for (let j = i + 1; j < eligible.length; j++) {
          if (schedule.get(eligible[j].p.id).has(inn)) continue;
          nextKidRatio = eligible[j].priorRatio;
          break;
        }
        if (nextKidRatio !== null && nextKidRatio - e.priorRatio <= 0.05) {
          continue; // safe to skip  alternative is similarly fair
        }
        // Otherwise: take the top half kid even though we'd prefer not to,
        // because the alternative is notably more under played.
      }
      schedule.get(e.p.id).add(inn);
      remaining.set(e.p.id, (remaining.get(e.p.id) || 0) - 1);
      if (topHalfIds.has(e.p.id)) topHalfCount++;
      benchedThisInning++;
    }
    // Second pass: relax pairing constraint if we couldn't fill. Position
    // coverage is never relaxed — a full bench that strands SS is still a
    // failed lineup.
    if (benchedThisInning < remainingSlots) {
      for (const e of eligible) {
        if (benchedThisInning >= remainingSlots) break;
        if (schedule.get(e.p.id).has(inn)) continue;
        if (wouldStrand(e.p.id, inn)) continue;
        schedule.get(e.p.id).add(inn);
        remaining.set(e.p.id, (remaining.get(e.p.id) || 0) - 1);
        benchedThisInning++;
      }
    }
    if (benchedThisInning < remainingSlots) return null;

    // JOINT-coverage repair: the cheap per-position guard can still leave an
    // inning where a few kids are jointly the only options for several spots
    // (e.g. the only SS AND only 1B — benching one strands the other). Verify a
    // full matching of the on-field set to all positions exists; if not, swap a
    // benched kid back ON for an on-field kid until it does, preserving the
    // catcher pin, no-back-to-back, inning-0 must-plays, and the bench count.
    let benchedThisInn = new Set<string>();
    for (const q of schedule.keys())
      if (schedule.get(q).has(inn)) benchedThisInn.add(q);
    if (!inningMatchable(benchedThisInn, inn)) {
      const catcherId = catcherByInning.get(inn);
      let repaired = false;
      for (const b of [...benchedThisInn]) {
        if (inn === 0 && forcedBenchInning0 && forcedBenchInning0.has(b))
          continue;
        for (const o of profiled) {
          if (benchedThisInn.has(o.id) || o.id === b) continue;
          if (o.id === catcherId) continue; // catcher must stay on
          if (offFieldByInning[inn].has(o.id)) continue;
          if (inn === 0 && firstInningMustPlay.has(o.id)) continue;
          if (inn > 0 && schedule.get(o.id).has(inn - 1)) continue; // no back-to-back
          const trial = new Set(benchedThisInn);
          trial.delete(b);
          trial.add(o.id);
          if (inningMatchable(trial, inn)) {
            schedule.get(b).delete(inn);
            schedule.get(o.id).add(inn);
            remaining.set(b, (remaining.get(b) || 0) + 1);
            remaining.set(o.id, (remaining.get(o.id) || 0) - 1);
            benchedThisInn = trial;
            repaired = true;
            break;
          }
        }
        if (repaired) break;
      }
      if (!repaired) return null; // genuinely uncoverable inning
    }
  }

  // Sanity check: every inning must have exactly numToBench benched
  for (let inn = 0; inn < totalInnings; inn++) {
    let count = 0;
    for (const pid of schedule.keys()) {
      if (schedule.get(pid).has(inn)) count++;
    }
    if (count !== numToBench) return null;
  }

  return { schedule, catcherByInning };
}

function tryBuildLineup(ctx: TryBuildCtx):
  | {
      ok: true;
      lineup: Inning[];
      penalty: number;
      lockRelaxedInnings: number[];
    }
  | { ok: false; failure: { type: string; [key: string]: unknown } }
  | null {
  const {
    profiled,
    positionsToFill,
    numToBench,
    totalInnings,
    isStarter,
    firstInningOverridesById,
    positionHistory,
    firstInningBenchHx,
    benchHistory,
    headGrades,
    defenseSize,
    positionLock,
    leagueRuleSet,
    teamAge,
    targetDateStr,
    leftyPenalty,
    isBigGame,
    competitive,
    pitcherPoolIds,
    depthChartRank,
    chartedPlayerIds,
    isKidPitch,
    pitchRules = DEFAULT_PITCH_RULE_SET,
    sameDayRoles = { pitched: new Set(), caught: new Set() },
    catcherPolicy,
    rand,
    fromInning = 0,
    currentLineup = null,
  } = ctx;

  // Resolved catcher playing-time policy. Defaulted defensively so any caller
  // that predates the setting still gets the legacy behavior.
  const {
    cap: catcherCap,
    consecutive: catcherConsecutive,
    enforceCap: enforceCatcherCap,
  } = catcherPolicy ||
  resolveCatcherPolicy(undefined, undefined, defenseSize, profiled.length);

  // Hoist age derived constants used by pickBestForPosition out of the
  // per call hot path (they don't change inning to inning).
  // 8U and below = no real pitcher (machine pitch), catcher matters less
  // since there are no strikes/passed balls  spine is 1B/SS/3B.
  // 9U+ = pitcher matters a lot, so spine is P/SS/3B/C/1B.
  const teamAgeNum = (() => {
    if (!teamAge) return 99;
    const m = String(teamAge).match(/(\d+)/g);
    if (!m) return 99;
    return parseInt(m[m.length - 1], 10);
  })();
  const PREMIUM_POSITIONS =
    teamAgeNum <= 8
      ? new Set(["1B", "SS", "3B"])
      : new Set(["P", "SS", "3B", "C", "1B"]);

  // Per-player positional flexibility: how many of THIS game's positions a
  // kid is actually eligible to field (catcher counts only when the kid is
  // cleared for C). Drives the scarcity-reservation nudge in
  // pickBestForPosition so a kid who can play few spots gets seated at one of
  // them before a do-anything kid is parked there, leaving the flexible kid to
  // plug the remaining holes. Computed once — it doesn't change inning to
  // inning.
  const positionFlexibility = new Map();
  for (const p of profiled) {
    let n = 0;
    for (const pos of positionsToFill) {
      if (pos === "C") {
        if (isCatcherEligible(p)) n++;
        continue;
      }
      if (!isPositionBlocked(p, pos)) n++;
    }
    positionFlexibility.set(p.id, n);
  }

  const state = new Map<string, PlayerState>();
  for (const p of profiled) {
    state.set(p.id, { bench: 0, positions: Object.create(null), history: [] });
  }

  // Compute top half defender set (used by the schedule's pairing rule)
  const sortedByDefense = [...profiled].sort(
    (a, b) => b.profile.defensiveScore - a.profile.defensiveScore,
  );
  const topHalfCount = Math.ceil(profiled.length / 2);
  const topHalfIds = new Set(
    sortedByDefense.slice(0, topHalfCount).map((p) => p.id),
  );

  // Catcher continuity ("back-to-back"). When the policy is consecutive we
  // tile the game into contiguous blocks of `catcherCap` innings and give
  // each block a single catcher — e.g. cap 2 → (0,1)(2,3)(4,5), cap 3 →
  // (0,1,2)(3,4,5). The legacy 10-fielder behavior is exactly cap 2. When the
  // policy is NOT consecutive (legacy 9-fielder, or an explicit cap with the
  // toggle off) there are no blocks and the catcher is picked fresh each
  // inning by pickBestForPosition under the per-kid cap.
  let catcherInningBlocks: CatcherBlock[] | null = null;
  if (catcherConsecutive && Number.isFinite(catcherCap) && catcherCap >= 1) {
    catcherInningBlocks = [];
    const blockSize = Math.max(1, Math.min(catcherCap, totalInnings));
    for (let i = 0; i < totalInnings; i += blockSize) {
      const block = [];
      for (let j = i; j < Math.min(i + blockSize, totalInnings); j++) {
        block.push(j);
      }
      catcherInningBlocks.push(block);
    }
  }

  // Non starters (when batting fewer than roster) must start on the bench.
  const forcedBenchInning0 = new Set<string>();
  if (isStarter.size > 0 && isStarter.size < profiled.length) {
    for (const p of profiled) {
      if (!isStarter.has(p.id)) forcedBenchInning0.add(p.id);
    }
  }

  // Pre compute bench schedule (math optimal distribution)
  const sched = precomputeBenchSchedule({
    profiled,
    totalInnings,
    numToBench,
    competitive: ctx.competitive,
    priorExtraSits: benchHistory,
    firstInningBenchHx,
    topHalfIds,
    catcherInningBlocks,
    catcherCap,
    enforceCatcherCap,
    positionsToFill,
    rand,
    forcedBenchInning0,
    firstInningOverridesById, // Safe-guards our overrides so we don't bench them
  });
  if (!sched)
    return { ok: false, failure: { type: "bench-schedule-impossible" } };
  const { schedule: benchSchedule, catcherByInning } = sched;

  const lineup: any[] = [];
  // Innings (1-based) where the rotation lock was relaxed to avoid stranding
  // a scarce position. Surfaced so the UI can note it instead of failing.
  const lockRelaxedInnings = [];

  // Mid-game rebuild seed: when `fromInning > 0` and `currentLineup` is
  // provided, replay the already-played innings into our per-player state
  // (catcher cap / position history / bench tally) and push their slot maps
  // verbatim into `lineup`, so the main fill loop below only has to fill
  // the remaining innings while still respecting carry-over rules.
  const mgFromInning =
    fromInning > 0 && Array.isArray(currentLineup) && currentLineup.length > 0
      ? Math.min(fromInning, currentLineup.length, totalInnings)
      : 0;
  for (let inn = 0; inn < mgFromInning; inn++) {
    const playedInn = currentLineup![inn] || {};
    const seeded: any = {};
    for (const key of Object.keys(playedInn)) {
      if (key === "BENCH") continue;
      const player = playedInn[key] as SlimPlayer | undefined;
      if (!player || Array.isArray(player)) continue;
      seeded[key] = player;
      const st = state.get(player.id)!;
      if (st) {
        st.positions[key] = (st.positions[key] || 0) + 1;
        st.history.push(key);
      }
    }
    const benchArr = Array.isArray(playedInn.BENCH) ? playedInn.BENCH : [];
    const benchOut: any[] = [];
    for (const p of benchArr) {
      if (!p) continue;
      const st = state.get(p.id)!;
      if (st) {
        st.bench++;
        st.history.push("BENCH");
        benchOut.push(p);
      }
    }
    seeded.BENCH = benchOut;
    lineup.push(seeded);
  }

  for (let inn = mgFromInning; inn < totalInnings; inn++) {
    const isLockInning =
      (positionLock === "2" && inn % 2 !== 0) ||
      (positionLock === "3" && inn % 3 !== 0) ||
      (positionLock === "full" && inn > 0);

    const benchedSet = new Set();

    // Bench assignment: read directly from the precomputed schedule.
    for (const p of profiled) {
      if (benchSchedule.get(p.id)?.has(inn)) {
        benchedSet.add(p.id);
      }
    }

    if (benchedSet.size !== numToBench)
      return {
        ok: false,
        failure: {
          type: "bench-schedule-mismatch",
          inning: inn + 1,
          expected: numToBench,
          actual: benchedSet.size,
        },
      };

    // Build this inning's defensive alignment. `useLock` controls whether
    // players are carried over from the previous inning at a rotation-lock
    // inning. The rotation lock is a PREFERENCE, not a physical constraint:
    // honoring it can freeze the only eligible kids for a scarce position
    // (e.g. 1B) into other slots and leave that position unfillable. So if a
    // locked build strands a position, we retry the inning with the lock
    // relaxed rather than fail the whole lineup (which would otherwise drop
    // season fairness entirely). Per-player state (positions/history/bench)
    // is mutated only AFTER a slot set is committed below, so building twice
    // here is side-effect free.
    const buildSlots = (useLock: any) => {
      const inningSlots: Record<string, any> = {};
      if (inn === 0) {
        for (const pos in firstInningOverridesById) {
          const pid = firstInningOverridesById[pos];
          const player = profiled.find((p: any) => p.id === pid);
          if (!player || !positionsToFill.includes(pos)) continue;
          if (benchedSet.has(pid))
            return {
              ok: false,
              failure: {
                type: "first-inning-override-benched",
                playerName: player.name,
                position: pos,
              },
            };
          if (isPositionBlocked(player, pos)) continue;
          // Catcher is opt-in only: never honor a first-inning override that
          // would seat a non-cleared kid at C.
          if (pos === "C" && !isCatcherEligible(player)) continue;
          inningSlots[pos] = player;
        }
      }

      const used = new Set(Object.values(inningSlots).map((p) => p.id));
      const remainingPositions = positionsToFill.filter(
        (pos: any) => !inningSlots[pos],
      );

      // Consecutive-catcher mode: catcher is fixed by the precomputed schedule
      // (one catcher per contiguous block of innings).
      if (catcherInningBlocks && !inningSlots["C"]) {
        const catcherId = catcherByInning.get(inn);
        if (catcherId) {
          const catcher = profiled.find((p: any) => p.id === catcherId);
          if (
            catcher &&
            !benchedSet.has(catcherId) &&
            !used.has(catcherId) &&
            isCatcherEligible(catcher) &&
            // Same-day dual-role (Kid Pitch): don't catch a kid who pitched.
            !(
              isKidPitch &&
              dualRoleBlocked(
                state.get(catcherId),
                "C",
                catcherId,
                sameDayRoles,
              )
            )
          ) {
            inningSlots["C"] = catcher;
            used.add(catcherId);
            const idx = remainingPositions.indexOf("C");
            if (idx !== -1) remainingPositions.splice(idx, 1);
          }
        }
      }

      // PRIMARY POSITION PRE PIN: kids you marked with a primaryPosition get
      // their slot before any other assignment runs. Without this, the random
      // position shuffle could fill RF first and pick a strong 3B primary kid
      // for RF before 3B is ever scored — the minus 10000 nudge inside
      // pickBestForPosition only fires when THAT exact position is being
      // scored, so processing order matters.
      //
      // Big Game: pre pin every inning (matches the "primary kid plays
      // primary all game" behavior in pickBestForPosition). MUST run before
      // lock inning carry over so a kid bumped off their primary last inning
      // gets it back, instead of being locked into the wrong spot.
      //
      // Fair mode: pre pin disabled entirely. The coach's explicit ask is
      // that in fair mode, kids rotate through every comfortablePositions
      // slot they're allowed to play — no privileged primary position. The
      // -2 tiebreaker inside pickBestForPosition keeps a feather-light
      // preference for ties, but rotation pressure / jitter / skill match
      // dominate the cost function.
      //
      // Sort by defensive score so when two kids share a primaryPosition,
      // the better defender wins it; the runner up is unconstrained.
      if (isBigGame) {
        const sortedByDef = [...profiled].sort(
          (a, b) => b.profile.defensiveScore - a.profile.defensiveScore,
        );
        for (const p of sortedByDef) {
          const pos = p.primaryPosition;
          if (!pos) continue;
          if (!remainingPositions.includes(pos)) continue;
          if (benchedSet.has(p.id)) continue;
          if (used.has(p.id)) continue;
          if (isPositionBlocked(p, pos)) continue;
          // Mirror pickBestForPosition's per position eligibility checks so we
          // don't pre pin into an illegal slot.
          const st = state.get(p.id)!;
          // Same-day dual-role (Kid Pitch): never pre-pin into P+C same game.
          if (isKidPitch && dualRoleBlocked(st, pos, p.id, sameDayRoles))
            continue;
          if (pos === "C") {
            if (!isCatcherEligible(p)) continue;
            if (
              Number.isFinite(catcherCap) &&
              (st.positions["C"] || 0) >= catcherCap
            )
              continue;
          }
          if (pos === "P" && defenseSize === "9") {
            if (
              leagueRuleSet === "NKB" &&
              !checkPitchEligibility(
                p,
                targetDateStr,
                teamAge ?? "",
                pitchRules,
              )
            )
              continue;
            const pCount = st.positions["P"] || 0;
            const playedHereLast = inn > 0 && st.history[inn - 1] === pos;
            if (inn > 0 && pCount > 0 && !playedHereLast) continue;
          }
          inningSlots[pos] = p;
          used.add(p.id);
          const idx = remainingPositions.indexOf(pos);
          if (idx !== -1) remainingPositions.splice(idx, 1);
        }
      }

      // LOCK INNING: a player who held a position last inning and is still on
      // the field should keep that position. Fills any slot the primary
      // pre pin pass above didn't claim  pre pin wins ties so a
      // primary position kid bumped off their primary last inning gets it
      // back here, even in lock inning + Big Game mode.
      if (useLock && inn > 0) {
        const prevInning = lineup[inn - 1];
        // Collect (pos, player) pairs from last inning where the player is still
        // available and the position still needs filling.
        for (const pos of [...remainingPositions]) {
          const prevPlayer = prevInning?.[pos];
          if (!prevPlayer) continue;
          if (benchedSet.has(prevPlayer.id)) continue; // they're sitting now
          if (used.has(prevPlayer.id)) continue; // already placed
          if (isPositionBlocked(prevPlayer, pos)) continue;
          // Never carry a non-cleared kid into the catcher slot, and never
          // carry them past the catcher inning cap — otherwise a position
          // lock chains the same kid behind the plate inning after inning
          // (in non-consecutive / auto modes C is still in remainingPositions
          // when this runs). Mirror pickBestForPosition's cap, including its
          // auto-mode default, so the slot falls through to a fair rotation.
          if (pos === "C") {
            if (!isCatcherEligible(prevPlayer)) continue;
            const cCap = Number.isFinite(catcherCap)
              ? catcherCap
              : defenseSize === "10"
                ? 2
                : 3;
            if ((state.get(prevPlayer.id)?.positions["C"] || 0) >= cCap)
              continue;
          }
          // Pitcher carry over rule for 9 fielder games is handled in pickBest;
          // for lock innings we trust the prior assignment.
          inningSlots[pos] = prevPlayer;
          used.add(prevPlayer.id);
          const idx = remainingPositions.indexOf(pos);
          if (idx !== -1) remainingPositions.splice(idx, 1);
        }
      }

      // Instead of pure random shuffle, fill the hardest positions first.
      // A position is "hard" if very few unassigned, unbenched kids are
      // eligible to play it. Mirrors EVERY hard filter from
      // pickBestForPosition so the count reflects reality — otherwise the
      // engine cheerfully fills the easy positions first and gets stuck
      // with no candidate for (say) RF at inning 3 because the OF rotation
      // lock or "can't play same spot back-to-back" rule eliminated every
      // remaining kid.
      const posScarcity = remainingPositions.map((pos: any) => {
        let count = 0;
        for (const p of profiled) {
          if (used.has(p.id) || benchedSet.has(p.id)) continue;
          if (isPositionBlocked(p, pos)) continue;

          const st = state.get(p.id)!;
          const playedHereLast = inn > 0 && st.history[inn - 1] === pos;

          if (isKidPitch && dualRoleBlocked(st, pos, p.id, sameDayRoles))
            continue;
          if (pos === "P" && defenseSize === "9") {
            if (
              leagueRuleSet === "NKB" &&
              !checkPitchEligibility(
                p,
                targetDateStr,
                teamAge ?? "",
                pitchRules,
              )
            )
              continue;
            const pCount = st.positions["P"] || 0;
            if (inn > 0 && pCount > 0 && !playedHereLast) continue;
          }
          if (pos === "C") {
            if (!isCatcherEligible(p)) continue;
            if (
              Number.isFinite(catcherCap) &&
              (st.positions["C"] || 0) >= catcherCap
            )
              continue;
          }

          // Same-position back-to-back AND the OF 2-inning rotation lock
          // are now soft score penalties inside pickBestForPosition rather
          // than hard exclusions (see comment there). So they're still
          // eligible for counting here — just disfavored.

          count++;
        }
        return { pos, count, r: rand() };
      });

      // Sort by fewest eligible candidates first. Tie-breaker is random.
      posScarcity.sort((a: any, b: any) => {
        if (a.count !== b.count) return a.count - b.count;
        return a.r - b.r;
      });

      remainingPositions.length = 0;
      for (const item of posScarcity) {
        remainingPositions.push(item.pos);
      }

      for (const pos of remainingPositions) {
        const candidate = pickBestForPosition({
          pos,
          inn,
          profiled,
          used,
          benchedSet,
          state,
          positionHistory,
          headGrades,
          defenseSize,
          positionLock,
          leagueRuleSet,
          teamAge,
          targetDateStr,
          leftyPenalty,
          isLockInning: useLock,
          isBigGame,
          competitive,
          pitcherPoolIds,
          depthChartRank,
          chartedPlayerIds,
          isKidPitch,
          pitchRules,
          sameDayRoles,
          catcherCap,
          rand,
          premiumPositions: PREMIUM_POSITIONS,
          positionFlexibility,
        });
        if (!candidate) {
          return {
            ok: false,
            failure: {
              type: "no-candidate-for-position",
              position: pos,
              inning: inn + 1,
            },
          };
        }
        inningSlots[pos] = candidate;
        used.add(candidate.id);
      }
      return { ok: true, inningSlots };
    };

    // Try honoring the rotation lock first; if it strands a position, retry
    // this inning with the lock relaxed before giving up.
    let built = buildSlots(isLockInning);
    if (
      !built.ok &&
      isLockInning &&
      inn > 0 &&
      built.failure?.type === "no-candidate-for-position"
    ) {
      const relaxed = buildSlots(false);
      if (relaxed.ok) {
        built = relaxed;
        lockRelaxedInnings.push(inn + 1);
      }
    }
    if (!built.ok)
      return { ok: false, failure: built.failure ?? { type: "unknown" } };
    const inningSlots: Record<string, any> = (built as any).inningSlots;

    const benchList = [];
    for (const p of profiled) {
      if (benchedSet.has(p.id)) {
        const st = state.get(p.id)!;
        st.bench++;
        st.history.push("BENCH");
        benchList.push(p);
      }
    }
    for (const pos of positionsToFill) {
      const player = inningSlots[pos];
      if (!player)
        return {
          ok: false,
          failure: {
            type: "no-candidate-for-position",
            position: pos,
            inning: inn + 1,
          },
        };
      const st = state.get(player.id)!;
      st.positions[pos] = (st.positions[pos] || 0) + 1;
      st.history.push(pos);
    }

    inningSlots["BENCH"] = benchList;
    lineup.push(inningSlots);
  }

  // ---------- Hard catcher invariant (belt-and-suspenders) ----------
  // Every assignment path is already gated on isCatcherEligible, but this
  // final sweep guarantees the rule holds for the innings WE generated
  // (never the reseeded already-played innings, which reflect reality): no
  // inning may field a catcher who isn't cleared for C. If one ever slips
  // through, swap them with an eligible fielder this inning (position swap,
  // so no bench change), or failing that an eligible bench player.
  for (let i = mgFromInning; i < lineup.length; i++) {
    const slots = lineup[i];
    const c = slots["C"];
    if (!c || isCatcherEligible(c)) continue;
    let fixed = false;
    for (const pos of Object.keys(slots)) {
      if (pos === "C" || pos === "BENCH") continue;
      const other = slots[pos];
      if (other && isCatcherEligible(other) && !isPositionBlocked(c, pos)) {
        slots["C"] = other;
        slots[pos] = c;
        fixed = true;
        break;
      }
    }
    if (!fixed && Array.isArray(slots["BENCH"])) {
      for (let b = 0; b < slots["BENCH"].length; b++) {
        const bp = slots["BENCH"][b];
        if (bp && isCatcherEligible(bp)) {
          slots["BENCH"][b] = c;
          slots["C"] = bp;
          fixed = true;
          break;
        }
      }
    }
  }

  // ---------- Penalty ----------
  let penalty = 0;
  let maxBench = 0;
  let minBench = Infinity;

  // Math floor for this game: with N players and S total bench slots, the
  // minimum number of times any player must sit is floor(S / N).
  const totalBenchSlots = numToBench * totalInnings;
  const minBenchPerPlayer =
    profiled.length > 0 ? Math.floor(totalBenchSlots / profiled.length) : 0;
  const everyoneShouldSit = minBenchPerPlayer >= 1;
  const exactDivision =
    profiled.length > 0 && totalBenchSlots % profiled.length === 0;

  // Per player extra sit penalty: if a player ends this game with more
  // "extra sits" total across the season than others, that's unfair.
  // We compute each player's projected season extra sits if THIS lineup
  // gets played, then penalize the spread.
  const projectedExtraSits = [];
  for (const p of profiled) {
    const st = state.get(p.id)!;
    const priorExtra = benchHistory.get(p.id)?.extraSits || 0;
    const thisExtra = Math.max(0, st.bench - minBenchPerPlayer);
    projectedExtraSits.push(priorExtra + thisExtra);
  }
  const minExtra = Math.min(...projectedExtraSits);
  const maxExtra = Math.max(...projectedExtraSits);
  const extraSitSpread = maxExtra - minExtra;

  for (const p of profiled) {
    const st = state.get(p.id)!;
    const b = st.bench;
    if (b > maxBench) maxBench = b;
    if (b < minBench) minBench = b;
    if (!isStarter.has(p.id) && b === totalInnings) penalty += 5000;

    // Hard fairness floor: if everyone should sit at least once, any player
    // who didn't is heavily penalized. This dominates other concerns.
    if (everyoneShouldSit && b === 0) penalty += 10000;

    // Diversity penalty: over concentration at single non C/non P position
    for (const pos in st.positions) {
      if (pos === "C" || pos === "P") continue;
      const count = st.positions[pos];
      if (count >= 3) penalty += (count - 2) * 50;
    }
  }

  // This game spread penalty. The bench count spread (max minus min) should be
  // either 0 (exact division) or 1 (non exact). Anything bigger means some
  // kid sat 2+ more than another in the same game  the unfairness pattern
  // we're trying to prevent.
  const idealSpread = exactDivision ? 0 : 1;
  const actualSpread = maxBench - minBench;
  const excessSpread = Math.max(0, actualSpread - idealSpread);
  // 5000 per excess unit of spread. This dominates other concerns when the
  // engine has been allowing wider distributions than necessary.
  penalty += excessSpread * 5000;

  // Cumulative extra sit spread penalty: when some players have taken the
  // "extra sitter" role more than others across the season, that's unfair.
  // 1500 per unit of spread is meaningful but doesn't override hard constraints.
  penalty += extraSitSpread * 1500;

  return { ok: true, lineup, penalty, lockRelaxedInnings };
}

// ---------- Position scoring ----------

function pickBestForPosition(opts: any): any {
  const {
    pos,
    inn,
    profiled,
    used,
    benchedSet,
    state,
    positionHistory,
    headGrades,
    defenseSize,
    positionLock,
    leagueRuleSet,
    teamAge,
    targetDateStr,
    leftyPenalty,
    isLockInning,
    isBigGame,
    competitive,
    pitcherPoolIds,
    depthChartRank,
    chartedPlayerIds,
    isKidPitch,
    pitchRules = DEFAULT_PITCH_RULE_SET,
    sameDayRoles = { pitched: new Set(), caught: new Set() },
    catcherCap,
    rand,
    premiumPositions,
    positionFlexibility,
  } = opts;

  // Premium positions are computed once in tryBuildLineup and passed in.
  // For Big Games, strong players are pulled toward these spots and weak
  // players are pushed to the OF.
  const isPremium = premiumPositions.has(pos);

  // D4 — P-slot short-circuit. When we have a pre-computed pitcher pool
  // (9U+ Kid Pitch, top N by gameType), pick exclusively from it. Prefer
  // the candidate with the lowest `recentPitches` for fairness across
  // the staff; ties break by pitcher score (already implicit in the pool
  // ordering). Respect every other per-player gate: not used this
  // inning, not benched, not blocked from P by `comfortablePositions`,
  // and the existing "can't pitch non-adjacent innings" rule.
  if (
    pos === "P" &&
    defenseSize === "9" &&
    pitcherPoolIds &&
    pitcherPoolIds.size > 0
  ) {
    const poolCandidates: any[] = [];
    for (const p of profiled) {
      if (!pitcherPoolIds.has(p.id)) continue;
      if (used.has(p.id) || benchedSet.has(p.id)) continue;
      if (isPositionBlocked(p, "P")) continue;
      const st = state.get(p.id)!;
      // Same-day dual-role (Kid Pitch): don't pitch a kid who caught earlier.
      if (isKidPitch && dualRoleBlocked(st, "P", p.id, sameDayRoles)) continue;
      const playedHereLast = inn > 0 && st.history[inn - 1] === "P";
      const pCount = st.positions["P"] || 0;
      // Mirror the existing rule: a kid can pitch consecutively but not
      // resume after a gap. NKB further requires daily pitch eligibility,
      // but that filter was already applied when building the pool.
      if (inn > 0 && pCount > 0 && !playedHereLast) continue;
      poolCandidates.push({ p, st, recent: p.pitching?.recentPitches || 0 });
    }
    if (poolCandidates.length > 0) {
      // Sort: lowest recentPitches first (fairness). The pool is already
      // top-N by score so ordering inside ties doesn't matter much, but
      // we keep it deterministic via id.
      poolCandidates.sort((a, b) => {
        if (a.recent !== b.recent) return a.recent - b.recent;
        return a.p.id < b.p.id ? -1 : 1;
      });
      return poolCandidates[0].p;
    }
    // If the pool is empty (everyone rested out / blocked), fall through
    // to the generic picker so the engine doesn't crash on edge cases.
  }

  let bestPlayer = null;
  let bestScore = Infinity;

  for (const p of profiled) {
    if (used.has(p.id) || benchedSet.has(p.id)) continue;
    if (isPositionBlocked(p, pos)) continue;

    const st = state.get(p.id)!;
    const playedHereLast = inn > 0 && st.history[inn - 1] === pos;

    // KID PITCH same-day dual-role: a kid never pitches AND catches in one game
    // (arm health). Ceremonial P (machine/coach) is exempt — see isKidPitch.
    if (isKidPitch && dualRoleBlocked(st, pos, p.id, sameDayRoles)) continue;

    if (pos === "P" && defenseSize === "9") {
      if (
        leagueRuleSet === "NKB" &&
        !checkPitchEligibility(p, targetDateStr, teamAge ?? "", pitchRules)
      )
        continue;
      const pCount = st.positions["P"] || 0;
      if (inn > 0 && pCount > 0 && !playedHereLast) continue;
    }

    if (pos === "C") {
      if (!isCatcherEligible(p)) continue;
      const cCap = Number.isFinite(catcherCap)
        ? catcherCap
        : defenseSize === "10"
          ? 2
          : 3;
      if ((st.positions["C"] || 0) >= cCap) continue;
    }

    // ---- Soft rotation rules (used to be hard `continue` blocks) -----
    // The same-position back-to-back rule and the OF 2-inning rotation
    // lock used to hard-exclude candidates. When a tight roster + heavy
    // restrictions made every remaining kid match the rule, generation
    // failed with "no eligible player for LF in inning 3" — even though
    // the rule is a coach-preference, not a physical constraint. Convert
    // both to heavy score penalties so the engine prefers anyone else
    // first but falls back rather than failing the whole build.
    const isCarryOverPos = pos === "C" || (pos === "P" && defenseSize === "9");
    let softPenalty = 0;
    if (!isCarryOverPos && !isLockInning && playedHereLast) {
      softPenalty += 500;
    }
    if (
      (positionLock === "1" || positionLock === "2") &&
      OF_POSITIONS.has(pos) &&
      inn >= 2
    ) {
      const h = st.history;
      if (OF_POSITIONS.has(h[inn - 1]) && OF_POSITIONS.has(h[inn - 2])) {
        softPenalty += 750;
      }
    }

    let score = Math.abs((POS_DIFFICULTY[pos] || 3) - 3) + softPenalty;

    const histPos = positionHistory.get(p.id);
    const histEntry = histPos?.get(pos) || { total: 0, bigGame: 0 };
    const seasonCount = histEntry.total;
    const bigGameCount = histEntry.bigGame;
    // Fair mode: aggressive rotation pressure. Each prior inning at this
    // position adds 8 to score (heavy push to rotate to a different kid).
    // Big Game: lighter pressure (1.5)  let strong defenders stay at premium
    // spots even if they've played there a lot, since winning matters more.
    const rotationWeight = isBigGame ? 1.5 : 8;
    // FAIR MODE intra-OF cycling: outfield positions get an extra 1.75x
    // rotation multiplier so a kid who already played RF this game gets
    // actively pushed to CF/LF on their next OF inning instead of
    // settling back into RF whenever they cycle off the bench. The
    // existing back-to-back +500 only catches the immediately-prior
    // inning, so RF→bench→RF→bench→RF was still possible at default
    // weight (jitter ±5 sometimes wins over the +8 pressure). Big Game
    // ignores the boost — strong defenders parking in a premium OF
    // (typically CF) is desired there.
    const isOF = OF_POSITIONS.has(pos);
    const ofRotationBoost = !isBigGame && isOF ? 1.75 : 1;
    score +=
      (seasonCount + (st.positions[pos] || 0)) *
      rotationWeight *
      ofRotationBoost;
    // FAIR MODE compensatory rotation: kids who've played this position in
    // Big Games get an additional push away from it in fair mode. Helps
    // share premium positions across the roster over the season.
    if (!isBigGame && bigGameCount > 0) {
      score += bigGameCount * 6;
    }

    // Random jitter  more aggressive for fair mode so similar skilled kids
    // genuinely shuffle, less for Big Game where we want consistency.
    score += rand() * (isBigGame ? 2 : 5);

    if (pos === "SS" || pos === "3B") {
      const headG = headGrades[p.id]?.armStrength;
      const armBonus = typeof headG === "number" ? headG : 5;
      // Big Game: full arm strength bias. Fair mode: half.
      score -= armBonus * (isBigGame ? 1 : 0.5);
    }

    if (p.throws === "L") {
      if (INFIELD_NON_1B.has(pos)) score += leftyPenalty;
      else if (pos === "1B") score -= 3;
    }

    if (isLockInning && playedHereLast) score -= 1000;

    if (p.primaryPosition === pos) {
      // Big Game: primary kids stick to their position every inning they're
      // on the field — same hard preference inning 1+ as inning 0, so a
      // primary SS kid plays SS the whole game in Big Game mode (rotating
      // off only when benched).
      // Fair mode: NO primary-position bonus. The coach asked explicitly
      // for fair mode to rotate kids through the positions they're
      // comfortable playing rather than clustering them at primary. The
      // comfortablePositions bonus below handles "stay within the
      // allowed set" without privileging primary inside that set.
      if (isBigGame) {
        score -= 10000;
      }
    }

    // FAIR MODE: bias toward any position in the player's
    // comfortablePositions list. The list already acts as a hard
    // whitelist via isPositionBlocked — this small bonus rewards the
    // engine for keeping kids inside their allowed rotation set
    // without singling out primary. Big Game ignores this bonus
    // because it's already pinning to primary far harder.
    if (!isBigGame) {
      const comfort = Array.isArray(p.comfortablePositions)
        ? p.comfortablePositions
        : null;
      if (
        comfort &&
        comfort.length > 0 &&
        comfort.some(
          (c: string) => canonicalizeOutfield(c) === canonicalizeOutfield(pos),
        )
      ) {
        score -= 3;
      }
    }

    // FAIR MODE positional-scarcity reservation: among the kids eligible for
    // this slot, prefer the one cleared for the FEWEST positions and reserve
    // the do-anything kids to fill the remaining holes. A single-position kid
    // adds nothing; each extra position a candidate can field adds a small
    // "save them for elsewhere" penalty. Vanilla rosters (everyone eligible
    // everywhere) get an identical offset on every candidate, so this only
    // shifts decisions when kids actually differ in flexibility. Big Game is
    // skipped — it pins strong kids to premium spots by skill instead.
    if (!isBigGame && positionFlexibility) {
      const flex = positionFlexibility.get(p.id);
      if (typeof flex === "number") {
        score += Math.max(0, flex - 1) * SCARCITY_RESERVE_WEIGHT;
      }
    }

    // BIG GAME: strong players get a meaningful boost toward premium positions
    // and a penalty for OF spots.
    if (isBigGame) {
      const overall = +p.profile?.overallScore || 0;
      const skill = Math.min(Math.max(overall / 100, 0), 1);
      if (isPremium) {
        score -= skill * 20 - 5;
        // Position importance: the spine is Pitcher > Catcher > 1B. An extra
        // skill-scaled pull so the strongest available players are steered to
        // those first (ahead of SS/3B). Skill-scaled, so weak players aren't
        // distorted and feasibility is unaffected.
        score -= skill * (PREMIUM_IMPORTANCE_EXTRA[pos] || 0);
      } else if (OF_POSITIONS.has(pos)) {
        score += skill * 12 - 6;
      }
    }

    // COMPETITIVE (Tournament): the depth chart is authoritative. A charted
    // player at this position gets a large rank-scaled bonus so the coach's
    // order wins over skill/rotation/jitter — while only ever reordering
    // candidates that already passed every hard gate above (eligibility,
    // catcher cap, used-this-inning, blocked positions), so the chart can
    // never make a lineup infeasible. Rank 0 always beats rank 1, and any
    // charted player beats an uncharted one. No effect in Rec (gated on
    // `competitive`, with an empty map there anyway).
    if (competitive && depthChartRank) {
      const rankMap = depthChartRank.get(canonicalizeOutfield(pos));
      const rank = rankMap?.get(p.id);
      if (typeof rank === "number") {
        score -= DEPTH_CHART_BASE_BONUS - rank * DEPTH_CHART_RANK_STEP;
      } else if (chartedPlayerIds && chartedPlayerIds.has(p.id)) {
        // Charted elsewhere: keep them available for their own slot rather than
        // letting an earlier-filled position grab them. Smaller than the bonus,
        // so if the only remaining candidates for a slot are all charted
        // elsewhere, one still fills it (feasibility preserved).
        score += DEPTH_CHART_AVOID_PENALTY;
      }
    }

    if (score < bestScore) {
      bestScore = score;
      bestPlayer = p;
    }
  }

  return bestPlayer;
}
