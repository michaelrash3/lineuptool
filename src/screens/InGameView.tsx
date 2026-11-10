import React, { memo, useState, useRef, useCallback, useEffect } from "react";
import { Icons } from "../icons";
import {
  formatGameDateDisplay,
  sameDayRoleSets,
  playsGame,
  recordPitchingOuting,
  removePitchingOutingEntry,
} from "../utils/helpers";
import {
  pitchBudgetFor,
  generateLineup,
  resolvePitchRuleSet,
} from "../lineupEngine";
import { shareLineupCard } from "../lineup/lineupCard";
import { applySwap, getPlayerAt, fillVacatedSpot } from "../lineup/inGameSwap";
import { useTeam, useUI, useToast } from "../contexts";
import { A11yDialog } from "../components/shared";
import { SyncStatusPill } from "../components/Chrome";
import { featureEnabled } from "../constants/features";
import { useNavigate } from "react-router-dom";
import { laterPlannedGamesForPlayer } from "../utils/tournamentPitching";
import { relievedArmIds } from "../utils/pitchingWorkload";
import {
  liveMarginAdvisory,
  tournamentForGame,
} from "../utils/tournamentStakes";

// Durable manual position picks are tracked for FIELD positions only. P keeps
// its pitch-count-governed rotation and C its catcher-block continuity, so we
// never lock those — they're honored for the current inning via the point
// override, but not held game-long.
const LOCKABLE = (pos: string) => pos !== "P" && pos !== "C" && pos !== "BENCH";

// Fold a manual move into the durable lock map. `assignments` is the post-move
// occupant of each tapped spot. A player can hold only one locked spot, so any
// stale lock elsewhere for that player is cleared (they moved). Moving into P/C
// (or the bench) just clears the player's old field lock.
const nextManualLocks = (
  prev: Record<string, string> | undefined,
  assignments: { pos: string; playerId?: string }[],
): Record<string, string> => {
  const locks: Record<string, string> = { ...(prev || {}) };
  for (const { pos, playerId } of assignments) {
    if (!playerId) continue;
    for (const k of Object.keys(locks))
      if (locks[k] === playerId && k !== pos) delete locks[k];
    if (LOCKABLE(pos)) locks[pos] = playerId;
    else delete locks[pos];
  }
  return locks;
};

// Keep existing durable picks current without creating new ones: a kid who
// moves gives up any hold they had elsewhere, and a kid arriving at a spot
// someone else held takes the hold over (the coach just overrode it).
const keepManualLocksCurrent = (
  prev: Record<string, string> | undefined,
  assignments: { pos: string; playerId?: string }[],
): Record<string, string> => {
  const locks: Record<string, string> = { ...(prev || {}) };
  for (const { pos, playerId } of assignments) {
    if (!playerId) continue;
    for (const k of Object.keys(locks))
      if (locks[k] === playerId && k !== pos) delete locks[k];
    if (LOCKABLE(pos) && pos in locks) locks[pos] = playerId;
  }
  return locks;
};

