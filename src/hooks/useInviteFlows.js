import { useCallback } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { appId, db } from "../firebase";

export const useInviteFlows = ({
  user,
  teams,
  teamData,
  updateTeam,
  switchTeam,
  toast,
}) => {
  const createInviteToken = useCallback(
    (role) => {
      if (!user) return null;
      if (role !== "head" && role !== "assistant") role = "assistant";
      const token =
        Math.random().toString(36).substring(2, 10) +
        Math.random().toString(36).substring(2, 10);
      const entry = {
        token,
        role,
        createdAt: new Date().toISOString(),
        createdBy: user.uid,
      };
      const next = [...(teamData.invites || []), entry];
      updateTeam({ invites: next });
      return token;
    },
    [user, teamData.invites, updateTeam]
  );

  const revokeInviteToken = useCallback(
    (token) => {
      const next = (teamData.invites || []).filter((i) => i.token !== token);
      updateTeam({ invites: next });
    },
    [teamData.invites, updateTeam]
  );

  const regenerateJoinCode = useCallback(() => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    updateTeam({ joinCode: code });
    return code;
  }, [updateTeam]);

  const joinTeamByCode = useCallback(
    async (rawCode) => {
      if (!user || !rawCode) return { ok: false, retryable: true };
      const code = String(rawCode).trim().toUpperCase();
      const codeRe = /^[A-HJ-NP-Z2-9]{6}$/;
      if (!codeRe.test(code)) {
        toast.push({ kind: "error", title: "Invalid code", message: "Team codes are 6 characters using A-Z and 2-9." });
        return { ok: false, retryable: false };
      }
      try {
        for (const t of teams) {
          const snap = await getDoc(doc(db, "artifacts", appId, "public", "data", "teams", t.id));
          if (snap.exists() && (snap.data().joinCode || "") === code) {
            switchTeam(t.id);
            toast.push({ kind: "success", title: `Already a member of ${snap.data().name || "this team"}` });
            return { ok: true };
          }
        }
        const q = query(collection(db, "artifacts", appId, "public", "data", "teams"), where("joinCode", "==", code));
        const snap = await getDocs(q);
        if (snap.empty) {
          toast.push({ kind: "error", title: "Code not recognized" });
          return { ok: false, retryable: false };
        }
        const teamDoc = snap.docs[0];
        const data = teamDoc.data();
        const members = Array.isArray(data.members) ? data.members : [];
        const nextMembers = members.includes(user.uid) ? members : [...members, user.uid];
        const nextCoachRoles = {
          ...(data.coachRoles || {}),
          [user.uid]: data.coachRoles?.[user.uid] === "head" ? "head" : "assistant",
        };
        await setDoc(doc(db, "artifacts", appId, "public", "data", "teams", teamDoc.id), { members: nextMembers, coachRoles: nextCoachRoles }, { merge: true });

        // Persist membership in user settings so re-login/reload keeps the
        // joined team in the selector instead of dropping back to a bootstrap
        // team.
        const userRef = doc(db, "artifacts", appId, "users", user.uid, "settings", "teams");
        const nextEntry = { id: teamDoc.id, name: data.name || "Joined Team" };
        const exists = teams.some((t) => t.id === teamDoc.id);
        const nextTeams = exists ? teams : [...teams, nextEntry];
        await setDoc(userRef, { teams: nextTeams, activeTeamId: teamDoc.id }, { merge: true });

        switchTeam(teamDoc.id);
        toast.push({ kind: "success", title: `Joined ${data.name || "team"}`, message: "You're set as an assistant coach. The head can promote you from Settings." });
        return { ok: true };
      } catch (_err) {
        toast.push({ kind: "error", title: "Couldn't join", message: "Your account may not have read access to this team. Ask the head coach to confirm the code or share an invite link." });
        return { ok: false, retryable: true };
      }
    },
    [user, teams, toast, switchTeam]
  );

  const redeemInviteToken = useCallback(
    async (token) => {
      if (!user || !token) return { ok: false, retryable: true };
      let teamId = null;
      let plainToken = token;
      if (token.includes(".")) {
        const [tId, t] = token.split(".");
        teamId = tId;
        plainToken = t;
      }
      try {
        if (!teamId) {
          for (const t of teams) {
            const snap = await getDoc(doc(db, "artifacts", appId, "public", "data", "teams", t.id));
            if (!snap.exists()) continue;
            if ((snap.data().invites || []).some((i) => i.token === plainToken)) {
              teamId = t.id;
              break;
            }
          }
        }
        if (!teamId) {
          toast.push({ kind: "error", title: "Invite not recognized" });
          return { ok: false, retryable: false };
        }
        const teamRef = doc(db, "artifacts", appId, "public", "data", "teams", teamId);
        const snap = await getDoc(teamRef);
        if (!snap.exists()) return { ok: false, retryable: false };
        const data = snap.data();
        const invites = Array.isArray(data.invites) ? data.invites : [];
        const invite = invites.find((i) => i.token === plainToken);
        if (!invite || invite.usedBy) return { ok: false, retryable: false };
        const members = Array.isArray(data.members) ? data.members : [];
        const nextMembers = members.includes(user.uid) ? members : [...members, user.uid];
        const nextCoachRoles = { ...(data.coachRoles || {}), [user.uid]: invite.role };
        const nextInvites = invites.map((i) =>
          i.token === plainToken ? { ...i, usedBy: user.uid, usedAt: new Date().toISOString() } : i
        );
        try {
          // Best-effort legacy invite consumption stamp. Some deployed rulesets
          // only allow join mutations on members/coachRoles, so we gracefully
          // fall back to a join-only write if invite bookkeeping is denied.
          await setDoc(
            teamRef,
            { members: nextMembers, coachRoles: nextCoachRoles, invites: nextInvites },
            { merge: true }
          );
        } catch (writeErr) {
          if (writeErr?.code !== "permission-denied") throw writeErr;
          await setDoc(
            teamRef,
            { members: nextMembers, coachRoles: nextCoachRoles },
            { merge: true }
          );
        }
        const userRef = doc(db, "artifacts", appId, "users", user.uid, "settings", "teams");
        const newEntry = { id: teamId, name: data.name || "Joined Team" };
        const exists = teams.some((t) => t.id === teamId);
        const nextTeams = exists ? teams : [...teams, newEntry];
        await setDoc(userRef, { teams: nextTeams, activeTeamId: teamId }, { merge: true });
        toast.push({ kind: "success", title: "Joined team", message: invite.role === "head" ? "You're a head coach on this team." : "You're an assistant coach on this team." });
        return { ok: true };
      } catch (e) {
        toast.push({
          kind: "error",
          title: "Could not redeem invite",
          message:
            e?.code === "permission-denied"
              ? "You don't have permission to use this invite. Ask the head coach to resend it."
              : "Invite redemption failed. Please try again or ask for a new invite link.",
        });
        return { ok: false, retryable: true };
      }
    },
    [user, teams, toast]
  );

  return {
    createInviteToken,
    revokeInviteToken,
    regenerateJoinCode,
    joinTeamByCode,
    redeemInviteToken,
  };
};
