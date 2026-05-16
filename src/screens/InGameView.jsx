import React, { memo, useState, useRef, useCallback, useEffect } from "react";
import { Icons } from "../icons";
import { formatGameDateDisplay } from "../utils/helpers";
import { shareLineupCard } from "../lineup/lineupCard";
import { useTeam, useUI, useToast } from "../contexts.js";
import { ScoreEditor } from "./ScheduleTab.jsx";

export const InGameView = memo(() => {
  const { team, updateGame, finalizeGame } = useTeam();
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
  const flushTimerRef = useRef(null);

  // Resolve the live game without an early return so downstream hooks
  // still execute on null-game renders. The actual null/missing-game
  // bailouts happen below the hook block.
  const game = inGameId ? team.games.find((g) => g.id === inGameId) : null;
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
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
          <Icons.Clipboard className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 mb-2">
            No Lineup Generated
          </h3>
          <p className="text-sm text-slate-500 font-medium mb-6">
            You need to generate a lineup before starting in-game mode.
          </p>
          <button
            onClick={() => setInGameId(null)}
            className="text-xs font-black uppercase tracking-widest px-5 py-3 bg-slate-100 text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-200 transition-colors"
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

  // Apply a mid-game removal: record it on the game, clear the player
  // from inning N+ across both position slots and BENCH. The vacated
  // spot is left null so the coach can swap in a bench kid manually
  // (which is consistent with how a real coach handles a sub on the
  // field — the umpire/scorekeeper waits while you pick a replacement).
  const removePlayerMidGame = (playerId, reason = "injury") => {
    const fromInning = currentInning;
    // Build the new lineup with the player stripped from inning N+.
    const base = pendingLineup ?? game.lineup;
    const nextLineup = base.map((existingInn, i) => {
      if (i < fromInning) return existingInn;
      const next = {
        ...existingInn,
        BENCH: (existingInn.BENCH || []).filter(
          (p) => p && p.id !== playerId
        ),
      };
      for (const pos of Object.keys(existingInn)) {
        if (pos === "BENCH") continue;
        if (existingInn[pos]?.id === playerId) next[pos] = null;
      }
      return next;
    });
    setPendingLineup(nextLineup);
    // Persist both the new lineup AND the midGameRemovals record. Flush
    // happens via the existing debounce + immediate write for the
    // midGameRemovals field (small).
    updateGame(game.id, {
      lineup: nextLineup,
      midGameRemovals: {
        ...(game.midGameRemovals || {}),
        [playerId]: { fromInning, reason },
      },
    });
    setShowRemoveModal(false);
    toast.push({
      kind: "success",
      title: "Player removed",
      message: `Removed from inning ${
        fromInning + 1
      }+. Their played innings still count.`,
      duration: 6000,
    });
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
  const patchInning = (idx, patch) => {
    setPendingLineup((cur) => {
      const base = cur ?? game.lineup;
      return base.map((existingInn, i) => {
        if (i !== idx) return existingInn;
        return { ...existingInn, ...patch };
      });
    });
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flush, 500);
  };

  // Perform a swap and record undo info.
  const performSwap = (firstSel, secondSel) => {
    const undoEntry = {
      inning: currentInning,
      first: firstSel,
      second: secondSel,
    };
    const lineupInning = { ...liveLineup[currentInning] };
    lineupInning.BENCH = [...(lineupInning.BENCH || [])];

    const getPlayer = (sel) => {
      if (sel.type === "position") return lineupInning[sel.pos];
      // bench
      return lineupInning.BENCH.find((p) => p.id === sel.playerId);
    };

    const setPlayer = (sel, player) => {
      if (sel.type === "position") {
        lineupInning[sel.pos] = player;
      } else {
        // bench: replace the player at this id
        lineupInning.BENCH = lineupInning.BENCH.map((p) =>
          p.id === sel.playerId ? player : p
        );
      }
    };

    const playerA = getPlayer(firstSel);
    const playerB = getPlayer(secondSel);
    if (!playerA || !playerB) {
      setInGameSelection(null);
      return;
    }
    setPlayer(firstSel, playerB);
    setPlayer(secondSel, playerA);

    patchInning(currentInning, lineupInning);
    setInGameUndoStack([undoEntry, ...inGameUndoStack].slice(0, 5));
    setInGameSelection(null);
  };

  const handleTap = (sel) => {
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
    // Re-do the swap (it's symmetric — swapping again undoes it)
    const lineupInning = { ...liveLineup[entry.inning] };
    lineupInning.BENCH = [...(lineupInning.BENCH || [])];

    const getPlayer = (sel) => {
      if (sel.type === "position") return lineupInning[sel.pos];
      return lineupInning.BENCH.find((p) => p.id === sel.playerId);
    };
    const setPlayer = (sel, player) => {
      if (sel.type === "position") lineupInning[sel.pos] = player;
      else
        lineupInning.BENCH = lineupInning.BENCH.map((p) =>
          p.id === sel.playerId ? player : p
        );
    };

    // To undo, we need to find the players who are CURRENTLY at the swap positions.
    // But the player IDs in entry.first/second referred to the originals — after the
    // swap, the locations now contain the OTHER player. So we just swap again.
    const playerA = getPlayer(entry.first);
    const playerB = getPlayer(entry.second);
    if (playerA && playerB) {
      setPlayer(entry.first, playerB);
      setPlayer(entry.second, playerA);
      patchInning(entry.inning, lineupInning);
    }
    setInGameUndoStack(inGameUndoStack.slice(1));
    setInGameSelection(null);
  };

  const isCellSelected = (sel) => {
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
      <div className="bg-white shadow-md">
        <div className="h-1.5" style={{ backgroundColor: primaryColor }} />
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={close}
            className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
            aria-label="Close in-game mode"
          >
            <Icons.X className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center min-w-0">
            <div className="t-eyebrow truncate">vs. {game.opponent}</div>
            <div className="t-h3 truncate" style={{ letterSpacing: "0.05em" }}>
              In-Game Mode
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowRemoveModal(true)}
              className="p-2 text-slate-600 hover:bg-red-50 hover:text-red-700 rounded-lg transition-colors"
              aria-label="Remove a player (injured / ill / left)"
              title="Mark a player out for the rest of the game"
            >
              <Icons.Alert className="w-5 h-5" />
            </button>
            <button
              onClick={undo}
              disabled={inGameUndoStack.length === 0}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Undo last swap"
            >
              <Icons.Refresh className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Inning navigator + score */}
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button
            onClick={() => setInGameInning(Math.max(0, currentInning - 1))}
            disabled={currentInning === 0}
            className="p-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 font-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous inning"
          >
            <Icons.ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center flex-1">
            <div className="t-eyebrow">Inning</div>
            <div className="t-stat-num">
              {currentInning + 1}
              <span className="text-slate-300 text-lg font-black">
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
            className="p-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 font-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next inning"
          >
            <Icons.ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Available Pitchers — eligibility status + who's been used this game.
            Only shown for kid-pitch divisions (machine pitch has no pitch counts). */}
        {(() => {
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
          const targetDate = game.date || new Date().toISOString().slice(0, 10);
          const presentPlayers = team.players.filter(
            (p) =>
              (game.attendance?.[p.id] !== false) && !usedPitcherIds.has(p.id)
          );
          const availablePitchers = presentPlayers.filter((p) => {
            const pitching = p.pitching;
            if (!pitching?.lastPitchDate || !pitching.recentPitches) return true;
            const recent = pitching.recentPitches;
            if (recent === 0) return true;
            const maxByAge = {
              "9U": 75, "10U": 75, "11U to 12U": 85,
              "13U to 14U": 95, "15U to 18U": 105,
            };
            const max = maxByAge[ageGroup] ?? 105;
            if (recent >= max) return false;
            const diffDays = Math.floor(
              (new Date(targetDate).getTime() -
                new Date(pitching.lastPitchDate).getTime()) /
                86_400_000
            );
            const restNeeded =
              recent >= 66 ? 4 : recent >= 51 ? 3 : recent >= 36 ? 2 : recent >= 21 ? 1 : 0;
            return diffDays > restNeeded;
          });

          const pitchCounts = game.pitchCounts || {};
          const updatePitchCount = (playerId, val) => {
            const next = { ...(game.pitchCounts || {}) };
            const num = parseInt(val, 10);
            if (Number.isFinite(num) && num >= 0) {
              next[playerId] = num;
            } else if (val === "") {
              delete next[playerId];
            }
            updateGame(game.id, { pitchCounts: next });
          };

          return (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-800 mb-2 flex items-center gap-1.5">
                <Icons.Pitch className="w-3.5 h-3.5" />
                Pitchers
              </div>
              {usedPitcherList.length > 0 && (
                <div className="mb-2">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-amber-700 mb-1">
                    Used This Game
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {usedPitcherList.map(({ player, firstInning }) => (
                      <div
                        key={player.id}
                        className="flex items-center gap-2 bg-white border border-amber-200 rounded-md px-2 py-1.5"
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-800 truncate">
                            {player.name}
                          </span>
                          <span className="text-slate-400 text-[9px] font-medium shrink-0">
                            (I{firstInning})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={pitchCounts[player.id] ?? ""}
                            onChange={(e) =>
                              updatePitchCount(player.id, e.target.value)
                            }
                            placeholder="0"
                            className="w-14 p-1 text-xs font-black text-slate-900 text-center bg-amber-50 border border-amber-300 rounded outline-none focus:ring-1 focus:ring-amber-500 tabular-nums"
                          />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-amber-700">
                            P
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-amber-700 mb-1">
                  Available ({availablePitchers.length})
                </div>
                {availablePitchers.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic font-medium">
                    No eligible pitchers remaining
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {availablePitchers.map((player) => (
                      <span
                        key={player.id}
                        className="text-[11px] font-bold text-emerald-800 bg-white border border-emerald-200 rounded-md px-2 py-1"
                      >
                        {player.name}
                      </span>
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
            className="shrink-0 py-3 px-4 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-transform hover:-translate-y-0.5 flex items-center justify-center gap-2 bg-white/90 text-slate-700 border border-slate-200"
          >
            <Icons.Link className="w-4 h-4" /> Share
          </button>
          <button
            onClick={() => setShowEndGameScore(true)}
            className="flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            <Icons.FileText className="w-4 h-4" /> End Game / Enter Final Score
          </button>
        </div>
      </div>

      {/* Selection helper */}
      {inGameSelection && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 text-center">
          <span className="text-[11px] font-black uppercase tracking-widest text-blue-800">
            {inGameSelection.type === "position"
              ? `${inGameSelection.pos} selected`
              : "Bench player selected"}
            {" · tap another cell to swap"}
          </span>
        </div>
      )}

      {/* On-field positions */}
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-300 mb-3 px-1">
          On Field
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
          {presentPositions.map((pos) => {
            const player = inn[pos];
            const sel = { type: "position", pos };
            const selected = isCellSelected(sel);
            return (
              <button
                key={pos}
                onClick={() => handleTap(sel)}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                  selected
                    ? "bg-white border-blue-500 ring-4 ring-blue-200 shadow-lg"
                    : "bg-white border-slate-200 hover:border-slate-400 active:scale-[0.97]"
                }`}
              >
                <div className="w-12 shrink-0 text-center text-[11px] font-extrabold uppercase tracking-widest text-slate-500 bg-slate-100 rounded-lg py-1.5">
                  {pos}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-base font-black text-slate-900 truncate leading-tight">
                    {player?.name || "—"}
                  </div>
                  {player?.number && (
                    <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                      #{player.number}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Bench */}
        <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-300 mb-3 px-1">
          Bench ({benchKids.length})
        </h3>
        {benchKids.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-6 text-center">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              No Bench This Inning
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {benchKids.map((player) => {
              const sel = { type: "bench", playerId: player.id };
              const selected = isCellSelected(sel);
              return (
                <button
                  key={player.id}
                  onClick={() => handleTap(sel)}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    selected
                      ? "bg-white border-blue-500 ring-4 ring-blue-200 shadow-lg"
                      : "bg-slate-100 border-slate-200 hover:border-slate-400 active:scale-[0.97]"
                  }`}
                >
                  <div className="w-12 shrink-0 text-center text-[11px] font-extrabold uppercase tracking-widest text-slate-500 bg-white rounded-lg py-1.5 border border-slate-200">
                    BN
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-base font-black text-slate-900 truncate leading-tight">
                      {player.name}
                    </div>
                    {player.number && (
                      <div className="text-[10px] font-bold text-slate-400 mt-0.5">
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
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
            <div className="p-5 sm:p-6 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-0.5">
                  vs. {game.opponent}
                </div>
                <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">
                  Final Score
                </h3>
              </div>
              <button
                onClick={() => setShowEndGameScore(false)}
                className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-xl transition-colors -mt-1 -mr-2"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <ScoreEditor
              game={game}
              primaryColor={primaryColor}
              tertiaryColor={tertiaryColor}
              onSave={(ts, os, inningsPlayed) => {
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
          </div>
        </div>
      )}

      {/* Mid-game removal modal — injury / illness / left site. */}
      {showRemoveModal && (
        <div
          className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm"
          onClick={() => setShowRemoveModal(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
            <div className="p-5 sm:p-6 border-b border-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">
                    Remove a Player
                  </h3>
                  <p className="text-[12px] text-slate-600 font-medium mt-1">
                    Mark a player out for the rest of the game (injury, illness, or had to leave). Innings they already played still count toward season totals.
                  </p>
                </div>
                <button
                  onClick={() => setShowRemoveModal(false)}
                  className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-xl transition-colors -mt-1 -mr-2"
                  aria-label="Cancel"
                >
                  <Icons.X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                Inning {currentInning + 1} of {totalInnings} — they'll be removed from this inning onward
              </div>
              {eligibleForRemoval.length === 0 ? (
                <div className="text-sm font-bold text-slate-400 italic text-center py-8">
                  No players to remove this inning.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {eligibleForRemoval.map((p) => (
                    <button
                      key={`rem-${p.id}`}
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${p.name} from inning ${
                              currentInning + 1
                            } onward? Their played innings will still count.`
                          )
                        ) {
                          removePlayerMidGame(p.id, "injury");
                        }
                      }}
                      className="w-full text-left px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold hover:bg-red-50 hover:border-red-300 hover:text-red-900 transition-colors flex items-center justify-between gap-3"
                    >
                      <span className="truncate">
                        {p.number ? `#${p.number} ` : ""}
                        {p.name}
                      </span>
                      <Icons.Alert className="w-4 h-4 text-red-500 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {Object.keys(game.midGameRemovals || {}).length > 0 && (
                <div className="mt-5 pt-4 border-t border-slate-200">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Already removed
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {Object.entries(game.midGameRemovals).map(([pid, info]) => {
                      const player =
                        team.players.find((q) => q.id === pid) || { name: "(unknown)" };
                      return (
                        <div
                          key={`removed-${pid}`}
                          className="text-xs font-bold text-slate-500 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-2"
                        >
                          <span>
                            {player.name} — out from inning {info.fromInning + 1}
                            {info.reason ? ` (${info.reason})` : ""}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Restore ${player.name}? They'll come back available to assign from inning ${
                                    currentInning + 1
                                  } onward. (Coach-initiated mistake fix.)`
                                )
                              ) {
                                const next = { ...(game.midGameRemovals || {}) };
                                delete next[pid];
                                updateGame(game.id, { midGameRemovals: next });
                              }
                            }}
                            className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 px-2 py-1 rounded"
                          >
                            Undo
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
