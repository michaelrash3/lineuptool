import { useCallback } from "react";
import { blankStats, genId } from "../utils/helpers";
import type { ConfirmContextValue, ToastContextValue } from "../types";

// Roster/player CRUD extracted from App.tsx's TeamProvider. Pure persistence
// (add/update/remove a player) with no engine or UI-bridge coupling — reads
// teamData and writes through the injected updateTeam, mirroring useGameCrud.
interface UsePlayerCrudArgs {
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
}

export const usePlayerCrud = ({
  teamData,
  updateTeam,
  toast,
  confirm,
}: UsePlayerCrudArgs) => {
  const addPlayer = useCallback(
    (form: any) => {
      const id = form.id || genId("p");
      const newPlayer = {
        id,
        name: form.name.trim(),
        number: form.number || "",
        bats: form.bats || "R",
        throws: form.throws || "R",
        present: true,
        restrictions: [],
        // Catcher is just "C" in this list — a new player isn't a catcher
        // until the coach adds C to their comfortable positions.
        comfortablePositions: Array.isArray(form.comfortablePositions)
          ? form.comfortablePositions
          : [],
        stats: blankStats(),
        pitching: { recentPitches: 0, lastPitchDate: null },
        // Scheduled-absence dates (ISO yyyy-mm-dd), managed on the profile.
        absences: [],
      };
      updateTeam({ players: [...teamData.players, newPlayer] });
      return id;
    },
    [teamData.players, updateTeam],
  );

  const updatePlayer = useCallback(
    (id: any, updates: any) => {
      const next = teamData.players.map((p: any) =>
        p.id === id ? { ...p, ...updates } : p,
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam],
  );

  const updatePlayerNested = useCallback(
    (id: any, key: any, updates: any) => {
      const next = teamData.players.map((p: any) =>
        p.id === id ? { ...p, [key]: { ...(p[key] || {}), ...updates } } : p,
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam],
  );

  const removePlayer = useCallback(
    async (id: any) => {
      const ok = await confirm({
        title: "Remove player?",
        message:
          "Removes them from the roster, lineups, attendance, and eval grades. You can undo right after.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;

      // Snapshot the pre-delete shapes for Undo. A mistap here cascades
      // through games / batting orders / attendance / pitch counts / eval
      // grades — a partial restore (just the roster row) would still leave
      // the player absent from the rest, so Undo has to revert all of them.
      const prevPlayers = teamData.players;
      const prevGames = teamData.games || [];
      const prevEvents = teamData.evaluationEvents || [];
      const removedPlayer = prevPlayers.find((p: any) => p.id === id);

      // Strip the player out of every shape that holds player references.
      const stripFromInning = (inning: any) => {
        if (!inning || typeof inning !== "object") return inning;
        const out: Record<string, any> = {};
        for (const pos in inning) {
          if (pos === "BENCH") {
            out.BENCH = (inning.BENCH || []).filter(
              (p: any) => p && p.id !== id,
            );
          } else {
            const slot = inning[pos];
            out[pos] = slot && slot.id === id ? null : slot;
          }
        }
        return out;
      };

      const stripFromGame = (g: any) => {
        const next = { ...g };
        if (Array.isArray(g.lineup))
          next.lineup = g.lineup.map(stripFromInning);
        if (Array.isArray(g.originalLineup))
          next.originalLineup = g.originalLineup.map(stripFromInning);
        if (Array.isArray(g.battingLineup))
          next.battingLineup = g.battingLineup.filter(
            (p: any) => p && p.id !== id,
          );
        if (g.attendance && id in g.attendance) {
          const { [id]: _dropAtt, ...rest } = g.attendance;
          next.attendance = rest;
        }
        if (g.pitchCounts && id in g.pitchCounts) {
          const { [id]: _dropPc, ...rest } = g.pitchCounts;
          next.pitchCounts = rest;
        }
        return next;
      };

      const stripFromEvent = (ev: any) => {
        if (!ev?.grades || !(id in ev.grades)) return ev;
        const { [id]: _dropG, ...rest } = ev.grades;
        return { ...ev, grades: rest };
      };

      updateTeam({
        players: prevPlayers.filter((p: any) => p.id !== id),
        games: prevGames.map(stripFromGame),
        evaluationEvents: prevEvents.map(stripFromEvent),
      });

      toast.push({
        kind: "success",
        title: "Player removed",
        message: removedPlayer
          ? `${removedPlayer.name} removed. Tap Undo to restore.`
          : "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () =>
            updateTeam({
              players: prevPlayers,
              games: prevGames,
              evaluationEvents: prevEvents,
            }),
        },
      } as any);
    },
    [
      teamData.players,
      teamData.games,
      teamData.evaluationEvents,
      updateTeam,
      toast,
      confirm,
    ],
  );

  return { addPlayer, updatePlayer, updatePlayerNested, removePlayer };
};
