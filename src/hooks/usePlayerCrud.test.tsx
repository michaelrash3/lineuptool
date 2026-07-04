import { renderHook, act } from "@testing-library/react";
import { usePlayerCrud } from "./usePlayerCrud";
import { applyTeamOps, makeConfirm, makeToast } from "../test-utils";

const setup = (teamOver: any = {}) => {
  const updateTeamArrays = jest.fn();
  const toast = makeToast();
  const confirm = makeConfirm();
  const teamData = {
    players: [],
    games: [],
    evaluationEvents: [],
    ...teamOver,
  };
  const { result } = renderHook(() =>
    usePlayerCrud({ teamData, updateTeamArrays, toast, confirm }),
  );
  return { result, teamData, updateTeamArrays, toast, confirm };
};

describe("usePlayerCrud", () => {
  it("addPlayer emits an append (concurrency-safe) with defaults and returns the id", () => {
    const { result, updateTeamArrays } = setup();
    let id = "";
    act(() => {
      id = result.current.addPlayer({ name: " Ava " });
    });
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "players" });
    expect(op.entries).toHaveLength(1);
    expect(op.entries[0]).toMatchObject({
      id,
      name: "Ava",
      bats: "R",
      throws: "R",
      present: true,
    });
    expect(op.entries[0].pitching).toEqual({
      recentPitches: 0,
      lastPitchDate: null,
    });
  });

  it("updatePlayer merges shallow updates via mapEntries", () => {
    const { result, teamData, updateTeamArrays } = setup({
      players: [{ id: "p1", name: "Ava", number: "1" }],
    });
    act(() => result.current.updatePlayer("p1", { number: "9" }));
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "players" });
    expect(applyTeamOps(teamData, op).players[0]).toMatchObject({
      id: "p1",
      name: "Ava",
      number: "9",
    });
  });

  it("updatePlayerNested merges into a nested key", () => {
    const { result, teamData, updateTeamArrays } = setup({
      players: [
        {
          id: "p1",
          name: "Ava",
          pitching: { recentPitches: 0, lastPitchDate: null },
        },
      ],
    });
    act(() =>
      result.current.updatePlayerNested("p1", "pitching", {
        recentPitches: 30,
      }),
    );
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.players[0].pitching).toEqual({
      recentPitches: 30,
      lastPitchDate: null,
    });
  });

  describe("removePlayer", () => {
    const team = {
      players: [
        { id: "p1", name: "Ava" },
        { id: "p2", name: "Mia" },
      ],
      games: [
        {
          id: "g1",
          lineup: [{ P: { id: "p1" }, BENCH: [{ id: "p2" }] }],
          battingLineup: [{ id: "p1" }, { id: "p2" }],
          attendance: { p1: true, p2: false },
          pitchCounts: { p1: 20 },
        },
      ],
      evaluationEvents: [
        { id: "e1", grades: { p1: { hit: 3 }, p2: { hit: 4 } } },
      ],
    };

    it("does nothing when the confirm is declined", async () => {
      const { result, updateTeamArrays, confirm } = setup(team);
      confirm.mockResolvedValueOnce(false);
      await act(async () => result.current.removePlayer("p1"));
      expect(updateTeamArrays).not.toHaveBeenCalled();
    });

    it("emits ONE atomic op list: removeById + games/evals mapEntries", async () => {
      const { result, teamData, updateTeamArrays } = setup(team);
      await act(async () => result.current.removePlayer("p1"));
      expect(updateTeamArrays).toHaveBeenCalledTimes(1);
      const ops = updateTeamArrays.mock.calls[0][0];
      expect(ops.map((u: any) => [u.op, u.key])).toEqual([
        ["removeById", "players"],
        ["mapEntries", "games"],
        ["mapEntries", "evaluationEvents"],
      ]);
      const next = applyTeamOps(teamData, ops);
      expect(next.players.map((p: any) => p.id)).toEqual(["p2"]);
      expect(next.games[0].lineup[0].P).toBeNull();
      expect(next.games[0].battingLineup.map((p: any) => p.id)).toEqual(["p2"]);
      expect(next.games[0].attendance).toEqual({ p2: false });
      expect(next.games[0].pitchCounts).toEqual({});
      expect(next.evaluationEvents[0].grades).toEqual({ p2: { hit: 4 } });
    });

    it("Undo restores all three snapshots", async () => {
      const { result, teamData, updateTeamArrays, toast } = setup(team);
      await act(async () => result.current.removePlayer("p1"));
      const undo = (toast.push as jest.Mock).mock.calls[0][0].action;
      expect(undo.label).toBe("Undo");
      const afterDelete = applyTeamOps(
        teamData,
        updateTeamArrays.mock.calls[0][0],
      );
      act(() => undo.onClick());
      const restored = applyTeamOps(
        afterDelete,
        updateTeamArrays.mock.calls[1][0],
      );
      expect(restored.players.map((p: any) => p.id)).toEqual(["p1", "p2"]);
      // Restored games pass through the same slimming as any stored write.
      expect(restored.games[0].lineup[0].P).toMatchObject({ id: "p1" });
      expect(restored.evaluationEvents[0].grades.p1).toEqual({ hit: 3 });
    });
  });
});
