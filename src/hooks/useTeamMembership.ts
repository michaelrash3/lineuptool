import { useCallback } from "react";
import { genId } from "../utils/helpers";

interface AuthUser {
  uid: string;
}

interface Coach {
  id: string;
  name?: string;
  role?: string;
}

interface UseTeamMembershipArgs {
  // Ref to the live team doc — callbacks read teamDataRef.current at call time
  // so they keep a stable identity across Firestore snapshots (same pattern as
  // updateTeam in TeamProvider).
  teamDataRef: React.MutableRefObject<
    {
      ownerId?: string;
      coachRoles?: Record<string, string>;
      members?: string[];
      coaches: Coach[];
    } & Record<string, unknown>
  >;
  updateTeam: (patch: Record<string, unknown>) => void;
  user: AuthUser | null | undefined;
}

export const useTeamMembership = ({
  teamDataRef,
  updateTeam,
  user,
}: UseTeamMembershipArgs) => {
  const setCoachRole = useCallback(
    (uid: string, role: string) => {
      const teamData = teamDataRef.current;
      if (!uid || uid === teamData.ownerId) return;
      if (role !== "head" && role !== "assistant") return;
      const next = { ...(teamData.coachRoles || {}), [uid]: role };
      updateTeam({ coachRoles: next });
    },
    [teamDataRef, updateTeam],
  );

  const addCurrentUserToMembers = useCallback(() => {
    if (!user) return;
    const teamData = teamDataRef.current;
    const members = Array.isArray(teamData.members) ? teamData.members : [];
    const nextMembers = members.includes(user.uid)
      ? members
      : [...members, user.uid];
    updateTeam({ members: nextMembers });
  }, [user, teamDataRef, updateTeam]);

  const addCoach = useCallback(
    (form: { name: string; role: string }) => {
      if (!form.name.trim()) return;
      const newCoach = {
        id: genId("c"),
        name: form.name.trim(),
        role: form.role,
      };
      updateTeam({ coaches: [...teamDataRef.current.coaches, newCoach] });
    },
    [teamDataRef, updateTeam],
  );

  const removeCoach = useCallback(
    (id: string) => {
      updateTeam({
        coaches: teamDataRef.current.coaches.filter((c: Coach) => c.id !== id),
      });
    },
    [teamDataRef, updateTeam],
  );

  return {
    setCoachRole,
    addCurrentUserToMembers,
    addCoach,
    removeCoach,
  };
};
