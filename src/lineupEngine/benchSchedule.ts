// lineupEngine/benchSchedule.ts
// The fairness / bench-rotation core: bipartite position matching, the bench
// pre-schedule pass, a single-attempt lineup build, and per-position scoring.
// Every tuning number lives in the documented constant block below, not inline.
import type { Inning, Player, SlimPlayer } from "../types";
import { canonicalizeOutfield } from "../utils/helpers";
import {
  isPositionBlocked,
  isHardRestricted,
  isCatcherEligible,
  resolveCatcherPolicy,
  OF_POSITIONS,
  INFIELD_NON_1B,
  POS_DIFFICULTY,
} from "./eligibility";
import { checkPitchEligibility, DEFAULT_PITCH_RULE_SET } from "./pitchRules";
import { dualRoleBlocked } from "./evaluation";
import {
  SCARCITY_RESERVE_WEIGHT,
  DEPTH_CHART_BASE_BONUS,
  DEPTH_CHART_RANK_STEP,
  DEPTH_CHART_AVOID_PENALTY,
  PREMIUM_IMPORTANCE_EXTRA,
} from "./prng";
import type {
  ProfiledPlayer,
  PlayerState,
  PickBestOpts,
  CatcherBlock,
  BenchScheduleOpts,
  TryBuildCtx,
} from "./types";

/* ----------------------------------------------------------------------------
   Tuning levers
   Every knob that trades FAIRNESS (everyone plays about the same, everywhere)
   against COMPETITIVENESS (best glove at the biggest spot) is hoisted here, so
   a coach-facing behavior change is a one-line edit rather than a hunt through
   the file. Values are the historical inline ones — moving ANY of them changes
   generated lineups, so re-run the engine suites after a tweak.
---------------------------------------------------------------------------- */

// Bench-schedule distribution (precomputeBenchSchedule): who sits and how
// often, decided before a single position is assigned.
export const BENCH_WEIGHTS = {
  // Widest allowed gap between the kid who sits most and the kid who sits
  // least — the coach-visible "max 2 extra sits" promise. It caps both the
  // per-game target spread and the season-disparity transfer. Lower = stricter
  // fairness but fewer feasible schedules on restricted rosters; higher = more
  // room to pay back season debt in a single game.
  MAX_SIT_GAP: 2,
  // How far a kid's season defensive innings must diverge from their expected
  // share, in innings, before the over-played → under-played sit transfer fires
  // at all. Lower = chases every small imbalance; higher = ignores noise.
  DISPARITY_INNINGS: 1,
  // Competitive (tournament) only: the sit cap is totalInnings divided by this,
  // so everyone still plays at least half. Drop it toward 1 to let the weakest
  // kids sit more of the game (more competitive); raise it to shrink the
  // biggest allowed sit (more fair).
  COMPETITIVE_SIT_DIVISOR: 2,
  // Catcher pre-pick: only prefer the positionally-less-scarce of two catcher
  // candidates once their scarcity drain (summed 1/supply) differs by more than
  // this, so near-equal kids don't churn. Higher = scarcity matters less.
  CATCHER_SCARCITY_GAP: 0.15,
  // Season bench ratio assumed for a kid with no history — mid-scale on
  // purpose, so a new kid sorts between the over- and under-played ends.
  NEUTRAL_PRIOR_RATIO: 0.5,
  // Added to a kid's prior-extra-sit count when they're pulled in as OVERFLOW
  // (they owe no sits, but the inning can't otherwise be filled). Big enough to
  // sink them below every kid carrying a real bench debt.
  OVERFLOW_SIT_DISCOURAGE: 100,
  // Most top-half defenders (by defensive score) allowed on the bench together
  // in one inning. 1 keeps the field competitive; raising it lets the pure
  // fairness order decide the bench.
  TOP_HALF_BENCH_CAP: 1,
  // …but a top-half kid is only skipped when the next kid in line is within
  // this much season bench ratio; past that the fairness gap outranks the
  // pairing preference. Larger = the pairing rule wins more often.
  TOP_HALF_FAIRNESS_TOLERANCE: 0.05,
  // Safety bound on the two sit-redistribution loops (anchor freeing,
  // pathological competitive rosters). Not a fairness lever — it exists so a
  // degenerate roster can't spin the generator forever.
  REDISTRIBUTE_GUARD: 1000,
} as const;

