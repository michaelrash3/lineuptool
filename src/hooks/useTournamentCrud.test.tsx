import { renderHook, act } from "@testing-library/react";
import { useTournamentCrud } from "./useTournamentCrud";
import { applyTeamOps, makeConfirm, makeToast } from "../test-utils";

const setup = (teamOver: any = {}) => {
  const updateTeamArrays = jest.fn();
  const toast = makeToast();
  const confirm = makeConfirm();
  const teamData = {
    tournaments: [],
    games: [],
    players: [],
    ...teamOver,
  };
  const { result } = renderHook(() =>
    useTournamentCrud({ teamData, updateTeamArrays, toast, confirm }),
  );
  return { result, teamData, updateTeamArrays, toast, confirm };
};

describe("useTournamentCrud", () => {
  it("addTournament emits an append with a trimmed, clamped name and seedKey", () => {
    const { result, updateTeamArrays } = setup();
    act(() =>
      result.current.addTournament({
        name: `  ${"x".repeat(80)}  `,
        gameIds: ["g1", "g2"],
        seedKey: "tour-2026-06-06",
      }),
    );
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "tournaments" });
    expect(op.entries).toHaveLength(1);
    expect(op.entries[0].name).toBe("x".repeat(60));
    expect(op.entries[0].gameIds).toEqual(["g1", "g2"]);
    expect(op.entries[0].seedKey).toBe("tour-2026-06-06");
    expect(op.entries[0].id).toMatch(/^trn/);
  });

  it("addTournament warns and does not persist without a name or games", () => {
    const { result, updateTeamArrays, toast } = setup();
    act(() => result.current.addTournament({ name: "  ", gameIds: ["g1"] }));
    act(() => result.current.addTournament({ name: "Bash", gameIds: [] }));
    expect(updateTeamArrays).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledTimes(2);
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn" }),
    );
  });

  it("updateTournament renames via mapEntries and drops an emptied name", () => {
    const { result, teamData, updateTeamArrays } = setup({
      tournaments: [{ id: "t1", name: "Old", gameIds: ["g1"] }],
    });
    act(() => result.current.updateTournament("t1", { name: " New Name " }));
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.tournaments[0].name).toBe("New Name");

    updateTeamArrays.mockClear();
    act(() => result.current.updateTournament("t1", { name: "   " }));
    // Only key was an emptied name -> nothing to persist.
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("setPlannedOutings writes one game's plan and preserves the others", () => {
    const { result, teamData, updateTeamArrays } = setup({
      tournaments: [
        {
          id: "t1",
          name: "Bash",
          gameIds: ["g1", "g2"],
          pitchPlan: { g1: [{ playerId: "p9", role: "start" }] },
        },
      ],
    });
    act(() =>
      result.current.setPlannedOutings("t1", "g2", [
        { playerId: "p1", role: "start", plannedPitches: 70 },
        { playerId: "p2", role: "relief" },
      ]),
    );
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.tournaments[0].pitchPlan.g1).toEqual([
      { playerId: "p9", role: "start" },
    ]);
    expect(next.tournaments[0].pitchPlan.g2).toHaveLength(2);
    expect(next.tournaments[0].pitchPlan.g2[0]).toMatchObject({
      playerId: "p1",
      plannedPitches: 70,
    });
  });

  it("setPlannedOutings with an empty list removes the game's key (and an empty map)", () => {
    const { result, teamData, updateTeamArrays } = setup({
      tournaments: [
        {
          id: "t1",
          name: "Bash",
          gameIds: ["g1"],
          pitchPlan: { g1: [{ playerId: "p9", role: "start" }] },
        },
      ],
    });
    act(() => result.current.setPlannedOutings("t1", "g1", []));
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.tournaments[0].pitchPlan).toBeUndefined();
  });

  it("removeTournament confirms, removes by id, and Undo restores the snapshot", async () => {
    const tournaments = [{ id: "t1", name: "Bash", gameIds: ["g1"] }];
    const { result, updateTeamArrays, toast } = setup({ tournaments });
    await act(async () => {
      await result.current.removeTournament("t1");
    });
    expect(updateTeamArrays).toHaveBeenCalledWith({
      op: "removeById",
      key: "tournaments",
      id: "t1",
    });
    const toastArg = (toast.push as jest.Mock).mock.calls[0][0];
    expect(toastArg.action.label).toBe("Undo");
    updateTeamArrays.mockClear();
    toastArg.action.onClick();
    const restored = applyTeamOps(
      { tournaments: [] },
      updateTeamArrays.mock.calls[0][0],
    );
    expect(restored.tournaments).toEqual(tournaments);
  });

  it("removeTournament does nothing when the confirm is declined", async () => {
    const { result, updateTeamArrays, confirm } = setup({
      tournaments: [{ id: "t1", name: "Bash", gameIds: [] }],
    });
    (confirm as jest.Mock).mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.removeTournament("t1");
    });
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });
});
