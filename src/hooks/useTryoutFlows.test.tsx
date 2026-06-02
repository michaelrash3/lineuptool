import { renderHook, act } from "@testing-library/react";
import { useTryoutFlows } from "./useTryoutFlows";
import { makeToast } from "../test-utils";

const setup = (teamOver: any = {}, user: any = { uid: "u1" }) => {
  const updateTeam = jest.fn();
  const toast = makeToast();
  const teamData = {
    tryoutSignups: [],
    interestSignups: [],
    evaluationEvents: [],
    players: [],
    tryoutDates: [],
    ...teamOver,
  };
  const { result } = renderHook(() =>
    useTryoutFlows({ teamData, updateTeam, toast, user, activeTeamId: "team-1" })
  );
  return { result, updateTeam, toast };
};

describe("useTryoutFlows", () => {
  it("generateTryoutShareId opens tryouts and returns an id", () => {
    const { result, updateTeam } = setup();
    let id = "";
    act(() => { id = result.current.generateTryoutShareId(); });
    expect(id).toBeTruthy();
    expect(updateTeam).toHaveBeenCalledWith(
      expect.objectContaining({ tryoutShareId: id, tryoutsOpen: true, tryoutsPhase: "open" })
    );
  });

  it("setTryoutsOpen / completeTryouts toggle phase", () => {
    const { result, updateTeam } = setup();
    act(() => result.current.setTryoutsOpen(false));
    expect(updateTeam).toHaveBeenCalledWith({ tryoutsOpen: false, tryoutsPhase: "intake_closed" });
    act(() => result.current.completeTryouts());
    expect(updateTeam).toHaveBeenLastCalledWith({ tryoutsOpen: false, tryoutsPhase: "completed" });
  });

  it("updateTryoutSignup patches the matching signup", () => {
    const { result, updateTeam } = setup({ tryoutSignups: [{ id: "s1", status: "tryout" }] });
    act(() => result.current.updateTryoutSignup("s1", { status: "reviewed" }));
    expect(updateTeam.mock.calls[0][0].tryoutSignups[0]).toMatchObject({ id: "s1", status: "reviewed" });
  });

  it("acceptTryout adds an accepted player and flips signup status", () => {
    const { result, updateTeam, toast } = setup({
      tryoutSignups: [{ id: "s1", firstName: "Ava", lastName: "Rivera", isCatcher: true }],
    });
    act(() => result.current.acceptTryout("s1"));
    const patch = updateTeam.mock.calls[0][0];
    expect(patch.tryoutSignups[0].status).toBe("accepted");
    expect(patch.players[0]).toMatchObject({ name: "Ava Rivera", playerStatus: "accepted" });
    expect(patch.players[0].comfortablePositions).toContain("C");
    expect(toast.push).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
  });

  it("saveTryoutEvaluation records a tryout eval event", () => {
    const { result, updateTeam } = setup();
    act(() => result.current.saveTryoutEvaluation("s1", { fielding: 4 }, "Head"));
    const ev = updateTeam.mock.calls[0][0].evaluationEvents[0];
    expect(ev).toMatchObject({ tryoutSignupId: "s1", evaluatorId: "u1", coachRole: "Head" });
    expect(ev.grades.signup).toEqual({ fielding: 4 });
  });

  it("convertInterestToTryout moves a lead into tryoutSignups", () => {
    const { result, updateTeam } = setup({
      interestSignups: [{ id: "i1", firstName: "Mia", lastName: "Stone" }],
    });
    act(() => result.current.convertInterestToTryout("i1"));
    const patch = updateTeam.mock.calls[0][0];
    expect(patch.interestSignups).toEqual([]);
    expect(patch.tryoutSignups[0]).toMatchObject({ firstName: "Mia", lastName: "Stone" });
  });
});
