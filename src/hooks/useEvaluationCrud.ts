import { useCallback } from "react";
import type { Firestore } from "firebase/firestore";
import { evalRoundDateForSave, dateToIsoLocal, genId } from "../utils/helpers";
import { EVAL_ROUNDS_DUAL_WRITE } from "../constants/flags";
import { mirrorEvalRound, removeEvalRoundDoc } from "../utils/evalRounds";
import type { EvaluationEvent, ToastContextValue } from "../types";
import type { TeamArrayUpdate } from "../utils/teamArrayUpdates";

// Pull a display-able last name from a Firebase auth user. Eval rounds
// are tagged with this at save time so the head's "Mike · 2026-05-23"
// label survives across devices and stale auth profiles. Falls back to
// the email local-part, then to "Coach", before ever leaving the field
// blank.
const lastNameOfUser = (u: any) => {
  const dn = (u?.displayName || "").trim();
  if (dn) {
    const parts = dn.split(/\s+/).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  const email = (u?.email || "").trim();
  const local = email.split("@")[0];
  if (local) return local;
  return "Coach";
};

// Evaluation round CRUD extracted from App.tsx's TeamProvider. saveTeamEvaluation
// reads the in-progress grades from the UI via the shared uiBridge ref (passed
// in), so this hook takes that ref alongside the usual persistence deps.
interface UseEvaluationCrudArgs {
  teamData: any;
  updateTeamArrays: (input: TeamArrayUpdate | TeamArrayUpdate[]) => void;
  toast: ToastContextValue;
  user:
    | { uid: string; displayName?: string | null; email?: string | null }
    | null
    | undefined;
  uiBridge: { current: any };
  // Subcollection dual-write handles (step 3 of the finding-3.1 fix). Optional
  // so non-provider callers (tests) can omit them; dual-write is additionally
  // gated behind EVAL_ROUNDS_DUAL_WRITE, so it's a no-op unless both the flag is
  // on AND these are supplied.
  db?: Firestore;
  appId?: string;
  teamId?: string | null;
}

export const useEvaluationCrud = ({
  teamData,
  updateTeamArrays,
  toast,
  user,
  uiBridge,
  db,
  appId,
  teamId,
}: UseEvaluationCrudArgs) => {
  // Best-effort mirror of a single round / a delete into the evalRounds
  // subcollection, alongside the authoritative array write. Inert unless the
  // dual-write flag is on and the Firestore handles are present.
  const mirror = useCallback(
    (round: EvaluationEvent) => {
      if (EVAL_ROUNDS_DUAL_WRITE && db && appId && teamId) {
        void mirrorEvalRound(db, appId, teamId, round);
      }
    },
    [db, appId, teamId],
  );
  const unmirror = useCallback(
    (roundId: string) => {
      if (EVAL_ROUNDS_DUAL_WRITE && db && appId && teamId) {
        void removeEvalRoundDoc(db, appId, teamId, roundId);
      }
    },
    [db, appId, teamId],
  );
  const saveTeamEvaluation = useCallback(() => {
    const inputs = uiBridge.current.getInputs?.();
    const grades = inputs?.teamEvalGrades || {};
    const selectedRoundId = inputs?.selectedRoundId || null;
    if (!user) return;

    if (selectedRoundId) {
      // Editing an existing round — update its grades, keep its
      // label/date/id/evaluatorName intact.
      updateTeamArrays({
        op: "mapEntries",
        key: "evaluationEvents",
        map: (items: EvaluationEvent[]) =>
          items.map((e) => (e.id === selectedRoundId ? { ...e, grades } : e)),
      });
      const edited = (teamData.evaluationEvents || []).find(
        (e: EvaluationEvent) => e.id === selectedRoundId,
      );
      if (edited) mirror({ ...edited, grades });
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
    const evaluatorName = lastNameOfUser(user);
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
    // append → arrayUnion: a simultaneous save by another coach lands too,
    // instead of whichever write finished last erasing the other.
    updateTeamArrays({
      op: "append",
      key: "evaluationEvents",
      entries: [newEvent],
    });
    mirror(newEvent);
    toast.push({
      kind: "success",
      title: "Eval saved",
      message: `${evaluatorName} · ${roundDate}`,
    });
    // Return the created id so callers can lock onto this round for edits.
    return newEvent.id;
  }, [
    user,
    teamData.evaluationEvents,
    updateTeamArrays,
    toast,
    uiBridge,
    mirror,
  ]);

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
        updateTeamArrays({
          op: "mapEntries",
          key: "evaluationEvents",
          map: (items: EvaluationEvent[]) =>
            items.map((e) => (e.id === existing.id ? { ...e, grades } : e)),
        });
        mirror({ ...existing, grades });
      } else {
        const newEvent: EvaluationEvent = {
          id: genId("ev"),
          date: roundDate,
          createdAt: Date.now(),
          coachRole: "Assistant",
          evaluatorId: user.uid,
          evaluatorName: lastNameOfUser(user),
          grades,
        };
        // append → arrayUnion: N assistants submitting during a live eval
        // session all land. The old whole-array write silently dropped every
        // submission but the last one to finish.
        updateTeamArrays({
          op: "append",
          key: "evaluationEvents",
          entries: [newEvent],
        });
        mirror(newEvent);
      }
      toast.push({
        kind: "success",
        title: "Submitted to head coach",
      });
    },
    [user, teamData.evaluationEvents, updateTeamArrays, toast, mirror],
  );

  // Drop an evaluation round (any role). HC-callable so the head coach
  // can clean up rounds entered in error — their own, or any assistant's
  // submission. Splices from team.evaluationEvents by id.
  const deleteEvaluation = useCallback(
    (roundId: any) => {
      if (!roundId) return;
      updateTeamArrays({
        op: "removeById",
        key: "evaluationEvents",
        id: roundId,
      });
      unmirror(roundId);
      toast.push({
        kind: "success",
        title: "Eval round deleted",
      });
    },
    [updateTeamArrays, toast, unmirror],
  );

  return {
    saveTeamEvaluation,
    saveAssistantEvaluation,
    deleteEvaluation,
  };
};
