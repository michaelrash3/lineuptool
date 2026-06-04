import { useCallback } from "react";
import { deleteDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { appId, db } from "../firebase";
import { blankStats, scrubUndefined } from "../utils/helpers";
import { reportError } from "../utils/errorReporter";
import type { ToastContextValue } from "../types";

// Tryout + interest-signup flows extracted from App.tsx's TeamProvider.
// Share-link generation, open/close state, signup/lead CRUD, tryout
// evaluations, and accept-to-roster.
//
// Phase 1 of the signup data migration (docs/firestore-data-migration.md):
// public signups now live in per-team subcollections, not the root team-doc
// arrays. The coach client merges both sources into teamData.tryoutSignups /
// teamData.interestSignups, tagging subcollection entries with `_sub` (the
// collection name). Every mutation here routes by that tag: a subcollection
// entry is edited/removed as its own doc; a legacy root-array entry still goes
// through the whole-array updateTeam path (rebuilt from the non-`_sub` entries
// so subcollection items are never folded back into the root array).
interface UseTryoutFlowsArgs {
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: ToastContextValue;
  user: { uid: string } | null | undefined;
  activeTeamId: string;
}

type SignupKind = "tryoutSignups" | "interestSignups";

export const useTryoutFlows = ({
  teamData,
  updateTeam,
  toast,
  user,
  activeTeamId,
}: UseTryoutFlowsArgs) => {
  // Doc ref for a signup living in a subcollection.
  const subDoc = useCallback(
    (kind: SignupKind, id: string) =>
      doc(db, "artifacts", appId, "public", "data", "teams", activeTeamId, kind, id),
    [activeTeamId]
  );

  // The legacy root-array slice (entries NOT sourced from a subcollection) for a
  // given kind — used to rebuild the array on a legacy-entry mutation without
  // re-folding subcollection items back into the root doc.
  const legacyArray = useCallback(
    (kind: SignupKind) =>
      (teamData[kind] || []).filter((s: any) => !s?._sub),
    [teamData]
  );

  const reportSubError = useCallback(
    (op: string, err: unknown) => {
      reportError(err, { source: `useTryoutFlows.${op}` });
      toast.push({
        kind: "error",
        title: "Save failed",
        message: "Couldn't update that signup. Check your connection and try again.",
      });
    },
    [toast]
  );
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
      // Persist an explicit slug→date mapping so the portal pins the exact date
      // this link was generated for. We append (never replace): a date can be
      // regenerated to mint a fresh slug while previously printed QR codes keep
      // resolving to their original date. `tryoutDateSlug` is still written for
      // backward compatibility with the legacy single-slug portal/mirror path.
      const existingLinks = Array.isArray(teamData.tryoutDateLinks)
        ? teamData.tryoutDateLinks.filter(
            (l: any) => l && l.slug && l.date && l.slug !== slug
          )
        : [];
      const nextLinks = [...existingLinks, { slug, date }];
      updateTeam({
        tryoutDateSlug: slug,
        tryoutDates: nextDates,
        tryoutDateLinks: nextLinks,
        tryoutsOpen: true,
        tryoutsPhase: "open",
      });
      return slug;
    },
    [activeTeamId, teamData.tryoutDates, teamData.tryoutDateLinks, updateTeam]
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

  // Coach-side manual add. Writes to the tryoutSignups subcollection (the new
  // canonical store); the team subscription rehydrates it into teamData.
  const appendTryoutSignup = useCallback(
    (signup: any) => {
      const id =
        signup.id || "ts-" + Math.random().toString(36).slice(2, 10);
      const { _sub, ...rest } = signup || {};
      const entry = {
        submittedAt: signup.submittedAt || new Date().toISOString(),
        status: signup.status || "tryout",
        ...rest,
        id,
      };
      setDoc(subDoc("tryoutSignups", id), scrubUndefined(entry) as any).catch(
        (err) => reportSubError("appendTryoutSignup", err)
      );
      return entry;
    },
    [subDoc, reportSubError]
  );

  const updateTryoutSignup = useCallback(
    (id: any, patch: any) => {
      if (!id) return;
      const entry = (teamData.tryoutSignups || []).find((s: any) => s.id === id);
      if (!entry) return;
      if (entry._sub) {
        updateDoc(subDoc(entry._sub as SignupKind, id), patch).catch((err) =>
          reportSubError("updateTryoutSignup", err)
        );
        return;
      }
      const next = legacyArray("tryoutSignups").map((s: any) =>
        s.id === id ? { ...s, ...patch } : s
      );
      updateTeam({ tryoutSignups: next });
    },
    [teamData.tryoutSignups, legacyArray, subDoc, updateTeam, reportSubError]
  );

  const deleteTryoutSignup = useCallback(
    (id: any) => {
      if (!id) return;
      // Two-tap armed confirm lives in TryoutsTab; no native confirm here.
      const entry = (teamData.tryoutSignups || []).find((s: any) => s.id === id);
      if (!entry) return;
      if (entry._sub) {
        deleteDoc(subDoc(entry._sub as SignupKind, id)).catch((err) =>
          reportSubError("deleteTryoutSignup", err)
        );
        return;
      }
      const next = legacyArray("tryoutSignups").filter((s: any) => s.id !== id);
      updateTeam({ tryoutSignups: next });
    },
    [teamData.tryoutSignups, legacyArray, subDoc, updateTeam, reportSubError]
  );

  // Bulk-remove signups. Subcollection entries are deleted per-doc; the
  // remaining legacy-array entries are rewritten in a SINGLE updateTeam (a
  // per-call array filter in a loop would drop all-but-one under the optimistic
  // merge). Returns the number targeted for removal.
  const deleteTryoutSignups = useCallback(
    (ids: any[]) => {
      const toRemove = new Set((ids || []).filter(Boolean));
      if (toRemove.size === 0) return 0;
      const current = teamData.tryoutSignups || [];
      const targets = current.filter((s: any) => toRemove.has(s.id));
      if (targets.length === 0) return 0;
      for (const t of targets) {
        if (t._sub) {
          deleteDoc(subDoc(t._sub as SignupKind, t.id)).catch((err) =>
            reportSubError("deleteTryoutSignups", err)
          );
        }
      }
      const legacyTargets = targets.filter((s: any) => !s._sub);
      if (legacyTargets.length > 0) {
        const next = legacyArray("tryoutSignups").filter(
          (s: any) => !toRemove.has(s.id)
        );
        updateTeam({ tryoutSignups: next });
      }
      return targets.length;
    },
    [teamData.tryoutSignups, legacyArray, subDoc, updateTeam, reportSubError]
  );

  // Drop an interest-survey lead. Coach-only; the two-tap confirm lives
  // in the InterestTab UI so there's no native confirm prompt here.
  const deleteInterestSignup = useCallback(
    (id: any) => {
      if (!id) return;
      const entry = (teamData.interestSignups || []).find((s: any) => s.id === id);
      if (!entry) return;
      if (entry._sub) {
        deleteDoc(subDoc(entry._sub as SignupKind, id)).catch((err) =>
          reportSubError("deleteInterestSignup", err)
        );
        return;
      }
      const next = legacyArray("interestSignups").filter((s: any) => s.id !== id);
      updateTeam({ interestSignups: next });
    },
    [teamData.interestSignups, legacyArray, subDoc, updateTeam, reportSubError]
  );

  // Promote an interest-survey lead into a real tryout signup. The new tryout
  // signup is created in the tryoutSignups subcollection; the source lead is
  // then removed from wherever it lives (its own subcollection doc, or the
  // legacy interest array).
  const convertInterestToTryout = useCallback(
    (id: any) => {
      if (!id) return;
      const lead = (teamData.interestSignups || []).find((s: any) => s.id === id);
      if (!lead) return;
      const signupId = `ts-${Math.random().toString(36).slice(2, 10)}`;
      const signup = {
        id: signupId,
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
      setDoc(subDoc("tryoutSignups", signupId), scrubUndefined(signup) as any).catch(
        (err) => reportSubError("convertInterestToTryout", err)
      );
      if (lead._sub) {
        deleteDoc(subDoc(lead._sub as SignupKind, id)).catch((err) =>
          reportSubError("convertInterestToTryout", err)
        );
      } else {
        updateTeam({
          interestSignups: legacyArray("interestSignups").filter(
            (s: any) => s.id !== id
          ),
        });
      }
      toast.push({
        kind: "success",
        title: "Moved to tryouts",
        message: `${lead.firstName} ${lead.lastName}`.trim(),
      });
    },
    [teamData.interestSignups, legacyArray, subDoc, updateTeam, toast, reportSubError]
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
      const nextPlayers = [...(teamData.players || []), player];
      if (signup._sub) {
        // Player is added to the root roster; the signup status flips on its
        // own subcollection doc.
        updateTeam({ players: nextPlayers });
        updateDoc(subDoc(signup._sub as SignupKind, id), {
          status: "accepted",
        }).catch((err) => reportSubError("acceptTryout", err));
      } else {
        const nextSignups = legacyArray("tryoutSignups").map((s: any) =>
          s.id === id ? { ...s, status: "accepted" } : s
        );
        updateTeam({ tryoutSignups: nextSignups, players: nextPlayers });
      }
      toast.push({
        kind: "success",
        title: `${name} accepted`,
        message: "Added to roster with status “accepted”. They join on Advance Season.",
      });
    },
    [teamData.tryoutSignups, teamData.players, legacyArray, subDoc, updateTeam, toast, reportSubError]
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
