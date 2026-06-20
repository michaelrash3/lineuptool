import React, { memo, useState, useRef, useCallback, useEffect } from "react";
import { Icons } from "../icons";
import { formatGameDateDisplay, sameDayRoleSets } from "../utils/helpers";
import {
  checkPitchEligibility,
  generateTournamentLineup,
  maxPitchesForAge,
  resolvePitchRuleSet,
} from "../lineupEngine";
import { shareLineupCard } from "../lineup/lineupCard";
import { applySwap, getPlayerAt, isCatcherBlocked } from "../lineup/inGameSwap";
import { useTeam, useUI, useToast } from "../contexts";
import { A11yDialog } from "../components/shared";
import { ScoreEditor } from "./ScheduleTab";

export const InGameView = memo(() => {
  const {
    team,
    updateGame,
    finalizeGame,
    removePlayerMidGame: removePlayerMidGameAction,
    currentRole,
  } = useTeam();
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
          <h3 className="text-xl font-black uppercase tracking-tight text-ink mb-2">
            No Lineup Generated
          </h3>
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
    // Delegate to the TeamProvider orchestrator — it runs the engine to
    // refill the defensive slots and strips the player from battingLineup.
    removePlayerMidGameAction?.(playerId, {
      gameId: game.id,
      fromInning: currentInning,
      reason,
      currentLineup: pendingLineup ?? game.lineup,
      currentBatting: game.battingLineup,
    });
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

  // One-tap pitcher assignment from the Available pool. Rec games swap the
  // chosen player into the P slot for the CURRENT inning only (reusing
  // performSwap, which keeps undo history + haptics). Tournament games
  // re-run the tournament generator from the current active participants,
  // force the selected reliever into P, and copy the generated defense to
  // this inning plus every remaining inning.
  const assignPitcher = (playerId: any) => {
    if (game.tournamentPlan) {
      assignPitcherRestOfGame(playerId);
      return;
    }
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
  const assignPitcherRestOfGame = (playerId: any) => {
    if (!canEdit) return;
    const base = pendingLineup ?? game.lineup;
    const current = base[currentInning];
    if (!current) return;

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

    if (!activeIds.has(playerId) || activePlayers.length === 0) return;
    if (current.P?.id === playerId) return;

    const result = generateTournamentLineup({
      activePlayers,
      allPlayers: roster.length ? roster : activePlayers,
      games: team.games || [],
      evaluationEvents: team.evaluationEvents || [],
      currentGame: game,
      firstInningOverridesById: { P: playerId },
      totalInnings: base.length,
      leagueRuleSet: game.leagueRuleSet || team.leagueRuleSet,
      competitive: true,
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
        title: "Pitching change failed",
        message: result.error,
        duration: 0,
      });
      return;
    }

    const changedInning = result.lineup?.[0];
    if (!changedInning) return;
    const cloneInning = (inning: any) => ({
      ...inning,
      BENCH: Array.isArray(inning.BENCH) ? [...inning.BENCH] : [],
    });
    const next = base.map((innState: any, idx: number) =>
      idx < currentInning ? innState : cloneInning(changedInning),
    );
    const newPitcherName = (changedInning.P as any)?.name || "New pitcher";

    setPendingLineup(next);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flush, 500);
    setInGameUndoStack([{ lineup: base }, ...inGameUndoStack].slice(0, 5));
    setInGameSelection(null);
    tapHaptic();
    toast.push({
      kind: "success",
      title: "Pitching change",
      message: `${newPitcherName} takes the mound from inning ${
        currentInning + 1
      } on — the rest of the lineup re-flowed around it.`,
    });
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
    const next = applySwap(liveInning, firstSel, secondSel);
    if (!next) {
      setInGameSelection(null);
      return;
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
            const pitchRules = resolvePitchRuleSet(team);
            const availablePitchers = presentPlayers.filter((p: any) =>
              checkPitchEligibility(p, targetDate, ageGroup, pitchRules),
            );

            const pitchCounts = game.pitchCounts || {};
            const pitchLimit = maxPitchesForAge(ageGroup, pitchRules);
            const updatePitchCount = (playerId: any, val: any) => {
              const next = { ...(game.pitchCounts || {}) };
              const num = parseInt(val, 10);
              if (Number.isFinite(num) && num >= 0) {
                next[playerId] = num;
                // Warn (don't block) when a count exceeds the age pitch limit —
                // a safety guardrail the coach can still override for accuracy.
                if (num > pitchLimit) {
                  const p = team.players.find((pl: any) => pl.id === playerId);
                  toast.push({
                    kind: "warn",
                    title: "Over pitch limit",
                    message: `${p?.name || "Pitcher"} at ${num} exceeds the ${ageGroup} limit of ${pitchLimit}.`,
                  });
                }
              } else if (val === "") {
                delete next[playerId];
              }
              updateGame(game.id, { pitchCounts: next });
            };

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
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min="0"
                              max={pitchLimit}
                              inputMode="numeric"
                              value={pitchCounts[player.id] ?? ""}
                              onChange={(e) =>
                                updatePitchCount(player.id, e.target.value)
                              }
                              placeholder="0"
                              className="w-14 p-1 text-xs font-black text-ink text-center bg-surface border border-line rounded outline-none focus:ring-1 focus:ring-[var(--team-primary)] tabular-nums"
                            />
                            <span className="text-[9px] font-bold uppercase tracking-widest text-warnfg">
                              P
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
                <h3 className="text-xl font-black uppercase tracking-tight text-ink">
                  Final Score
                </h3>
              </div>
              <button
                onClick={() => setShowEndGameScore(false)}
                className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            {/* Pitch counts at finalize — finalizeGame commits game.pitchCounts
                to each pitcher's season record, so this is the last stop to
                get them right. Kid-pitch only (machine pitch has no counts). */}
            {!String(game.pitchingFormat || team.pitchingFormat || "")
              .toLowerCase()
              .includes("machine") &&
              (() => {
                const seen = new Set();
                const used: any[] = [];
                for (const innState of liveLineup) {
                  const pitcher = innState?.P;
                  if (pitcher && !seen.has(pitcher.id)) {
                    seen.add(pitcher.id);
                    used.push(pitcher);
                  }
                }
                if (used.length === 0) return null;
                const counts = game.pitchCounts || {};
                return (
                  <div className="px-5 sm:px-6 py-4 border-b border-line">
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-2">
                      Pitch counts — enter each kid's total before saving
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {used.map((p: any) => (
                        <div
                          key={`final-pc-${p.id}`}
                          className="flex items-center gap-2"
                        >
                          <span className="flex-1 text-sm font-bold text-ink truncate">
                            {p.name}
                          </span>
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={counts[p.id] ?? ""}
                            onChange={(e) => {
                              const next = { ...(game.pitchCounts || {}) };
                              const num = parseInt(e.target.value, 10);
                              if (Number.isFinite(num) && num >= 0) {
                                next[p.id] = num;
                              } else {
                                delete next[p.id];
                              }
                              updateGame(game.id, { pitchCounts: next });
                            }}
                            placeholder="0"
                            aria-label={`Pitch count for ${p.name}`}
                            className="w-20 p-2 text-sm font-black text-ink text-center bg-surface border border-line-strong rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] tabular-nums"
                          />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">
                            pitches
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
                  <h3 className="text-xl font-black uppercase tracking-tight text-ink">
                    Remove a Player
                  </h3>
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
