import { useCallback } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { appId, db } from "../firebase";

export const useInviteFlows = ({
  user,
  teams,
  updateTeam,
  switchTeam,
  toast,
}) => {
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

  return {
    regenerateJoinCode,
    joinTeamByCode,
  };
};
