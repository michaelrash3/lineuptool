import { useCallback } from "react";
import type { Firestore } from "firebase/firestore";
import { evalRoundDateForSave, dateToIsoLocal, genId } from "../utils/helpers";
import {
  EVAL_ROUNDS_DUAL_WRITE,
  EVAL_ROUNDS_SUBCOLLECTION,
} from "../constants/flags";
import {
  mirrorEvalRound,
  removeEvalRoundDoc,
  saveEvalRound,
  deleteEvalRound,
} from "../utils/evalRounds";
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
  // Has the store cut over to the subcollection as the PRIMARY, authoritative
  // home for eval rounds (finding-3.1 phase 3)? When true, writes go per-doc
  // and errors are surfaced; the legacy array is no longer written (callers
  // gate their updateTeamArrays on !subPrimary). When false we're still on the
  // array (with a best-effort subcollection mirror during the dual-write soak).
  const subPrimary = Boolean(
    EVAL_ROUNDS_SUBCOLLECTION && db && appId && teamId,
  );

  // Persist a saved/edited round. Subcollection-primary path REJECTS on failure
  // so we can tell the coach instead of silently dropping their grades; the
  // legacy path keeps the best-effort mirror alongside the (authoritative)
  // array write the caller performs.
  const saveRound = useCallback(
    (round: EvaluationEvent) => {
      if (!db || !appId || !teamId) return;
      if (subPrimary) {
        saveEvalRound(db, appId, teamId, round).catch(() => {
          toast.push({
            kind: "error",
            title: "Couldn't save that eval",
            message: "Check your connection and try again.",
          });
        });
      } else if (EVAL_ROUNDS_DUAL_WRITE) {
        void mirrorEvalRound(db, appId, teamId, round);
      }
    },
    [subPrimary, db, appId, teamId, toast],
  );
  const deleteRound = useCallback(
    (roundId: string) => {
      if (!db || !appId || !teamId) return;
      if (subPrimary) {
        deleteEvalRound(db, appId, teamId, roundId).catch(() => {
          toast.push({
            kind: "error",
            title: "Couldn't delete that eval",
            message: "Check your connection and try again.",
          });
        });
      } else if (EVAL_ROUNDS_DUAL_WRITE) {
        void removeEvalRoundDoc(db, appId, teamId, roundId);
      }
    },
    [subPrimary, db, appId, teamId, toast],
  );
  const saveTeamEvaluation = useCallback(() => {
    const inputs = uiBridge.current.getInputs?.();
    const grades = inputs?.teamEvalGrades || {};
    const selectedRoundId = inputs?.selectedRoundId || null;
    if (!user) return;

    if (selectedRoundId) {
      // Editing an existing round — update its grades, keep its
      // label/date/id/evaluatorName intact.
      if (!subPrimary) {
        updateTeamArrays({
          op: "mapEntries",
          key: "evaluationEvents",
          map: (items: EvaluationEvent[]) =>
            items.map((e) => (e.id === selectedRoundId ? { ...e, grades } : e)),
        });
      }
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
    // instead of whichever write finished last erasing the other. (Per-doc
    // subcollection writes are inherently concurrency-safe, so no arrayUnion
    // equivalent is needed once subPrimary.)
    if (!subPrimary) {
      updateTeamArrays({
        op: "append",
        key: "evaluationEvents",
        entries: [newEvent],
      });
    }
    saveRound(newEvent);
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
    subPrimary,
    saveRound,
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
        if (!subPrimary) {
          updateTeamArrays({
            op: "mapEntries",
            key: "evaluationEvents",
            map: (items: EvaluationEvent[]) =>
              items.map((e) => (e.id === existing.id ? { ...e, grades } : e)),
          });
        }
        saveRound({ ...existing, grades });
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
        if (!subPrimary) {
          updateTeamArrays({
            op: "append",
            key: "evaluationEvents",
            entries: [newEvent],
          });
        }
        saveRound(newEvent);
      }
      toast.push({
        kind: "success",
        title: "Submitted to head coach",
      });
    },
    [
      user,
      teamData.evaluationEvents,
      updateTeamArrays,
      toast,
      subPrimary,
      saveRound,
    ],
  );

  // Drop an evaluation round (any role). HC-callable so the head coach
  // can clean up rounds entered in error — their own, or any assistant's
  // submission. Splices from team.evaluationEvents by id.
  const deleteEvaluation = useCallback(
    (roundId: any) => {
      if (!roundId) return;
      if (!subPrimary) {
        updateTeamArrays({
          op: "removeById",
          key: "evaluationEvents",
          id: roundId,
        });
      }
      deleteRound(roundId);
      toast.push({
        kind: "success",
        title: "Eval round deleted",
      });
    },
    [updateTeamArrays, toast, subPrimary, deleteRound],
  );

  return {
    saveTeamEvaluation,
    saveAssistantEvaluation,
    deleteEvaluation,
  };
};
