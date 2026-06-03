import { useCallback } from "react";
import { deleteDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { appId, db } from "../firebase";
import { normalizeDateToIso, recordPitchingOuting, slimGame } from "../utils/helpers";
import { reportError } from "../utils/errorReporter";
import type { ToastContextValue } from "../types";

// Game/schedule CRUD extracted from App.tsx's TeamProvider. This slice is pure
// persistence (add/update/postpone/finalize/delete a game) with no coupling to
// the lineup-generation engine or the UI bridge — it only reads teamData and
// writes through the injected updateTeam. Lineup generation, templates, and
// in-game player removal stay in App.tsx because they reach into the engine and
// UI refs.
//
// Phase 3 migration: games live in the games subcollection (tagged `_sub` when
// merged in). New games are created there; edits/deletes route to the source —
// the game's own doc (slimmed like the legacy array writes) or the legacy root
// array (rebuilt from non-`_sub` entries). Pitch-count commits write players
// separately (players aren't migrated).
interface UseGameCrudArgs {
  // teamData carries more fields at runtime than the strict Team interface
  // models; typed permissively to mirror the App.tsx provider.
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: ToastContextValue;
  activeTeamId: string | null | undefined;
}

export const useGameCrud = ({ teamData, updateTeam, toast, activeTeamId }: UseGameCrudArgs) => {
  const gameDoc = useCallback(
    (id: string) =>
      doc(db, "artifacts", appId, "public", "data", "teams", activeTeamId!, "games", id),
    [activeTeamId]
  );
  const legacyGames = useCallback(
    () => (teamData.games || []).filter((g: any) => !g?._sub),
    [teamData.games]
  );
  const reportGameError = useCallback(
    (op: string, err: unknown) => {
      reportError(err, { source: `useGameCrud.${op}` });
      toast.push({ kind: "error", title: "Save failed", message: "Check your connection and try again." });
    },
    [toast]
  );

  const addGame = useCallback(
    (form: any) => {
      if (!form.date || !form.opponent.trim()) {
        toast.push({
          kind: "warn",
          title: "Missing info",
          message: "Date and opponent required.",
        });
        return;
      }
      const newGame = {
        id: "g-" + Math.random().toString(36).substring(2, 10),
        date: form.date,
        opponent: form.opponent.trim(),
        leagueRuleSet: form.leagueRuleSet,
        pitchingFormat: form.pitchingFormat,
        defenseSize: teamData.defenseSize,
        battingSize: teamData.battingSize,
        positionLock: teamData.positionLock,
        lineup: null,
        battingLineup: null,
        attendance: {},
        status: "scheduled",
        teamScore: null,
        opponentScore: null,
      };
      // New games are created in the subcollection (slimmed, like every stored
      // game). The team subscription rehydrates it into teamData.games.
      setDoc(gameDoc(newGame.id), slimGame(newGame as any) as any).catch((err) =>
        reportGameError("addGame", err)
      );
    },
    [teamData.defenseSize, teamData.battingSize, teamData.positionLock, gameDoc, toast, reportGameError]
  );

  const updateGame = useCallback(
    (gameId: any, updates: any) => {
      // Defend against callers that pass empty/invalid dates from a cleared
      // input field. An empty `date` would break every `games.sort((a,b) =>
      // new Date(a.date) - new Date(b.date))` comparator and the upcoming-game
      // logic. If the date is empty/unparseable, drop just that key from the
      // update rather than persisting garbage.
      let safeUpdates = updates;
      if ("date" in safeUpdates) {
        const iso = normalizeDateToIso(safeUpdates.date);
        if (!iso) {
          const { date: _drop, ...rest } = safeUpdates;
          safeUpdates = rest;
        } else if (iso !== safeUpdates.date) {
          safeUpdates = { ...safeUpdates, date: iso };
        }
      }
      if (Object.keys(safeUpdates).length === 0) return;
      const game = (teamData.games || []).find((g: any) => g.id === gameId);
      if (game?._sub) {
        // slimGame slims any lineup/battingLineup/originalLineup present in the
        // patch (it no-ops on keys it doesn't recognize), matching how the
        // legacy array path is slimmed by persistTeam.
        updateDoc(gameDoc(gameId), slimGame(safeUpdates) as any).catch((err) =>
          reportGameError("updateGame", err)
        );
        return;
      }
      const next = legacyGames().map((g: any) =>
        g.id === gameId ? { ...g, ...safeUpdates } : g
      );
      updateTeam({ games: next });
    },
    [teamData.games, legacyGames, gameDoc, updateTeam, reportGameError]
  );

  // Helper: push the game's pitch counts to each pitcher's player record.
  // Replaces (not accumulates) the pitcher's recentPitches/lastPitchDate, since
  // the engine treats those as "most recent outing" for rest-day calculations.
  // Returns the next players array (or the unchanged players array if there's
  // nothing to commit). Caller is responsible for combining this with their
  // own game updates and writing both via updateTeam.
  const commitPitchCountsToPlayers = useCallback(
    (game: any) => {
      const pitchCounts = game?.pitchCounts || {};
      const pitchedPlayerIds = Object.keys(pitchCounts).filter(
        (pid) => Number.isFinite(pitchCounts[pid]) && pitchCounts[pid] > 0
      );
      if (pitchedPlayerIds.length === 0 || !game.date) {
        return teamData.players;
      }
      return teamData.players.map((p: any) => {
        if (!pitchedPlayerIds.includes(p.id)) return p;
        return {
          ...p,
          // Sets recentPitches/lastPitchDate (unchanged) and appends the outing
          // to the pitcher's rolling history log, keyed by game id so same-date
          // doubleheaders keep separate entries.
          pitching: recordPitchingOuting(p.pitching, game.date, pitchCounts[p.id], game.id),
        };
      });
    },
    [teamData.players]
  );

  // Postpone a game: set status to "postponed", clear scores, AND commit any
  // pitch counts that were entered before the rain came. Pitchers still threw
  // their warm-up tosses or innings before the call; their counts should
  // count toward rest just like a finalized game.
  const postponeGame = useCallback(
    (gameId: any) => {
      const game = (teamData.games || []).find((g: any) => g.id === gameId);
      if (!game) return;
      const nextPlayers = commitPitchCountsToPlayers(game);
      if (nextPlayers !== teamData.players) updateTeam({ players: nextPlayers });
      updateGame(gameId, {
        status: "postponed",
        teamScore: null,
        opponentScore: null,
      });
    },
    [teamData.games, teamData.players, commitPitchCountsToPlayers, updateGame, updateTeam]
  );

  // Finalize a game: set score, mark final, and trim/restore the lineup to
  // match how many innings were actually played.
  //
  // Trim semantics:
  //  - First time we trim: stash full lineup in `originalLineup`, then slice.
  //  - Trimming further: leave `originalLineup` alone (still has the longest
  //    version we've ever seen).
  //  - Restoring (passing a count larger than current `lineup.length`):
  //    pull from `originalLineup` if it has enough entries.
  //  - If `inningsPlayed` matches current length, no lineup change is made.
  const finalizeGame = useCallback(
    (gameId: any, teamScore: any, opponentScore: any, inningsPlayed: any) => {
      const game = teamData.games.find((g: any) => g.id === gameId);
      if (!game) return;
      const gameUpdates: Record<string, any> = {
        teamScore,
        opponentScore,
        status: "final",
      };
      if (game.lineup?.length && Number.isFinite(inningsPlayed) && inningsPlayed > 0) {
        const longest = game.originalLineup?.length > game.lineup.length
          ? game.originalLineup
          : game.lineup;
        const target = Math.min(inningsPlayed, longest.length);
        if (target < game.lineup.length) {
          // Trim. Stash longest version (only on first trim).
          if (!game.originalLineup) {
            gameUpdates.originalLineup = game.lineup;
          }
          gameUpdates.lineup = game.lineup.slice(0, target);
        } else if (target > game.lineup.length) {
          // Restore from originalLineup if available.
          if (game.originalLineup && game.originalLineup.length >= target) {
            gameUpdates.lineup = game.originalLineup.slice(0, target);
          }
          // else: no-op (can't restore beyond what we have)
        }
      }

      // Commit any pitch counts entered for this game to the player records,
      // then write the game updates (routed to its doc or the legacy array).
      const nextPlayers = commitPitchCountsToPlayers(game);
      if (nextPlayers !== teamData.players) updateTeam({ players: nextPlayers });
      updateGame(gameId, gameUpdates);
    },
    [teamData.games, teamData.players, updateGame, updateTeam, commitPitchCountsToPlayers]
  );

  const deleteSavedGame = useCallback(
    (gameId: any) => {
      if (!window.confirm("Delete this game?")) return;
      const removed = (teamData.games || []).find((g: any) => g.id === gameId);
      if (!removed) return;
      if (removed._sub) {
        const { _sub, ...restore } = removed;
        deleteDoc(gameDoc(gameId)).catch((err) => reportGameError("deleteSavedGame", err));
        toast.push({
          kind: "success",
          title: "Game deleted",
          message: removed.opponent
            ? `vs ${removed.opponent} — tap Undo to restore.`
            : "Tap Undo to restore.",
          duration: 10000,
          action: {
            label: "Undo",
            onClick: () =>
              setDoc(gameDoc(gameId), slimGame(restore) as any).catch((err) =>
                reportGameError("deleteSavedGame.undo", err)
              ),
          },
        } as any);
        return;
      }
      const prevLegacy = legacyGames();
      updateTeam({ games: prevLegacy.filter((g: any) => g.id !== gameId) });
      toast.push({
        kind: "success",
        title: "Game deleted",
        message: removed.opponent
          ? `vs ${removed.opponent} — tap Undo to restore.`
          : "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () => updateTeam({ games: prevLegacy }),
        },
      } as any);
    },
    [teamData.games, legacyGames, gameDoc, updateTeam, toast, reportGameError]
  );

  return { addGame, updateGame, postponeGame, finalizeGame, deleteSavedGame };
};
