import { useCallback } from "react";
import { evalRoundDateForSave, dateToIsoLocal } from "../utils/helpers";
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
  user:
    | { uid: string; displayName?: string; email?: string }
    | null
    | undefined;
  uiBridge: { current: any };
}

export const useEvaluationCrud = ({
  teamData,
  updateTeam,
  toast,
  user,
  uiBridge,
}: UseEvaluationCrudArgs) => {
  const saveTeamEvaluation = useCallback(() => {
    const inputs = uiBridge.current.getInputs?.();
    const grades = inputs?.teamEvalGrades || {};
    const selectedRoundId = inputs?.selectedRoundId || null;
    if (!user) return;

    if (selectedRoundId) {
      // Editing an existing round — update its grades, keep its
      // label/date/id/evaluatorName intact.
      const next = teamData.evaluationEvents.map((e: any) =>
        e.id === selectedRoundId ? { ...e, grades } : e,
      );
      updateTeam({ evaluationEvents: next });
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
    const newEvent = {
      id: "ev-" + Math.random().toString(36).substring(2, 10),
      date: roundDate,
      // Wall-clock creation stamp — the unambiguous tiebreaker for "latest
      // round" sorts when two rounds share a date (same-day saves).
      createdAt: Date.now(),
      coachRole: "Head",
      evaluatorId: user.uid,
      evaluatorName,
      grades,
    };
    updateTeam({
      evaluationEvents: [...teamData.evaluationEvents, newEvent],
    });
    toast.push({
      kind: "success",
      title: "Eval saved",
      message: `${evaluatorName} · ${roundDate}`,
    });
    // Return the created id so callers can lock onto this round for edits.
    return newEvent.id;
  }, [user, teamData.evaluationEvents, updateTeam, toast, uiBridge]);

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
      let nextEvents;
      if (existing) {
        nextEvents = teamData.evaluationEvents.map((e: any) =>
          e.id === existing.id ? { ...e, grades } : e,
        );
      } else {
        const newEvent = {
          id: "ev-" + Math.random().toString(36).substring(2, 10),
          date: roundDate,
          createdAt: Date.now(),
          coachRole: "Assistant",
          evaluatorId: user.uid,
          evaluatorName: lastNameOfUser(user),
          grades,
        };
        nextEvents = [...(teamData.evaluationEvents || []), newEvent];
      }
      updateTeam({ evaluationEvents: nextEvents });
      toast.push({
        kind: "success",
        title: "Submitted to head coach",
      });
    },
    [user, teamData.evaluationEvents, updateTeam, toast],
  );

  // Drop an evaluation round (any role). HC-callable so the head coach
  // can clean up rounds entered in error — their own, or any assistant's
  // submission. Splices from team.evaluationEvents by id.
  const deleteEvaluation = useCallback(
    (roundId: any) => {
      if (!roundId) return;
      const next = (teamData.evaluationEvents || []).filter(
        (e: any) => e.id !== roundId,
      );
      updateTeam({ evaluationEvents: next });
      toast.push({
        kind: "success",
        title: "Eval round deleted",
      });
    },
    [teamData.evaluationEvents, updateTeam, toast],
  );

  return {
    saveTeamEvaluation,
    saveAssistantEvaluation,
    deleteEvaluation,
  };
};
