import { renderHook, act } from "@testing-library/react";
import { useTeamMembership } from "./useTeamMembership";

// Auth-critical membership/role mutations. These guard the head-coach takeover
// and self-join paths whose server-side counterparts live in firestore.rules,
// so the client guards here must stay in lockstep.

const setup = (
  teamData: Record<string, unknown> = {},
  user: { uid: string } | null = { uid: "u1" },
) => {
  const updateTeam = jest.fn();
  const { result } = renderHook(() =>
    useTeamMembership({
      teamDataRef: { current: teamData as any },
      updateTeam,
      user,
    }),
  );
  return { updateTeam, result };
};

describe("setCoachRole", () => {
  it("sets a valid role for a non-owner, merging existing roles", () => {
    const { updateTeam, result } = setup({
      ownerId: "owner",
      coachRoles: { existing: "assistant" },
    });
    act(() => result.current.setCoachRole("u2", "head"));
    expect(updateTeam).toHaveBeenCalledWith({
      coachRoles: { existing: "assistant", u2: "head" },
    });
  });

  it("refuses to change the owner's role", () => {
    const { updateTeam, result } = setup({ ownerId: "owner" });
    act(() => result.current.setCoachRole("owner", "assistant"));
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("ignores empty uid and bogus roles (no privilege smuggling)", () => {
    const { updateTeam, result } = setup({ ownerId: "owner" });
    act(() => result.current.setCoachRole("", "head"));
    act(() => result.current.setCoachRole("u2", "superadmin"));
    expect(updateTeam).not.toHaveBeenCalled();
  });
});

describe("addCurrentUserToMembers", () => {
  it("appends the current user when not already a member", () => {
    const { updateTeam, result } = setup({ members: ["a"] }, { uid: "u1" });
    act(() => result.current.addCurrentUserToMembers());
    expect(updateTeam).toHaveBeenCalledWith({ members: ["a", "u1"] });
  });

  it("does not duplicate an existing member", () => {
    const { updateTeam, result } = setup({ members: ["u1"] }, { uid: "u1" });
    act(() => result.current.addCurrentUserToMembers());
    expect(updateTeam).toHaveBeenCalledWith({ members: ["u1"] });
  });

  it("no-ops when there is no signed-in user", () => {
    const { updateTeam, result } = setup({ members: [] }, null);
    act(() => result.current.addCurrentUserToMembers());
    expect(updateTeam).not.toHaveBeenCalled();
  });
});
