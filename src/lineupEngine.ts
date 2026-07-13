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

// ---------------------------------------------------------------------------
// Extracted engine submodules (src/lineupEngine/*). This file remains the
// implementation host for the batting order, bench schedule, and lineup
// generators, and re-exports the public surface below so every existing
// `import { X } from ".../lineupEngine"` keeps resolving unchanged.
// ---------------------------------------------------------------------------
import {
  isPositionBlocked,
  isHardRestricted,
  isCatcherEligible,
  resolveCatcherPolicy,
  getPositionsForInning,
  OF_POSITIONS,
  INFIELD_NON_1B,
  POS_DIFFICULTY,
} from "./lineupEngine/eligibility";
import type { CatcherPolicy } from "./lineupEngine/eligibility";
import {
  getCombinedGrades,
  getEffectiveStats,
  numOrNull,
  gloveOf,
  rangeOf,
  armStrengthOf,
  armAccuracyOf,
  baserunningOf,
  speedBaseOf,
  contactOf,
  powerOf,
  statArmGrade,
  statBlockingGrade,
  statFieldingGrade,
  statOffSpeedGrade,
  statStrikesGrade,
  statThrowingGrade,
  statVelocityGrade,
  DEFAULT_GRADES,
} from "./lineupEngine/grades";
import type { GradesInput } from "./lineupEngine/grades";
import {
  buildPitchingPlan,
  checkPitchEligibility,
  DEFAULT_PITCH_RULE_SET,
} from "./lineupEngine/pitchRules";
import type { PitchRuleSet } from "./lineupEngine/pitchRules";
import {
  mulberry32,
  leftyInfieldPenalty,
  SCARCITY_RESERVE_WEIGHT,
  DEPTH_CHART_BASE_BONUS,
  DEPTH_CHART_RANK_STEP,
  DEPTH_CHART_AVOID_PENALTY,
  PREMIUM_IMPORTANCE_EXTRA,
} from "./lineupEngine/prng";
import type {
  ProfiledPlayer,
  PlayerState,
  ExtraSitEntry,
  BenchFailure,
  PickBestOpts,
  CatcherBlock,
  BenchScheduleOpts,
  TryBuildCtx,
} from "./lineupEngine/types";
import {
  buildPlayerProfile,
  buildPositionHistory,
  buildFirstInningBenchHistory,
  buildExtraSitHistory,
  buildSlotIdResolver,
} from "./lineupEngine/profile";
import {
  calcPitcherScore,
  calcCatcherScore,
  dualRoleBlocked,
} from "./lineupEngine/evaluation";
import { getPitcherPoolSize } from "./lineupEngine/primaryPosition";

