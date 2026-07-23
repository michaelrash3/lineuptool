import { useCallback } from "react";
import type { Firestore } from "firebase/firestore";
import { blankStats, genId } from "../utils/helpers";
import { saveEvalRound } from "../utils/evalRounds";
import type {
  ConfirmContextValue,
  EvaluationEvent,
  Game,
  Player,
  ToastContextValue,
  Tournament,
} from "../types";
import type { TeamArrayUpdate } from "../utils/teamArrayUpdates";

// Roster/player CRUD extracted from App.tsx's TeamProvider. Pure persistence
// (add/update/remove a player) with no engine or UI-bridge coupling — writes
// through the injected updateTeamArrays (narrow per-op Firestore writes so
// concurrent edits by two coaches can't clobber each other), mirroring
// useGameCrud.
interface UsePlayerCrudArgs {
  // Ref to the freshest team (see TeamProvider.teamDataRef): callbacks
  // read it at call time so their identities survive Firestore snapshots.
  teamDataRef: React.MutableRefObject<any>;
  updateTeamArrays: (input: TeamArrayUpdate | TeamArrayUpdate[]) => void;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
  // Subcollection handles for the removePlayer eval-grade strip — eval rounds
  // live per-author in evalRounds (finding-3.1). Optional so non-provider
  // callers (tests) can omit them; without them the grade strip is skipped.
  db?: Firestore;
  appId?: string;
  teamId?: string | null;
}

export const usePlayerCrud = ({
  teamDataRef,
  updateTeamArrays,
  toast,
  confirm,
  db,
  appId,
  teamId,
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
      updateTeamArrays({ op: "append", key: "players", entries: [newPlayer] });
      return id;
    },
    [updateTeamArrays],
  );

  const updatePlayer = useCallback(
    (id: any, updates: any) => {
      updateTeamArrays({
        op: "mapEntries",
        key: "players",
        map: (items: Player[]) =>
          items.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      });
    },
    [updateTeamArrays],
  );

  const updatePlayerNested = useCallback(
    (id: any, key: any, updates: any) => {
      updateTeamArrays({
        op: "mapEntries",
        key: "players",
        map: (items: Player[]) =>
          items.map((p) =>
            p.id === id
              ? { ...p, [key]: { ...((p as any)[key] || {}), ...updates } }
              : p,
          ),
      });
    },
    [updateTeamArrays],
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
      const prevPlayers = teamDataRef.current.players;
      const prevGames = teamDataRef.current.games || [];
      const prevEvents = teamDataRef.current.evaluationEvents || [];
      const prevTournaments: Tournament[] =
        teamDataRef.current.tournaments || [];
      const removedPlayer = prevPlayers.find((p: any) => p.id === id);
      // Tournament pitch plans reference players by id — a removed player
      // must leave every plan too, or the entry lingers invisibly (the plan
      // panel filters unknown ids rather than rendering them).
      const touchesTournaments = prevTournaments.some((t) =>
        Object.values(t.pitchPlan || {}).some((entries) =>
          (entries || []).some((e) => e.playerId === id),
        ),
      );
      const stripFromTournament = (t: Tournament): Tournament => {
        if (!t.pitchPlan) return t;
        const pitchPlan: NonNullable<Tournament["pitchPlan"]> = {};
        let changed = false;
        for (const [gameId, entries] of Object.entries(t.pitchPlan)) {
          const kept = (entries || []).filter((e) => e.playerId !== id);
          if (kept.length !== (entries || []).length) changed = true;
          if (kept.length > 0) pitchPlan[gameId] = kept;
        }
        if (!changed) return t;
        if (Object.keys(pitchPlan).length === 0) {
          const { pitchPlan: _drop, ...rest } = t;
          return rest;
        }
        return { ...t, pitchPlan };
      };

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

      // One op list → one merged updateDoc, so the roster row and every
      // reference to it disappear atomically. Eval grades live per-doc in the
      // evalRounds subcollection — never in this shared-doc write (writing
      // teamDataRef.current.evaluationEvents back would resurrect scoped rounds onto the
      // team doc and recreate the dropped legacy field, which the rules now
      // reject).
      updateTeamArrays([
        { op: "removeById", key: "players", id },
        {
          op: "mapEntries",
          key: "games",
          map: (items: Game[]) => items.map(stripFromGame),
        },
        ...(touchesTournaments
          ? [
              {
                op: "mapEntries",
                key: "tournaments",
                map: (items: Tournament[]) => items.map(stripFromTournament),
              } as const,
            ]
          : []),
      ]);
      if (db && appId && teamId) {
        // Per-doc grade strip, best-effort hygiene: the rules let the head
        // update any round but an assistant only their own, so a failure here
        // (assistant removing a player graded by someone else) is swallowed —
        // the orphaned grades are keyed by a now-unused player id and never
        // surface anywhere.
        for (const ev of prevEvents as EvaluationEvent[]) {
          const stripped = stripFromEvent(ev);
          if (stripped !== ev) {
            void saveEvalRound(db, appId, teamId, stripped).catch(() => {});
          }
        }
      }

      toast.push({
        kind: "success",
        title: "Player removed",
        message: removedPlayer
          ? `${removedPlayer.name} removed. Tap Undo to restore.`
          : "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          // Undo deliberately restores the captured snapshots wholesale —
          // reverting to the pre-delete state IS its semantics, so the
          // residual last-write-wins here is the intended outcome.
          onClick: () => {
            updateTeamArrays([
              {
                op: "mapEntries",
                key: "players",
                map: () => prevPlayers as Player[],
              },
              {
                op: "mapEntries",
                key: "games",
                map: () => prevGames as Game[],
              },
              ...(touchesTournaments
                ? [
                    {
                      op: "mapEntries",
                      key: "tournaments",
                      map: () => prevTournaments,
                    } as const,
                  ]
                : []),
            ]);
            if (db && appId && teamId) {
              // Restore the pre-delete grades per-doc (same permission scope
              // as the strip above — best-effort for non-authored rounds).
              for (const ev of prevEvents as EvaluationEvent[]) {
                if (ev?.grades && id in ev.grades) {
                  void saveEvalRound(db, appId, teamId, ev).catch(() => {});
                }
              }
            }
          },
        },
      } as any);
    },
    [teamDataRef, updateTeamArrays, toast, confirm, db, appId, teamId],
  );

  return { addPlayer, updatePlayer, updatePlayerNested, removePlayer };
};
