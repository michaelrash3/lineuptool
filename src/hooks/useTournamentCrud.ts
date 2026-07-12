import { useCallback } from "react";
import { genId } from "../utils/helpers";
import type {
  ConfirmContextValue,
  PlannedOuting,
  ToastContextValue,
  Tournament,
} from "../types";
import type { TeamArrayUpdate } from "../utils/teamArrayUpdates";

// Tournament CRUD — pure persistence for the stored Tournament entities
// (weekend game groupings + cross-game pitching plans), following the
// useGameCrud slice pattern: every mutation goes through the injected
// updateTeamArrays so concurrent edits by two coaches stay confined to the
// tournaments array. The cross-game eligibility math lives in
// src/utils/tournamentPitching.ts, not here.

const NAME_MAX = 60;

interface UseTournamentCrudArgs {
  // teamData carries more fields at runtime than the strict Team interface
  // models; typed permissively to mirror the App.tsx provider.
  teamData: any;
  updateTeamArrays: (input: TeamArrayUpdate | TeamArrayUpdate[]) => void;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
}

export const useTournamentCrud = ({
  teamData,
  updateTeamArrays,
  toast,
  confirm,
}: UseTournamentCrudArgs) => {
  const addTournament = useCallback(
    (form: {
      name?: string;
      gameIds?: string[];
      seedKey?: string;
    }): string | null => {
      const name = String(form.name ?? "")
        .trim()
        .slice(0, NAME_MAX);
      const gameIds = (form.gameIds || []).filter(Boolean);
      if (!name || gameIds.length === 0) {
        toast.push({
          kind: "warn",
          title: "Missing info",
          message: "A tournament needs a name and at least one game.",
        });
        return null;
      }
      const entry: Tournament = {
        id: genId("trn"),
        name,
        gameIds,
        createdAt: new Date().toISOString(),
      };
      if (form.seedKey) entry.seedKey = form.seedKey;
      updateTeamArrays({
        op: "append",
        key: "tournaments",
        entries: [entry],
      });
      // The id lets the creation page navigate straight to the new
      // tournament's detail page.
      return entry.id;
    },
    [updateTeamArrays, toast],
  );

  const updateTournament = useCallback(
    (tournamentId: string, patch: Partial<Tournament>) => {
      let safe = { ...patch };
      if ("name" in safe) {
        const name = String(safe.name ?? "")
          .trim()
          .slice(0, NAME_MAX);
        // An emptied name field never persists — drop the key instead.
        if (!name) {
          const { name: _drop, ...rest } = safe;
          safe = rest;
        } else {
          safe = { ...safe, name };
        }
      }
      if (Object.keys(safe).length === 0) return;
      updateTeamArrays({
        op: "mapEntries",
        key: "tournaments",
        map: (items: Tournament[]) =>
          items.map((t) => (t.id === tournamentId ? { ...t, ...safe } : t)),
      });
    },
    [updateTeamArrays],
  );

  // Replace the planned outings for one game of one tournament. An empty list
  // removes the game's key entirely so an abandoned plan leaves no residue.
  const setPlannedOutings = useCallback(
    (tournamentId: string, gameId: string, outings: PlannedOuting[]) => {
      updateTeamArrays({
        op: "mapEntries",
        key: "tournaments",
        map: (items: Tournament[]) =>
          items.map((t) => {
            if (t.id !== tournamentId) return t;
            const pitchPlan = { ...(t.pitchPlan || {}) };
            if (outings.length === 0) delete pitchPlan[gameId];
            else pitchPlan[gameId] = outings;
            if (Object.keys(pitchPlan).length === 0) {
              const { pitchPlan: _drop, ...rest } = t;
              return rest;
            }
            return { ...t, pitchPlan };
          }),
      });
    },
    [updateTeamArrays],
  );

  // Resolves true only when the delete actually happened, so a page hosting
  // the tournament knows whether to navigate away.
  const removeTournament = useCallback(
    async (tournamentId: string): Promise<boolean> => {
      const ok = await confirm({
        title: "Delete this tournament?",
        message:
          "Its pitching plan goes with it — the games themselves stay on the schedule. You can undo right after.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return false;
      const prev: Tournament[] = teamData.tournaments || [];
      const removed = prev.find((t) => t.id === tournamentId);
      updateTeamArrays({
        op: "removeById",
        key: "tournaments",
        id: tournamentId,
      });
      toast.push({
        kind: "success",
        title: "Tournament deleted",
        message: removed?.name
          ? `${removed.name} — tap Undo to restore.`
          : "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          // Undo deliberately restores the captured snapshot wholesale —
          // reverting to the pre-delete state IS its semantics.
          onClick: () =>
            updateTeamArrays({
              op: "mapEntries",
              key: "tournaments",
              map: () => prev,
            }),
        },
      } as any);
      return true;
    },
    [teamData.tournaments, updateTeamArrays, toast, confirm],
  );

  return {
    addTournament,
    updateTournament,
    setPlannedOutings,
    removeTournament,
  };
};
