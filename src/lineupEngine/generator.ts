// lineupEngine/generator.ts
// The Rec / Competitive fairness solver: generateLineup (the main entry point,
// including the mid-game rebuild and the attempt/relax loop) plus
// buildCompetitiveLineup (a thin competitive wrapper).
import type {
  EngineInput,
  EngineResult,
  Game,
  Inning,
  SlimPlayer,
} from "../types";
import { canonicalizeOutfield, evalRoundRecency } from "../utils/helpers";
import { checkPitchEligibility } from "./pitchRules";
import type { PitchRuleSet } from "./pitchRules";
import { buildProfiledPlayers, resolveGameContext } from "./engineContext";
import { calcPitcherScore, calcCatcherScore } from "./evaluation";
import {
  isPositionBlocked,
  isCatcherEligible,
  resolveCatcherPolicy,
  getPositionsForInning,
} from "./eligibility";
import { getPitcherPoolSize } from "./primaryPosition";
import { mulberry32, leftyInfieldPenalty } from "./prng";
import {
  buildPositionHistory,
  buildFirstInningBenchHistory,
  buildExtraSitHistory,
  buildSlotIdResolver,
} from "./profile";
import { tryBuildLineup } from "./benchSchedule";
import { generateBattingOrder } from "./battingOrder";
import type { BenchFailure, ExtraSitEntry } from "./types";

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
  const {
    ruleSet: pitchRules,
    gameDate: targetDateStr,
    kidPitch: isKidPitchFormat,
  } = resolveGameContext({
    pitchRuleSet: pitchRuleSet as PitchRuleSet,
    currentGame,
    pitchingFormat,
  });
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

  const { combinedGrades, profiled } = buildProfiledPlayers({
    activePlayers,
    allPlayers,
    evaluationEvents,
    games,
    teamAge,
  });

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
