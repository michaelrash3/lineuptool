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
    useTryoutFlows({
      teamData,
      updateTeam,
      toast,
      user,
      activeTeamId: "team-1",
    }),
  );
  return { result, updateTeam, toast };
};

describe("useTryoutFlows", () => {
  it("generateTryoutShareId opens tryouts and returns an id", () => {
    const { result, updateTeam } = setup();
    let id = "";
    act(() => {
      id = result.current.generateTryoutShareId();
    });
    expect(id).toBeTruthy();
    expect(updateTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        tryoutShareId: id,
        tryoutsOpen: true,
        tryoutsPhase: "open",
      }),
    );
  });

  it("generateTryoutDateLink pins each generated slug to its own date", () => {
    // First date.
    const { result, updateTeam } = setup({
      tryoutDates: [],
      tryoutDateLinks: [],
    });
    let slugA = "";
    act(() => {
      slugA = result.current.generateTryoutDateLink("2026-04-10")!;
    });
    const patchA = updateTeam.mock.calls[0][0];
    expect(slugA).toContain("2026-04-10");
    expect(patchA.tryoutDateSlug).toBe(slugA);
    expect(patchA.tryoutDates).toEqual(["2026-04-10"]);
    expect(patchA.tryoutDateLinks).toEqual([
      { slug: slugA, date: "2026-04-10" },
    ]);

    // Second date on a team that already carries the first link — the mapping
    // must ACCUMULATE so the first slug keeps resolving to its original date.
    const { result: r2, updateTeam: u2 } = setup({
      tryoutDates: ["2026-04-10"],
      tryoutDateLinks: [{ slug: slugA, date: "2026-04-10" }],
    });
    let slugB = "";
    act(() => {
      slugB = r2.current.generateTryoutDateLink("2026-05-22")!;
    });
    const patchB = u2.mock.calls[0][0];
    expect(slugB).not.toBe(slugA);
    expect(patchB.tryoutDates).toEqual(["2026-04-10", "2026-05-22"]);
    expect(patchB.tryoutDateLinks).toEqual([
      { slug: slugA, date: "2026-04-10" },
      { slug: slugB, date: "2026-05-22" },
    ]);
  });

  it("setTryoutsOpen / completeTryouts toggle phase", () => {
    const { result, updateTeam } = setup();
    act(() => result.current.setTryoutsOpen(false));
    expect(updateTeam).toHaveBeenCalledWith({
      tryoutsOpen: false,
      tryoutsPhase: "intake_closed",
    });
    act(() => result.current.completeTryouts());
    expect(updateTeam).toHaveBeenLastCalledWith({
      tryoutsOpen: false,
      tryoutsPhase: "completed",
    });
  });

  it("updateTryoutSignup patches the matching signup", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "s1", status: "tryout" }],
    });
    act(() => result.current.updateTryoutSignup("s1", { status: "reviewed" }));
    expect(updateTeam.mock.calls[0][0].tryoutSignups[0]).toMatchObject({
      id: "s1",
      status: "reviewed",
    });
  });

  it("acceptTryout (default) holds the signup for next season without adding a player", () => {
    const { result, updateTeam, toast } = setup({
      tryoutSignups: [
        { id: "s1", firstName: "Ava", lastName: "Rivera", isCatcher: true },
      ],
    });
    act(() => result.current.acceptTryout("s1"));
    const patch = updateTeam.mock.calls[0][0];
    expect(patch.tryoutSignups[0].status).toBe("accepted");
    // No current-season player is created — they join on Advance Season.
    expect(patch.players).toBeUndefined();
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" }),
    );
  });

  it("acceptTryout('current') pulls the player onto the current roster and consumes the signup", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [
        { id: "s1", firstName: "Ava", lastName: "Rivera", isCatcher: true },
      ],
      players: [],
    });
    act(() => result.current.acceptTryout("s1", "current"));
    const patch = updateTeam.mock.calls[0][0];
    // Signup is removed (they're a roster player now, not a tryout).
    expect(patch.tryoutSignups).toEqual([]);
    expect(patch.players[0]).toMatchObject({
      name: "Ava Rivera",
      playerStatus: "returning",
    });
    expect(patch.players[0].comfortablePositions).toContain("C");
  });

  it("saveTryoutEvaluation records a date-grouped tryout session", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [
        { id: "s1", tryoutDate: "2026-06-18" },
        { id: "s2", tryoutDate: "2026-06-18" },
      ],
    });
    act(() =>
      result.current.saveTryoutEvaluation("s1", { fielding: 4 }, "Head"),
    );
    const session = updateTeam.mock.calls[0][0].tryoutSessions[0];
    expect(session).toMatchObject({
      id: "tryout-2026-06-18",
      date: "2026-06-18",
    });
    expect(session.gradesByEvaluator.u1).toMatchObject({
      evaluatorId: "u1",
      coachRole: "Head",
    });
    expect(session.gradesByEvaluator.u1.grades.s1).toEqual({ fielding: 4 });
  });

  it("saveTryoutEvaluations saves multiple kids into one date session in one write", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [
        { id: "s1", tryoutDate: "2026-06-18" },
        { id: "s2", tryoutDate: "2026-06-18" },
      ],
    });
    act(() =>
      result.current.saveTryoutEvaluations(
        [
          { signupId: "s1", date: "2026-06-18", grades: { fielding: 4 } },
          { signupId: "s2", date: "2026-06-18", grades: { fielding: 5 } },
        ],
        "Head",
      ),
    );
    expect(updateTeam).toHaveBeenCalledTimes(1);
    const session = updateTeam.mock.calls[0][0].tryoutSessions[0];
    expect(session.signupIds).toEqual(["s1", "s2"]);
    expect(session.gradesByEvaluator.u1.grades).toMatchObject({
      s1: { fielding: 4 },
      s2: { fielding: 5 },
    });
  });

  it("convertInterestToTryout moves a lead into tryoutSignups", () => {
    const { result, updateTeam } = setup({
      interestSignups: [{ id: "i1", firstName: "Mia", lastName: "Stone" }],
    });
    act(() => result.current.convertInterestToTryout("i1"));
    const patch = updateTeam.mock.calls[0][0];
    expect(patch.interestSignups).toEqual([]);
    expect(patch.tryoutSignups[0]).toMatchObject({
      firstName: "Mia",
      lastName: "Stone",
    });
  });

  it("deleteTryoutSignup removes a single signup", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    act(() => result.current.deleteTryoutSignup("b"));
    expect(updateTeam).toHaveBeenCalledWith({
      tryoutSignups: [{ id: "a" }, { id: "c" }],
    });
  });

  it("deleteTryoutSignups removes ALL given ids in a single write", () => {
    // Regression guard: looping deleteTryoutSignup over no-shows only removed
    // the last one (each call filtered the same stale array, and the optimistic
    // merge kept the last write). The bulk helper must drop every id at once.
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    });
    let removed = 0;
    act(() => {
      removed = result.current.deleteTryoutSignups(["b", "d"]);
    });
    expect(removed).toBe(2);
    expect(updateTeam).toHaveBeenCalledTimes(1);
    expect(updateTeam).toHaveBeenCalledWith({
      tryoutSignups: [{ id: "a" }, { id: "c" }],
    });
  });

  it("deleteTryoutSignups is a no-op (no write) when nothing matches", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "a" }],
    });
    let removed = -1;
    act(() => {
      removed = result.current.deleteTryoutSignups(["zzz"]);
    });
    expect(removed).toBe(0);
    expect(updateTeam).not.toHaveBeenCalled();
  });
});
