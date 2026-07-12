import { useCallback } from "react";
import { normalizeDateToIso, genId } from "../utils/helpers";
import { allowedPitchingFormats } from "../constants/ui";
import { celebrateWin } from "../utils/celebrate";
import type {
  ConfirmContextValue,
  Game,
  ToastContextValue,
  Tournament,
} from "../types";
import type { TeamArrayUpdate } from "../utils/teamArrayUpdates";

// Game/schedule CRUD extracted from App.tsx's TeamProvider. This slice is pure
// persistence (add/update/postpone/finalize/delete a game) with no coupling to
// the lineup-generation engine or the UI bridge — it writes through the
// injected updateTeamArrays (narrow per-op Firestore writes so concurrent
// edits by two coaches can't clobber each other). Lineup generation,
// templates, and in-game player removal stay in App.tsx because they reach
// into the engine and UI refs.
interface UseGameCrudArgs {
  // teamData carries more fields at runtime than the strict Team interface
  // models; typed permissively to mirror the App.tsx provider.
  teamData: any;
  updateTeamArrays: (input: TeamArrayUpdate | TeamArrayUpdate[]) => void;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
}

export const useGameCrud = ({
  teamData,
  updateTeamArrays,
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
      // Write-time clamp: the add form's pill can display the only legal
      // format while the form STATE still holds an older pick (e.g. 9U+ is
      // always Kid Pitch; NKB 6-8U is always Machine Pitch) — never persist
      // a format this league + age can't play.
      const allowedFormats = allowedPitchingFormats(
        form.leagueRuleSet,
        teamData.teamAge,
      );
      const newGame: Game = {
        id: genId("g"),
        date: form.date,
        opponent: form.opponent.trim(),
        leagueRuleSet: form.leagueRuleSet,
        pitchingFormat: allowedFormats.includes(form.pitchingFormat)
          ? form.pitchingFormat
          : allowedFormats[0],
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
      updateTeamArrays({ op: "append", key: "games", entries: [newGame] });
    },
    [teamData, updateTeamArrays, toast],
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
      // mapEntries runs against the LATEST committed games, so a lineup save
      // racing another coach's edit only clobbers this one array — and two
      // edits to different games interleave cleanly on the next snapshot.
      const patch = safeUpdates;
      updateTeamArrays({
        op: "mapEntries",
        key: "games",
        map: (items: Game[]) =>
          items.map((g) => (g.id === gameId ? { ...g, ...patch } : g)),
      });
    },
    [updateTeamArrays],
  );

  // Pitching and catching arm-care logs are committed at stats-import time now
  // (useImportExportFlows.uploadGameStatsCsv), sourced from the GameChanger box
  // score rather than the planned lineup or hand-entered pitch counts. Finalize
  // and postpone therefore no longer touch player pitching/catching records.

  // Postpone a game: set status to "postponed" and clear scores.
  const postponeGame = useCallback(
    (gameId: any) => {
      const game = teamData.games.find((g: any) => g.id === gameId);
      if (!game) return;
      updateTeamArrays({
        op: "mapEntries",
        key: "games",
        map: (items: Game[]) =>
          items.map((g) =>
            g.id === gameId
              ? {
                  ...g,
                  status: "postponed",
                  teamScore: null,
                  opponentScore: null,
                }
              : g,
          ),
      });
    },
    [teamData.games, updateTeamArrays],
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

      // Pitching/catching arm-care logs are no longer committed here — they're
      // recorded from the imported box score (uploadGameStatsCsv). Finalize just
      // persists the score and the trimmed/restored lineup.
      updateGame(gameId, gameUpdates);

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
      teamData.primaryColor,
      teamData.secondaryColor,
      updateGame,
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
      // A deleted game must also leave any tournament that references it —
      // both its membership and its planned pitching outings — in the SAME
      // atomic write, so a mid-flight refresh can't observe a dangling link.
      const prevTournaments: Tournament[] = teamData.tournaments || [];
      const touchesTournaments = prevTournaments.some(
        (t) => t.gameIds?.includes(gameId) || t.pitchPlan?.[gameId],
      );
      const removeOp: TeamArrayUpdate = {
        op: "removeById",
        key: "games",
        id: gameId,
      };
      const ops: TeamArrayUpdate[] = [removeOp];
      if (touchesTournaments) {
        ops.push({
          op: "mapEntries",
          key: "tournaments",
          map: (items: Tournament[]) =>
            items.map((t) => {
              const hasGame = t.gameIds?.includes(gameId);
              const hasPlan = Boolean(t.pitchPlan?.[gameId]);
              if (!hasGame && !hasPlan) return t;
              const next: Tournament = {
                ...t,
                gameIds: (t.gameIds || []).filter((id) => id !== gameId),
              };
              if (hasPlan) {
                const { [gameId]: _drop, ...pitchPlan } = t.pitchPlan || {};
                if (Object.keys(pitchPlan).length) next.pitchPlan = pitchPlan;
                else delete next.pitchPlan;
              }
              return next;
            }),
        });
      }
      updateTeamArrays(touchesTournaments ? ops : removeOp);
      toast.push({
        kind: "success",
        title: "Game deleted",
        message: removed?.opponent
          ? `vs ${removed.opponent} — tap Undo to restore.`
          : "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          // Undo deliberately restores the captured snapshots wholesale —
          // reverting to the pre-delete state IS its semantics.
          onClick: () => {
            const restoreGames: TeamArrayUpdate = {
              op: "mapEntries",
              key: "games",
              map: () => prevGames as Game[],
            };
            updateTeamArrays(
              touchesTournaments
                ? [
                    restoreGames,
                    {
                      op: "mapEntries",
                      key: "tournaments",
                      map: () => prevTournaments,
                    },
                  ]
                : restoreGames,
            );
          },
        },
      } as any);
    },
    [teamData.games, teamData.tournaments, updateTeamArrays, toast, confirm],
  );

  return { addGame, updateGame, postponeGame, finalizeGame, deleteSavedGame };
};
