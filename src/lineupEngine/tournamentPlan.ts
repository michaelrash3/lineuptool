// lineupEngine/tournamentPlan.ts
// Tournament (competitive) generator: a scripted best-XI plan with unit subs,
// starter returns, and a ranked relief list. A distinct algorithm from the Rec
// fairness solver in generator.ts.
import type {
  EngineInput,
  EngineResult,
  Game,
  Inning,
  SlimPlayer,
  TournamentPlan,
  TournamentSubstitution,
} from "../types";
import type { ProfiledPlayer } from "./types";
import { buildProfiledPlayers, resolveGameContext } from "./engineContext";
import { buildPitchingPlan, checkPitchEligibility } from "./pitchRules";
import { calcPitcherScore, calcCatcherScore } from "./evaluation";
import {
  isPositionBlocked,
  isHardRestricted,
  isCatcherEligible,
  resolveCatcherPolicy,
  getPositionsForInning,
} from "./eligibility";
import { maxPositionMatching } from "./benchSchedule";
import { generateBattingOrder } from "./battingOrder";

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

  const {
    combinedGrades: grades,
    profiled,
    byId,
  } = buildProfiledPlayers({
    activePlayers,
    allPlayers,
    evaluationEvents,
    games,
    teamAge,
  });

  const defSizeNum = parseInt(defenseSize, 10) || 9;
  const positions = getPositionsForInning(
    Math.min(profiled.length, defSizeNum),
    defenseSize,
  );
  const { ruleSet, gameDate, kidPitch } = resolveGameContext({
    pitchRuleSet,
    currentGame,
    pitchingFormat,
  });
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
