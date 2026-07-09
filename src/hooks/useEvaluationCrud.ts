import { useCallback } from "react";
import type { Firestore } from "firebase/firestore";
import {
  evalRoundDateForSave,
  dateToIsoLocal,
  genId,
  coachLastNameOf,
} from "../utils/helpers";
import { saveEvalRound, deleteEvalRound } from "../utils/evalRounds";
import type { EvaluationEvent, ToastContextValue } from "../types";

// Evaluation round CRUD extracted from App.tsx's TeamProvider. saveTeamEvaluation
// reads the in-progress grades from the UI via the shared uiBridge ref (passed
// in), so this hook takes that ref alongside the usual persistence deps.
//
// Rounds live per-author in the `teams/{teamId}/evalRounds` subcollection (the
// finding-3.1 fix; see docs/eval-authz-design.md) — every save/delete goes
// per-doc through the error-propagating saveEvalRound/deleteEvalRound, and the
// role-scoped subscription in TeamProvider owns teamData.evaluationEvents.
interface UseEvaluationCrudArgs {
  teamData: any;
  toast: ToastContextValue;
  user:
    | { uid: string; displayName?: string | null; email?: string | null }
    | null
    | undefined;
  uiBridge: { current: any };
  // Subcollection write handles. Optional so non-provider callers (tests) can
  // omit them; without all three, saves/deletes are no-ops.
  db?: Firestore;
  appId?: string;
  teamId?: string | null;
}

export const useEvaluationCrud = ({
  teamData,
  toast,
  user,
  uiBridge,
  db,
  appId,
  teamId,
}: UseEvaluationCrudArgs) => {
  // Persist a saved/edited round per-doc. REJECTS on failure so we can tell
  // the coach instead of silently dropping their grades.
  const saveRound = useCallback(
    (round: EvaluationEvent) => {
      if (!db || !appId || !teamId) return;
      saveEvalRound(db, appId, teamId, round).catch(() => {
        toast.push({
          kind: "error",
          title: "Couldn't save that eval",
          message: "Check your connection and try again.",
        });
      });
    },
    [db, appId, teamId, toast],
  );
  const deleteRound = useCallback(
    (roundId: string) => {
      if (!db || !appId || !teamId) return;
      deleteEvalRound(db, appId, teamId, roundId).catch(() => {
        toast.push({
          kind: "error",
          title: "Couldn't delete that eval",
          message: "Check your connection and try again.",
        });
      });
    },
    [db, appId, teamId, toast],
  );
  const saveTeamEvaluation = useCallback(() => {
    const inputs = uiBridge.current.getInputs?.();
    const grades = inputs?.teamEvalGrades || {};
    const selectedRoundId = inputs?.selectedRoundId || null;
    if (!user) return;

    if (selectedRoundId) {
      // Editing an existing round — update its grades, keep its
      // label/date/id/evaluatorName intact.
      const edited = (teamData.evaluationEvents || []).find(
        (e: EvaluationEvent) => e.id === selectedRoundId,
      );
      if (edited) saveRound({ ...edited, grades });
      toast.push({ kind: "success", title: "Eval updated" });
      return selectedRoundId;
    }

    // Creating a new round. Stamp it with the calendar due date it satisfies
    // (not the literal day) so rounds line up with the cadence schedule, and
    // denormalize the coach's last name so reads across devices don't need an
    // auth roundtrip.
    // COLLISION GUARD: if this coach already has a round on that due date
    // (a second save inside the same cadence window), stamp the new round with
    // today's literal date instead. Without this, the two rounds carried
    // identical dates — identical dropdown labels and tied "latest round"
    // sorts that resolved to the OLDER round, which read as the newer
    // evaluation having gone missing.
    const snapped = evalRoundDateForSave();
    const today = dateToIsoLocal(new Date());
    const dateTaken = (d: string) =>
      (teamData.evaluationEvents || []).some(
        (e: any) =>
          e.coachRole === "Head" && e.evaluatorId === user.uid && e.date === d,
      );
    const roundDate = dateTaken(snapped) ? today : snapped;
    const evaluatorName = coachLastNameOf(user);
    const newEvent: EvaluationEvent = {
      id: genId("ev"),
      date: roundDate,
      // Wall-clock creation stamp — the unambiguous tiebreaker for "latest
      // round" sorts when two rounds share a date (same-day saves).
      createdAt: Date.now(),
      coachRole: "Head",
      evaluatorId: user.uid,
      evaluatorName,
      grades,
    };
    // Per-doc subcollection writes are inherently concurrency-safe — a
    // simultaneous save by another coach lands in its own doc.
    saveRound(newEvent);
    toast.push({
      kind: "success",
      title: "Eval saved",
      message: `${evaluatorName} · ${roundDate}`,
    });
    // Return the created id so callers can lock onto this round for edits.
    return newEvent.id;
  }, [user, teamData.evaluationEvents, toast, uiBridge, saveRound]);

  // Build an Assistant eval round and persist it. Mirrors saveTeamEvaluation's
  // upsert behavior — the round is stamped with the calendar due date it
  // satisfies, and the upsert key uses that same date so a second submission
  // inside the same window updates the round in place instead of duplicating.
  const saveAssistantEvaluation = useCallback(
    (grades: any) => {
      if (!user) return;
      const roundDate = evalRoundDateForSave();
      const existing = (teamData.evaluationEvents || []).find(
        (e: any) =>
          e.coachRole === "Assistant" &&
          e.evaluatorId === user.uid &&
          e.date === roundDate,
      );
      if (existing) {
        saveRound({ ...existing, grades });
      } else {
        const newEvent: EvaluationEvent = {
          id: genId("ev"),
          date: roundDate,
          createdAt: Date.now(),
          coachRole: "Assistant",
          evaluatorId: user.uid,
          evaluatorName: coachLastNameOf(user),
          grades,
        };
        // N assistants submitting during a live eval session all land — each
        // round is its own doc, so nobody's submission can clobber another's.
        saveRound(newEvent);
      }
      toast.push({
        kind: "success",
        title: "Submitted to head coach",
      });
    },
    [user, teamData.evaluationEvents, toast, saveRound],
  );

  // Drop an evaluation round (any role). HC-callable so the head coach
  // can clean up rounds entered in error — their own, or any assistant's
  // submission. Deletes the round's own doc by id.
  const deleteEvaluation = useCallback(
    (roundId: any) => {
      if (!roundId) return;
      deleteRound(roundId);
      toast.push({
        kind: "success",
        title: "Eval round deleted",
      });
    },
    [toast, deleteRound],
  );

  return {
    saveTeamEvaluation,
    saveAssistantEvaluation,
    deleteEvaluation,
  };
};
