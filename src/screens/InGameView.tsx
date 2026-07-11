import React, { memo, useState, useRef, useCallback, useEffect } from "react";
import { Icons } from "../icons";
import { formatGameDateDisplay, sameDayRoleSets } from "../utils/helpers";
import {
  checkPitchEligibility,
  generateLineup,
  generateTournamentLineup,
  resolvePitchRuleSet,
} from "../lineupEngine";
import { shareLineupCard } from "../lineup/lineupCard";
import {
  applySwap,
  getPlayerAt,
  isCatcherBlocked,
  fillVacatedSpot,
} from "../lineup/inGameSwap";
import { useTeam, useUI, useToast } from "../contexts";
import { A11yDialog } from "../components/shared";
import { featureEnabled } from "../constants/features";
import { ScoreEditor } from "./ScheduleTab";

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

export const InGameView = memo(() => {
  const {
    team,
    updateGame,
    finalizeGame,
    removePlayerMidGame: removePlayerMidGameAction,
    setPlayerHealth,
    currentRole,
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
  const [showEndGameScore, setShowEndGameScore] = useState(false);
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
  const [pendingLineup, setPendingLineup] = useState(null);
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
  const pitchersThisGame = new Set<string>();
  for (const innx of liveLineup) {
    const cId = (innx?.C as any)?.id;
    if (cId) catchersThisGame.add(cId);
    const pId = (innx?.P as any)?.id;
    if (pId) pitchersThisGame.add(pId);
  }
  // May this player take the mound? Not if they're catching this game or caught
  // earlier today.
  const canPitchDual = (id: string) =>
    !catchersThisGame.has(id) && !sameDayRoles.caught.has(id);
  // May this player catch? Not if they pitched this game or earlier today.
  const canCatchDual = (id: string) =>
    !pitchersThisGame.has(id) && !sameDayRoles.pitched.has(id);

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

  // Update a specific inning's lineup with a patch. Writes go through the
  // optimistic pendingLineup state and the flush is debounced so rapid taps
  // coalesce into one Firestore write.
  const patchInning = (idx: any, patch: any) => {
    setPendingLineup((cur) => {
      const base = cur ?? game.lineup;
      return base.map((existingInn: any, i: any) => {
        if (i !== idx) return existingInn;
        return { ...existingInn, ...patch };
      });
    });
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flush, 500);
  };

  // One-tap pitcher assignment from the Available pool. Both Rec and Tournament
  // games re-run the engine with the chosen reliever forced to P and re-flow the
  // current + remaining innings around them (recalibrateRestOfGame picks the
  // right engine). Only if that rebuild can't run (e.g. the engine errors) do we
  // fall back to a current-inning-only swap via performSwap.
  const assignPitcher = (playerId: any) => {
    if (assignPitcherRestOfGame(playerId)) return;
    const innNow = pendingLineup
      ? pendingLineup[currentInning]
      : liveLineup[currentInning];
    if (!innNow) return;
    // Find which cell the chosen pitcher currently occupies this inning.
    let sourceSel = null;
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
    // Don't swap a player with themselves (they're already P somehow).
    if (sourceSel.type === "position" && sourceSel.pos === "P") return;
    performSwap({ type: "position", pos: "P" }, sourceSel);
  };

  // Tournament pitching change: preserve completed innings, rebuild the best
  // current/future defense with the selected reliever forced to P, and record
  // one whole-lineup undo snapshot. This intentionally does NOT swap the
  // pulled pitcher into the reliever's old field/bench spot.
  const assignPitcherRestOfGame = (playerId: any): boolean => {
    const base = pendingLineup ?? game.lineup;
    const current = base[currentInning];
    if (!current) return false;
    if (current.P?.id === playerId) return false;
    // The new pitcher is no longer a field lock (P isn't lockable).
    const locks = nextManualLocks(game.manualLocks, [{ pos: "P", playerId }]);
    return recalibrateRestOfGame(
      { P: playerId },
      {
        title: "Pitching change",
        message: (rebuiltCurrent: any) =>
          `${
            (rebuiltCurrent.P as any)?.name || "New pitcher"
          } takes the mound from inning ${
            currentInning + 1
          } on — the rest of the lineup re-flowed around it.`,
      },
      locks,
    );
  };

  // Re-optimize the current + remaining innings with a set of position pins,
  // keeping the innings already played. Shared by the pitching change (pin P)
  // and a manual position move (pin the swapped spots + keep the battery). The
  // fair rotation keeps rotating around the pins. Works in BOTH Rec and
  // Tournament games (the engine is chosen by game type below). Returns true if
  // it rebuilt.
  const recalibrateRestOfGame = (
    overrides: Record<string, string>,
    opts: { title: string; message: (rebuiltCurrent: any) => string },
    sticky?: Record<string, string>,
  ): boolean => {
    if (!canEdit) return false;
    const base = pendingLineup ?? game.lineup;
    const current = base[currentInning];
    if (!current) return false;

    const activeIds = new Set<string>();
    for (const pos of Object.keys(current || {})) {
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
    if (activePlayers.length === 0) return false;
    // Drop pins for anyone not actually in this inning (defensive).
    const pins: Record<string, string> = {};
    for (const [pos, id] of Object.entries(overrides))
      if (id && activeIds.has(id)) pins[pos] = id;
    // Durable manual locks (field positions) that the engine holds for the rest
    // of the game. Default to the game's stored locks; callers pass the freshly
    // updated map for the move that triggered this rebuild. Filter to players in
    // this inning.
    const sourceLocks: Record<string, string> =
      sticky ?? game.manualLocks ?? {};
    const stickyPins: Record<string, string> = {};
    for (const [pos, id] of Object.entries(sourceLocks))
      if (id && activeIds.has(id)) stickyPins[pos] = id;

    // Pick the engine by game type, mirroring useLineupActions: Tournament
    // (USSSA) games run the competitive pipeline; Rec games run the fair-play
    // engine. This is what makes the re-flow work in BOTH modes, not just
    // tournament. The two engines preserve the already-played innings
    // differently: the Rec engine (generateLineup) replays them via
    // fromInning/currentLineup, which also makes it apply the pin at the
    // CURRENT inning (the one the coach is on) rather than inning 0 — without
    // that, the fair-play rotation would slide the moved pitcher off the mound.
    // The tournament pipeline doesn't take fromInning; it regenerates fresh and
    // we keep the played innings in the caller-side merge below.
    const isTournament = (game.leagueRuleSet || team.leagueRuleSet) === "USSSA";
    const result = (isTournament ? generateTournamentLineup : generateLineup)({
      activePlayers,
      allPlayers: roster.length ? roster : activePlayers,
      games: team.games || [],
      evaluationEvents: team.evaluationEvents || [],
      currentGame: game,
      firstInningOverridesById: pins,
      stickyOverridesById: stickyPins,
      totalInnings: base.length,
      ...(isTournament
        ? {}
        : { fromInning: currentInning, currentLineup: base }),
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
    });

    if (result.error) {
      toast.push({
        kind: "error",
        title: `${opts.title} failed`,
        message: result.error,
        duration: 0,
      });
      return false;
    }

    const rebuilt = result.lineup;
    if (!rebuilt || !rebuilt[currentInning]) return false;
    const cloneInning = (inning: any) => ({
      ...inning,
      BENCH: Array.isArray(inning.BENCH) ? [...inning.BENCH] : [],
    });
    // Keep the innings already played; for the rest, take the corresponding
    // inning from the rebuild so the fair rotation KEEPS rotating around the
    // pins (not a single inning frozen across the rest of the game).
    const next = base.map((innState: any, idx: number) =>
      idx < currentInning
        ? innState
        : rebuilt[idx]
          ? cloneInning(rebuilt[idx])
          : innState,
    );

    setPendingLineup(next);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flush, 500);
    // Persist the manual locks that drove this rebuild so later re-flows (from
    // other changes) keep building around them. Snapshot the prior locks on the
    // undo entry so undo restores them too.
    const priorLocks = game.manualLocks || {};
    if (sticky) updateGame(game.id, { manualLocks: sticky });
    setInGameUndoStack(
      [{ lineup: base, locks: priorLocks }, ...inGameUndoStack].slice(0, 5),
    );
    setInGameSelection(null);
    tapHaptic();
    toast.push({
      kind: "success",
      title: opts.title,
      message: opts.message(rebuilt[currentInning]),
    });
    return true;
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

  // Perform a swap and record undo info. The pure transform + catcher-block
  // check live in ../lineup/inGameSwap; this keeps the side effects.
  const performSwap = (firstSel: any, secondSel: any) => {
    const liveInning = liveLineup[currentInning];
    const playerA = getPlayerAt(liveInning, firstSel);
    const playerB = getPlayerAt(liveInning, secondSel);
    if (!playerA || !playerB) {
      setInGameSelection(null);
      return;
    }
    if (
      isCatcherBlocked(firstSel, secondSel, playerA, playerB, clearedToCatch)
    ) {
      toast.push({
        kind: "error",
        title: "Not a catcher",
        message:
          "That player isn't cleared to catch. Add C to their comfortable positions on the roster first.",
      });
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
    const incomingC = arrivingAt("C");
    if (incomingC && !canCatchDual(incomingC.id)) {
      toast.push({
        kind: "error",
        title: "Can't catch today",
        message: `${incomingC.name} pitched ${
          pitchersThisGame.has(incomingC.id) ? "this game" : "earlier today"
        } — they can't catch the same day (arm care).`,
      });
      setInGameSelection(null);
      return;
    }
    const incomingP = arrivingAt("P");
    if (incomingP && !canPitchDual(incomingP.id)) {
      toast.push({
        kind: "error",
        title: "Can't pitch today",
        message: `${incomingP.name} is ${
          catchersThisGame.has(incomingP.id)
            ? "catching this game"
            : "caught earlier today"
        } — they can't pitch the same day (arm care).`,
      });
      setInGameSelection(null);
      return;
    }

    const next = applySwap(liveInning, firstSel, secondSel);
    if (!next) {
      setInGameSelection(null);
      return;
    }

    // A SUBSTITUTION (one cell is the bench: a player enters or leaves the
    // field) carries forward to the remaining innings — but ONLY by filling the
    // exact spot that was tapped, and only in innings that still match it (the
    // subbed-out player still at that position with the sub free on the bench).
    // Innings the rotation has already changed are left alone, so this never
    // scrambles the rest of the game. A plain position↔position swap (both on
    // the field) only changes the current inning.
    const isSubstitution =
      firstSel.type === "bench" || secondSel.type === "bench";
    if (isSubstitution && currentInning < liveLineup.length - 1) {
      // The tapped field position, the player leaving it, and the sub entering.
      const posSel = firstSel.type === "position" ? firstSel : secondSel;
      const pos = posSel.pos;
      const outPlayer = getPlayerAt(liveInning, posSel);
      const inPlayer = firstSel.type === "bench" ? playerA : playerB;

      // Bringing a new PITCHER or CATCHER in off the bench recalibrates the rest
      // of the game (like the Available-Pitchers change and a position move):
      // the incoming arm/glove is pinned to the mound/plate, the other half of
      // the battery is kept for continuity, and the remaining innings re-flow
      // around them. Both Rec and Tournament. Other subs just fill the tapped
      // spot below.
      if (pos === "P" || pos === "C") {
        const cur = (pendingLineup ?? game.lineup)[currentInning];
        const pins: Record<string, string> = {};
        if ((cur?.P as any)?.id) pins.P = (cur.P as any).id;
        if ((cur?.C as any)?.id) pins.C = (cur.C as any).id;
        pins[pos] = inPlayer.id; // the incoming player takes the tapped slot
        // Incoming arm/glove moves to P/C (not lockable) — clear any field lock.
        const locks = nextManualLocks(game.manualLocks, [
          { pos, playerId: inPlayer.id },
        ]);
        const did = recalibrateRestOfGame(
          pins,
          {
            title: pos === "P" ? "Pitching change" : "Catcher change",
            message: () =>
              `${inPlayer.name} ${
                pos === "P" ? "takes the mound" : "is behind the plate"
              } from inning ${
                currentInning + 1
              } on — the rest of the lineup re-flowed around it.`,
          },
          locks,
        );
        if (did) return; // otherwise fall through to a fill-forward sub
      }

      const base = pendingLineup ?? game.lineup;
      const newLineup = base.map((innState: any, idx: number) => {
        if (idx < currentInning) return innState;
        if (idx === currentInning) return next;
        return outPlayer
          ? fillVacatedSpot(
              innState,
              pos,
              outPlayer.id,
              inPlayer,
              clearedToCatch,
            )
          : innState;
      });
      setPendingLineup(newLineup);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flush, 500);
      // Whole-lineup undo snapshot (the change touched several innings).
      setInGameUndoStack([{ lineup: base }, ...inGameUndoStack].slice(0, 5));
      setInGameSelection(null);
      tapHaptic();
      // Whoever came OFF the bench is the one entering the game.
      const enter = firstSel.type === "bench" ? playerA : playerB;
      const exit = firstSel.type === "bench" ? playerB : playerA;
      toast.push({
        kind: "success",
        title: "Substitution",
        message: `${(enter as any)?.name || "The sub"} in for ${
          (exit as any)?.name || "the starter"
        } from inning ${currentInning + 1} on.`,
      });
      return;
    }

    // A POSITION MOVE (both cells on the field) recalibrates the rest of the
    // game: the two swapped players are pinned to their new spots and the
    // current battery (P/C) is kept for continuity, then the engine re-optimizes
    // the remaining innings' defense + rotation around them. Innings already
    // played are untouched. If the rebuild can't run it falls back to the
    // current-inning-only swap below.
    //   - Tournament: any position move re-flows the rest of the game.
    //   - Rec: only a move that touches the BATTERY (a player to/from P or C)
    //     re-flows; a plain field↔field tweak stays current-inning-only so a
    //     coach's small fair-play adjustment doesn't reshuffle the whole game.
    const movesBattery =
      firstSel.pos === "P" ||
      secondSel.pos === "P" ||
      firstSel.pos === "C" ||
      secondSel.pos === "C";
    const isTournamentGame =
      (game.leagueRuleSet || team.leagueRuleSet) === "USSSA";
    if (
      !isSubstitution &&
      (isTournamentGame || movesBattery) &&
      currentInning < liveLineup.length - 1 &&
      firstSel.type === "position" &&
      secondSel.type === "position"
    ) {
      const cur = (pendingLineup ?? game.lineup)[currentInning];
      const pins: Record<string, string> = {};
      if ((cur?.P as any)?.id) pins.P = (cur.P as any).id; // keep the pitcher
      if ((cur?.C as any)?.id) pins.C = (cur.C as any).id; // keep the catcher
      // The swap wins for the two tapped spots (firstSel now holds playerB,
      // secondSel now holds playerA).
      pins[firstSel.pos] = playerB.id;
      pins[secondSel.pos] = playerA.id;
      // Remember both tapped spots as durable manual picks (field positions are
      // held rest-of-game; P/C are dropped by nextManualLocks).
      const locks = nextManualLocks(game.manualLocks, [
        { pos: firstSel.pos, playerId: playerB.id },
        { pos: secondSel.pos, playerId: playerA.id },
      ]);
      const did = recalibrateRestOfGame(
        pins,
        {
          title: "Defense recalibrated",
          message: () =>
            `Lineup re-flowed around your change from inning ${
              currentInning + 1
            } on.`,
        },
        locks,
      );
      if (did) return; // otherwise fall back to a current-inning-only swap
    }

    patchInning(currentInning, next);
    // Snapshot the pre-swap inning for undo. (Replaying the swap to undo it
    // breaks for bench cells — the player's id moves off the bench — so we
    // restore the prior inning state directly. applySwap is immutable, so
    // liveInning is untouched and safe to keep.)
    setInGameUndoStack(
      [
        { inning: currentInning, prevInning: liveInning },
        ...inGameUndoStack,
      ].slice(0, 5),
    );
    setInGameSelection(null);
    tapHaptic();
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
    // Restore the snapshot captured before the swap. Whole-lineup entries
    // come from tournament pitching changes (they touch several innings).
    if (entry.lineup) {
      setPendingLineup(entry.lineup);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flush, 500);
    } else if (entry.prevInning) {
      patchInning(entry.inning, entry.prevInning);
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

  const close = () => {
    setInGameId(null);
    setInGameSelection(null);
    setInGameUndoStack([]);
    setShowEndGameScore(false);
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
            className="p-2 hover:bg-surface-2 text-ink-2 rounded-lg transition-colors"
            aria-label="Close in-game mode"
          >
            <Icons.X className="w-5 h-5" />
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
                      className={`relative p-2 rounded-lg transition-colors ${
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
                      {removedCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-loss text-white text-[10px] font-black flex items-center justify-center leading-none tabular-nums">
                          {removedCount}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={undo}
                      disabled={inGameUndoStack.length === 0}
                      className="p-2 text-ink-2 hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Undo last swap"
                    >
                      <Icons.Refresh className="w-5 h-5" />
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
      </div>

      {/* Inning navigator + score */}
      <div className="bg-surface border-b border-line p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button
            onClick={() => setInGameInning(Math.max(0, currentInning - 1))}
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
            onClick={() =>
              setInGameInning(Math.min(totalInnings - 1, currentInning + 1))
            }
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
            // Available pool: present players not yet used, eligible by rest rules
            const targetDate =
              game.date || new Date().toISOString().slice(0, 10);
            const presentPlayers = team.players.filter(
              (p: any) =>
                game.attendance?.[p.id] !== false && !usedPitcherIds.has(p.id),
            );
            // Eligibility (rest rules + age pitch limit) lives in the engine —
            // use it directly so this view can't drift from the canonical rules.
            // Also drop kids who can't pitch today on dual-role grounds (slated
            // to catch this game, or caught earlier the same day).
            const pitchRules = resolvePitchRuleSet(team);
            const availablePitchers = presentPlayers.filter(
              (p: any) =>
                checkPitchEligibility(p, targetDate, ageGroup, pitchRules) &&
                canPitchDual(p.id),
            );

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
                      {usedPitcherList.map(({ player, firstInning }) => (
                        <div
                          key={player.id}
                          className="flex items-center gap-2 bg-surface border border-line rounded-md px-2 py-1.5"
                        >
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-ink truncate">
                              {player.name}
                            </span>
                            <span className="text-ink-3 text-[9px] font-medium shrink-0">
                              (I{firstInning})
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
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
                      {availablePitchers.map((player: any) => (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => assignPitcher(player.id)}
                          title={`Make ${player.name} the pitcher for inning ${
                            currentInning + 1
                          }`}
                          className="text-[11px] font-bold text-win bg-surface border border-line rounded-md px-2 py-1 hover:bg-win-bg hover:border-line-strong active:scale-[0.97] transition-all cursor-pointer"
                        >
                          {player.name}
                        </button>
                      ))}
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
              onClick={() => setShowEndGameScore(true)}
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

      {/* End Game / Score modal — overlays the in-game view */}
      {showEndGameScore && (
        <div
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 backdrop-blur-sm"
          onClick={() => setShowEndGameScore(false)}
        >
          <A11yDialog
            label="End game"
            onClose={() => setShowEndGameScore(false)}
            className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
            <div className="p-5 sm:p-6 border-b border-line flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-0.5">
                  vs. {game.opponent}
                </div>
                <h3 className="t-h2">Final Score</h3>
              </div>
              <button
                onClick={() => setShowEndGameScore(false)}
                className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            {/* Pitch counts are no longer entered by hand — they're pulled from
                the imported GameChanger box score after the game. */}
            <ScoreEditor
              game={game}
              primaryColor={primaryColor}
              tertiaryColor={tertiaryColor}
              onSave={(ts: any, os: any, inningsPlayed: any) => {
                finalizeGame(game.id, ts, os, inningsPlayed);
                setShowEndGameScore(false);
                close();
              }}
              onClear={() => {
                updateGame(game.id, {
                  teamScore: null,
                  opponentScore: null,
                  status: "scheduled",
                });
                setShowEndGameScore(false);
              }}
              onCancel={() => setShowEndGameScore(false)}
            />
          </A11yDialog>
        </div>
      )}

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
