import { useCallback } from "react";

export const useTeamMembership = ({ teamData, updateTeam, user }) => {
  const setCoachRole = useCallback(
    (uid, role) => {
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