// Whole-attempt penalty (end of tryBuildLineup). The generator scores many
// attempts and keeps the lowest, so these set the PRIORITY ORDER between
// fairness violations, not just their size — keep the tiers an order of
// magnitude apart or a cheap violation starts outbidding an expensive one.
export const PENALTY_WEIGHTS = {
  // A non-starter who never took the field at all.
  BENCHED_ALL_GAME: 5000,
  // Top tier: when the bench math says everyone must sit at least once, a kid
  // who sat zero means another kid absorbed their inning.
  NEVER_SAT: 10000,
  // Position diversity: innings at the same non-C/non-P spot are free up to
  // this count, then every further inning costs POSITION_REPEAT_STEP. Raise the
  // step to spread kids around the diamond harder.
  POSITION_REPEAT_THRESHOLD: 3,
  POSITION_REPEAT_STEP: 50,
  // Per unit of THIS game's bench spread beyond the mathematically unavoidable
  // one (0 when bench slots divide evenly across the roster, else 1). As heavy
  // as a hard violation on purpose — a 2-sit gap in one game is what parents
  // actually notice.
  EXCESS_SPREAD: 5000,
  // Per unit of SEASON extra-sit spread. Meaningful, but well under
  // EXCESS_SPREAD so evening out the season never justifies burying a kid today.
  SEASON_EXTRA_SIT_SPREAD: 1500,
} as const;

// Rotation pressure inside pickBestForPosition: how hard a kid is pushed OFF a
// position they have already played (this game plus season history).
export const ROTATION_WEIGHTS = {
  // Per prior inning at this position. Fair mode pushes hard so the roster
  // cycles; Big Game barely pushes, letting a strong defender hold the spot all
  // game. Move BIG_GAME toward FAIR to make big games rotate more.
  FAIR: 8,
  BIG_GAME: 1.5,
  // Fair mode only: extra multiplier on that pressure for outfield spots, so a
  // kid cycling off the bench lands in a DIFFERENT outfield spot instead of
  // settling back into the same one (SAME_POSITION_BACK_TO_BACK only looks one
  // inning back, and jitter can outbid the base weight).
  OUTFIELD_CYCLE_BOOST: 1.75,
  // Fair mode only: per inning this kid played here in a PAST Big Game — pays
  // premium-position time back to the rest of the roster over the season.
  BIG_GAME_HISTORY_PAYBACK: 6,
  // Soft penalty for repeating the exact position played last inning (outside
  // lock innings and the P/C carry-over spots). Deliberately soft, not a hard
  // block: on a tight roster the alternative is failing the whole build.
  SAME_POSITION_BACK_TO_BACK: 500,
  // Soft penalty for a third straight outfield inning under the 1-/2-inning
  // rotation lock. Above SAME_POSITION_BACK_TO_BACK so the engine breaks an OF
  // streak before it breaks the same-spot rule.
  OUTFIELD_LOCK_REPEAT: 750,
} as const;

