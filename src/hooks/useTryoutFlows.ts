import { useCallback } from "react";
import { blankStats, normalizeTryoutSessions } from "../utils/helpers";
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
  activeTeamId: string | null;
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
      const dates = Array.isArray(teamData.tryoutDates)
        ? teamData.tryoutDates
        : [];
      const nextDates = dates.includes(date) ? dates : [...dates, date];
      // Persist an explicit slug→date mapping so the portal pins the exact date
      // this link was generated for. We append (never replace): a date can be
      // regenerated to mint a fresh slug while previously printed QR codes keep
      // resolving to their original date. `tryoutDateSlug` is still written for
      // backward compatibility with the legacy single-slug portal/mirror path.
      const existingLinks = Array.isArray(teamData.tryoutDateLinks)
        ? teamData.tryoutDateLinks.filter(
            (l: any) => l && l.slug && l.date && l.slug !== slug,
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
    [activeTeamId, teamData.tryoutDates, teamData.tryoutDateLinks, updateTeam],
  );

  const setTryoutsOpen = useCallback(
    (open: any) => {
      updateTeam({
        tryoutsOpen: !!open,
        tryoutsPhase: open ? "open" : "intake_closed",
      });
    },
    [updateTeam],
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
    [updateTeam],
  );

  const appendTryoutSignup = useCallback(
    (signup: any) => {
      const id = signup.id || "ts-" + Math.random().toString(36).slice(2, 10);
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
    [teamData.tryoutSignups, updateTeam],
  );

  const updateTryoutSignup = useCallback(
    (id: any, patch: any) => {
      const next = (teamData.tryoutSignups || []).map((s: any) =>
        s.id === id ? { ...s, ...patch } : s,
      );
      updateTeam({ tryoutSignups: next });
    },
    [teamData.tryoutSignups, updateTeam],
  );

  const deleteTryoutSignup = useCallback(
    (id: any) => {
      if (!id) return;
      // Two-tap armed confirm lives in TryoutsTab; no native confirm here.
      const next = (teamData.tryoutSignups || []).filter(
        (s: any) => s.id !== id,
      );
      updateTeam({ tryoutSignups: next });
    },
    [teamData.tryoutSignups, updateTeam],
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
    [teamData.tryoutSignups, updateTeam],
  );

  // Drop an interest-survey lead. Coach-only; the two-tap confirm lives
  // in the InterestTab UI so there's no native confirm prompt here.
  const deleteInterestSignup = useCallback(
    (id: any) => {
      if (!id) return;
      const next = (teamData.interestSignups || []).filter(
        (s: any) => s.id !== id,
      );
      updateTeam({ interestSignups: next });
    },
    [teamData.interestSignups, updateTeam],
  );

  // Promote an interest-survey lead into a real tryout signup. Useful
  // when tryouts open and the HC wants to seed the signup list from
  // standing interest. Copies fields, marks status:"tryout", removes
  // the source lead from interestSignups in the same write.
  const convertInterestToTryout = useCallback(
    (id: any) => {
      if (!id) return;
      const lead = (teamData.interestSignups || []).find(
        (s: any) => s.id === id,
      );
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
        tryoutDate: lead.tryoutDate || "",
        primaryPosition: lead.primaryPosition || "",
        secondaryPosition: lead.secondaryPosition || "",
        canPitch: lead.canPitch === true,
        canCatch: lead.canCatch === true || lead.isCatcher === true,
        isCatcher: lead.canCatch === true || lead.isCatcher === true,
        comfortablePositions: [
          ...(Array.isArray(lead.comfortablePositions)
            ? lead.comfortablePositions
            : []
          ).filter((p: any) => p !== "C"),
          ...(lead.canCatch === true || lead.isCatcher === true ? ["C"] : []),
        ],
        notes: lead.notes || "",
        status: "tryout",
      };
      updateTeam({
        tryoutSignups: [...(teamData.tryoutSignups || []), signup],
        interestSignups: (teamData.interestSignups || []).filter(
          (s: any) => s.id !== id,
        ),
      });
      toast.push({
        kind: "success",
        title: "Moved to tryouts",
        message: `${lead.firstName} ${lead.lastName}`.trim(),
      });
    },
    [teamData.interestSignups, teamData.tryoutSignups, updateTeam, toast],
  );

  // Drop a parent-submitted player-info entry. Coach-only; the two-tap
  // confirm lives in the PlayerInfoTab UI so there's no native prompt here.
  const deletePlayerInfoSubmission = useCallback(
    (id: any) => {
      if (!id) return;
      const next = (teamData.playerInfoSubmissions || []).filter(
        (s: any) => s.id !== id,
      );
      updateTeam({ playerInfoSubmissions: next });
    },
    [teamData.playerInfoSubmissions, updateTeam],
  );

  // Apply a parent-submitted player-info entry onto a matching roster player.
  // Writes the sizing + school + emergency-contact fields onto the chosen
  // Player (only fields the parent actually filled in — never blanking
  // existing roster data) and stamps the submission as handled in the same
  // write so the inbox can show it as applied.
  const applyPlayerInfoToPlayer = useCallback(
    (submissionId: any, playerId: any) => {
      if (!submissionId || !playerId) return;
      const sub = (teamData.playerInfoSubmissions || []).find(
        (s: any) => s.id === submissionId,
      );
      const player = (teamData.players || []).find(
        (p: any) => p.id === playerId,
      );
      if (!sub || !player) return;

      // Map submission fields → player fields, skipping blanks so applying a
      // sparse submission never wipes data already on the roster record.
      const patch: Record<string, unknown> = {};
      const put = (key: string, value: unknown) => {
        const v = String(value ?? "").trim();
        if (v) patch[key] = v;
      };
      put("number", sub.number);
      put("hatSize", sub.hatSize);
      put("shirtSize", sub.shirtSize);
      put("pantsSize", sub.pantsSize);
      put("height", sub.height);
      put("weight", sub.weight);
      put("school", sub.school);
      put("grade", sub.grade);
      put("emergencyName", sub.emergencyName);
      put("emergencyPhone", sub.emergencyPhone);
      // DOB + parent/guardian contact only fill gaps — don't clobber what the
      // coach may have already curated on the roster.
      if (!player.dob) put("dob", sub.dob);
      if (!player.parentName) put("parentName", sub.parentName);
      if (!player.email) put("email", sub.email);
      if (!player.phone) put("phone", sub.phone);

      const now = new Date().toISOString();
      const nextPlayers = (teamData.players || []).map((p: any) =>
        p.id === playerId ? { ...p, ...patch } : p,
      );
      const nextSubs = (teamData.playerInfoSubmissions || []).map((s: any) =>
        s.id === submissionId
          ? { ...s, appliedToPlayerId: playerId, appliedAt: now }
          : s,
      );
      updateTeam({ players: nextPlayers, playerInfoSubmissions: nextSubs });
      toast.push({
        kind: "success",
        title: "Player info applied",
        message:
          `${sub.firstName || ""} ${sub.lastName || ""}`.trim() || player.name,
      });
    },
    [teamData.playerInfoSubmissions, teamData.players, updateTeam, toast],
  );

  // Tryout grades live in date-grouped tryoutSessions, separate from the
  // roster evaluationEvents collection. Each date has one session; each
  // evaluator owns a grades map keyed by signup id inside that session.
  const saveTryoutEvaluation = useCallback(
    (signupId: any, grades: any, coachRole: any, rawDate?: any) => {
      if (!user || !signupId) return;
      const signup = (teamData.tryoutSignups || []).find(
        (s: any) => s.id === signupId,
      );
      const date = String(
        rawDate || signup?.tryoutDate || new Date().toISOString().slice(0, 10),
      );
      const sessionId = `tryout-${date.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const sessions = normalizeTryoutSessions(teamData);
      const existing = sessions.find((s: any) => s.id === sessionId);
      const now = Date.now();
      const session = existing || {
        id: sessionId,
        date,
        label: `Tryout · ${date}`,
        createdAt: now,
        signupIds: [],
        gradesByEvaluator: {},
      };
      const evaluator = session.gradesByEvaluator?.[user.uid] || {
        coachRole: coachRole || "Assistant",
        evaluatorId: user.uid,
        grades: {},
      };
      const nextSession = {
        ...session,
        updatedAt: now,
        signupIds: Array.from(
          new Set([...(session.signupIds || []), signupId]),
        ),
        gradesByEvaluator: {
          ...(session.gradesByEvaluator || {}),
          [user.uid]: {
            ...evaluator,
            coachRole: coachRole || evaluator.coachRole || "Assistant",
            evaluatorId: user.uid,
            updatedAt: now,
            grades: { ...(evaluator.grades || {}), [signupId]: { ...grades } },
          },
        },
      };
      const next = existing
        ? sessions.map((s: any) => (s.id === sessionId ? nextSession : s))
        : [...sessions, nextSession];
      updateTeam({ tryoutSessions: next });
    },
    [user, teamData, updateTeam],
  );

  const saveTryoutEvaluations = useCallback(
    (entries: any[], coachRole: any) => {
      if (!user) return;
      const sessions = normalizeTryoutSessions(teamData);
      const byId = new Map(
        sessions.map((session: any) => [session.id, session]),
      );
      const now = Date.now();
      for (const entry of entries || []) {
        if (!entry?.signupId) continue;
        const signup = (teamData.tryoutSignups || []).find(
          (s: any) => s.id === entry.signupId,
        );
        const date = String(
          entry.date ||
            signup?.tryoutDate ||
            new Date().toISOString().slice(0, 10),
        );
        const sessionId = `tryout-${date.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const session: any = byId.get(sessionId) || {
          id: sessionId,
          date,
          label: `Tryout · ${date}`,
          createdAt: now,
          signupIds: [],
          gradesByEvaluator: {},
        };
        const evaluator = session.gradesByEvaluator?.[user.uid] || {
          coachRole: coachRole || "Assistant",
          evaluatorId: user.uid,
          grades: {},
        };
        byId.set(sessionId, {
          ...session,
          updatedAt: now,
          signupIds: Array.from(
            new Set([...(session.signupIds || []), entry.signupId]),
          ),
          gradesByEvaluator: {
            ...(session.gradesByEvaluator || {}),
            [user.uid]: {
              ...evaluator,
              coachRole: coachRole || evaluator.coachRole || "Assistant",
              evaluatorId: user.uid,
              updatedAt: now,
              grades: {
                ...(evaluator.grades || {}),
                [entry.signupId]: { ...(entry.grades || {}) },
              },
            },
          },
        });
      }
      updateTeam({ tryoutSessions: [...byId.values()] });
    },
    [user, teamData, updateTeam],
  );

  // Accept-offer flow. Tryout accepts are oriented to the NEXT season by
  // default: the signup is flagged "accepted" and stays in the Tryouts tab,
  // then advanceSeason promotes it onto the new roster automatically (it's
  // pre-checked in the Advance Season modal). The coach can override with
  // target="current" to pull a kid straight onto the CURRENT roster now.
  const acceptTryout = useCallback(
    (id: any, target: "next" | "current" = "next") => {
      const signup = (teamData.tryoutSignups || []).find(
        (s: any) => s.id === id,
      );
      if (!signup) return;
      const name = `${signup.firstName || ""} ${signup.lastName || ""}`.trim();

      if (target === "current") {
        // Override: this kid plays THIS season. They become a normal active
        // player (and ride into next season as a returner), so their tryout
        // signup is consumed — they're a roster player, not a tryout anymore.
        const player = {
          id: "p-" + Math.random().toString(36).slice(2, 10),
          name,
          number: signup.tryoutNumber || signup.number || "",
          dob: signup.dob || "",
          bats: signup.bats || "R",
          throws: signup.throws || "R",
          comfortablePositions: [
            ...(Array.isArray(signup.comfortablePositions)
              ? signup.comfortablePositions
              : []
            ).filter((p: any) => p !== "C"),
            ...(signup.isCatcher === true ? ["C"] : []),
          ],
          parentName: signup.parentName || "",
          email: signup.email || "",
          phone: signup.phone || "",
          present: true,
          playerStatus: "returning",
          stats: blankStats(),
          pitching: { recentPitches: 0, lastPitchDate: null },
          tryoutSignupId: signup.id,
        };
        updateTeam({
          tryoutSignups: (teamData.tryoutSignups || []).filter(
            (s: any) => s.id !== id,
          ),
          players: [...(teamData.players || []), player],
        });
        toast.push({
          kind: "success",
          title: `${name} added to current roster`,
        });
        return;
      }

      // Default: accept for NEXT season. Keep them in the Tryouts tab marked
      // "accepted"; advanceSeason brings them onto the roster.
      const nextSignups = (teamData.tryoutSignups || []).map((s: any) =>
        s.id === id ? { ...s, status: "accepted" } : s,
      );
      updateTeam({ tryoutSignups: nextSignups });
      toast.push({
        kind: "success",
        title: `${name} accepted`,
        message: "Joins the roster automatically when you Advance Season.",
      });
    },
    [teamData.tryoutSignups, teamData.players, updateTeam, toast],
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
    deletePlayerInfoSubmission,
    applyPlayerInfoToPlayer,
    saveTryoutEvaluation,
    saveTryoutEvaluations,
    acceptTryout,
  };
};
