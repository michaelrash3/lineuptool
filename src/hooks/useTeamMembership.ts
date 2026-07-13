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
  teamData: {
    ownerId?: string;
    coachRoles?: Record<string, string>;
    members?: string[];
    coaches: Coach[];
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
    [teamData.coachRoles, teamData.ownerId, updateTeam],
  );

  const addCurrentUserToMembers = useCallback(() => {
    if (!user) return;
    const members = Array.isArray(teamData.members) ? teamData.members : [];
    const nextMembers = members.includes(user.uid)
      ? members
      : [...members, user.uid];
    updateTeam({ members: nextMembers });
  }, [user, teamData.members, updateTeam]);

  const addCoach = useCallback(
    (form: { name: string; role: string }) => {
      if (!form.name.trim()) return;
      const newCoach = {
        id: genId("c"),
        name: form.name.trim(),
        role: form.role,
      };
      updateTeam({ coaches: [...teamData.coaches, newCoach] });
    },
    [teamData.coaches, updateTeam],
  );

  const removeCoach = useCallback(
    (id: string) => {
      updateTeam({
        coaches: teamData.coaches.filter((c: Coach) => c.id !== id),
      });
    },
    [teamData.coaches, updateTeam],
  );

  return {
    setCoachRole,
    addCurrentUserToMembers,
    addCoach,
    removeCoach,
  };
};