// The remaining per-candidate terms in pickBestForPosition. Score is a COST:
// negative terms pull a player toward the slot, positive ones push them away.
export const SCORE_WEIGHTS = {
  // Mid-scale POS_DIFFICULTY — both the fallback for a position missing from
  // the table and the pivot the |difficulty − pivot| base cost measures from,
  // so the easiest and hardest spots sit equally far off neutral.
  NEUTRAL_DIFFICULTY: 3,
  // Random tiebreaker range. Fair mode's is wide enough that similar-skill kids
  // genuinely shuffle game to game; Big Game stays near-deterministic.
  JITTER_FAIR: 5,
  JITTER_BIG_GAME: 2,
  // SS/3B arm-strength pull: the grade assumed when a kid has none (mid), and
  // how much of it counts — Big Game the full grade, fair mode half.
  DEFAULT_ARM_GRADE: 5,
  ARM_BIAS_BIG_GAME: 1,
  ARM_BIAS_FAIR: 0.5,
  // Lefty at first base — the one infield spot a left-hander is an asset at.
  // (The matching infield penalty is age/rule-set scaled; see LEFTY_PENALTY.)
  LEFTY_1B_BONUS: 3,
  // Lock inning: hold a kid at the spot they had last inning. Big enough to
  // beat every rotation and skill term, well under BIG_GAME_PRIMARY_PIN.
  LOCK_CARRYOVER_BONUS: 1000,
  // Big Game: a kid's primaryPosition is effectively pinned — the largest term
  // in the function, so it outranks rotation, jitter and skill. No fair-mode
  // equivalent by design (fair mode has no privileged primary position).
  BIG_GAME_PRIMARY_PIN: 10000,
  // Fair mode: feather-light nudge to keep kids inside their comfortable list
  // (already a hard whitelist) without privileging primary inside it.
  COMFORT_BONUS: 3,
  // overallScore runs 0..SKILL_SCALE; the Big Game terms below use the clamped
  // 0..1 ratio so strong and weak kids move in opposite directions.
  SKILL_SCALE: 100,
  // Big Game premium ("spine") spots: pull = skill × SLOPE − OFFSET, taken off
  // the cost, so kids above the OFFSET/SLOPE break-even skill are drawn to the
  // spine and the weakest are actively pushed off it. Raise SLOPE for a sharper
  // strong/weak split; raise OFFSET to reserve the spine for a smaller top tier.
  PREMIUM_PULL_SLOPE: 20,
  PREMIUM_PULL_OFFSET: 5,
  // Big Game outfield: the mirror image — push = skill × SLOPE − OFFSET added
  // to the cost, so kids above its break-even are repelled from the OF and the
  // weaker ones drift into it.
  OUTFIELD_PUSH_SLOPE: 12,
  OUTFIELD_PUSH_OFFSET: 6,
} as const;

// Catcher inning cap under the "auto" policy, mirrored from
// resolveCatcherPolicy for the paths that run before/without a finite resolved
// cap: 10-fielder games run back-to-back pairs, everything else caps at 3.
export const AUTO_CATCHER_CAP = { TEN_FIELDER: 2, DEFAULT: 3 } as const;

