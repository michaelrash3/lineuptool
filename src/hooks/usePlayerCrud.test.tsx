import { renderHook, act } from "@testing-library/react";
import { usePlayerCrud } from "./usePlayerCrud";
import { makeConfirm, makeToast } from "../test-utils";

const setup = (teamOver: any = {}) => {
  const updateTeam = jest.fn();
  const toast = makeToast();
  const confirm = makeConfirm();
  const teamData = {
    players: [],
    games: [],
    evaluationEvents: [],
    ...teamOver,
  };
  const { result } = renderHook(() =>
    usePlayerCrud({ teamData, updateTeam, toast, confirm }),
  );
  return { result, updateTeam, toast, confirm };
};

describe("usePlayerCrud", () => {
  it("addPlayer appends a player with defaults and returns the id", () => {
    const { result, updateTeam } = setup();
    let id = "";
    act(() => {
      id = result.current.addPlayer({ name: " Ava " });
    });
    const players = updateTeam.mock.calls[0][0].players;
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({
      id,
      name: "Ava",
      bats: "R",
      throws: "R",
      present: true,
    });
    expect(players[0].pitching).toEqual({
      recentPitches: 0,
      lastPitchDate: null,
    });
  });

  it("updatePlayer merges shallow updates", () => {
    const { result, updateTeam } = setup({
      players: [{ id: "p1", name: "Ava", number: "1" }],
    });
    act(() => result.current.updatePlayer("p1", { number: "9" }));
    expect(updateTeam.mock.calls[0][0].players[0]).toMatchObject({
      id: "p1",
      name: "Ava",
      number: "9",
    });
  });

  it("updatePlayerNested merges into a nested key", () => {
    const { result, updateTeam } = setup({
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
    expect(updateTeam.mock.calls[0][0].players[0].pitching).toEqual({
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
      const { result, updateTeam, confirm } = setup(team);
      confirm.mockResolvedValueOnce(false);
      await act(async () => result.current.removePlayer("p1"));
      expect(updateTeam).not.toHaveBeenCalled();
    });

    it("strips the player from roster, lineups, attendance, pitch counts, and evals", async () => {
      const { result, updateTeam, toast } = setup(team);
      await act(async () => result.current.removePlayer("p1"));
      const patch = updateTeam.mock.calls[0][0];
      expect(patch.players.map((p: any) => p.id)).toEqual(["p2"]);
      expect(patch.games[0].lineup[0].P).toBeNull();
      expect(patch.games[0].battingLineup.map((p: any) => p.id)).toEqual([
        "p2",
      ]);
      expect(patch.games[0].attendance).toEqual({ p2: false });
      expect(patch.games[0].pitchCounts).toEqual({});
      expect(patch.evaluationEvents[0].grades).toEqual({ p2: { hit: 4 } });
      // Undo restores all snapshots.
      const undo = (toast.push as jest.Mock).mock.calls[0][0].action;
      expect(undo.label).toBe("Undo");
    });
  });
});
