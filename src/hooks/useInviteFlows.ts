import { useCallback } from "react";
import {
  arrayUnion,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { appId, db } from "../firebase";
import { reportError } from "../utils/errorReporter";
import { mergeTeamEntries, randomCode } from "../utils/helpers";
import type { ToastContextValue } from "../types";

interface AuthUser {
  uid: string;
}

interface TeamEntry {
  id: string;
  name?: string;
}

interface UseInviteFlowsArgs {
  user: AuthUser | null | undefined;
  teams: TeamEntry[];
  activeTeamId: string | null | undefined;
  teamData: { name?: string; joinCode?: string } & Record<string, unknown>;
  updateTeam: (patch: Record<string, unknown>) => void;
  switchTeam: (id: string) => void;
  toast: ToastContextValue;
}

interface JoinResult {
  ok: boolean;
  retryable?: boolean;
}

// Path to the sanitized invite-lookup doc for a given join code. Holds only
// { teamId, teamName, updatedAt } — never the private team doc.
const inviteRef = (code: string) =>
  doc(db, "artifacts", appId, "public", "data", "teamInvites", code);

const teamRef = (teamId: string) =>
  doc(db, "artifacts", appId, "public", "data", "teams", teamId);

export const useInviteFlows = ({
  user,
  teams,
  activeTeamId,
  teamData = {},
  updateTeam,
  switchTeam,
  toast,
}: UseInviteFlowsArgs) => {
  // Mint a fresh join code, rotate the sanitized invite doc, and invalidate the
  // previous one. The code is still written onto the team doc (via updateTeam)
  // for backward compatibility and because the self-join rule gates on it.
  const regenerateJoinCode = useCallback(() => {
    // Crockford-ish alphabet (no I/O/0/1) over a CSPRNG. 6 chars × 31 symbols ≈
    // 887M combinations, so a stale-but-valid code isn't trivially brute-forced.
    const code = randomCode(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    const prevCode = String(teamData.joinCode || "")
      .trim()
      .toUpperCase();
    updateTeam({ joinCode: code });
    // Best-effort invite-doc maintenance: a failure here never blocks the code
    // change (the legacy on-team-doc code still works), but we surface it so a
    // coach knows the public lookup may be stale.
    if (activeTeamId) {
      void (async () => {
        try {
          await setDoc(inviteRef(code), {
            teamId: activeTeamId,
            teamName: teamData.name || "",
            updatedAt: Date.now(),
          });
          // Invalidate the old code's lookup so a rotated code stops resolving.
          // Best-effort: the new code already works, but report a failed cleanup
          // so a lingering stale lookup is diagnosable instead of silent.
          if (prevCode && prevCode !== code) {
            await deleteDoc(inviteRef(prevCode)).catch((err) =>
              reportError(err, {
                source: "useInviteFlows.invalidateOldInvite",
                prevCode,
              }),
            );
          }
        } catch (err) {
          reportError(err, { source: "useInviteFlows.regenerateJoinCode" });
          toast.push({
            kind: "warn",
            title: "Code updated, but invite link may lag",
            message:
              "The new code works, but we couldn't refresh the shareable invite lookup. Try regenerating again if joins fail.",
          });
        }
      })();
    }
    return code;
  }, [activeTeamId, teamData.joinCode, teamData.name, updateTeam, toast]);

  const joinTeamByCode = useCallback(
    async (rawCode: string): Promise<JoinResult> => {
      if (!user || !rawCode) return { ok: false, retryable: true };
      const code = String(rawCode).trim().toUpperCase();
      const codeRe = /^[A-HJ-NP-Z2-9]{6}$/;
      if (!codeRe.test(code)) {
        toast.push({
          kind: "error",
          title: "Invalid code",
          message: "Team codes are 6 characters using A-Z and 2-9.",
        });
        return { ok: false, retryable: false };
      }
      try {
        // Already a member of a team carrying this code? These are teams the
        // caller already belongs to, so reading their docs is permitted.
        for (const t of teams) {
          const snap = await getDoc(teamRef(t.id));
          const sd = snap.exists() ? (snap.data() as any) : null;
          if (sd && String(sd.joinCode || "").toUpperCase() === code) {
            switchTeam(t.id);
            toast.push({
              kind: "success",
              title: `Already a member of ${sd.name || "this team"}`,
            });
            return { ok: true };
          }
        }

        // Resolve the code through the sanitized invite lookup — never a query
        // against the private team docs. Exposes only teamId + teamName.
        const inviteSnap = await getDoc(inviteRef(code));
        if (!inviteSnap.exists()) {
          toast.push({ kind: "error", title: "Code not recognized" });
          return { ok: false, retryable: false };
        }
        const invite = inviteSnap.data() as any;
        const teamId = String(invite.teamId || "");
        const teamName = String(invite.teamName || "") || "Joined Team";
        if (!teamId) {
          toast.push({ kind: "error", title: "Code not recognized" });
          return { ok: false, retryable: false };
        }

        // Atomic self-join: arrayUnion adds the caller without read-modify-write
        // of the whole members array (no lost concurrent joins), and the dotted
        // path sets only this user's coachRoles entry. Both are exactly what the
        // self-join security rule permits — the joiner never reads the team doc.
        await updateDoc(teamRef(teamId), {
          members: arrayUnion(user.uid),
          [`coachRoles.${user.uid}`]: "assistant",
        });

        // Persist membership in user settings so re-login/reload keeps the
        // joined team in the selector instead of dropping back to a bootstrap
        // team. Merge with the server's CURRENT list, never just local state:
        // writing `[...teams, entry]` while the local list was transiently
        // empty overwrote the settings doc and orphaned existing teams.
        const userRef = doc(
          db,
          "artifacts",
          appId,
          "users",
          user.uid,
          "settings",
          "teams",
        );
        const nextEntry = { id: teamId, name: teamName };
        let serverTeams: TeamEntry[] | null = null;
        try {
          const settingsSnap = await getDoc(userRef);
          const data = settingsSnap.exists()
            ? (settingsSnap.data() as any)
            : null;
          serverTeams = Array.isArray(data?.teams) ? data.teams : null;
        } catch {
          // Settings read failed — fall back to merging with local state only.
        }
        const nextTeams = mergeTeamEntries(serverTeams, teams, [nextEntry]);
        await setDoc(
          userRef,
          { teams: nextTeams, activeTeamId: teamId },
          { merge: true },
        );

        switchTeam(teamId);
        toast.push({
          kind: "success",
          title: `Joined ${teamName}`,
          message:
            "You're set as an assistant coach. The head can promote you from Settings.",
        });
        return { ok: true };
      } catch (err: any) {
        // Log the underlying error so a coach reporting "I can't join" can
        // share a console snapshot — most join failures are silently caught
        // here and the toast was too vague to act on.
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.error("[joinTeamByCode] failed:", err);
        }
        const errCode = err?.code || "";
        const isPermission = errCode === "permission-denied";
        toast.push({
          kind: "error",
          title: "Couldn't join",
          message: isPermission
            ? "The team rejected the join. Make sure the code is current — the head can regenerate it from Settings."
            : "Couldn't reach the team. Check your connection and try again.",
        });
        return { ok: false, retryable: !isPermission };
      }
    },
    [user, teams, toast, switchTeam],
  );

  return {
    regenerateJoinCode,
    joinTeamByCode,
  };
};