// Re-export the public surface that lived in this file before the split.
export {
  isPositionBlocked,
  isCatcherEligible,
  resolveCatcherPolicy,
  getPositionsForInning,
} from "./lineupEngine/eligibility";
export type { CatcherPolicy } from "./lineupEngine/eligibility";
export {
  getCombinedGrades,
  statContactGrade,
  statPowerGrade,
  statFieldingGrade,
  statArmGrade,
  statBlockingGrade,
  countGamesCaught,
  getOffensiveScore,
  calcVelocityQuality,
} from "./lineupEngine/grades";
export {
  calculateTotalScore,
  TOTAL_SCORE_MAX,
} from "./lineupEngine/totalScore";
export {
  resolvePitchRuleSet,
  maxPitchesForAge,
  mostRecentDayPitches,
  checkPitchEligibility,
  buildPitchingPlan,
  analyzePitchingWorkload,
} from "./lineupEngine/pitchRules";
export type {
  PitchRuleSet,
  PitcherAvailability,
  PitchingWorkloadAnalysis,
} from "./lineupEngine/pitchRules";
export {
  PITCHER_SCORE_WEIGHTS,
  PITCHER_EVAL_MAX,
  calcPitcherStatsQuality,
  calcPitcherScore,
  CATCHER_EVAL_MAX,
  calcCatcherStatsQuality,
  calcFieldingStatsQuality,
  calcCatcherScore,
  calcDefensiveScore,
} from "./lineupEngine/evaluation";
export {
  getActivePositionList,
  fieldFitScore,
  suggestPrimaryPosition,
  getPitcherPoolSize,
} from "./lineupEngine/primaryPosition";
export type { PrimarySuggestion } from "./lineupEngine/primaryPosition";

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

  // Attach structured reasons to the placed players. The printable lineup
  // card renders `battingReason` as an italic "role — note" sub-line.
  for (let i = 0; i < count; i++) {
    const player = order[i];
    if (!player) continue;
    const reason = reasons[i] || { role: "", note: "" };
    player.battingReason = {
      role: reason.role,
      note: reason.note,
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
    {
      teamAge,
      games:
        (input.games as Array<{ playerStats?: Record<string, any> }>) || [],
    },
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
    // Durable in-game manual position picks; seated in the starting nine so the
    // scripted-starter rotation keeps them at the spot for the rest of the game.
    stickyOverridesById = {},
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
  // Eligibility for a MANUAL override (coach's explicit pick). Authoritative —
  // honor the pick even out of the player's comfortable spots — but still
  // respect a hard restriction, the catcher opt-in, and (for P) pitch-count
  // rules, which are safety/legality, not preference.
  const eligibleForOverride = (
    pos: string,
    p: ProfiledPlayer | undefined,
  ): boolean => {
    if (!p) return false;
    if (pos === "C") return isCatcherEligible(p);
    if (isHardRestricted(p, pos)) return false;
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
    // Utilize primary positions: a kid you've tagged with this primaryPosition
    // is preferred for it. The nudge sits ABOVE the raw skill gradient (so a
    // primary-2B kid plays 2B over a slightly-better-overall kid) but BELOW the
    // depth chart (≥500 when charted), so your explicit chart still wins.
    else if (p.primaryPosition === pos) s += 200;
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

  // Honor coach position pins for inning 0: the Starting Pitcher picker (P), and
  // in-game manual moves / pitching changes that re-run this generator (the
  // swapped spots + the kept battery). Seat each pinned player at their position
  // BEFORE the scarcity fill so the lineup is built around the coach's choices,
  // not the top-ranked option. A pin is skipped if the player isn't present, is
  // already seated, or isn't eligible there (so P still falls back to the normal
  // pick when the chosen arm can't go).
  // Manual picks are seated authoritatively (eligibleForOverride honors out-of-
  // comfort spots while still respecting hard restrictions / catcher opt-in /
  // pitch rules). Sticky locks (durable manual picks) seat the same way; in the
  // tournament path they ride the starting nine, which the scripted starters
  // hold for the rest of the game. firstInningOverridesById wins ties.
  const overridePins = { ...stickyOverridesById, ...firstInningOverridesById };
  for (const pos of fillOrder) {
    const pid = overridePins[pos];
    if (!pid || assigned.has(pos)) continue;
    const pp = byId.get(pid);
    if (
      pp &&
      !used.has(pp.id) &&
      positions.includes(pos) &&
      eligibleForOverride(pos, pp)
    ) {
      assigned.set(pos, pp);
      used.add(pp.id);
    }
  }
  const pendingOrder = fillOrder.filter((pos) => !assigned.has(pos));

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

  // ---------- Fair, rec-style rotation ----------
  // Tournaments still field your best nine to start, but the bench now rotates
  // across the WHOLE game instead of a single 3rd-4th window. "Lean fair": every
  // present player sits at most floor(totalInnings/3) innings (so everyone plays
  // roughly two-thirds — enough that no parent sees their kid riding the bench),
  // while the designated subs (players who didn't earn a starting spot) and then
  // the weakest starters give up their innings first, so the best kids still
  // play the most. Nobody is benched two innings back-to-back when it can be
  // avoided. The pitcher is fixed for the game (manual relief changes re-run
  // this generator) and the catcher follows the catcher policy below.
  const fixedP = assigned.get("P");
  const benchPlayers = profiled
    .filter((p) => !used.has(p.id))
    .sort(
      (a, b) => (b.profile.overallScore || 0) - (a.profile.overallScore || 0),
    );

  // An EXPLICIT catcher cap (Settings → Catcher Innings, or the per-game
  // override) applies in tournament games too: once the starting catcher hits
  // the cap, the best catcher-eligible bench player takes over for the rest of
  // the game. "auto"/"none" keep tournament catcher continuity (one catcher all
  // game). No handoff when nobody on the bench can catch.
  const catcherPolicy = resolveCatcherPolicy(
    catcherMaxInnings,
    catcherConsecutive,
    defenseSize,
    profiled.length,
  );
  const starterC = assigned.get("C");
  const starterCId = starterC?.id ?? null;
  let catcherHandoff: TournamentSubstitution | null = null;
  if (
    starterC &&
    catcherPolicy.enforceCap &&
    catcherPolicy.cap < totalInnings
  ) {
    const handoffInning = catcherPolicy.cap + 1;
    const reliefC = benchPlayers
      .filter((p) => isCatcherEligible(p) && p.id !== starterC.id)
      .sort(
        (a, b) =>
          calcCatcherScore(b.profile.grades, b.stats) -
          calcCatcherScore(a.profile.grades, a.stats),
      )[0];
    if (reliefC) {
      catcherHandoff = {
        inning: handoffInning,
        returnInning: null,
        position: "C",
        in: slim(reliefC),
        out: slim(starterC),
      };
    }
  }

  // Who catches each inning (1-indexed innings → 0-indexed array). Once the
  // relief catcher takes over they catch the rest of the way.
  const catcherByInning: (string | null)[] = [];
  for (let i = 1; i <= totalInnings; i++) {
    catcherByInning.push(
      catcherHandoff && i >= (catcherHandoff.inning as number)
        ? (catcherHandoff.in?.id ?? starterCId)
        : starterCId,
    );
  }

  // Positions that rotate each inning — everything but the fixed P and the
  // catcher (handled above).
  const fieldPositions = positions.filter((p) => p !== "P" && p !== "C");
  const benchPerInning = Math.max(0, profiled.length - positions.length);
  const sitCap = Math.max(1, Math.floor(totalInnings / 3));

  // A player's starting field position (if any) — used to keep starters at
  // their home spot and to bench non-starters first.
  const homePosOf = new Map<string, string>();
  for (const pos of fieldPositions) {
    const s = assigned.get(pos);
    if (s) homePosOf.set(s.id, pos);
  }

  const fieldEligible = (pos: string, pid: string): boolean => {
    const pl = byId.get(pid);
    return !!pl && pos !== "C" && pos !== "P" && !isPositionBlocked(pl, pos);
  };
  const canCoverField = (players: ProfiledPlayer[]): boolean =>
    maxPositionMatching(
      fieldPositions,
      players.map((p) => p.id),
      fieldEligible,
    ).size === fieldPositions.length;

  const sits = new Map<string, number>(profiled.map((p) => [p.id, 0]));
  const innings: Inning[] = [];
  const substitutions: TournamentSubstitution[] = [];
  const subEntered = new Set<string>(); // non-starter ids already recorded as subs
  let prevBench = new Set<string>();

  for (let i = 0; i < totalInnings; i++) {
    const catcherId = catcherByInning[i];
    // Rotation pool: everyone except the fixed pitcher and this inning's catcher.
    const pool = profiled.filter(
      (p) => p.id !== fixedP?.id && p.id !== catcherId,
    );

    // Bench priority (sit soonest first): non-starters before starters, then
    // weakest score first, deterministic id tiebreak.
    const benchOrder = [...pool].sort((a, b) => {
      const aS = homePosOf.has(a.id) ? 1 : 0;
      const bS = homePosOf.has(b.id) ? 1 : 0;
      if (aS !== bS) return aS - bS;
      const sa = a.profile.overallScore || 0;
      const sb = b.profile.overallScore || 0;
      if (sa !== sb) return sa - sb;
      return a.id < b.id ? -1 : 1;
    });

    const pickBench = (relaxBackToBack: boolean): Set<string> => {
      const bench = new Set<string>();
      const consider = (capped: boolean) => {
        for (const p of benchOrder) {
          if (bench.size >= benchPerInning) break;
          if (bench.has(p.id)) continue;
          if (!capped && (sits.get(p.id) || 0) >= sitCap) continue;
          if (!relaxBackToBack && prevBench.has(p.id)) continue;
          bench.add(p.id);
        }
      };
      consider(false);
      // If the cap left us short (huge bench), allow over-cap to fill the inning.
      if (bench.size < benchPerInning) consider(true);
      return bench;
    };
    let bench = pickBench(false);
    if (bench.size < benchPerInning) bench = pickBench(true);

    // Feasibility: the players left on the field must cover every field
    // position. If benching someone strands a hole, swap them back in for a
    // stronger on-field player until a full defense is possible.
    const onFieldOf = (b: Set<string>) => pool.filter((p) => !b.has(p.id));
    let guard = 0;
    while (!canCoverField(onFieldOf(bench)) && guard++ < pool.length + 2) {
      const strongestFirst = [...onFieldOf(bench)].sort(
        (a, b) => (b.profile.overallScore || 0) - (a.profile.overallScore || 0),
      );
      let fixed = false;
      for (const bid of [...bench]) {
        for (const victim of strongestFirst) {
          if (victim.id === bid) continue;
          const trial = new Set(bench);
          trial.delete(bid);
          trial.add(victim.id);
          if (canCoverField(onFieldOf(trial))) {
            bench = trial;
            fixed = true;
            break;
          }
        }
        if (fixed) break;
      }
      if (!fixed) break;
    }

    for (const id of bench) sits.set(id, (sits.get(id) || 0) + 1);

    // Seat the inning: P, C, starters at home, then fill the rest by matching.
    const inn: Inning = {};
    if (fixedP) inn.P = slim(fixedP);
    if (catcherId) {
      const c = byId.get(catcherId);
      if (c) inn.C = slim(c);
    }
    const onField = onFieldOf(bench);
    const onFieldIds = new Set(onField.map((p) => p.id));
    const placed = new Set<string>();
    const freePositions: string[] = [];
    for (const pos of fieldPositions) {
      const s = assigned.get(pos);
      if (s && onFieldIds.has(s.id) && !placed.has(s.id)) {
        inn[pos] = slim(s);
        placed.add(s.id);
      } else {
        freePositions.push(pos);
      }
    }
    if (freePositions.length > 0) {
      // Utilize primary positions for the fill-ins: a bench kid returning to
      // the field gets their primaryPosition first when it's open and they're
      // eligible (so they aren't parked in right field). Resolve two kids who
      // share a primary by defensive score. Then fill whatever's left.
      const openPositions = new Set(freePositions);
      const freePlayers = onField.filter((p) => !placed.has(p.id));
      for (const pos of freePositions) {
        if (inn[pos]) continue;
        const want = freePlayers
          .filter(
            (p) =>
              !placed.has(p.id) &&
              p.primaryPosition === pos &&
              fieldEligible(pos, p.id),
          )
          .sort(
            (a, b) => b.profile.defensiveScore - a.profile.defensiveScore,
          )[0];
        if (want) {
          inn[pos] = slim(want);
          placed.add(want.id);
          openPositions.delete(pos);
        }
      }
      const remainingPositions = [...openPositions];
      const freeIds = onField.filter((p) => !placed.has(p.id)).map((p) => p.id);
      let match = maxPositionMatching(
        remainingPositions,
        freeIds,
        fieldEligible,
      );
      // Safety net: if the home/primary placements boxed us in, rematch the
      // whole field from scratch (feasibility was guaranteed above).
      if (match.size < remainingPositions.length) {
        for (const pos of fieldPositions) delete inn[pos];
        match = maxPositionMatching(
          fieldPositions,
          [...onFieldIds],
          fieldEligible,
        );
      }
      for (const [pos, pid] of match) {
        const pl = byId.get(pid);
        if (pl) inn[pos] = slim(pl);
      }
    }

    inn.BENCH = profiled.filter((p) => bench.has(p.id)).map(slim);
    innings.push(inn);

    // Record substitution metadata — the first inning a non-starter takes over
    // a starter's home spot. (Display/record only; the grid above is authoritative.)
    for (const pos of fieldPositions) {
      const occupantId = (inn[pos] as SlimPlayer | undefined)?.id;
      const starter = assigned.get(pos);
      if (
        occupantId &&
        starter &&
        occupantId !== starter.id &&
        !subEntered.has(occupantId)
      ) {
        const subP = byId.get(occupantId);
        if (subP) {
          substitutions.push({
            inning: i + 1,
            returnInning: null,
            position: pos,
            in: slim(subP),
            out: slim(starter),
          });
          subEntered.add(occupantId);
        }
      }
    }
    if (catcherHandoff && i + 1 === catcherHandoff.inning) {
      substitutions.push(catcherHandoff);
    }

    prevBench = bench;
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
    stickyOverridesById = {},
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
      // const capture so the closure sees the non-null map without a `!`.
      const rank = m;
      ids.forEach((id, i) => {
        if (!rank.has(id)) rank.set(id, i);
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
        stickyOverridesById,
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
    overrideInning = 0,
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
      const involvesOverrideInning = block.includes(overrideInning);

      const isAvailable = (p: ProfiledPlayer) => {
        if (involvesOverrideInning) {
          const lockedPos = firstInningLockedPos.get(p.id);
          // If you forced them to play a specific spot that IS NOT catcher in
          // the override inning, they can't be the catcher for a block covering it.
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
      // 1st Inning Override safety: Do not bench a kid if the user explicitly forced them into a position in the override inning
      if (inn === overrideInning && firstInningMustPlay.has(p.id)) continue;
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
      const priorRatio =
        totalPrior > 0 ? (hist?.benchInn || 0) / totalPrior : 0.5;
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
          !(inn === overrideInning && firstInningMustPlay.has(p.id)) &&
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
        const priorRatio =
          totalPrior > 0 ? (hist?.benchInn || 0) / totalPrior : 0.5;
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
          if (inn === overrideInning && firstInningMustPlay.has(o.id)) continue;
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
    stickyOverridesById = {},
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

  // First RE-SOLVED inning on a mid-game rebuild (innings 0..mgFromInning-1 are
  // replayed verbatim from currentLineup below). 0 for a normal from-scratch
  // build. The position overrides apply HERE, not at a hardcoded inning 0, so a
  // coach's in-game pin (e.g. move a player to pitcher in inning 4) lands on the
  // inning they're on.
  const mgFromInning =
    fromInning > 0 && Array.isArray(currentLineup) && currentLineup.length > 0
      ? Math.min(fromInning, currentLineup.length, totalInnings)
      : 0;

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
    overrideInning: mgFromInning, // ...at the inning the coach actually pinned
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
  // (mgFromInning is computed once near the top of tryBuildLineup.)
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
    const buildSlots = (useLock: boolean) => {
      const inningSlots: Record<string, any> = {};
      if (inn === mgFromInning) {
        for (const pos in firstInningOverridesById) {
          const pid = firstInningOverridesById[pos];
          const player = profiled.find((p) => p.id === pid);
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
          // A manual override is authoritative — honor it even out of the
          // player's comfortable spots — but still respect a hard restriction.
          if (isHardRestricted(player, pos)) continue;
          // Catcher is opt-in only: never honor a first-inning override that
          // would seat a non-cleared kid at C.
          if (pos === "C" && !isCatcherEligible(player)) continue;
          inningSlots[pos] = player;
        }
      }

      // Sticky manual locks: the coach's durable in-game position picks, held
      // for the rest of the game (every inning from mgFromInning on). Best
      // effort — seat the player whenever they're on the field and not hard-
      // restricted; if the fairness scheduler benched them this inning, the spot
      // fills normally below. Field positions only: P keeps its pitch-count-
      // governed rotation and C its catcher-block continuity, so a lock can
      // never strand an over-limit pitcher on the mound.
      if (inn >= mgFromInning) {
        for (const pos in stickyOverridesById) {
          if (pos === "P" || pos === "C") continue;
          if (inningSlots[pos]) continue; // a point override already won it
          const pid = stickyOverridesById[pos];
          if (benchedSet.has(pid)) continue;
          const player = profiled.find((p) => p.id === pid);
          if (!player || !positionsToFill.includes(pos)) continue;
          if (isHardRestricted(player, pos)) continue;
          // Don't double-book a player already locked into another spot here.
          if (Object.values(inningSlots).some((p: any) => p.id === pid))
            continue;
          inningSlots[pos] = player;
        }
      }

      const used = new Set(Object.values(inningSlots).map((p) => p.id));
      const remainingPositions = positionsToFill.filter(
        (pos) => !inningSlots[pos],
      );

      // Consecutive-catcher mode: catcher is fixed by the precomputed schedule
      // (one catcher per contiguous block of innings).
      if (catcherInningBlocks && !inningSlots["C"]) {
        const catcherId = catcherByInning.get(inn);
        if (catcherId) {
          const catcher = profiled.find((p) => p.id === catcherId);
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
          const prevPlayer = prevInning?.[pos] as any;
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
      const posScarcity = remainingPositions.map((pos) => {
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
      posScarcity.sort((a, b) => {
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

function pickBestForPosition(opts: PickBestOpts): ProfiledPlayer | null {
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
    const poolCandidates: Array<{
      p: ProfiledPlayer;
      st: PlayerState;
      recent: number;
    }> = [];
    for (const p of profiled) {
      if (!pitcherPoolIds.has(p.id)) continue;
      if (used.has(p.id) || benchedSet.has(p.id)) continue;
      if (isPositionBlocked(p, "P")) continue;
      const st = state.get(p.id)!;
      // Same-day dual-role (Kid Pitch): don't pitch a kid who caught earlier.
      if (
        isKidPitch &&
        dualRoleBlocked(st, "P", p.id, sameDayRoles ?? undefined)
      )
        continue;
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
    if (isKidPitch && dualRoleBlocked(st, pos, p.id, sameDayRoles ?? undefined))
      continue;

    if (pos === "P" && defenseSize === "9") {
      if (
        leagueRuleSet === "NKB" &&
        !checkPitchEligibility(
          p,
          targetDateStr ?? "",
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
      const cCap = Number.isFinite(catcherCap)
        ? catcherCap!
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
      if (INFIELD_NON_1B.has(pos)) score += leftyPenalty ?? 0;
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
