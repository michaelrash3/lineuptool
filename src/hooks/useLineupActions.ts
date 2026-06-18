import { useCallback } from "react";
import {
  generateLineup as engineGenerateLineup,
  generateBattingOnly as engineGenerateBattingOnly,
  generateTournamentLineup as engineGenerateTournamentLineup,
  resolvePitchRuleSet,
} from "../lineupEngine";
import { isActiveRosterPlayer, sameDayRoleSets } from "../utils/helpers";
import type { ToastContextValue } from "../types";

// Lineup generation, undo, save, templates, and mid-game player removal —
// extracted from App.tsx's TeamProvider. These reach into the engine plus the
// shared UI bridge (in-progress lineup inputs/results) and a previous-lineup
// ref for undo, so the hook takes those refs alongside persistence deps.
// Bodies are moved verbatim; behavior is unchanged.
interface UseLineupActionsArgs {
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  updateGame: (gameId: any, updates: any) => void;
  persistTeam: (updates: any) => void;
  toast: ToastContextValue;
  uiBridge: { current: any };
  previousLineupRef: { current: any };
}

export const useLineupActions = ({
  teamData,
  updateTeam,
  updateGame,
  persistTeam,
  toast,
  uiBridge,
  previousLineupRef,
}: UseLineupActionsArgs) => {
  // ----- Lineup generation (uses the engine) -----
  // uiBridge / previousLineupRef are owned by TeamProvider and passed in; the
  // UI sets inputs via useUI() which we read at call time through uiBridge.
  const _runGenerate = useCallback(
    (seed: any, options: any = {}) => {
      const inputs = uiBridge.current.getInputs();
      if (!inputs) return;
      const {
        currentGame,
        currentGameAttendance,
        firstInningLineup,
        previousLineup,
        previousBattingLineup,
      } = inputs;
      if (!currentGame) {
        toast.push({ kind: "error", title: "No game selected" });
        return;
      }
      // Per-game toggle drives default; explicit options override (used by the
      // failure-prompt "Retry Relaxed" action).
      const gameSaysRelaxed = currentGame.applySeasonalFairness === false;
      const relaxFairness =
        options.relaxFairness != null
          ? options.relaxFairness
          : gameSaysRelaxed;

      const presentPlayers = teamData.players.filter(
        // Roster-inactive kids never play, even if a stale attendance map
        // still has them marked present from before they went inactive.
        (p: any) => isActiveRosterPlayer(p) && currentGameAttendance[p.id] !== false
      );
      if (presentPlayers.length < 7) {
        toast.push({
          kind: "error",
          title: "Not enough players",
          message: "Need at least 7 present.",
        });
        return;
      }

      // Tournament (USSSA) games build the scripted starters/subs plan via the
      // parallel tournament pipeline; Rec keeps the fairness engine untouched.
      const isTournamentGame =
        (currentGame.leagueRuleSet || teamData.leagueRuleSet) === "USSSA";
      const engineFn = isTournamentGame
        ? engineGenerateTournamentLineup
        : engineGenerateLineup;
      const result = engineFn({
        activePlayers: presentPlayers,
        allPlayers: teamData.players,
        games: teamData.games,
        evaluationEvents: teamData.evaluationEvents,
        currentGame,
        firstInningOverridesById: firstInningLineup,
        totalInnings:
          parseInt(currentGame.inningsCount || teamData.inningsCount, 10) || 6,
        leagueRuleSet: currentGame.leagueRuleSet || teamData.leagueRuleSet,
        competitive:
          (currentGame.leagueRuleSet || teamData.leagueRuleSet) === "USSSA",
        depthChart: teamData.depthChart,
        pitchRuleSet: resolvePitchRuleSet({ pitchRuleSet: teamData.pitchRuleSet, customPitchLimit: teamData.customPitchLimit, customRestTiers: teamData.customRestTiers }),
        sameDayRoles: sameDayRoleSets(teamData.players, currentGame.date, currentGame.id),
        teamAge: teamData.teamAge,
        defenseSize: currentGame.defenseSize || teamData.defenseSize,
        positionLock: currentGame.positionLock || teamData.positionLock,
        battingSize: currentGame.battingSize || teamData.battingSize,
        pitchingFormat: currentGame.pitchingFormat || teamData.pitchingFormat,
        catcherMaxInnings:
          currentGame.catcherMaxInnings || teamData.catcherMaxInnings,
        catcherConsecutive:
          currentGame.catcherConsecutive ?? teamData.catcherConsecutive,
        seed,
        relaxFairness,
        isBigGame: currentGame.isBigGame === true,
      });

      if (result.error) {
        // Engine internally retries with relaxed fairness if strict fairness
        // fails. So an error here means the constraints are genuinely
        // unsatisfiable (restrictions / locks / setup conflicts). The engine
        // gives us a specific message about WHAT broke.
        toast.push({
          kind: "error",
          title: "Could not build lineup",
          message: result.error,
          duration: 0,
        });
        return;
      }

      // Snapshot for undo
      previousLineupRef.current = {
        lineup: previousLineup,
        battingLineup: previousBattingLineup,
      };
      uiBridge.current.applyResult(result);

      // Push success toast with Undo action (only meaningful if there *was* a previous)
      const hasPrev = !!previousLineup;
      // Engine may have internally relaxed fairness when strict failed.
      // Treat that as a soft note, not an error.
      const internallyRelaxed = result.fairnessRelaxed === true;
      if (internallyRelaxed) {
        // Structured detail for diagnosis — surfaces the dominant strict-pass
        // failure (type/position/inning) alongside the coach-facing message.
        console.warn("[lineup] strict fairness relaxed:", {
          type: result.fairnessRelaxedType,
          reason: result.fairnessRelaxedReason,
        });
      }
      // Tournament (competitive) games intentionally ignore the seasonal
      // fairness ledger (best-XI + a per-game minimum-play floor), so the
      // "one-game balance" caveat is expected behavior there — not a warning
      // worth surfacing on every build. Suppress the relaxed-fairness note for
      // Tournament games; Rec games keep it. (internallyRelaxed can't even fire
      // in competitive mode — see effectiveRelax in lineupEngine — so the only
      // thing this hides for Tournament is the intentional relaxFairness path.)
      const showAsRelaxed =
        (relaxFairness || internallyRelaxed) && !isTournamentGame;
      // When the engine fell back, show the ACTUAL blocker that defeated
      // strict fairness (e.g. "Bench schedule couldn't satisfy…") so the
      // cause can be locked down, not just a generic note.
      const relaxedBlocker =
        result.fairnessRelaxedReason ||
        "the bench distribution couldn't be scheduled";
      // The engine eases the rotation lock for an inning when keeping everyone
      // in their slot would otherwise make a fair, full defense impossible.
      const relaxedInns = Array.isArray(result.lockRelaxedInnings)
        ? result.lockRelaxedInnings
        : [];
      const lockNote =
        relaxedInns.length > 0
          ? ` Rotation eased in inning ${relaxedInns.join(", ")} to keep a full, fair defense.`
          : "";
      const successMessage = !showAsRelaxed
        ? hasPrev
          ? `Tap Undo to restore the previous lineup.${lockNote}`
          : lockNote.trim()
        : internallyRelaxed
        ? `Strict fairness blocked — ${relaxedBlocker} Built one-game balanced instead; catch up over future games.`
        : "Built without considering past games. Some kids may bench more than others this season.";
      toast.push({
        kind: showAsRelaxed ? "warn" : "success",
        title: showAsRelaxed
          ? "Lineup built (one-game balance)"
          : "Lineup generated",
        message: successMessage,
        duration: 10000,
        action: hasPrev
          ? {
              label: "Undo",
              onClick: () => {
                const snap = previousLineupRef.current;
                if (snap)
                  uiBridge.current.applyResult({
                    lineup: snap.lineup,
                    battingLineup: snap.battingLineup,
                  });
              },
            }
          : undefined,
      });
    },
    [teamData.players,
      teamData.games,
      teamData.evaluationEvents,
      teamData.inningsCount,
      teamData.leagueRuleSet,
      teamData.teamAge,
      teamData.defenseSize,
      teamData.positionLock,
      teamData.battingSize,
      teamData.pitchingFormat,
      teamData.catcherMaxInnings,
      teamData.catcherConsecutive,
      teamData.depthChart,
      teamData.pitchRuleSet,
      teamData.customPitchLimit,
      teamData.customRestTiers,
      toast, uiBridge, previousLineupRef]
  );

  const generateLineup = useCallback(
    () => _runGenerate(Date.now()),
    [_runGenerate]
  );
  const regenerateLineup = useCallback(
    () => _runGenerate(Date.now() + Math.floor(Math.random() * 1e6)),
    [_runGenerate]
  );

  // Re-roll just the defensive schedule, preserving the current batting
  // order. The engine still computes both halves, but we throw away its
  // batting output and reapply the existing one. Mirror of
  // `regenerateBatting` from the other direction.
  const regenerateDefense = useCallback(() => {
    const inputs = uiBridge.current.getInputs();
    if (!inputs) return;
    const {
      currentGame,
      currentGameAttendance,
      firstInningLineup,
      lineup,
      battingLineup,
    } = inputs;
    if (!currentGame) {
      toast.push({ kind: "error", title: "No game selected" });
      return;
    }
    if (!lineup) {
      toast.push({
        kind: "error",
        title: "Generate a lineup first",
        message: "Re-roll defense works on top of an existing lineup.",
      });
      return;
    }
    const presentPlayers = teamData.players.filter(
      (p: any) => isActiveRosterPlayer(p) && currentGameAttendance[p.id] !== false
    );
    if (presentPlayers.length < 7) {
      toast.push({
        kind: "error",
        title: "Not enough players",
        message: "Need at least 7 present.",
      });
      return;
    }

    const result = engineGenerateLineup({
      activePlayers: presentPlayers,
      allPlayers: teamData.players,
      games: teamData.games,
      evaluationEvents: teamData.evaluationEvents,
      currentGame,
      firstInningOverridesById: firstInningLineup,
      totalInnings:
        parseInt(currentGame.inningsCount || teamData.inningsCount, 10) || 6,
      leagueRuleSet: currentGame.leagueRuleSet || teamData.leagueRuleSet,
      competitive:
        (currentGame.leagueRuleSet || teamData.leagueRuleSet) === "USSSA",
      depthChart: teamData.depthChart,
      pitchRuleSet: resolvePitchRuleSet({ pitchRuleSet: teamData.pitchRuleSet, customPitchLimit: teamData.customPitchLimit, customRestTiers: teamData.customRestTiers }),
      sameDayRoles: sameDayRoleSets(teamData.players, currentGame.date, currentGame.id),
      teamAge: teamData.teamAge,
      defenseSize: currentGame.defenseSize || teamData.defenseSize,
      positionLock: currentGame.positionLock || teamData.positionLock,
      battingSize: currentGame.battingSize || teamData.battingSize,
      catcherMaxInnings:
        currentGame.catcherMaxInnings || teamData.catcherMaxInnings,
      catcherConsecutive:
        currentGame.catcherConsecutive ?? teamData.catcherConsecutive,
      seed: Date.now() + Math.floor(Math.random() * 1e6),
      relaxFairness: currentGame.applySeasonalFairness === false,
      isBigGame: currentGame.isBigGame === true,
    });

    if (result.error) {
      toast.push({
        kind: "error",
        title: "Couldn't re-roll defense",
        message: result.error,
        duration: 0,
      });
      return;
    }

    previousLineupRef.current = { lineup, battingLineup };
    uiBridge.current.applyResult({
      lineup: result.lineup,
      // Preserve the existing batting order — re-roll only touched defense.
      battingLineup,
    });
    toast.push({
      kind: "success",
      title: "Defense re-rolled",
      message: lineup ? "Tap Undo to restore the previous defense." : "",
      duration: 6000,
      action: lineup
        ? {
            label: "Undo",
            onClick: () => {
              const snap = previousLineupRef.current;
              if (snap)
                uiBridge.current.applyResult({
                  lineup: snap.lineup,
                  battingLineup: snap.battingLineup,
                });
            },
          }
        : undefined,
    });
  }, [teamData.players,
    teamData.games,
    teamData.evaluationEvents,
    teamData.inningsCount,
    teamData.leagueRuleSet,
    teamData.teamAge,
    teamData.defenseSize,
    teamData.positionLock,
    teamData.battingSize,
    teamData.catcherMaxInnings,
    teamData.catcherConsecutive,
    teamData.depthChart,
    teamData.pitchRuleSet,
    teamData.customPitchLimit,
    teamData.customRestTiers,
    toast, uiBridge, previousLineupRef]);

  // Re-roll JUST the batting order. Defensive lineup, attendance, and
  // first-inning overrides are all left alone. Useful when the defense
  // looks right but the order doesn't, or when the coach wants to try a
  // different shuffle of similarly-rated kids in the middle of the order.
  const regenerateBatting = useCallback(() => {
    const inputs = uiBridge.current.getInputs();
    if (!inputs) return;
    const { currentGame, currentGameAttendance, lineup, battingLineup } = inputs;
    if (!currentGame) {
      toast.push({ kind: "error", title: "No game selected" });
      return;
    }
    if (!lineup) {
      toast.push({
        kind: "error",
        title: "Generate a lineup first",
        message: "Re-roll batting works on top of an existing lineup.",
      });
      return;
    }
    const presentPlayers = teamData.players.filter(
      (p: any) => isActiveRosterPlayer(p) && currentGameAttendance[p.id] !== false
    );
    if (presentPlayers.length < 1) {
      toast.push({ kind: "error", title: "No players present to bat" });
      return;
    }

    const result = engineGenerateBattingOnly({
      activePlayers: presentPlayers,
      allPlayers: teamData.players,
      evaluationEvents: teamData.evaluationEvents,
      leagueRuleSet: currentGame.leagueRuleSet || teamData.leagueRuleSet,
      competitive:
        (currentGame.leagueRuleSet || teamData.leagueRuleSet) === "USSSA",
      teamAge: teamData.teamAge,
      battingSize: currentGame.battingSize || teamData.battingSize,
      seed: Date.now() + Math.floor(Math.random() * 1e6),
    });

    if (result.error) {
      toast.push({
        kind: "error",
        title: "Couldn't build batting order",
        message: result.error,
      });
      return;
    }

    // Snapshot for undo (preserve current defensive lineup, swap batting).
    previousLineupRef.current = { lineup, battingLineup };
    uiBridge.current.applyResult({
      lineup,
      battingLineup: result.battingLineup,
    });
    toast.push({
      kind: "success",
      title: "Batting order re-rolled",
      message: battingLineup ? "Tap Undo to restore the previous order." : "",
      duration: 6000,
      action: battingLineup
        ? {
            label: "Undo",
            onClick: () => {
              const snap = previousLineupRef.current;
              if (snap)
                uiBridge.current.applyResult({
                  lineup: snap.lineup,
                  battingLineup: snap.battingLineup,
                });
            },
          }
        : undefined,
    });
  }, [teamData.players,
    teamData.evaluationEvents,
    teamData.leagueRuleSet,
    teamData.teamAge,
    teamData.battingSize,
    toast, uiBridge, previousLineupRef]);

  const undoLineup = useCallback(() => {
    const snap = previousLineupRef.current;
    if (snap)
      uiBridge.current.applyResult({
        lineup: snap.lineup,
        battingLineup: snap.battingLineup,
      });
  }, [uiBridge, previousLineupRef]);

  const saveCurrentGame = useCallback(() => {
    const inputs = uiBridge.current.getInputs();
    if (!inputs?.currentGame) return;
    const {
      currentGame,
      currentGameAttendance,
      lineup,
      battingLineup,
      lineupQualityPenalty,
      tournamentPlan,
    } = inputs;
    if (!lineup) {
      toast.push({ kind: "warn", title: "No lineup to save" });
      return;
    }
    // persistTeam slims the lineup down to {id, name, number} per player to
    // stay under Firestore's 1MB document limit. Full player data is in
    // team.players and rehydrated on read.
    updateGame(currentGame.id, {
      lineup,
      battingLineup,
      attendance: currentGameAttendance,
      // Tournament plan (starters/subs/relief) rides with the lineup so the
      // substitution card survives a reload; null clears a stale plan when a
      // Rec lineup overwrites a tournament one.
      tournamentPlan: tournamentPlan || null,
      // Persist quality penalty so the chip survives a reload. Cleared
      // when the lineup is reset.
      qualityPenalty:
        typeof lineupQualityPenalty === "number"
          ? lineupQualityPenalty
          : null,
    });
    toast.push({ kind: "success", title: "Game saved" });
    uiBridge.current.markSaved?.();
  }, [updateGame, toast, uiBridge]);

  // Persist ONLY who's present/absent for the current game — no lineup
  // required. Lets a coach record attendance as RSVPs come in and plan the
  // lineup later (saveCurrentGame still refuses lineup-less saves so a full
  // "Save Game" stays meaningful).
  const saveAttendance = useCallback(() => {
    const inputs = uiBridge.current.getInputs();
    if (!inputs?.currentGame) return;
    const { currentGame, currentGameAttendance, lineup } = inputs;
    updateGame(currentGame.id, { attendance: currentGameAttendance || {} });
    const absent = Object.values(currentGameAttendance || {}).filter(
      (v) => v === false
    ).length;
    const presentCount = (teamData.players || []).filter(
      (p: any) =>
        p &&
        isActiveRosterPlayer(p) &&
        (currentGameAttendance || {})[p.id] !== false
    ).length;
    // Kid Pitch: the coach picks the starting pitcher first (Starting Pitcher
    // picker), and THAT selection rolls the projected lineup — so don't
    // auto-build here. Other formats have no pitcher step, so once attendance
    // is set we roll the projected lineup straight away for confirmation.
    const fmt = currentGame.pitchingFormat || teamData.pitchingFormat || "";
    const isKidPitch = /kid/i.test(fmt);
    const enough = !lineup && presentCount >= 7;
    const autoBuild = enough && !isKidPitch;
    toast.push({
      kind: "success",
      title: "Attendance saved",
      message: autoBuild
        ? "Rolling out your projected lineup for confirmation…"
        : enough && isKidPitch
        ? "Now pick your starting pitcher to roll the lineup."
        : absent > 0
        ? `${absent} marked out — plan the lineup whenever you're ready.`
        : "Everyone's in — plan the lineup whenever you're ready.",
    });
    if (autoBuild) {
      // Defer one tick so the attendance state settles before the engine reads
      // present players.
      setTimeout(() => generateLineup(), 0);
    }
  }, [updateGame, toast, uiBridge, teamData.players, teamData.pitchingFormat, generateLineup]);

  // ----- Lineup templates -----
  // Save the current lineup + batting order as a named template the coach
  // can apply to future games (especially useful for tournaments with
  // repeating opponents). Capped at 10 templates per team to keep the doc
  // size in check.
  const saveLineupTemplate = useCallback(
    (name: any) => {
      const inputs = uiBridge.current.getInputs();
      const { lineup, battingLineup } = inputs || {};
      if (!lineup) {
        toast.push({ kind: "warn", title: "No lineup to save as template" });
        return;
      }
      const trimmed = (name || "").trim() || "Untitled Template";
      const tpl = {
        id: "tpl-" + Math.random().toString(36).substring(2, 10),
        name: trimmed,
        lineup,
        battingLineup,
        createdAt: new Date().toISOString(),
      };
      const existing = Array.isArray(teamData.lineupTemplates)
        ? teamData.lineupTemplates
        : [];
      const next = [...existing, tpl].slice(-10);
      updateTeam({ lineupTemplates: next });
      toast.push({
        kind: "success",
        title: "Template Saved",
        message: `"${trimmed}" is now available to apply to other games.`,
      });
    },
    [teamData.lineupTemplates, updateTeam, toast, uiBridge]
  );

  // Apply a template to the currently-selected game's in-flight editor.
  // Stored lineups reference players by id; we leave them as-is and let
  // the editor flag any roster-gone players visually.
  const applyLineupTemplate = useCallback(
    (templateId: any) => {
      const tpl = (teamData.lineupTemplates || []).find(
        (t: any) => t.id === templateId
      );
      if (!tpl) return;
      uiBridge.current.applyTemplate?.(tpl);
      toast.push({
        kind: "info",
        title: "Template Applied",
        message: `Loaded "${tpl.name}". Tweak and save to keep the changes.`,
      });
    },
    [teamData.lineupTemplates, toast, uiBridge]
  );

  const deleteLineupTemplate = useCallback(
    (templateId: any) => {
      const next = (teamData.lineupTemplates || []).filter(
        (t: any) => t.id !== templateId
      );
      updateTeam({ lineupTemplates: next });
    },
    [teamData.lineupTemplates, updateTeam]
  );

  // Mid-game player removal: rebuild the defensive lineup from the current
  // inning onward (engine fills the open slots with remaining roster), strip
  // the removed player from the batting order (the rest of the order stays
  // static), and record the removal so the engine's fairness math prorates
  // their played innings.
  const removePlayerMidGame = useCallback(
    (playerId: any, opts: any = {}) => {
      const { fromInning = 0, reason = "injury" } = opts;
      const inputs = uiBridge.current.getInputs?.() || {};
      const game =
        inputs.currentGame ||
        (teamData.games || []).find(
          (g: any) => g.id === (opts.gameId || teamData?.inGameId)
        );
      const gameId = game?.id || opts.gameId;
      if (!gameId) {
        toast.push({ kind: "error", title: "No game selected" });
        return;
      }
      // Re-read the game from teamData to make sure we have the latest
      // persisted lineup (InGameView passes its pendingLineup via opts).
      const persistedGame = (teamData.games || []).find((g: any) => g.id === gameId);
      const existingLineup = opts.currentLineup || persistedGame?.lineup || [];
      const existingBatting =
        opts.currentBatting || persistedGame?.battingLineup || [];
      if (!Array.isArray(existingLineup) || existingLineup.length === 0) {
        toast.push({
          kind: "warn",
          title: "No lineup to rebuild",
          message: "Generate a lineup first before removing a player.",
        });
        return;
      }
      const existingRemovals = persistedGame?.midGameRemovals || {};
      // Active set = currently-rostered players who are still on the field
      // for this game: present (or no attendance flag) AND not previously
      // removed AND not the player we're removing now.
      const attendance = persistedGame?.attendance || {};
      const activePlayers = (teamData.players || []).filter((p: any) => {
        if (!p?.id) return false;
        if (p.id === playerId) return false;
        if (existingRemovals[p.id]) return false;
        if (!isActiveRosterPlayer(p)) return false;
        if (attendance[p.id] === false) return false;
        return true;
      });

      const fromInn = Math.min(
        Math.max(0, fromInning),
        existingLineup.length - 1
      );

      // Tournament games redraft best-available from the depth chart
      // (competitive mode — no fairness ledger); rec games keep the relaxed
      // rec rebuild. Played innings 0..fromInn-1 are preserved verbatim
      // either way; the min-play floor is approximate across the replayed
      // innings, same in kind as the relaxed rec rebuild.
      const isTournament =
        (persistedGame?.leagueRuleSet || teamData.leagueRuleSet) === "USSSA";

      const result = engineGenerateLineup({
        activePlayers,
        allPlayers: teamData.players || [],
        games: teamData.games || [],
        evaluationEvents: teamData.evaluationEvents || [],
        currentGame: persistedGame,
        totalInnings: existingLineup.length,
        leagueRuleSet:
          persistedGame?.leagueRuleSet || teamData.leagueRuleSet,
        teamAge: persistedGame?.teamAge || teamData.teamAge,
        defenseSize: persistedGame?.defenseSize || teamData.defenseSize,
        positionLock: persistedGame?.positionLock || teamData.positionLock,
        battingSize: persistedGame?.battingSize || teamData.battingSize,
        pitchingFormat:
          persistedGame?.pitchingFormat || teamData.pitchingFormat,
        catcherMaxInnings:
          persistedGame?.catcherMaxInnings || teamData.catcherMaxInnings,
        catcherConsecutive:
          persistedGame?.catcherConsecutive ?? teamData.catcherConsecutive,
        isBigGame: persistedGame?.isBigGame === true,
        competitive: isTournament,
        depthChart: teamData.depthChart,
        pitchRuleSet: resolvePitchRuleSet({
          pitchRuleSet: teamData.pitchRuleSet,
          customPitchLimit: teamData.customPitchLimit,
          customRestTiers: teamData.customRestTiers,
        }),
        sameDayRoles: sameDayRoleSets(
          teamData.players,
          persistedGame?.date,
          gameId
        ),
        seed: Date.now() & 0xffffffff,
        relaxFairness: true,
        fromInning: fromInn,
        currentLineup: existingLineup,
      });

      if (result.error) {
        toast.push({
          kind: "error",
          title: "Rebuild failed",
          message: result.error,
        });
        return;
      }

      const nextLineup = Array.isArray(result.lineup)
        ? result.lineup
        : existingLineup;
      const nextBatting = (existingBatting || []).filter(
        (p: any) => p && p.id !== playerId
      );
      const nextRemovals = {
        ...existingRemovals,
        [playerId]: { fromInning: fromInn, reason },
      };

      updateGame(gameId, {
        lineup: nextLineup,
        battingLineup: nextBatting,
        midGameRemovals: nextRemovals,
        // The scripted tournament starters/subs plan references the
        // pre-redraft grid (and possibly the removed player) — clear it so
        // pitching changes fall back to the per-inning swap path.
        ...(isTournament ? { tournamentPlan: null } : {}),
      });

      const removedPlayer = (teamData.players || []).find(
        (p: any) => p.id === playerId
      );
      toast.push({
        kind: "success",
        title: "Player removed",
        message: `${removedPlayer?.name || "Player"} removed from inning ${
          fromInn + 1
        }+. ${
          isTournament
            ? "Defense redrafted best-available from the depth chart"
            : "Defense rebuilt"
        }; batting order shrunk by one.`,
        duration: 6000,
      });
    },
    [teamData, updateGame, toast, uiBridge]
  );



  return {
    generateLineup,
    regenerateLineup,
    regenerateDefense,
    regenerateBatting,
    undoLineup,
    saveCurrentGame,
    saveAttendance,
    saveLineupTemplate,
    applyLineupTemplate,
    deleteLineupTemplate,
    removePlayerMidGame,
  };
};
