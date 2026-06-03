import { useCallback } from "react";
import { blankStats } from "../utils/helpers";
import type { ToastContextValue } from "../types";

// Tryout + interest-signup flows extracted from App.tsx's TeamProvider.
// Share-link generation, open/close state, signup/lead CRUD, tryout
// evaluations, and accept-to-roster. Pure persistence via updateTeam; no
// engine or UI-bridge coupling. Mirrors the useGameCrud/usePlayerCrud pattern.
interface UseTryoutFlowsArgs {
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: ToastContextValue;
  user: { uid: string } | null | undefined;
  activeTeamId: string;
}

export const useTryoutFlows = ({
  teamData,
  updateTeam,
  toast,
  user,
  activeTeamId,
}: UseTryoutFlowsArgs) => {
  const generateTryoutShareId = useCallback(() => {
    const id =
      Math.random().toString(36).slice(2, 8) +
      Math.random().toString(36).slice(2, 8);
    updateTeam({ tryoutShareId: id, tryoutsOpen: true, tryoutsPhase: "open" });
    return id;
  }, [updateTeam]);


  const generateTryoutDateLink = useCallback(
    (rawDate: any) => {
      const date = String(rawDate || "").trim();
      if (!date) return null;
      const base = String(activeTeamId || "").replace(/[^a-zA-Z0-9_-]/g, "");
      const rand = Math.random().toString(36).slice(2, 8);
      const slug = `${base || "team"}-${date}-${rand}`;
      const dates = Array.isArray(teamData.tryoutDates) ? teamData.tryoutDates : [];
      const nextDates = dates.includes(date) ? dates : [...dates, date];
      updateTeam({
        tryoutDateSlug: slug,
        tryoutDates: nextDates,
        tryoutsOpen: true,
        tryoutsPhase: "open",
      });
      return slug;
    },
    [activeTeamId, teamData.tryoutDates, updateTeam]
  );

  const setTryoutsOpen = useCallback(
    (open: any) => {
      updateTeam({
        tryoutsOpen: !!open,
        tryoutsPhase: open ? "open" : "intake_closed",
      });
    },
    [updateTeam]
  );

  const completeTryouts = useCallback(() => {
    updateTeam({ tryoutsOpen: false, tryoutsPhase: "completed" });
  }, [updateTeam]);

  const setRosterCap = useCallback(
    (cap: any) => {
      const n = parseInt(cap, 10);
      if (!Number.isFinite(n) || n <= 0) return;
      updateTeam({ rosterCap: n });
    },
    [updateTeam]
  );

  const appendTryoutSignup = useCallback(
    (signup: any) => {
      const id =
        signup.id || "ts-" + Math.random().toString(36).slice(2, 10);
      const entry = {
        id,
        submittedAt: signup.submittedAt || new Date().toISOString(),
        status: signup.status || "tryout",
        ...signup,
      };
      const next = [...(teamData.tryoutSignups || []), entry];
      updateTeam({ tryoutSignups: next });
      return entry;
    },
    [teamData.tryoutSignups, updateTeam]
  );

  const updateTryoutSignup = useCallback(
    (id: any, patch: any) => {
      const next = (teamData.tryoutSignups || []).map((s: any) =>
        s.id === id ? { ...s, ...patch } : s
      );
      updateTeam({ tryoutSignups: next });
    },
    [teamData.tryoutSignups, updateTeam]
  );

  const deleteTryoutSignup = useCallback(
    (id: any) => {
      if (!id) return;
      // Two-tap armed confirm lives in TryoutsTab; no native confirm here.
      const next = (teamData.tryoutSignups || []).filter((s: any) => s.id !== id);
      updateTeam({ tryoutSignups: next });
    },
    [teamData.tryoutSignups, updateTeam]
  );

  // Bulk-remove signups in a SINGLE write. Calling deleteTryoutSignup() in a
  // loop is buggy: each call filters the same closure-captured array and the
  // optimistic merge keeps only the last write — so all-but-one survive. This
  // filters every id out at once. Returns the number actually removed.
  const deleteTryoutSignups = useCallback(
    (ids: any[]) => {
      const toRemove = new Set((ids || []).filter(Boolean));
      if (toRemove.size === 0) return 0;
      const current = teamData.tryoutSignups || [];
      const next = current.filter((s: any) => !toRemove.has(s.id));
      const removed = current.length - next.length;
      if (removed > 0) updateTeam({ tryoutSignups: next });
      return removed;
    },
    [teamData.tryoutSignups, updateTeam]
  );

  // Drop an interest-survey lead. Coach-only; the two-tap confirm lives
  // in the InterestTab UI so there's no native confirm prompt here.
  const deleteInterestSignup = useCallback(
    (id: any) => {
      if (!id) return;
      const next = (teamData.interestSignups || []).filter((s: any) => s.id !== id);
      updateTeam({ interestSignups: next });
    },
    [teamData.interestSignups, updateTeam]
  );

  // Promote an interest-survey lead into a real tryout signup. Useful
  // when tryouts open and the HC wants to seed the signup list from
  // standing interest. Copies fields, marks status:"tryout", removes
  // the source lead from interestSignups in the same write.
  const convertInterestToTryout = useCallback(
    (id: any) => {
      if (!id) return;
      const lead = (teamData.interestSignups || []).find((s: any) => s.id === id);
      if (!lead) return;
      const signup = {
        id: `ts-${Math.random().toString(36).slice(2, 10)}`,
        submittedAt: new Date().toISOString(),
        firstName: lead.firstName,
        lastName: lead.lastName,
        dob: lead.dob || "",
        parentName: lead.parentName || "",
        email: lead.email || "",
        phone: lead.phone || "",
        currentTeam: lead.currentTeam || "",
        comfortablePositions: [
          ...(Array.isArray(lead.comfortablePositions) ? lead.comfortablePositions : []).filter(
            (p: any) => p !== "C"
          ),
          ...(lead.isCatcher === true ? ["C"] : []),
        ],
        notes: lead.notes || "",
        status: "tryout",
      };
      updateTeam({
        tryoutSignups: [...(teamData.tryoutSignups || []), signup],
        interestSignups: (teamData.interestSignups || []).filter(
          (s: any) => s.id !== id
        ),
      });
      toast.push({
        kind: "success",
        title: "Moved to tryouts",
        message: `${lead.firstName} ${lead.lastName}`.trim(),
      });
    },
    [teamData.interestSignups, teamData.tryoutSignups, updateTeam, toast]
  );

  // Tryout grades live in team.evaluationEvents alongside roster
  // evals but carry `tryoutSignupId` so getCombinedGrades ignores them
  // when scoring the roster. One event per (evaluator, signup).
  const saveTryoutEvaluation = useCallback(
    (signupId: any, grades: any, coachRole: any) => {
      if (!user || !signupId) return;
      const date = new Date().toISOString().slice(0, 10);
      const existing = (teamData.evaluationEvents || []).find(
        (e: any) =>
          e.tryoutSignupId === signupId && e.evaluatorId === user.uid
      );
      const event = {
        id:
          existing?.id || "ev-" + Math.random().toString(36).slice(2, 10),
        date,
        coachRole: coachRole || "Assistant",
        evaluatorId: user.uid,
        label: `Tryout · ${signupId}`,
        tryoutSignupId: signupId,
        grades: { signup: { ...grades } },
      };
      const next = existing
        ? teamData.evaluationEvents.map((e: any) =>
            e.id === existing.id ? event : e
          )
        : [...(teamData.evaluationEvents || []), event];
      updateTeam({ evaluationEvents: next });
    },
    [user, teamData.evaluationEvents, updateTeam]
  );

  // Accept-offer flow. Flips signup.status to "accepted" AND creates
  // a corresponding entry in team.players with playerStatus = "accepted"
  // so PR L's advanceSeason picks them up automatically.
  const acceptTryout = useCallback(
    (id: any) => {
      const signup = (teamData.tryoutSignups || []).find((s: any) => s.id === id);
      if (!signup) return;
      const name = `${signup.firstName || ""} ${signup.lastName || ""}`.trim();
      const player = {
        id: "p-" + Math.random().toString(36).slice(2, 10),
        name,
        number: signup.number || "",
        dob: signup.dob || "",
        bats: signup.bats || "R",
        throws: signup.throws || "R",
        comfortablePositions: [
          ...(Array.isArray(signup.comfortablePositions) ? signup.comfortablePositions : []).filter(
            (p: any) => p !== "C"
          ),
          ...(signup.isCatcher === true ? ["C"] : []),
        ],
        parentName: signup.parentName || "",
        email: signup.email || "",
        phone: signup.phone || "",
        present: true,
        playerStatus: "accepted",
        stats: blankStats(),
        pitching: { recentPitches: 0, lastPitchDate: null },
      };
      const nextSignups = (teamData.tryoutSignups || []).map((s: any) =>
        s.id === id ? { ...s, status: "accepted" } : s
      );
      const nextPlayers = [...(teamData.players || []), player];
      updateTeam({
        tryoutSignups: nextSignups,
        players: nextPlayers,
      });
      toast.push({
        kind: "success",
        title: `${name} accepted`,
        message: "Added to roster with status “accepted”. They join on Advance Season.",
      });
    },
    [teamData.tryoutSignups, teamData.players, updateTeam, toast]
  );

  return {
    generateTryoutShareId,
    generateTryoutDateLink,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    appendTryoutSignup,
    updateTryoutSignup,
    deleteTryoutSignup,
    deleteTryoutSignups,
    deleteInterestSignup,
    convertInterestToTryout,
    saveTryoutEvaluation,
    acceptTryout,
  };
};
