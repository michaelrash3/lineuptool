import { useCallback } from "react";
import { deleteDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { appId, db } from "../firebase";
import { evalRoundDateForSave, scrubUndefined } from "../utils/helpers";
import { reportError } from "../utils/errorReporter";
import type { ToastContextValue } from "../types";

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
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: ToastContextValue;
  user: { uid: string; displayName?: string; email?: string } | null | undefined;
  uiBridge: { current: any };
  activeTeamId: string | null | undefined;
}

export const useEvaluationCrud = ({
  teamData,
  updateTeam,
  toast,
  user,
  uiBridge,
  activeTeamId,
}: UseEvaluationCrudArgs) => {
  // Phase 2 migration: evaluation rounds live in the evaluationEvents
  // subcollection (tagged `_sub` when merged in). New rounds are written there;
  // edits/deletes of an existing round route to its source — its own doc, or the
  // legacy root array (rebuilt from non-`_sub` entries so subcollection rounds
  // are never folded back onto the team doc).
  const evalDoc = useCallback(
    (id: string) =>
      doc(db, "artifacts", appId, "public", "data", "teams", activeTeamId!, "evaluationEvents", id),
    [activeTeamId]
  );
  const legacyEvents = useCallback(
    () => (teamData.evaluationEvents || []).filter((e: any) => !e?._sub),
    [teamData.evaluationEvents]
  );
  const createEvent = useCallback(
    (event: any) => {
      setDoc(evalDoc(event.id), scrubUndefined(event) as any).catch((err) => {
        reportError(err, { source: "useEvaluationCrud.createEvent" });
        toast.push({ kind: "error", title: "Eval save failed", message: "Check your connection and try again." });
      });
    },
    [evalDoc, toast]
  );
  const patchEvent = useCallback(
    (entry: any, patch: Record<string, unknown>) => {
      if (entry._sub) {
        updateDoc(evalDoc(entry.id), patch as any).catch((err) => {
          reportError(err, { source: "useEvaluationCrud.patchEvent" });
          toast.push({ kind: "error", title: "Eval save failed", message: "Check your connection and try again." });
        });
        return;
      }
      const next = legacyEvents().map((e: any) =>
        e.id === entry.id ? { ...e, ...patch } : e
      );
      updateTeam({ evaluationEvents: next });
    },
    [evalDoc, legacyEvents, updateTeam, toast]
  );
  const saveTeamEvaluation = useCallback(() => {
    const inputs = uiBridge.current.getInputs?.();
    const grades = inputs?.teamEvalGrades || {};
    const selectedRoundId = inputs?.selectedRoundId || null;
    if (!user) return;

    if (selectedRoundId) {
      // Editing an existing round — update its grades, keep its
      // label/date/id/evaluatorName intact.
      const existing = (teamData.evaluationEvents || []).find(
        (e: any) => e.id === selectedRoundId
      );
      if (existing) patchEvent(existing, { grades });
      toast.push({ kind: "success", title: "Eval updated" });
      return selectedRoundId;
    }

    // Creating a new round. Stamp it with the calendar due date it satisfies
    // (not the literal day) so rounds line up with the cadence schedule, and
    // denormalize the coach's last name so reads across devices don't need an
    // auth roundtrip.
    const roundDate = evalRoundDateForSave();
    const evaluatorName = lastNameOfUser(user);
    const newEvent = {
      id: "ev-" + Math.random().toString(36).substring(2, 10),
      date: roundDate,
      coachRole: "Head",
      evaluatorId: user.uid,
      evaluatorName,
      grades,
    };
    createEvent(newEvent);
    toast.push({
      kind: "success",
      title: "Eval saved",
      message: `${evaluatorName} · ${roundDate}`,
    });
    // Return the created id so callers can lock onto this round for edits.
    return newEvent.id;
  }, [user, teamData.evaluationEvents, createEvent, patchEvent, toast, uiBridge]);

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
          e.date === roundDate
      );
      if (existing) {
        patchEvent(existing, { grades });
      } else {
        createEvent({
          id: "ev-" + Math.random().toString(36).substring(2, 10),
          date: roundDate,
          coachRole: "Assistant",
          evaluatorId: user.uid,
          evaluatorName: lastNameOfUser(user),
          grades,
        });
      }
      toast.push({
        kind: "success",
        title: "Submitted to head coach",
      });
    },
    [user, teamData.evaluationEvents, createEvent, patchEvent, toast]
  );

  // Drop an evaluation round (any role). HC-callable so the head coach
  // can clean up rounds entered in error — their own, or any assistant's
  // submission. Splices from team.evaluationEvents by id.
  const deleteEvaluation = useCallback(
    (roundId: any) => {
      if (!roundId) return;
      const entry = (teamData.evaluationEvents || []).find(
        (e: any) => e.id === roundId
      );
      if (!entry) return;
      if (entry._sub) {
        deleteDoc(evalDoc(roundId)).catch((err) => {
          reportError(err, { source: "useEvaluationCrud.deleteEvaluation" });
          toast.push({ kind: "error", title: "Delete failed", message: "Check your connection and try again." });
        });
      } else {
        updateTeam({ evaluationEvents: legacyEvents().filter((e: any) => e.id !== roundId) });
      }
      toast.push({
        kind: "success",
        title: "Eval round deleted",
      });
    },
    [teamData.evaluationEvents, evalDoc, legacyEvents, updateTeam, toast]
  );

  return {
    saveTeamEvaluation,
    saveAssistantEvaluation,
    deleteEvaluation,
  };
};