export const InGameView = memo(() => {
  const navigate = useNavigate();
  const {
    team,
    updateGame,
    updatePlayer,
    removePlayerMidGame: removePlayerMidGameAction,
    setPlayerHealth,
    currentRole,
    syncStatus,
  } = useTeam();
  // Whether the Development module is on — gates the "also mark Out"
  // persistence hook on injury removals.
  const devEnabled = featureEnabled(team, "development");
  // Assistants can view the running game (so they can shadow the coach
  // from the dugout) but can't swap players or take destructive actions.
  const canEdit = currentRole !== "assistant";
  const toast = useToast();
  const {
    inGameId,
    setInGameId,
    inGameInning,
    setInGameInning,
    inGameSelection,
    setInGameSelection,
    inGameUndoStack,
    setInGameUndoStack,
  } = useUI();
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [showScoreEditor, setShowScoreEditor] = useState(false);
  // Two-tap confirm for mid-game removal: first tap arms the row,
  // second tap commits. Replaces a blocking window.confirm — keeps
  // the coach inside the modal context.
  const [pendingRemovePlayerId, setPendingRemovePlayerId] = useState<
    string | null
  >(null);
  const [pendingRestorePlayerId, setPendingRestorePlayerId] = useState<
    string | null
  >(null);
  // Injury removals can also persist a health status on the profile so the
  // NEXT game defaults the kid to absent — default on; the coach unticks it
  // for a precautionary pull that isn't a real injury.
  const [alsoMarkOut, setAlsoMarkOut] = useState(true);

  // ----- Coalesce in-game tap-swap writes -----
  // Each tap previously fired its own setDoc, so a flurry of swaps became
  // a flurry of writes — costly, and on tab close the latest swap could
  // drop from the offline queue. Keep an optimistic `pendingLineup`
  // locally for instant UI feedback and debounce-flush a single write
  // covering the latest state. Flush eagerly when the page hides /
  // unloads / unmounts so nothing is lost.
  //
  // These hooks must live above the early returns below so React sees
  // the same hook order on every render — the rules-of-hooks invariant.
  const [pendingLineup, setPendingLineup] = useState<any[] | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the live game without an early return so downstream hooks
  // still execute on null-game renders. The actual null/missing-game
  // bailouts happen below the hook block.
  const game = inGameId ? team.games.find((g: any) => g.id === inGameId) : null;
  const gameId = game?.id ?? null;

  const flush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setPendingLineup((cur) => {
      if (cur && gameId) updateGame(gameId, { lineup: cur });
      return null;
    });
  }, [gameId, updateGame]);

  // Reset pending state when the user switches to a different in-game game.
  useEffect(() => {
    setPendingLineup(null);
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, [inGameId]);

  // Drop the armed-for-removal state whenever the modal closes so the row
  // isn't still "primed" the next time the modal opens.
  useEffect(() => {
    if (!showRemoveModal) {
      setPendingRemovePlayerId(null);
      setPendingRestorePlayerId(null);
      setAlsoMarkOut(true);
    }
  }, [showRemoveModal]);

  // Flush eagerly on visibility change / page hide / unmount so a tab
  // close mid-edit doesn't drop the latest swap from the offline write
  // queue.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  // An assistant shadowing from the dugout follows the head coach's inning
  // (saved on the game as they step through it). The head coach's own view
  // is restored once on open (UIProvider) and then driven by their taps.
  const followedInning = game?.liveInning;
  useEffect(() => {
    if (canEdit || typeof followedInning !== "number") return;
    setInGameInning(followedInning);
  }, [canEdit, followedInning, setInGameInning]);

  // ----- Live pitch counts -----
  // Teams without a GameChanger box score had no way to count pitches, so
  // availability was judged from empty logs. The head coach can now tap the
  // count up as the game goes. Taps show instantly and are written to the
  // pitcher's log right away as ONE outing tagged with this game's id (each
  // tap rewrites that single entry) — which is exactly what a later box-score
  // import replaces (it dedupes on gameId), so importing never double-counts.
  const [livePitches, setLivePitches] = useState<Record<string, number>>({});
  useEffect(() => {
    setLivePitches({});
  }, [inGameId]);

  if (!inGameId) return null;
  if (!game) return null;
  if (!game.lineup?.length) {
    // Edge case: someone hit "Start Game" before generating a lineup
    return (
      <div className="fixed inset-0 z-[85] bg-slate-900/95 backdrop-blur-sm flex flex-col items-center justify-center p-6">
        <div className="bg-surface rounded-2xl shadow-2xl max-w-md w-full p-8 text-center border border-line">
          <Icons.Clipboard className="w-12 h-12 text-ink-3 mx-auto mb-4" />
          <h3 className="t-h2 mb-2">No Lineup Generated</h3>
          <p className="text-sm text-ink-3 font-medium mb-6">
            You need to generate a lineup before starting in-game mode.
          </p>
          <button
            onClick={() => setInGameId(null)}
            className="text-xs font-black uppercase tracking-widest px-5 py-3 bg-surface-2 text-ink border border-line rounded-xl hover:bg-line transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Display data: prefer the local pending lineup (for instant UI) and
  // fall back to the persisted game.lineup. Reseed automatically when
  // game.lineup changes by virtue of pendingLineup being cleared on
  // flush completion.
  const liveLineup = pendingLineup ?? game.lineup;

  const totalInnings = liveLineup.length;
  const currentInning = Math.min(Math.max(0, inGameInning), totalInnings - 1);
  const inn = liveLineup[currentInning];
  const { primaryColor, tertiaryColor } = team;

  // Dual-role arm-health rules, enforced live in game mode (the generator
  // enforces them when building a lineup; manual in-game moves must too):
  //   • a kid slated to CATCH in this game can't be put on the mound, and
  //   • a kid who PITCHED in this game (or an earlier game the same day) can't
  //     be slid behind the plate.
  // Catchers/pitchers "this game" = anyone who appears at C / P in any inning;
  // same-day roles come from other games on the same date.
  const sameDayRoles = sameDayRoleSets(team.players, game.date, game.id);
  const catchersThisGame = new Set<string>();
  for (const innx of liveLineup) {
    const cId = (innx?.C as any)?.id;
    if (cId) catchersThisGame.add(cId);
  }
  // Should the Available list offer this arm? Not if they're catching this game
  // or caught earlier today. (A list of suggestions only — the coach can still
  // put anyone on the mound by tapping; that's applied with a heads-up.)
  const canPitchDual = (id: string) =>
    !catchersThisGame.has(id) && !sameDayRoles.caught.has(id);

  // Position order — display order (matches existing lineup grid)
  const positionOrder = [
    "P",
    "C",
    "1B",
    "2B",
    "3B",
    "SS",
    "LF",
    "LCF",
    "CF",
    "RCF",
    "RF",
  ];
  const presentPositions = positionOrder.filter((pos) => inn[pos]);

  // Mid-game removal state (injury / illness / left site). When the coach
  // marks a kid removed, they're gone from the lineup for the current
  // inning and every inning after — but innings 0..N-1 still count for
  // their season totals (the engine's buildExtraSitHistory respects
  // game.midGameRemovals when crunching past games). showRemoveModal
  // hook is declared up top with the other state to keep hook order
  // stable across renders.

  // Soft tap on every swap so the coach gets tactile confirmation without
  // having to look at the screen. Android Chrome respects this; iOS Safari
  // ignores it as a graceful no-op.
  const tapHaptic = () => {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(15);
    }
  };

  // Bump a score by ±1, clamped to 0. Writes through updateGame directly
  // (no debounce) since score updates are infrequent and the coach wants
  // immediate persistence in case the page is closed mid-edit.
  const adjustScore = (which: any, delta: any) => {
    if (!canEdit) return;
    const current =
      (which === "team" ? game.teamScore : game.opponentScore) ?? 0;
    const next = Math.max(0, current + delta);
    updateGame(
      game.id,
      which === "team" ? { teamScore: next } : { opponentScore: next },
    );
  };

  // Apply a mid-game removal: record it on the game, clear the player
  // from inning N+ across both position slots and BENCH. The vacated
  // spot is left null so the coach can swap in a bench kid manually
  // (which is consistent with how a real coach handles a sub on the
  // field — the umpire/scorekeeper waits while you pick a replacement).
  const removePlayerMidGame = (playerId: any, reason = "injury") => {
    // Flush any in-flight optimistic edits first so the engine rebuild sees
    // the latest lineup state (not a stale Firestore copy).
    setPendingLineup((cur) => {
      if (cur) updateGame(game.id, { lineup: cur });
      return null;
    });
    // A removed player can't hold a manual lock anymore — drop it so the
    // refill isn't forced to seat someone who just left.
    const locks: Record<string, string> = game.manualLocks || {};
    if (Object.values(locks).includes(playerId)) {
      const nextLocks: Record<string, string> = {};
      for (const [pos, id] of Object.entries(locks))
        if (id !== playerId) nextLocks[pos] = id;
      updateGame(game.id, { manualLocks: nextLocks });
    }
    // Delegate to the TeamProvider orchestrator — it runs the engine to
    // refill the defensive slots and strips the player from battingLineup.
    removePlayerMidGameAction?.(playerId, {
      gameId: game.id,
      fromInning: currentInning,
      reason,
      currentLineup: pendingLineup ?? game.lineup,
      currentBatting: game.battingLineup,
    });
    // Optionally persist the injury on the profile so upcoming games default
    // this kid to absent until the coach clears them (or sets a return date).
    if (reason === "injury" && alsoMarkOut && devEnabled) {
      setPlayerHealth?.(playerId, {
        status: "out",
        note: "Removed mid-game (injury)",
      });
    }
    setShowRemoveModal(false);
  };

  // Currently-active roster set: present and not already removed.
  // Used by the removal modal to list eligible players.
  const eligibleForRemoval = (() => {
    const removed = game.midGameRemovals || {};
    const ids = new Set();
    // Include anyone currently in a position or on the bench this inning.
    for (const pos of Object.keys(inn || {})) {
      if (pos === "BENCH") continue;
      const p = inn[pos];
      if (p && !removed[p.id]) ids.add(p.id);
    }
    for (const bp of inn?.BENCH || []) {
      if (bp && !removed[bp.id]) ids.add(bp.id);
    }
    // Map ids back to players. Use the in-game inning's own data (slim
    // player records) so the names match what's on the field.
    const byId = new Map();
    for (const pos of Object.keys(inn || {})) {
      if (pos === "BENCH") continue;
      const p = inn[pos];
      if (p) byId.set(p.id, p);
    }
    for (const bp of inn?.BENCH || []) if (bp) byId.set(bp.id, bp);
    return [...ids].map((id) => byId.get(id)).filter(Boolean);
  })();

  // ----- Editing the live lineup -----
  // An edit is a FACT, not a suggestion. Whatever the coach sets for the inning
  // they're on is exactly what that inning becomes — nothing is refused and the
  // engine never reshuffles it. Every inning AFTER it is then re-planned around
  // what has actually happened so far (innings 0..current, as edited): the
  // fairness math counts the sits already taken, a catcher mid-block finishes
  // the block, and in Kid Pitch the arm on the mound now keeps the ball. Rec
  // games re-plan with the fair-play engine, Tournament games with the
  // competitive one (best-XI + minimum-play floor) — the same pair that builds
  // their lineups.
  const replanAfter = (
    edited: any[],
    fromIdx: number,
    locks: Record<string, string>,
  ): { lineup: any[] } | { error: string } => {
    if (fromIdx >= edited.length - 1) return { lineup: edited };
    const current = edited[fromIdx] || {};
    const activeIds = new Set<string>();
    for (const pos of Object.keys(current)) {
      if (pos === "BENCH") continue;
      const p = current[pos];
      if (p?.id) activeIds.add(p.id);
    }
    for (const p of current.BENCH || []) if (p?.id) activeIds.add(p.id);
    const roster = team.players || [];
    const byId = new Map<string, any>(roster.map((p: any) => [p.id, p]));
    const activePlayers = [...activeIds]
      .map((id) => byId.get(id))
      .filter(Boolean) as any[];
    // Durable manual picks (field positions) the re-plan keeps holding — only
    // for kids still in the game.
    const stickyPins: Record<string, string> = {};
    for (const [pos, id] of Object.entries(locks))
      if (id && activeIds.has(id)) stickyPins[pos] = id;
    const isTournament = (game.leagueRuleSet || team.leagueRuleSet) === "USSSA";
    let result: any;
    try {
      result = generateLineup({
        activePlayers,
        allPlayers: roster.length ? roster : activePlayers,
        games: team.games || [],
        evaluationEvents: team.evaluationEvents || [],
        currentGame: game,
        firstInningOverridesById: {},
        stickyOverridesById: stickyPins,
        totalInnings: edited.length,
        fromInning: fromIdx + 1,
        currentLineup: edited,
        leagueRuleSet: game.leagueRuleSet || team.leagueRuleSet,
        competitive: isTournament,
        depthChart: team.depthChart,
        pitchRuleSet: resolvePitchRuleSet({
          pitchRuleSet: team.pitchRuleSet,
          customPitchLimit: team.customPitchLimit,
          customRestTiers: team.customRestTiers,
        }),
        sameDayRoles: sameDayRoleSets(roster, game.date, game.id),
        teamAge: team.teamAge,
        defenseSize: game.defenseSize || team.defenseSize,
        positionLock: game.positionLock || team.positionLock,
        battingSize: game.battingSize || team.battingSize,
        pitchingFormat: game.pitchingFormat || team.pitchingFormat,
        catcherMaxInnings: game.catcherMaxInnings || team.catcherMaxInnings,
        catcherConsecutive: game.catcherConsecutive ?? team.catcherConsecutive,
        isBigGame: game.isBigGame === true,
        seed: Date.now() + Math.floor(Math.random() * 1e6),
        relaxFairness: game.applySeasonalFairness === false,
      } as any);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (result?.error) return { error: String(result.error) };
    const rebuilt = result?.lineup;
    if (!Array.isArray(rebuilt) || rebuilt.length < edited.length)
      return { error: "The engine returned an incomplete lineup." };
    // Innings 0..fromIdx are taken from `edited` itself (never the engine's
    // replay of them), so the inning the coach just set is exactly as set.
    return {
      lineup: edited.map((inn: any, idx: number) =>
        idx <= fromIdx
          ? inn
          : {
              ...rebuilt[idx],
              BENCH: Array.isArray(rebuilt[idx].BENCH)
                ? [...rebuilt[idx].BENCH]
                : [],
            },
      ),
    };
  };

  const inningRange = (from: number, to: number) =>
    from === to ? `inning ${from}` : `innings ${from}–${to}`;

  // Commit an edit to the CURRENT inning: write it exactly, re-plan the rest of
  // the game, keep one whole-lineup undo snapshot, and say what happened. If
  // the re-plan can't run, the edit still stands — the later innings just keep
  // their old plan (`fallbackLater`, when given, patches each of them first).
  const commitInningEdit = (
    editedInning: any,
    opts: {
      title: string;
      message: string;
      locks: Record<string, string>;
      warnings: string[];
      fallbackLater?: (inn: any) => any;
    },
  ) => {
    const base = pendingLineup ?? game.lineup;
    const edited = base.map((inn: any, i: number) =>
      i === currentInning ? editedInning : inn,
    );
    const replan = replanAfter(edited, currentInning, opts.locks);
    const isLast = currentInning >= edited.length - 1;
    let nextLineup: any[];
    let replanError: string | null = null;
    if ("error" in replan) {
      replanError = replan.error;
      nextLineup = opts.fallbackLater
        ? edited.map((inn: any, i: number) =>
            i > currentInning ? opts.fallbackLater!(inn) : inn,
          )
        : edited;
    } else {
      nextLineup = replan.lineup;
    }

    setPendingLineup(nextLineup);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flush, 500);
    // Holds only steer re-plans, so the last inning (nothing left to plan)
    // doesn't record new ones.
    const priorLocks = game.manualLocks || {};
    if (!isLast && JSON.stringify(priorLocks) !== JSON.stringify(opts.locks))
      updateGame(game.id, { manualLocks: opts.locks });
    setInGameUndoStack(
      [{ lineup: base, locks: priorLocks }, ...inGameUndoStack].slice(0, 5),
    );
    setInGameSelection(null);
    tapHaptic();

    const rest = inningRange(currentInning + 2, edited.length);
    const later = isLast
      ? ""
      : replanError
        ? ` Couldn't re-plan ${rest} (${replanError}) — they keep their old plan.`
        : ` ${rest[0].toUpperCase()}${rest.slice(1)} re-planned around it.`;
    const headsUp = opts.warnings.length
      ? ` Heads up: ${opts.warnings.join(" ")}`
      : "";
    toast.push({
      kind: replanError || opts.warnings.length ? "warn" : "success",
      title: opts.title,
      message: `${opts.message}${later}${headsUp}`,
      duration: replanError || opts.warnings.length ? 8000 : 4000,
    });
  };

  // One-tap pitching change from the Available pool: the reliever takes the
  // mound THIS inning by trading places with the pitcher (the pulled arm goes
  // to the reliever's spot — field or bench), exactly like tapping the two
  // cells. The innings after it re-plan around the new arm.
  const assignPitcher = (playerId: any) => {
    const innNow = liveLineup[currentInning];
    if (!innNow || innNow.P?.id === playerId) return;
    let sourceSel: any = null;
    for (const pos of positionOrder) {
      if (innNow[pos]?.id === playerId) {
        sourceSel = { type: "position", pos };
        break;
      }
    }
    if (!sourceSel) {
      const onBench = (innNow.BENCH || []).find((p: any) => p?.id === playerId);
      if (onBench) sourceSel = { type: "bench", playerId };
    }
    if (!sourceSel) return;
    performSwap({ type: "position", pos: "P" }, sourceSel);
  };

  // Resolve from the roster whether a slim player is cleared to catch
  // (C is opt-in: in comfortablePositions and not restricted).
  const clearedToCatch = (slim: any) => {
    const rp = (team?.players || []).find((p: any) => p.id === slim?.id);
    const list = Array.isArray(rp?.comfortablePositions)
      ? rp.comfortablePositions
      : [];
    const restr = Array.isArray(rp?.restrictions) ? rp.restrictions : [];
    return list.includes("C") && !restr.includes("C");
  };

  // Perform a swap of two tapped cells in the current inning. The pure
  // transform lives in ../lineup/inGameSwap; this decides the lock bookkeeping
  // and the wording, then commits through commitInningEdit.
  const performSwap = (firstSel: any, secondSel: any) => {
    if (!canEdit) return;
    const liveInning = liveLineup[currentInning];
    const playerA = getPlayerAt(liveInning, firstSel);
    const playerB = getPlayerAt(liveInning, secondSel);
    const next = applySwap(liveInning, firstSel, secondSel);
    if (!playerA || !playerB || !next) {
      setInGameSelection(null);
      return;
    }
    // After the swap firstSel holds playerB and secondSel holds playerA, so the
    // player ARRIVING at a position is the OTHER selection's player.
    const arrivingAt = (pos: string) =>
      firstSel.type === "position" && firstSel.pos === pos
        ? playerB
        : secondSel.type === "position" && secondSel.pos === pos
          ? playerA
          : null;

    // Heads-ups, never refusals: the coach is telling us what's happening on
    // the field. "This game" means the innings already played (before this
    // one) — the planned innings are about to be re-planned anyway.
    const played = liveLineup.slice(0, currentInning);
    const caughtEarlier = new Set(
      played.map((i: any) => i?.C?.id).filter(Boolean),
    );
    const pitchedEarlier = new Set(
      played.map((i: any) => i?.P?.id).filter(Boolean),
    );
    const warnings: string[] = [];
    const incomingC = arrivingAt("C");
    if (incomingC) {
      if (!clearedToCatch(incomingC))
        warnings.push(
          `${incomingC.name} isn't set as a catcher on the roster.`,
        );
      if (
        pitchedEarlier.has(incomingC.id) ||
        sameDayRoles.pitched.has(incomingC.id)
      )
        warnings.push(
          `${incomingC.name} pitched ${
            pitchedEarlier.has(incomingC.id) ? "this game" : "earlier today"
          } — arm-care rules say no catching the same day.`,
        );
    }
    const incomingP = arrivingAt("P");
    if (
      incomingP &&
      (caughtEarlier.has(incomingP.id) || sameDayRoles.caught.has(incomingP.id))
    )
      warnings.push(
        `${incomingP.name} caught ${
          caughtEarlier.has(incomingP.id) ? "this game" : "earlier today"
        } — arm-care rules say no pitching the same day.`,
      );

    const isSubstitution =
      firstSel.type === "bench" || secondSel.type === "bench";
    const isTournamentGame =
      (game.leagueRuleSet || team.leagueRuleSet) === "USSSA";
    const touchesBattery = [firstSel, secondSel].some(
      (s: any) => s.type === "position" && (s.pos === "P" || s.pos === "C"),
    );
    // Who lands where (field spots only) after the swap.
    const arrivals = [
      firstSel.type === "position" && {
        pos: firstSel.pos,
        playerId: playerB.id,
      },
      secondSel.type === "position" && {
        pos: secondSel.pos,
        playerId: playerA.id,
      },
    ].filter(Boolean) as { pos: string; playerId: string }[];
    // Durable manual picks: a Tournament position move, or any move that
    // touches the battery, holds the tapped field spots for the rest of the
    // game (P/C themselves are never held — the pitch-count and catcher-block
    // rules govern them). Any other move just keeps existing picks current: a
    // kid arriving at a held spot takes the hold over.
    const locks =
      touchesBattery || (isTournamentGame && !isSubstitution)
        ? nextManualLocks(game.manualLocks, arrivals)
        : keepManualLocksCurrent(game.manualLocks, arrivals);

    const inning = currentInning + 1;
    let title = "Lineup updated";
    let message = `${playerA.name} and ${playerB.name} switched in inning ${inning}.`;
    let fallbackLater: ((inn: any) => any) | undefined;
    if (isSubstitution && firstSel.type !== secondSel.type) {
      // A substitution: one player comes off the bench, one goes to it.
      const posSel = firstSel.type === "position" ? firstSel : secondSel;
      const enter = firstSel.type === "bench" ? playerA : playerB;
      const exit = firstSel.type === "bench" ? playerB : playerA;
      title =
        posSel.pos === "P"
          ? "Pitching change"
          : posSel.pos === "C"
            ? "Catcher change"
            : "Substitution";
      message = `${enter.name} in for ${exit.name} at ${posSel.pos} in inning ${inning}.`;
      // If the re-plan can't run, still carry the sub forward in the exact
      // spot where the rest of the old plan has the same situation.
      fallbackLater = (inn: any) =>
        fillVacatedSpot(inn, posSel.pos, exit.id, enter, clearedToCatch);
    } else if (incomingP) {
      title = "Pitching change";
      const outgoing = incomingP.id === playerA.id ? playerB : playerA;
      const outgoingTo =
        arrivals.find((a) => a.playerId === outgoing.id)?.pos || "the bench";
      message = `${incomingP.name} pitching in inning ${inning}; ${outgoing.name} to ${outgoingTo}.`;
    } else if (incomingC) {
      title = "Catcher change";
      message = `${incomingC.name} catching in inning ${inning}.`;
    } else if (isSubstitution) {
      message = `${playerA.name} and ${playerB.name} switched on the bench.`;
    }

    commitInningEdit(next, { title, message, locks, warnings, fallbackLater });
  };

  const handleTap = (sel: any) => {
    // Assistants can't move players around — short-circuit any tap.
    if (!canEdit) return;
    // If nothing selected → select this one
    if (!inGameSelection) {
      setInGameSelection(sel);
      return;
    }
    // If tapping the same cell → deselect
    const isSame =
      inGameSelection.type === sel.type &&
      ((sel.type === "position" && inGameSelection.pos === sel.pos) ||
        (sel.type === "bench" && inGameSelection.playerId === sel.playerId));
    if (isSame) {
      setInGameSelection(null);
      return;
    }
    // Otherwise → swap
    performSwap(inGameSelection, sel);
  };

  const undo = () => {
    if (inGameUndoStack.length === 0) return;
    const entry = inGameUndoStack[0];
    // Restore the whole lineup captured before the edit — the edited inning
    // AND the re-planned innings after it.
    if (entry.lineup) {
      setPendingLineup(entry.lineup);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flush, 500);
    }
    // Restore the manual locks captured before the change this entry undoes.
    if (entry.locks !== undefined)
      updateGame(game.id, { manualLocks: entry.locks });
    setInGameUndoStack(inGameUndoStack.slice(1));
    setInGameSelection(null);
  };

  const isCellSelected = (sel: any) => {
    if (!inGameSelection) return false;
    if (inGameSelection.type !== sel.type) return false;
    if (sel.type === "position") return inGameSelection.pos === sel.pos;
    return inGameSelection.playerId === sel.playerId;
  };

  // Closing keeps everything: the lineup is saved, the inning is remembered,
  // and undo survives until a DIFFERENT game is opened (see UIProvider).
  const close = () => {
    flush();
    setInGameId(null);
    setInGameSelection(null);
  };

  // Step innings. The head coach's inning is saved on the game so reopening
  // (or a reload) resumes here and an assistant's view follows along.
  const goToInning = (n: number) => {
    const next = Math.min(Math.max(0, n), totalInnings - 1);
    setInGameInning(next);
    if (canEdit && game.liveInning !== next)
      updateGame(game.id, { liveInning: next });
  };

  // This game's logged pitches for a pitcher: the live tally if the coach has
  // tapped, else what the log already holds for this game.
  const rosterById = new Map<string, any>(
    (team.players || []).map((p: any) => [p.id, p]),
  );
  const loggedPitchesThisGame = (playerId: string) => {
    const log = rosterById.get(playerId)?.pitching?.log;
    if (!Array.isArray(log)) return 0;
    return log
      .filter((o: any) => o && o.gameId === game.id)
      .reduce((sum: number, o: any) => sum + (Number(o.pitches) || 0), 0);
  };
  const pitchesThisGame = (playerId: string) =>
    livePitches[playerId] ?? loggedPitchesThisGame(playerId);
  const writePitchCount = (playerId: string, count: number) => {
    const rp = rosterById.get(playerId);
    if (!rp || !game.date) return;
    const pitching = rp.pitching || {};
    if (count > 0) {
      updatePlayer?.(playerId, {
        pitching: recordPitchingOuting(pitching, game.date, count, game.id),
      });
    } else {
      const log = Array.isArray(pitching.log) ? pitching.log : [];
      const idx = log.findIndex((o: any) => o && o.gameId === game.id);
      if (idx >= 0)
        updatePlayer?.(playerId, {
          pitching: removePitchingOutingEntry(pitching, idx),
        });
    }
  };
  const adjustPitches = (playerId: string, delta: number) => {
    if (!canEdit) return;
    const next = Math.max(0, pitchesThisGame(playerId) + delta);
    setLivePitches((cur) => ({ ...cur, [playerId]: next }));
    writePitchCount(playerId, next);
  };

  const benchKids = inn.BENCH || [];

  return (
    <div className="fixed inset-0 z-[85] bg-slate-900 overflow-y-auto">
      {/* Top bar */}
      <div className="bg-surface border-b border-line">
        <div className="h-1.5" style={{ backgroundColor: primaryColor }} />
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={close}
            className="min-w-[48px] min-h-[48px] flex flex-col items-center justify-center gap-0.5 hover:bg-surface-2 text-ink-2 rounded-lg transition-colors"
            aria-label="Close in-game mode"
            title="Close — the lineup and inning are saved; resume from Home"
          >
            <Icons.X className="w-5 h-5" />
            <span className="text-[10px] font-black uppercase tracking-wider">
              Close
            </span>
          </button>
          {(() => {
            const tScore = game.teamScore ?? 0;
            const oScore = game.opponentScore ?? 0;
            const chipBody = (
              <>
                <div className="t-eyebrow truncate">vs. {game.opponent}</div>
                <div className="text-2xl font-black tabular-nums tracking-tight text-ink leading-none mt-0.5">
                  <span>{tScore}</span>
                  <span className="text-ink-3 mx-2">–</span>
                  <span>{oScore}</span>
                </div>
              </>
            );
            return canEdit ? (
              <button
                type="button"
                onClick={() => setShowScoreEditor((s) => !s)}
                className="flex-1 text-center min-w-0 rounded-lg px-2 py-1 hover:bg-surface-2 transition-colors"
                aria-label="Edit live score"
                aria-expanded={showScoreEditor}
              >
                {chipBody}
              </button>
            ) : (
              <div className="flex-1 text-center min-w-0 px-2 py-1">
                {chipBody}
              </div>
            );
          })()}
          <div className="flex items-center gap-1">
            {canEdit &&
              (() => {
                const removedCount = Object.keys(
                  game.midGameRemovals || {},
                ).length;
                return (
                  <>
                    <button
                      onClick={() => setShowRemoveModal(true)}
                      className={`relative min-w-[48px] min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
                        removedCount > 0
                          ? "text-loss bg-loss-bg hover:bg-loss-bg"
                          : "text-ink-2 hover:bg-loss-bg hover:text-loss"
                      }`}
                      aria-label={
                        removedCount > 0
                          ? `${removedCount} player${
                              removedCount === 1 ? "" : "s"
                            } out — remove another`
                          : "Remove a player (injured / ill / left)"
                      }
                      title={
                        removedCount > 0
                          ? `${removedCount} out of game — tap to manage`
                          : "Mark a player out for the rest of the game"
                      }
                    >
                      <Icons.Alert className="w-5 h-5" />
                      <span className="text-[10px] font-black uppercase tracking-wider">
                        Out
                      </span>
                      {removedCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-loss text-white text-[10px] font-black flex items-center justify-center leading-none tabular-nums">
                          {removedCount}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={undo}
                      disabled={inGameUndoStack.length === 0}
                      className="min-w-[48px] min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-ink-2 hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Undo last swap"
                    >
                      <Icons.Undo className="w-5 h-5" />
                      <span className="text-[10px] font-black uppercase tracking-wider">
                        Undo
                      </span>
                    </button>
                  </>
                );
              })()}
          </div>
        </div>
        {!canEdit && (
          <div className="px-4 py-2 bg-warn-bg border-t border-line text-center text-[11px] font-black uppercase tracking-widest text-warnfg">
            View only — head coach controls lineup changes
          </div>
        )}
        {/* In-game covers the app header, so its save status shows here —
            exactly where signal is worst. */}
        {syncStatus && (
          <div className="px-4 py-1.5 border-t border-line flex justify-center">
            <SyncStatusPill syncStatus={syncStatus} />
          </div>
        )}
        {showScoreEditor && canEdit && (
          <div className="px-4 py-3 bg-app border-t border-line flex items-center justify-center gap-3">
            {[
              { key: "team", label: "Us", value: game.teamScore ?? 0 },
              { key: "opp", label: "Opp", value: game.opponentScore ?? 0 },
            ].map(({ key, label, value }) => {
              const which = key === "team" ? "team" : "opponent";
              return (
                <div
                  key={key}
                  className="flex items-center gap-1.5 bg-surface border border-line rounded-xl px-1.5 py-1 shadow-sm"
                >
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 px-2">
                    {label}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjustScore(which, -1)}
                    disabled={value <= 0}
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-surface-2 text-ink font-black text-lg hover:bg-line disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label={`Decrease ${label} score`}
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-xl font-black tabular-nums text-ink">
                    {value}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjustScore(which, +1)}
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-white font-black text-lg hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: primaryColor }}
                    aria-label={`Increase ${label} score`}
                  >
                    +
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setShowScoreEditor(false)}
              className="text-[10px] font-black uppercase tracking-widest text-ink-3 hover:text-ink px-2 py-2"
            >
              Done
            </button>
          </div>
        )}
        {/* Pool-play margin advisory: once the lead reaches the tournament's
            run-diff cap, extra runs stop buying tiebreaker currency — the
            moment to rest arms and run the bench. Advisory only. */}
        {(() => {
          if (!featureEnabled(team, "tournaments")) return null;
          const advisory = liveMarginAdvisory(
            game,
            tournamentForGame(team.tournaments, game.id),
          );
          if (!advisory) return null;
          return (
            <div className="px-4 py-2 bg-warn-bg border-t border-line text-center text-[11px] font-bold text-warnfg leading-snug">
              {advisory}
            </div>
          );
        })()}
      </div>

      {/* Inning navigator + score */}
      <div className="bg-surface border-b border-line p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button
            onClick={() => goToInning(currentInning - 1)}
            disabled={currentInning === 0}
            className="p-3 bg-surface-2 hover:bg-line rounded-xl text-ink font-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous inning"
          >
            <Icons.ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center flex-1">
            <div className="t-eyebrow">Inning</div>
            <div className="t-stat-num">
              {currentInning + 1}
              <span className="text-ink-3 text-lg font-black">
                {" "}
                / {totalInnings}
              </span>
            </div>
          </div>
          <button
            onClick={() => goToInning(currentInning + 1)}
            disabled={currentInning >= totalInnings - 1}
            className="p-3 bg-surface-2 hover:bg-line rounded-xl text-ink font-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next inning"
          >
            <Icons.ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Available Pitchers — eligibility status + who's been used this game.
            Only shown for kid-pitch divisions (machine pitch has no pitch counts).
            Hidden for assistants — they don't manage the pitching staff. */}
        {canEdit &&
          (() => {
            const fmt = game.pitchingFormat || team.pitchingFormat || "";
            if (fmt.toLowerCase().includes("machine")) return null;
            const ageGroup = game.teamAge || team.teamAge;

            // Pitchers used in this game so far (anyone at P through current inning)
            const usedPitcherIds = new Set();
            const usedPitcherList = [];
            for (let i = 0; i <= currentInning; i++) {
              const pitcher = liveLineup[i]?.P;
              if (pitcher && !usedPitcherIds.has(pitcher.id)) {
                usedPitcherIds.add(pitcher.id);
                usedPitcherList.push({ player: pitcher, firstInning: i + 1 });
              }
            }
            // Dead-arm rule at the UI (Phase A closes this in the engine, this
            // closes the coach-override door): an arm already used AND relieved
            // this game is done pitching — it must never be offered for a
            // one-tap re-pin, and its Used row explains why it's not coming
            // back. The current arm (latest inning's P) stays on the mound.
            const relievedIds = relievedArmIds(liveLineup, currentInning);
            // Available pool: present players not yet used, eligible by rest rules
            const targetDate =
              game.date || new Date().toISOString().slice(0, 10);
            const presentPlayers = team.players.filter(
              (p: any) =>
                game.attendance?.[p.id] !== false &&
                !usedPitcherIds.has(p.id) &&
                // Subs are only arms for their own tournament's games.
                playsGame(p, game.id, team.tournaments) &&
                // Defensive: relieved arms are a subset of used arms above,
                // but keep the dead-arm exclusion explicit so a refactor of
                // the used scan can't silently reopen the override gap.
                !relievedIds.has(p.id),
            );
            // Eligibility (rest rules + age pitch limit) lives in the engine —
            // use it directly so this view can't drift from the canonical rules.
            // Also drop kids who can't pitch today on dual-role grounds (slated
            // to catch this game, or caught earlier the same day).
            //
            // The budget is per DATE, and THIS game's own logged outing is
            // excluded: on the back half of a doubleheader a kid who threw in
            // game 1 is still an arm here, carrying whatever the day's max
            // leaves him. He drops off only when that remainder hits zero.
            const pitchRules = resolvePitchRuleSet(team);
            const dayBudget = (p: any) =>
              pitchBudgetFor(p.pitching, targetDate, ageGroup, pitchRules, {
                excludeGameId: game.id,
              });
            const availablePitchers = presentPlayers.filter(
              (p: any) => dayBudget(p).eligible && canPitchDual(p.id),
            );
            // Advisory only: an arm penciled into a LATER game — a stored
            // tournament's plan OR a standalone game's week-planner plan —
            // stays selectable; using them now just burns tomorrow's plan,
            // and the coach should see that at the decision moment. The
            // tournaments toggle only hides the stored-tournament layer
            // (standalone game.pitchPlan is written by the always-available
            // week planner), so the lookup itself always runs.
            const laterPlannedFor = (playerId: string) =>
              laterPlannedGamesForPlayer(
                featureEnabled(team, "tournaments") ? team.tournaments : [],
                team.games,
                playerId,
                game.id,
              )[0];

            return (
              <div className="bg-warn-bg border border-line rounded-xl p-3 mb-3">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-warnfg mb-2 flex items-center gap-1.5">
                  <Icons.Pitch className="w-3.5 h-3.5" />
                  Pitchers
                </div>
                {usedPitcherList.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-warnfg mb-1">
                      Used This Game
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {usedPitcherList.map(({ player, firstInning }) => {
                        const relieved = relievedIds.has(player.id);
                        const count = pitchesThisGame(player.id);
                        // Today's budget minus THIS game's live count (the
                        // budget itself excludes this game's logged outing).
                        const rp = rosterById.get(player.id);
                        const budget = rp ? dayBudget(rp) : null;
                        const left =
                          budget && Number.isFinite(budget.remaining)
                            ? budget.remaining - count
                            : null;
                        const leftTone =
                          left == null
                            ? "text-ink-3"
                            : left <= 0
                              ? "text-loss"
                              : left <= 10
                                ? "text-warnfg"
                                : "text-ink-3";
                        return (
                          <div
                            key={player.id}
                            className={`flex items-center gap-2 bg-surface border border-line rounded-md px-2 py-1.5 ${
                              relieved ? "opacity-70" : ""
                            }`}
                          >
                            <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-[12px] font-bold truncate ${
                                  relieved ? "text-ink-3" : "text-ink"
                                }`}
                              >
                                {player.name}
                              </span>
                              <span className="text-ink-3 text-[10px] font-medium shrink-0">
                                (Inn {firstInning})
                              </span>
                              {relieved && (
                                <span className="text-[10px] font-black uppercase tracking-widest text-loss shrink-0">
                                  Relieved — done for this game
                                </span>
                              )}
                              {left != null && (
                                <span
                                  className={`basis-full text-[11px] font-bold tabular-nums ${leftTone}`}
                                >
                                  {left <= 0
                                    ? "At today's pitch limit"
                                    : `${left} left today`}
                                </span>
                              )}
                            </div>
                            {/* Live pitch count — taps save to this game's
                                outing in the arm-care log. */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => adjustPitches(player.id, -1)}
                                disabled={count <= 0}
                                className="w-10 h-10 rounded-lg bg-surface-2 text-ink font-black text-lg disabled:opacity-30"
                                aria-label={`One fewer pitch for ${player.name}`}
                              >
                                −
                              </button>
                              <span
                                className="min-w-[2.5rem] text-center text-lg font-black tabular-nums text-ink"
                                aria-label={`${player.name}: ${count} pitches this game`}
                              >
                                {count}
                              </span>
                              <button
                                type="button"
                                onClick={() => adjustPitches(player.id, 1)}
                                className="w-10 h-10 rounded-lg text-white font-black text-base"
                                style={{ backgroundColor: primaryColor }}
                                aria-label={`One more pitch for ${player.name}`}
                              >
                                +1
                              </button>
                              <button
                                type="button"
                                onClick={() => adjustPitches(player.id, 5)}
                                className="w-10 h-10 rounded-lg text-white font-black text-base"
                                style={{ backgroundColor: primaryColor }}
                                aria-label={`Five more pitches for ${player.name}`}
                              >
                                +5
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {relievedIds.size > 0 && (
                      <div className="text-[10px] text-ink-3 font-medium mt-1.5 leading-snug">
                        A pulled arm can't return to the mound this game
                        (one-pitcher rule), so relieved pitchers aren't offered
                        below.
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-warnfg mb-1">
                    Available ({availablePitchers.length})
                  </div>
                  {availablePitchers.length === 0 ? (
                    <div className="text-[11px] text-ink-3 italic font-medium">
                      No eligible pitchers remaining
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {availablePitchers.map((player: any) => {
                        const later = laterPlannedFor(player.id);
                        // Pitches this kid already threw earlier TODAY (an
                        // earlier game the same date) — what's left of the
                        // daily max is all he has for this one.
                        const budget = dayBudget(player);
                        return (
                          <button
                            key={player.id}
                            type="button"
                            onClick={() => assignPitcher(player.id)}
                            title={
                              later
                                ? `${player.name} is planned to pitch ${
                                    later.opponent
                                      ? `vs ${later.opponent} `
                                      : ""
                                  }${formatGameDateDisplay(later.date)} — pitching now may burn that plan`
                                : budget.thrownToday > 0
                                  ? `${player.name} threw ${budget.thrownToday} earlier today — ${budget.remaining} of the ${budget.dailyMax}-pitch daily max left`
                                  : `Make ${player.name} the pitcher for inning ${
                                      currentInning + 1
                                    }`
                            }
                            className="text-[11px] font-bold text-win bg-surface border border-line rounded-md px-2 py-1 hover:bg-win-bg hover:border-line-strong active:scale-[0.97] transition-all cursor-pointer"
                          >
                            {player.name}
                            {budget.thrownToday > 0 && (
                              <span className="text-ink-3 font-black tabular-nums">
                                {" "}
                                · {budget.remaining} left
                              </span>
                            )}
                            {later && (
                              <span className="text-warnfg font-black">
                                {" "}
                                · planned {formatGameDateDisplay(later.date)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

        {/* End Game + Share row */}
        <div className="flex gap-2">
          <button
            onClick={() =>
              shareLineupCard({
                game,
                team,
                formatDate: formatGameDateDisplay,
                toast,
              })
            }
            title="Share this lineup as a PNG image"
            className="shrink-0 py-3 px-4 text-xs font-black uppercase tracking-widest rounded-xl transition-transform hover:-translate-y-0.5 flex items-center justify-center gap-2 bg-surface text-ink border border-line"
          >
            <Icons.Link className="w-4 h-4" /> Share
          </button>
          {canEdit && (
            <button
              onClick={() => navigate(`/schedule/game/${game.id}/final`)}
              className="flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              <Icons.FileText className="w-4 h-4" /> End Game / Enter Final
              Score
            </button>
          )}
        </div>
      </div>

      {/* Selection helper */}
      {inGameSelection && (
        <div
          className="border-b border-line px-4 py-2.5 text-center"
          style={{ backgroundColor: "var(--info-bg)" }}
        >
          <span
            className="text-[11px] font-black uppercase tracking-widest"
            style={{ color: "var(--info-fg)" }}
          >
            {inGameSelection.type === "position"
              ? `${inGameSelection.pos} selected`
              : "Bench player selected"}
            {" · tap another cell to swap"}
          </span>
        </div>
      )}

      {/* On-field positions */}
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-ink-2 mb-3 px-1">
          On Field
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
          {presentPositions.map((pos) => {
            const player = inn[pos];
            const sel = { type: "position", pos };
            const selected = isCellSelected(sel);
            // Who's at this position next inning? If it's a different
            // player (or someone-then-nobody / nobody-then-someone)
            // surface them so the coach can plan one inning ahead.
            const nextInn = liveLineup[currentInning + 1];
            const nextPlayer = nextInn ? nextInn[pos] : null;
            const showNext =
              nextInn && nextPlayer && nextPlayer.id !== player?.id;
            return (
              <button
                key={pos}
                onClick={() => handleTap(sel)}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                  selected
                    ? "bg-surface ring-4 shadow-lg"
                    : `bg-surface border-line hover:border-line-strong active:scale-[0.97] ${
                        inGameSelection ? "opacity-50" : ""
                      }`
                }`}
                style={
                  selected
                    ? ({
                        borderColor: "var(--team-primary)",
                        // The ring color is the team primary at low opacity so
                        // it reads as a soft highlight, not a hard outline.
                        "--tw-ring-color": "var(--team-primary-15)",
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <div className="w-12 shrink-0 text-center text-[11px] font-extrabold uppercase tracking-widest text-ink-3 bg-surface-2 rounded-lg py-1.5">
                  {pos}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-base font-black text-ink truncate leading-tight">
                    {player?.name || "—"}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {player?.number && (
                      <span className="text-[10px] font-bold text-ink-3">
                        #{player.number}
                      </span>
                    )}
                    {showNext && (
                      <span className="text-[10px] font-bold text-ink-3 truncate">
                        → next: {nextPlayer.name}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Bench */}
        <h3 className="text-[11px] font-black uppercase tracking-widest text-ink-2 mb-3 px-1">
          Bench ({benchKids.length})
        </h3>
        {benchKids.length === 0 ? (
          <div className="bg-surface-2 rounded-xl p-6 text-center">
            <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">
              No Bench This Inning
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {benchKids.map((player: any) => {
              const sel = { type: "bench", playerId: player.id };
              const selected = isCellSelected(sel);
              return (
                <button
                  key={player.id}
                  onClick={() => handleTap(sel)}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    selected
                      ? "bg-surface ring-4 shadow-lg"
                      : `bg-surface-2 border-line hover:border-line-strong active:scale-[0.97] ${
                          inGameSelection ? "opacity-50" : ""
                        }`
                  }`}
                  style={
                    selected
                      ? ({
                          borderColor: "var(--team-primary)",
                          "--tw-ring-color": "var(--team-primary-15)",
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  <div className="w-12 shrink-0 text-center text-[11px] font-extrabold uppercase tracking-widest text-ink-3 bg-surface rounded-lg py-1.5 border border-line">
                    BN
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-base font-black text-ink truncate leading-tight">
                      {player.name}
                    </div>
                    {player.number && (
                      <div className="text-[10px] font-bold text-ink-3 mt-0.5">
                        #{player.number}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Mid-game removal modal — injury / illness / left site. */}
      {showRemoveModal && (
        <div
          className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm"
          onClick={() => setShowRemoveModal(false)}
        >
          <A11yDialog
            label="Remove a player"
            onClose={() => setShowRemoveModal(false)}
            className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
            <div className="p-5 sm:p-6 border-b border-line">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="t-h2">Remove a Player</h3>
                  <p className="text-[12px] text-ink-2 font-medium mt-1">
                    Mark a player out for the rest of the game (injury, illness,
                    or had to leave). Innings they already played still count
                    toward season totals.
                  </p>
                </div>
                <button
                  onClick={() => setShowRemoveModal(false)}
                  className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
                  aria-label="Cancel"
                >
                  <Icons.X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-2">
                Inning {currentInning + 1} of {totalInnings} — they'll be
                removed from this inning onward
              </div>
              {devEnabled && (
                <label className="flex items-start gap-2 mb-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={alsoMarkOut}
                    onChange={(e) => setAlsoMarkOut(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-[var(--team-primary)]"
                  />
                  <span className="text-[11px] font-bold text-ink-2 leading-snug">
                    Also mark them <span className="text-loss">Out</span>{" "}
                    (injured) on their profile — upcoming games will default
                    them to absent until you clear it.
                  </span>
                </label>
              )}
              {eligibleForRemoval.length === 0 ? (
                <div className="text-sm font-bold text-ink-3 italic text-center py-8">
                  No players to remove this inning.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {eligibleForRemoval.map((p) => {
                    const armed = pendingRemovePlayerId === p.id;
                    return (
                      <button
                        key={`rem-${p.id}`}
                        type="button"
                        onClick={() => {
                          if (armed) {
                            removePlayerMidGame(p.id, "injury");
                          } else {
                            setPendingRemovePlayerId(p.id);
                            setPendingRestorePlayerId(null);
                          }
                        }}
                        className={`w-full text-left px-4 py-3 rounded-xl font-bold transition-colors flex items-center justify-between gap-3 ${
                          armed
                            ? "bg-loss-bg border-2 border-loss text-loss ring-2 ring-loss-bg"
                            : "bg-surface border border-line text-ink hover:bg-loss-bg hover:border-line-strong hover:text-loss"
                        }`}
                      >
                        <span className="truncate flex-1 min-w-0">
                          {p.number ? `#${p.number} ` : ""}
                          {p.name}
                        </span>
                        {armed ? (
                          <span className="text-[10px] font-black uppercase tracking-widest text-loss shrink-0 whitespace-nowrap">
                            Tap to confirm
                          </span>
                        ) : (
                          <Icons.Alert className="w-4 h-4 text-loss shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {Object.keys(game.midGameRemovals || {}).length > 0 && (
                <div className="mt-5 pt-4 border-t border-line">
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-2">
                    Already removed
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {Object.entries(
                      (game.midGameRemovals || {}) as Record<string, any>,
                    ).map(([pid, info]: [string, any]) => {
                      const player = team.players.find(
                        (q: any) => q.id === pid,
                      ) || { name: "(unknown)" };
                      const armed = pendingRestorePlayerId === pid;
                      return (
                        <div
                          key={`removed-${pid}`}
                          className={`text-xs font-bold px-3 py-2 border rounded-lg flex items-center justify-between gap-2 transition-colors ${
                            armed
                              ? "bg-win-bg border-line text-win"
                              : "bg-app border-line text-ink-3"
                          }`}
                        >
                          <span className="truncate flex-1 min-w-0">
                            {player.name} — out from inning{" "}
                            {info.fromInning + 1}
                            {info.reason ? ` (${info.reason})` : ""}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (armed) {
                                const next = {
                                  ...(game.midGameRemovals || {}),
                                };
                                delete next[pid];
                                updateGame(game.id, { midGameRemovals: next });
                                setPendingRestorePlayerId(null);
                              } else {
                                setPendingRestorePlayerId(pid);
                                setPendingRemovePlayerId(null);
                              }
                            }}
                            className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded shrink-0 whitespace-nowrap transition-colors ${
                              armed
                                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                : "text-ink-3 hover:text-ink"
                            }`}
                          >
                            {armed ? "Tap to confirm" : "Undo"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </A11yDialog>
        </div>
      )}
    </div>
  );
});
