import { useCallback } from "react";

interface AuthUser {
  uid: string;
}

interface UseTeamMembershipArgs {
  teamData: {
    ownerId?: string;
    coachRoles?: Record<string, string>;
    members?: string[];
  } & Record<string, unknown>;
  updateTeam: (patch: Record<string, unknown>) => void;
  user: AuthUser | null | undefined;
}

export const useTeamMembership = ({
  teamData,
  updateTeam,
  user,
}: UseTeamMembershipArgs) => {
  const setCoachRole = useCallback(
    (uid: string, role: string) => {
      if (!uid || uid === teamData.ownerId) return;
      if (role !== "head" && role !== "assistant") return;
      const next = { ...(teamData.coachRoles || {}), [uid]: role };
      updateTeam({ coachRoles: next });
    },
    [teamData.coachRoles, teamData.ownerId, updateTeam]
  );

  const addCurrentUserToMembers = useCallback(() => {
    if (!user) return;
    const members = Array.isArray(teamData.members) ? teamData.members : [];
    const nextMembers = members.includes(user.uid)
      ? members
      : [...members, user.uid];
    updateTeam({ members: nextMembers });
  }, [user, teamData.members, updateTeam]);

  return { setCoachRole, addCurrentUserToMembers };
};
