import { useCallback } from "react";
import {
  normalizeDateToIso,
  recordPitchingOuting,
  recordCatchingOuting,
} from "../utils/helpers";
import { celebrateWin } from "../utils/celebrate";
import type { ConfirmContextValue, ToastContextValue } from "../types";

// Game/schedule CRUD extracted from App.tsx's TeamProvider. This slice is pure
// persistence (add/update/postpone/finalize/delete a game) with no coupling to
// the lineup-generation engine or the UI bridge — it only reads teamData and
// writes through the injected updateTeam. Lineup generation, templates, and
// in-game player removal stay in App.tsx because they reach into the engine and
// UI refs.
interface UseGameCrudArgs {
  // teamData carries more fields at runtime than the strict Team interface
  // models; typed permissively to mirror the App.tsx provider.
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
}

export const useGameCrud = ({
  teamData,
  updateTeam,
  toast,
  confirm,
}: UseGameCrudArgs) => {
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
        // Pool/Bracket is a Tournament-only subset; Rec games are always League.
        // New Tournament games default to Pool play (coach can switch to Bracket).
        gameType: form.leagueRuleSet === "USSSA" ? "pool" : "league",
        defenseSize: teamData.defenseSize,
        battingSize: teamData.battingSize,
        positionLock: teamData.positionLock,
        isScrimmage: !!form.isScrimmage,
        lineup: null,
        battingLineup: null,
        attendance: {},
        status: "scheduled",
        teamScore: null,
        opponentScore: null,
      };
      updateTeam({ games: [...teamData.games, newGame] });
    },
    [teamData, updateTeam, toast],
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
      const next = teamData.games.map((g: any) =>
        g.id === gameId ? { ...g, ...safeUpdates } : g,
      );
      updateTeam({ games: next });
    },
    [teamData.games, updateTeam],
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
        (pid) => Number.isFinite(pitchCounts[pid]) && pitchCounts[pid] > 0,
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
          pitching: recordPitchingOuting(
            p.pitching,
            game.date,
            pitchCounts[p.id],
            game.id,
          ),
        };
      });
    },
    [teamData.players],
  );

  // Helper: log each player's catching innings for THIS game (from the played
  // lineup) so the same-day catch<->pitch rule can see catching across games
  // (doubleheaders). Keyed by game id; counts C appearances per inning. Returns
  // the next players array (unchanged ref if no one caught).
  const commitCatchingToPlayers = useCallback(
    (lineup: any, date: any, gameId: any, basePlayers: any[]) => {
      if (!date || !Array.isArray(lineup)) return basePlayers;
      const counts: Record<string, number> = {};
      for (const inn of lineup) {
        const c = inn?.C;
        if (c?.id) counts[c.id] = (counts[c.id] || 0) + 1;
      }
      const ids = Object.keys(counts);
      if (ids.length === 0) return basePlayers;
      return basePlayers.map((p: any) =>
        ids.includes(p.id)
          ? {
              ...p,
              catching: recordCatchingOuting(
                p.catching,
                date,
                counts[p.id],
                gameId,
              ),
            }
          : p,
      );
    },
    [],
  );

  // Postpone a game: set status to "postponed", clear scores, AND commit any
  // pitch counts that were entered before the rain came. Pitchers still threw
  // their warm-up tosses or innings before the call; their counts should
  // count toward rest just like a finalized game.
  const postponeGame = useCallback(
    (gameId: any) => {
      const game = teamData.games.find((g: any) => g.id === gameId);
      if (!game) return;
      const nextPlayers = commitPitchCountsToPlayers(game);
      const nextGames = teamData.games.map((g: any) =>
        g.id === gameId
          ? {
              ...g,
              status: "postponed",
              teamScore: null,
              opponentScore: null,
            }
          : g,
      );
      const playersChanged = nextPlayers !== teamData.players;
      if (playersChanged) {
        updateTeam({ players: nextPlayers, games: nextGames });
      } else {
        updateTeam({ games: nextGames });
      }
    },
    [teamData.games, teamData.players, commitPitchCountsToPlayers, updateTeam],
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
      if (
        game.lineup?.length &&
        Number.isFinite(inningsPlayed) &&
        inningsPlayed > 0
      ) {
        const longest =
          game.originalLineup?.length > game.lineup.length
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

      // Commit pitch counts AND catching innings (from the lineup that was
      // actually played, after any trim) to the player records.
      const effectiveLineup = gameUpdates.lineup || game.lineup;
      let nextPlayers = commitPitchCountsToPlayers(game);
      nextPlayers = commitCatchingToPlayers(
        effectiveLineup,
        game.date,
        game.id,
        nextPlayers,
      );
      const playersChanged = nextPlayers !== teamData.players;
      if (playersChanged) {
        const nextGames = teamData.games.map((g: any) =>
          g.id === gameId ? { ...g, ...gameUpdates } : g,
        );
        updateTeam({ players: nextPlayers, games: nextGames });
      } else {
        updateGame(gameId, gameUpdates);
      }

      // That's a W — confetti in team colors. Single choke point covers both
      // finalize paths (InGameView and the schedule's finalize dialog).
      if (Number(teamScore) > Number(opponentScore)) {
        void celebrateWin(
          [teamData.primaryColor, teamData.secondaryColor].filter(Boolean),
        );
      }
    },
    [
      teamData.games,
      teamData.players,
      teamData.primaryColor,
      teamData.secondaryColor,
      updateGame,
      updateTeam,
      commitPitchCountsToPlayers,
      commitCatchingToPlayers,
    ],
  );

  const deleteSavedGame = useCallback(
    async (gameId: any) => {
      const ok = await confirm({
        title: "Delete this game?",
        message: "Its lineup and score go with it. You can undo right after.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const prevGames = teamData.games;
      const removed = prevGames.find((g: any) => g.id === gameId);
      updateTeam({ games: prevGames.filter((g: any) => g.id !== gameId) });
      toast.push({
        kind: "success",
        title: "Game deleted",
        message: removed?.opponent
          ? `vs ${removed.opponent} — tap Undo to restore.`
          : "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () => updateTeam({ games: prevGames }),
        },
      } as any);
    },
    [teamData.games, updateTeam, toast, confirm],
  );

  return { addGame, updateGame, postponeGame, finalizeGame, deleteSavedGame };
};