// Age gate for the premium ("spine") position set. 8U and below is machine or
// coach pitch — no real pitcher, and catcher matters less with no strikes or
// passed balls — so the spine is the infield; 9U+ puts P and C back on top.
// Big Game pulls strong kids toward the spine and pushes weak kids to the OF.
export const MACHINE_PITCH_MAX_AGE = 8;
// A team with no recorded age scores as the oldest bracket, the safer default:
// it never strips P/C out of the spine.
export const UNKNOWN_TEAM_AGE = 99;
export const PREMIUM_POSITIONS_MACHINE_PITCH = new Set<string>([
  "1B",
  "SS",
  "3B",
]);
export const PREMIUM_POSITIONS_KID_PITCH = new Set<string>([
  "P",
  "SS",
  "3B",
  "C",
  "1B",
]);

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
export function maxPositionMatching(
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

export function precomputeBenchSchedule(opts: BenchScheduleOpts): {
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
    fixedPitcherId = null,
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
  // KID-PITCH GAME-LONG PITCHER PIN: the pinned pitcher is on the mound every
  // inning, so he behaves exactly like a sole-eligible anchor — he can never
  // be benched, and never reserved at catcher (Kid Pitch also bans pitch+catch
  // in one game). The ANCHOR GUARD below zeroes his sit target and
  // redistributes it, so the fairness distribution is shared by the OTHER
  // kids only. His innings aren't exempted from the season ledger — the
  // emitted plan records him at P, so future games see him as over-played.
  if (fixedPitcherId) {
    anchorIds.add(fixedPitcherId);
    anchorNonC.add(fixedPitcherId);
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
  //   No kid sits more than (minSits + MAX_SIT_GAP)  the "max 2 extras" rule
  //   When the schedule is empty (no past games), defaults to even split
  // ============================================================
  const minSits = Math.floor(totalBenchSlots / N);
  const maxSits = minSits + BENCH_WEIGHTS.MAX_SIT_GAP;

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
  // A "big" disparity means at least DISPARITY_INNINGS vs team avg. We transfer
  // up to one full sit per pair, capped by maxSits per kid and floor of 0.
  // Apply seasonal disparity transfer  "rob from over played, give to
  // under played." Skip entirely if there's no meaningful disparity (first
  // game of season, or everyone already balanced).
  const hasDisparity = playerDeltas.some(
    (x) => Math.abs(x.delta) >= BENCH_WEIGHTS.DISPARITY_INNINGS,
  );
  if (hasDisparity) {
    // Identify donors (over played, can take more sits) and recipients
    // (under played, can give up sits).
    const donors = playerDeltas
      .filter((x) => x.delta >= BENCH_WEIGHTS.DISPARITY_INNINGS)
      .slice(); // most over played first
    const recipients = playerDeltas
      .filter((x) => x.delta <= -BENCH_WEIGHTS.DISPARITY_INNINGS)
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
      // Find the minimum target across all kids  we cap at min + MAX_SIT_GAP
      // so the gap between most sit and least sit kid never exceeds it.
      let minActual = Infinity;
      for (const t of targetSits.values()) {
        if (t < minActual) minActual = t;
      }
      const dynamicMax = Math.max(
        maxSits,
        minActual + BENCH_WEIGHTS.MAX_SIT_GAP,
      );
      if (donorTarget >= dynamicMax) {
        dIdx++;
        continue;
      }
      // Recipient at 0 already? Can't go below.
      if (recipientTarget <= 0) {
        rIdx++;
        continue;
      }
      // Don't transfer if it would create a gap wider than MAX_SIT_GAP between
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
      if (donorAfter - newMin > BENCH_WEIGHTS.MAX_SIT_GAP) {
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
    const cap = Math.max(
      1,
      Math.floor(totalInnings / BENCH_WEIGHTS.COMPETITIVE_SIT_DIVISOR),
    );
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
    while (remaining > 0 && guard < BENCH_WEIGHTS.REDISTRIBUTE_GUARD) {
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
    while (freed > 0 && guard < BENCH_WEIGHTS.REDISTRIBUTE_GUARD) {
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
      // The game-long pinned pitcher can never catch — he's on the mound every
      // inning. Hard-excluded even from the last-resort reuse tiers below
      // (the anchorNonC `free()` gate alone would still allow those).
      .filter(({ p }) => p.id !== fixedPitcherId)
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
        if (Math.abs(da - db) > BENCH_WEIGHTS.CATCHER_SCARCITY_GAP)
          return da - db;

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
    // A schedule that benches the game-long pinned pitcher can never complete
    // — he must be on the mound this inning.
    if (fixedPitcherId && benchedThisInn.has(fixedPitcherId)) return false;
    const catcherId = catcherByInning.get(inn);
    const pool: string[] = [];
    for (const p of profiled) {
      if (benchedThisInn.has(p.id)) continue;
      if (catcherId && p.id === catcherId) continue; // committed to C
      if (fixedPitcherId && p.id === fixedPitcherId) continue; // committed to P
      pool.push(p.id);
    }
    // Only guard positions that ARE coverable by someone. A position with zero
    // eligible players is a genuine roster gap — let the fill loop surface its
    // specific "no eligible player for X" message rather than masking it as a
    // generic bench-schedule failure here. P is dropped when a game-long
    // pitcher is pinned (he covers it by construction, like the catcher's C).
    const positions = (positionsToFill || []).filter(
      (pos: string) =>
        !(catcherId && pos === "C") &&
        !(fixedPitcherId && pos === "P") &&
        (posEligibleIds.get(pos)?.size || 0) > 0,
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
      // With a game-long pitcher pinned, P is always covered by him (he never
      // sits, never catches) — and, being committed to P, he can't be counted
      // as cover for any OTHER position.
      if (fixedPitcherId && pos === "P") continue;
      if (!ids.has(pid)) continue;
      let others = 0;
      for (const qid of ids) {
        if (qid === pid) continue;
        if (schedule.get(qid)?.has(inn)) continue;
        if (pos !== "C" && qid === catcherId) continue;
        if (qid === fixedPitcherId) continue; // committed to P
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
      // No history  NEUTRAL_PRIOR_RATIO.
      const priorRatio =
        totalPrior > 0
          ? (hist?.benchInn || 0) / totalPrior
          : BENCH_WEIGHTS.NEUTRAL_PRIOR_RATIO;
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
          // The game-long pinned pitcher never absorbs an overflow sit.
          p.id !== fixedPitcherId &&
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
          totalPrior > 0
            ? (hist?.benchInn || 0) / totalPrior
            : BENCH_WEIGHTS.NEUTRAL_PRIOR_RATIO;
        eligible.push({
          p,
          debt: 1,
          priorRatio,
          defInn: hist?.defInn || 0,
          priorExtra:
            (priorExtraSits.get(p.id)?.extraSits || 0) +
            BENCH_WEIGHTS.OVERFLOW_SIT_DISCOURAGE,
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

    // First pass: respect the TOP_HALF_BENCH_CAP per inning, BUT only skip a
    // top half kid if the next kid in line has a similar priorRatio (within
    // TOP_HALF_FAIRNESS_TOLERANCE). Otherwise the fairness gap is more
    // important.
    for (let i = 0; i < eligible.length; i++) {
      const e = eligible[i];
      if (benchedThisInning >= remainingSlots) break;
      // Re-check at pick time: benching earlier kids this inning can make
      // this one the last available player for a position.
      if (wouldStrand(e.p.id, inn)) continue;
      if (
        topHalfIds.has(e.p.id) &&
        topHalfCount >= BENCH_WEIGHTS.TOP_HALF_BENCH_CAP
      ) {
        // Only skip if the next un benched kid in line is within fairness
        // tolerance (so we're not punishing an under played kid)
        let nextKidRatio = null;
        for (let j = i + 1; j < eligible.length; j++) {
          if (schedule.get(eligible[j].p.id).has(inn)) continue;
          nextKidRatio = eligible[j].priorRatio;
          break;
        }
        if (
          nextKidRatio !== null &&
          nextKidRatio - e.priorRatio <=
            BENCH_WEIGHTS.TOP_HALF_FAIRNESS_TOLERANCE
        ) {
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
          if (o.id === fixedPitcherId) continue; // pinned pitcher stays on
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

export function tryBuildLineup(ctx: TryBuildCtx):
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
    fixedPitcherId = null,
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

  // Resolve the age-derived premium set once per build rather than per
  // pickBestForPosition call (it can't change inning to inning). See the
  // MACHINE_PITCH_MAX_AGE block for why the spine differs by age.
  const teamAgeNum = (() => {
    if (!teamAge) return UNKNOWN_TEAM_AGE;
    const m = String(teamAge).match(/(\d+)/g);
    if (!m) return UNKNOWN_TEAM_AGE;
    return parseInt(m[m.length - 1], 10);
  })();
  const PREMIUM_POSITIONS =
    teamAgeNum <= MACHINE_PITCH_MAX_AGE
      ? PREMIUM_POSITIONS_MACHINE_PITCH
      : PREMIUM_POSITIONS_KID_PITCH;

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
    fixedPitcherId, // Kid-Pitch game-long pitcher: never benched, never at C
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

      // KID-PITCH GAME-LONG PITCHER PIN: seat the pinned starter at P before
      // any other pass (sticky locks, the Big-Game pre-pin, lock carry-over,
      // scarcity fill) can claim him for a different slot — the same "seat
      // fixedP first" shape as tournamentPlan. The bench pre-schedule
      // guarantees he is never benched, so this seat succeeds every generated
      // inning and the per-inning P continuity gates below become trivially
      // satisfied (one arm, wire to wire). On a mid-game rebuild this runs
      // from mgFromInning on, seating the arm the rebuild resolved (override
      // or incumbent) — a relieved arm is never resurrected because P is
      // occupied by the pin in every remaining inning.
      if (
        fixedPitcherId &&
        !inningSlots["P"] &&
        positionsToFill.includes("P") &&
        !benchedSet.has(fixedPitcherId)
      ) {
        const pinnedArm = profiled.find((p) => p.id === fixedPitcherId);
        if (
          pinnedArm &&
          !Object.values(inningSlots).some((p: any) => p?.id === fixedPitcherId)
        ) {
          inningSlots["P"] = pinnedArm;
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
          // Kid-Pitch game-long pin: P belongs to the pinned arm only. (He is
          // already seated above, so P is normally out of remainingPositions —
          // this is the explicit gate, not a hot path.)
          if (pos === "P" && fixedPitcherId && p.id !== fixedPitcherId)
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
                ? AUTO_CATCHER_CAP.TEN_FIELDER
                : AUTO_CATCHER_CAP.DEFAULT;
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
          // Kid-Pitch game-long pin: only the pinned arm counts as a P
          // candidate (P is already seated when the pin is active, so this
          // keeps the scarcity count honest rather than changing fill order).
          if (pos === "P" && fixedPitcherId && p.id !== fixedPitcherId)
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
          fixedPitcherId,
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

  // KID-PITCH PIN accounting (deliberate): the game-long pitcher is OUTSIDE
  // the bench-fairness pool — he plays every inning on the mound by rule, so
  // the bench math (floor, spread, extra-sit projection) is computed over the
  // OTHER kids sharing the bench slots. Without this his bench=0 would read
  // as a NEVER_SAT violation and stretch the spread on every attempt, skewing
  // attempt ranking for a structural (not fairness) reason. His innings still
  // land in the season ledger untouched — the emitted plan records him at P,
  // so profile.ts counts them as ordinary defensive innings and future games
  // see him as over-played (he pays the time back later).
  const fairnessPool = fixedPitcherId
    ? profiled.filter((p) => p.id !== fixedPitcherId)
    : profiled;

  // Math floor for this game: with N fairness-pool players and S total bench
  // slots, the minimum number of times any of them must sit is floor(S / N).
  const totalBenchSlots = numToBench * totalInnings;
  const minBenchPerPlayer =
    fairnessPool.length > 0
      ? Math.floor(totalBenchSlots / fairnessPool.length)
      : 0;
  const everyoneShouldSit = minBenchPerPlayer >= 1;
  const exactDivision =
    fairnessPool.length > 0 && totalBenchSlots % fairnessPool.length === 0;

  // Per player extra sit penalty: if a player ends this game with more
  // "extra sits" total across the season than others, that's unfair.
  // We compute each player's projected season extra sits if THIS lineup
  // gets played, then penalize the spread.
  const projectedExtraSits = [];
  for (const p of fairnessPool) {
    const st = state.get(p.id)!;
    const priorExtra = benchHistory.get(p.id)?.extraSits || 0;
    const thisExtra = Math.max(0, st.bench - minBenchPerPlayer);
    projectedExtraSits.push(priorExtra + thisExtra);
  }
  const minExtra = Math.min(...projectedExtraSits);
  const maxExtra = Math.max(...projectedExtraSits);
  const extraSitSpread = maxExtra - minExtra;

  for (const p of fairnessPool) {
    const st = state.get(p.id)!;
    const b = st.bench;
    if (b > maxBench) maxBench = b;
    if (b < minBench) minBench = b;
    if (!isStarter.has(p.id) && b === totalInnings)
      penalty += PENALTY_WEIGHTS.BENCHED_ALL_GAME;

    // Hard fairness floor: if everyone should sit at least once, any player
    // who didn't is heavily penalized. This dominates other concerns.
    if (everyoneShouldSit && b === 0) penalty += PENALTY_WEIGHTS.NEVER_SAT;
  }

  // Diversity penalty: over-concentration at a single non-C/non-P position.
  // Runs over the FULL roster — on a mid-game rebuild the pinned pitcher's
  // replayed field innings still count toward variety like anyone else's.
  for (const p of profiled) {
    const st = state.get(p.id)!;
    for (const pos in st.positions) {
      if (pos === "C" || pos === "P") continue;
      const count = st.positions[pos];
      if (count >= PENALTY_WEIGHTS.POSITION_REPEAT_THRESHOLD) {
        penalty +=
          (count - (PENALTY_WEIGHTS.POSITION_REPEAT_THRESHOLD - 1)) *
          PENALTY_WEIGHTS.POSITION_REPEAT_STEP;
      }
    }
  }

  // This game spread penalty. The bench count spread (max minus min) should be
  // either 0 (exact division) or 1 (non exact). Anything bigger means some
  // kid sat 2+ more than another in the same game  the unfairness pattern
  // we're trying to prevent.
  const idealSpread = exactDivision ? 0 : 1;
  const actualSpread = maxBench - minBench;
  const excessSpread = Math.max(0, actualSpread - idealSpread);
  // Dominates other concerns when the engine has been allowing wider
  // distributions than necessary.
  penalty += excessSpread * PENALTY_WEIGHTS.EXCESS_SPREAD;

  // Cumulative extra sit spread penalty: when some players have taken the
  // "extra sitter" role more than others across the season, that's unfair.
  // Meaningful, but doesn't override hard constraints.
  penalty += extraSitSpread * PENALTY_WEIGHTS.SEASON_EXTRA_SIT_SPREAD;

  return { ok: true, lineup, penalty, lockRelaxedInnings };
}

// ---------- Position scoring ----------

export function pickBestForPosition(opts: PickBestOpts): ProfiledPlayer | null {
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
    fixedPitcherId = null,
    rand,
    premiumPositions,
    positionFlexibility,
  } = opts;

  // Premium positions are computed once in tryBuildLineup and passed in.
  // For Big Games, strong players are pulled toward these spots and weak
  // players are pushed to the OF.
  const isPremium = premiumPositions.has(pos);

  // KID-PITCH GAME-LONG PITCHER PIN — when a game-long pitcher is pinned, P is
  // not a rotating slot: only the pinned arm may take the mound. buildSlots
  // seats him before the fill loop, so this path normally never runs; it
  // exists so no code path that DOES reach the picker for P (and no future
  // one) can quietly rotate another arm in. It deliberately supersedes the
  // per-inning pool short-circuit and the "consecutive-only" continuity rule
  // below — with one arm wire-to-wire both are trivially satisfied.
  if (pos === "P" && fixedPitcherId) {
    for (const p of profiled) {
      if (p.id !== fixedPitcherId) continue;
      if (used.has(p.id) || benchedSet.has(p.id)) return null;
      return p;
    }
    return null;
  }

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
          ? AUTO_CATCHER_CAP.TEN_FIELDER
          : AUTO_CATCHER_CAP.DEFAULT;
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
      softPenalty += ROTATION_WEIGHTS.SAME_POSITION_BACK_TO_BACK;
    }
    if (
      (positionLock === "1" || positionLock === "2") &&
      OF_POSITIONS.has(pos) &&
      inn >= 2
    ) {
      const h = st.history;
      if (OF_POSITIONS.has(h[inn - 1]) && OF_POSITIONS.has(h[inn - 2])) {
        softPenalty += ROTATION_WEIGHTS.OUTFIELD_LOCK_REPEAT;
      }
    }

    let score =
      Math.abs(
        (POS_DIFFICULTY[pos] || SCORE_WEIGHTS.NEUTRAL_DIFFICULTY) -
          SCORE_WEIGHTS.NEUTRAL_DIFFICULTY,
      ) + softPenalty;

    const histPos = positionHistory.get(p.id);
    const histEntry = histPos?.get(pos) || { total: 0, bigGame: 0 };
    const seasonCount = histEntry.total;
    const bigGameCount = histEntry.bigGame;
    // Fair mode: aggressive rotation pressure (heavy push to rotate to a
    // different kid). Big Game: lighter pressure  let strong defenders stay
    // at premium spots even if they've played there a lot, since winning
    // matters more.
    const rotationWeight = isBigGame
      ? ROTATION_WEIGHTS.BIG_GAME
      : ROTATION_WEIGHTS.FAIR;
    // FAIR MODE intra-OF cycling: outfield positions get an extra rotation
    // multiplier so a kid who already played RF this game gets actively
    // pushed to CF/LF on their next OF inning instead of settling back into
    // RF whenever they cycle off the bench. The back-to-back penalty only
    // catches the immediately-prior inning, so RF→bench→RF→bench→RF was
    // still possible at default weight (jitter sometimes wins over the base
    // pressure). Big Game ignores the boost — strong defenders parking in a
    // premium OF (typically CF) is desired there.
    const isOF = OF_POSITIONS.has(pos);
    const ofRotationBoost =
      !isBigGame && isOF ? ROTATION_WEIGHTS.OUTFIELD_CYCLE_BOOST : 1;
    score +=
      (seasonCount + (st.positions[pos] || 0)) *
      rotationWeight *
      ofRotationBoost;
    // FAIR MODE compensatory rotation: kids who've played this position in
    // Big Games get an additional push away from it in fair mode. Helps
    // share premium positions across the roster over the season.
    if (!isBigGame && bigGameCount > 0) {
      score += bigGameCount * ROTATION_WEIGHTS.BIG_GAME_HISTORY_PAYBACK;
    }

    // Random jitter  more aggressive for fair mode so similar skilled kids
    // genuinely shuffle, less for Big Game where we want consistency.
    score +=
      rand() *
      (isBigGame ? SCORE_WEIGHTS.JITTER_BIG_GAME : SCORE_WEIGHTS.JITTER_FAIR);

    if (pos === "SS" || pos === "3B") {
      const headG = headGrades[p.id]?.armStrength;
      const armBonus =
        typeof headG === "number" ? headG : SCORE_WEIGHTS.DEFAULT_ARM_GRADE;
      // Big Game: full arm strength bias. Fair mode: half.
      score -=
        armBonus *
        (isBigGame
          ? SCORE_WEIGHTS.ARM_BIAS_BIG_GAME
          : SCORE_WEIGHTS.ARM_BIAS_FAIR);
    }

    if (p.throws === "L") {
      if (INFIELD_NON_1B.has(pos)) score += leftyPenalty ?? 0;
      else if (pos === "1B") score -= SCORE_WEIGHTS.LEFTY_1B_BONUS;
    }

    if (isLockInning && playedHereLast)
      score -= SCORE_WEIGHTS.LOCK_CARRYOVER_BONUS;

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
        score -= SCORE_WEIGHTS.BIG_GAME_PRIMARY_PIN;
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
        score -= SCORE_WEIGHTS.COMFORT_BONUS;
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
      const skill = Math.min(
        Math.max(overall / SCORE_WEIGHTS.SKILL_SCALE, 0),
        1,
      );
      if (isPremium) {
        score -=
          skill * SCORE_WEIGHTS.PREMIUM_PULL_SLOPE -
          SCORE_WEIGHTS.PREMIUM_PULL_OFFSET;
        // Position importance: the spine is Pitcher > Catcher > 1B. An extra
        // skill-scaled pull so the strongest available players are steered to
        // those first (ahead of SS/3B). Skill-scaled, so weak players aren't
        // distorted and feasibility is unaffected.
        score -= skill * (PREMIUM_IMPORTANCE_EXTRA[pos] || 0);
      } else if (OF_POSITIONS.has(pos)) {
        score +=
          skill * SCORE_WEIGHTS.OUTFIELD_PUSH_SLOPE -
          SCORE_WEIGHTS.OUTFIELD_PUSH_OFFSET;
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
