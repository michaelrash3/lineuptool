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
      if (!user || !rawCode) return false;
      const code = String(rawCode).trim().toUpperCase();
      const codeRe = /^[A-HJ-NP-Z2-9]{6}$/;
      if (!codeRe.test(code)) {
        toast.push({ kind: "error", title: "Invalid code", message: "Team codes are 6 characters using A-Z and 2-9." });
        return false;
      }
      try {
        for (const t of teams) {
          const snap = await getDoc(doc(db, "artifacts", appId, "public", "data", "teams", t.id));
          if (snap.exists() && (snap.data().joinCode || "") === code) {
            switchTeam(t.id);
            toast.push({ kind: "success", title: `Already a member of ${snap.data().name || "this team"}` });
            return true;
          }
        }
        const q = query(collection(db, "artifacts", appId, "public", "data", "teams"), where("joinCode", "==", code));
        const snap = await getDocs(q);
        if (snap.empty) {
          toast.push({ kind: "error", title: "Code not recognized" });
          return false;
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
        switchTeam(teamDoc.id);
        toast.push({ kind: "success", title: `Joined ${data.name || "team"}`, message: "You're set as an assistant coach. The head can promote you from Settings." });
        return true;
      } catch (_err) {
        toast.push({ kind: "error", title: "Couldn't join", message: "Your account may not have read access to this team. Ask the head coach to confirm the code or share an invite link." });
        return false;
      }
    },
    [user, teams, toast, switchTeam]
  );

  const redeemInviteToken = useCallback(
    async (token) => {
      if (!user || !token) return false;
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
          toast.push({
            kind: "error",
            title: "Invite not recognized",
            message: "This invite link is invalid or no longer available.",
          });
          return false;
        }
        const teamRef = doc(db, "artifacts", appId, "public", "data", "teams", teamId);
        const snap = await getDoc(teamRef);
        if (!snap.exists()) {
          toast.push({
            kind: "error",
            title: "Team not found",
            message: "This invite points to a team that no longer exists.",
          });
          return false;
        }
        const data = snap.data();
        const invites = Array.isArray(data.invites) ? data.invites : [];
        const invite = invites.find((i) => i.token === plainToken);
        if (!invite) {
          toast.push({
            kind: "error",
            title: "Invite not recognized",
            message: "This invite token is invalid or has been removed.",
          });
          return false;
        }
        if (invite.usedBy) {
          toast.push({
            kind: "error",
            title: "Invite already used",
            message: "Ask a head coach to generate a new invite link.",
          });
          return false;
        }
        const members = Array.isArray(data.members) ? data.members : [];
        const nextMembers = members.includes(user.uid) ? members : [...members, user.uid];
        const nextCoachRoles = { ...(data.coachRoles || {}), [user.uid]: invite.role };
        const nextInvites = invites.map((i) =>
          i.token === plainToken ? { ...i, usedBy: user.uid, usedAt: new Date().toISOString() } : i
        );
        await setDoc(teamRef, { members: nextMembers, coachRoles: nextCoachRoles, invites: nextInvites }, { merge: true });
        const userRef = doc(db, "artifacts", appId, "users", user.uid, "settings", "teams");
        const newEntry = { id: teamId, name: data.name || "Joined Team" };
        const exists = teams.some((t) => t.id === teamId);
        const nextTeams = exists ? teams : [...teams, newEntry];
        await setDoc(userRef, { teams: nextTeams, activeTeamId: teamId }, { merge: true });
        toast.push({ kind: "success", title: "Joined team", message: invite.role === "head" ? "You're a head coach on this team." : "You're an assistant coach on this team." });
        return true;
      } catch (e) {
        toast.push({ kind: "error", title: "Could not redeem invite", message: e.message });
        return false;
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
