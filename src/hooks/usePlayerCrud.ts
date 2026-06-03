import { useCallback } from "react";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { appId, db } from "../firebase";
import { blankStats, slimGame } from "../utils/helpers";
import { reportError } from "../utils/errorReporter";
import type { ToastContextValue } from "../types";

// Roster/player CRUD extracted from App.tsx's TeamProvider. Pure persistence
// (add/update/remove a player) with no engine or UI-bridge coupling — reads
// teamData and writes through the injected updateTeam, mirroring useGameCrud.
interface UsePlayerCrudArgs {
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: ToastContextValue;
  activeTeamId: string | null | undefined;
}

export const usePlayerCrud = ({
  teamData,
  updateTeam,
  toast,
  activeTeamId,
}: UsePlayerCrudArgs) => {
  // Update an evaluationEvents subcollection doc's grades (used when a deleted
  // player's grades must be stripped from a round that lives in the
  // subcollection rather than the legacy root array).
  const writeSubEventGrades = useCallback(
    (eventId: string, grades: any) => {
      if (!activeTeamId) return;
      updateDoc(
        doc(db, "artifacts", appId, "public", "data", "teams", activeTeamId, "evaluationEvents", eventId),
        { grades }
      ).catch((err) => reportError(err, { source: "usePlayerCrud.writeSubEventGrades" }));
    },
    [activeTeamId]
  );
  // Overwrite a games-subcollection doc (used when stripping a deleted player
  // out of a game that lives in the subcollection rather than the root array).
  const writeSubGame = useCallback(
    (game: any) => {
      if (!activeTeamId) return;
      const { _sub, ...clean } = game;
      setDoc(
        doc(db, "artifacts", appId, "public", "data", "teams", activeTeamId, "games", clean.id),
        slimGame(clean) as any
      ).catch((err) => reportError(err, { source: "usePlayerCrud.writeSubGame" }));
    },
    [activeTeamId]
  );
  const addPlayer = useCallback(
    (form: any) => {
      const id =
        form.id || "p-" + Math.random().toString(36).substring(2, 10);
      const newPlayer = {
        id,
        name: form.name.trim(),
        number: form.number || "",
        bats: form.bats || "R",
        throws: form.throws || "R",
        photoUrl: form.photoUrl || "",
        present: true,
        restrictions: [],
        // Catcher is just "C" in this list — a new player isn't a catcher
        // until the coach adds C to their comfortable positions.
        comfortablePositions: Array.isArray(form.comfortablePositions)
          ? form.comfortablePositions
          : [],
        stats: blankStats(),
        pitching: { recentPitches: 0, lastPitchDate: null },
      };
      updateTeam({ players: [...teamData.players, newPlayer] });
      return id;
    },
    [teamData.players, updateTeam]
  );

  const updatePlayer = useCallback(
    (id: any, updates: any) => {
      const next = teamData.players.map((p: any) =>
        p.id === id ? { ...p, ...updates } : p
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const updatePlayerNested = useCallback(
    (id: any, key: any, updates: any) => {
      const next = teamData.players.map((p: any) =>
        p.id === id ? { ...p, [key]: { ...(p[key] || {}), ...updates } } : p
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const removePlayer = useCallback(
    (id: any) => {
      if (!window.confirm("Remove this player from the roster?")) return;

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
              (p: any) => p && p.id !== id
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
        if (Array.isArray(g.lineup)) next.lineup = g.lineup.map(stripFromInning);
        if (Array.isArray(g.originalLineup))
          next.originalLineup = g.originalLineup.map(stripFromInning);
        if (Array.isArray(g.battingLineup))
          next.battingLineup = g.battingLineup.filter(
            (p: any) => p && p.id !== id
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

      // Evaluations and games may each be split across a legacy root array and a
      // subcollection. Strip the deleted player from both: the legacy slices
      // ride along in the single updateTeam below; each affected subcollection
      // doc is rewritten on its own (and captured so Undo can restore it).
      const legacyEvents = prevEvents.filter((e: any) => !e?._sub);
      const subEvents = prevEvents.filter((e: any) => e?._sub);
      const affectedSubEvents = subEvents.filter(
        (e: any) => e?.grades && id in e.grades
      );

      const legacyGames = prevGames.filter((g: any) => !g?._sub);
      const subGames = prevGames.filter((g: any) => g?._sub);
      const affectedSubGames: Array<{ before: any; after: any }> = [];
      for (const g of subGames) {
        const { _sub, ...clean } = g;
        const after = stripFromGame(clean);
        if (JSON.stringify(after) !== JSON.stringify(clean)) {
          affectedSubGames.push({ before: clean, after });
        }
      }

      for (const ev of affectedSubEvents) {
        writeSubEventGrades(ev.id, stripFromEvent(ev).grades);
      }
      for (const g of affectedSubGames) writeSubGame(g.after);

      updateTeam({
        players: prevPlayers.filter((p: any) => p.id !== id),
        games: legacyGames.map(stripFromGame),
        evaluationEvents: legacyEvents.map(stripFromEvent),
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
          onClick: () => {
            for (const ev of affectedSubEvents) {
              writeSubEventGrades(ev.id, ev.grades);
            }
            for (const g of affectedSubGames) writeSubGame(g.before);
            updateTeam({
              players: prevPlayers,
              games: legacyGames,
              evaluationEvents: legacyEvents,
            });
          },
        },
      } as any);
    },
    [
      teamData.players,
      teamData.games,
      teamData.evaluationEvents,
      writeSubEventGrades,
      writeSubGame,
      updateTeam,
      toast,
    ]
  );

  return { addPlayer, updatePlayer, updatePlayerNested, removePlayer };
};
