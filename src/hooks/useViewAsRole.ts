import { useCallback, useMemo, useState } from "react";

interface AuthUser {
  uid: string;
}

interface UseViewAsRoleArgs {
  teamData: {
    ownerId?: string;
    coachRoles?: Record<string, string>;
    members?: string[];
  } & Record<string, unknown>;
  user: AuthUser | null | undefined;
}

// The "view as" role override (a head coach previewing the assistant UI) plus
// the derived real / resolved / current role. Extracted verbatim from
// TeamProvider — the visible-role logic is unchanged. viewAsRole lives in
// sessionStorage only (never Firestore, never other tabs) and resets to null
// on a fresh browser session by design.
export const useViewAsRole = ({ teamData, user }: UseViewAsRoleArgs) => {
  const [viewAsRole, setViewAsRoleState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = window.sessionStorage.getItem("lineuptool.viewAsRole");
      return v === "assistant" ? "assistant" : null;
    } catch {
      return null;
    }
  });
  const setViewAsRole = useCallback((next: string | null) => {
    setViewAsRoleState(next);
    try {
      if (next) window.sessionStorage.setItem("lineuptool.viewAsRole", next);
      else window.sessionStorage.removeItem("lineuptool.viewAsRole");
    } catch {
      /* ignore */
    }
  }, []);

  // Derive the current user's REAL role on the active team — separate from
  // currentRole so the override toggle UI can render even when the visible
  // role has been flipped to "assistant".
  //   - ownerId === user.uid  → head (definitive)
  //   - coachRoles[uid] === "head" | "assistant" → that role
  //   - missing ownerId AND user is the sole member → head (legacy unclaimed
  //     team this user is migrating); the sole-member gate closes the old
  //     "missing ownerId → head" hole once anyone else is in members[].
  //   - everything else → assistant
  const realRole = useMemo<"head" | "assistant">(() => {
    if (!user) return "head";
    if (user.uid === teamData.ownerId) return "head";
    const explicit = teamData.coachRoles?.[user.uid];
    if (explicit === "head") return "head";
    if (explicit === "assistant") return "assistant";
    if (!teamData.ownerId) {
      const members = Array.isArray(teamData.members) ? teamData.members : [];
      const others = members.filter((uid: string) => uid && uid !== user?.uid);
      if (others.length === 0) return "head";
    }
    return "assistant";
  }, [user, teamData.ownerId, teamData.coachRoles, teamData.members]);

  // True only when teamData carries enough signal for realRole to be
  // trustworthy. During the window between login and the first team snapshot,
  // teamData is the empty DEFAULT_TEAM_DATA and realRole falls through to
  // "head" via the legacy sole-member claim path; gating role-sensitive routes
  // on this flag keeps them in a loader until the role lands.
  const roleResolved = useMemo(() => {
    if (!user) return false;
    return Boolean(
      teamData.ownerId ||
      (teamData.coachRoles && Object.keys(teamData.coachRoles).length > 0) ||
      (Array.isArray(teamData.members) && teamData.members.length > 0),
    );
  }, [user, teamData.ownerId, teamData.coachRoles, teamData.members]);

  // Visible role for the rest of the app. Only the head coach can flip
  // themselves to assistant; assistants can never escalate.
  const currentRole = useMemo<"head" | "assistant">(() => {
    if (realRole === "head" && viewAsRole === "assistant") return "assistant";
    return realRole;
  }, [realRole, viewAsRole]);

  return { viewAsRole, setViewAsRole, realRole, roleResolved, currentRole };
};
