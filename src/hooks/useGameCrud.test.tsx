import { renderHook, act } from "@testing-library/react";
import { useGameCrud } from "./useGameCrud";
import { applyTeamOps, makeConfirm, makeToast } from "../test-utils";

const setup = (teamOver: any = {}) => {
  const updateTeamArrays = jest.fn();
  const toast = makeToast();
  const confirm = makeConfirm();
  const teamData = {
    games: [],
    players: [],
    defenseSize: 9,
    battingSize: 10,
    positionLock: false,
    ...teamOver,
  };
  const { result } = renderHook(() =>
    useGameCrud({ teamData, updateTeamArrays, toast, confirm }),
  );
  return { result, teamData, updateTeamArrays, toast, confirm };
};

describe("useGameCrud", () => {
  it("addGame emits an append (concurrency-safe) with a scheduled game", () => {
    const { result, updateTeamArrays } = setup();
    act(() =>
      result.current.addGame({
        date: "2026-05-01",
        opponent: " Rays ",
        leagueRuleSet: "USSSA",
        pitchingFormat: "Kid Pitch",
      }),
    );
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "games" });
    expect(op.entries).toHaveLength(1);
    expect(op.entries[0]).toMatchObject({
      date: "2026-05-01",
      opponent: "Rays",
      status: "scheduled",
    });
  });

  it("addGame warns and does not persist when date/opponent missing", () => {
    const { result, updateTeamArrays, toast } = setup();
    act(() =>
      result.current.addGame({
        date: "",
        opponent: "",
        leagueRuleSet: "USSSA",
        pitchingFormat: "Kid Pitch",
      }),
    );
    expect(updateTeamArrays).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn" }),
    );
  });

  it("updateGame normalizes a slash date and drops an unparseable one", () => {
    const { result, teamData, updateTeamArrays } = setup({
      games: [{ id: "g1", date: "2026-05-01" }],
    });
    act(() => result.current.updateGame("g1", { date: "05/08/2026" }));
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.games[0].date).toBe("2026-05-08");

    updateTeamArrays.mockClear();
    act(() => result.current.updateGame("g1", { date: "garbage" }));
    // Only key was a bad date -> nothing to persist.
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("finalizeGame sets score and final status", () => {
    const { result, teamData, updateTeamArrays } = setup({
      games: [{ id: "g1", date: "2026-05-01", lineup: null }],
    });
    act(() => result.current.finalizeGame("g1", 5, 3, 6));
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.games[0]).toMatchObject({
      teamScore: 5,
      opponentScore: 3,
      status: "final",
    });
  });

  it("finalizeGame no longer touches pitcher records (arm-care comes from imports)", () => {
    const { result, updateTeamArrays } = setup({
      games: [
        { id: "g1", date: "2026-05-01", lineup: null, pitchCounts: { p1: 40 } },
      ],
      players: [
        {
          id: "p1",
          name: "Ace",
          pitching: { recentPitches: 0, lastPitchDate: null },
        },
      ],
    });
    act(() => result.current.finalizeGame("g1", 1, 0, 6));
    // Finalize writes only the game (score/status); pitching is committed at
    // stats-import time, so no players op is produced here.
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "games" });
  });

  it("postponeGame clears scores and marks postponed", () => {
    const { result, teamData, updateTeamArrays } = setup({
      games: [{ id: "g1", date: "2026-05-01", teamScore: 2, opponentScore: 1 }],
    });
    act(() => result.current.postponeGame("g1"));
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.games[0]).toMatchObject({
      status: "postponed",
      teamScore: null,
      opponentScore: null,
    });
  });

  it("deleteSavedGame emits removeById and offers undo, gated by confirm", async () => {
    const { result, updateTeamArrays, toast, confirm } = setup({
      games: [{ id: "g1", opponent: "Rays" }],
    });
    confirm.mockResolvedValueOnce(false);
    await act(async () => result.current.deleteSavedGame("g1"));
    expect(updateTeamArrays).not.toHaveBeenCalled(); // declined

    await act(async () => result.current.deleteSavedGame("g1"));
    expect(updateTeamArrays.mock.calls[0][0]).toEqual({
      op: "removeById",
      key: "games",
      id: "g1",
    });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Game deleted",
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
    // Undo restores the captured snapshot.
    const undo = (toast.push as jest.Mock).mock.calls[0][0].action;
    act(() => undo.onClick());
    const restored = applyTeamOps(
      { games: [] },
      updateTeamArrays.mock.calls[1][0],
    );
    expect(restored.games.map((g: any) => g.id)).toEqual(["g1"]);
  });

  it("deleteSavedGame strips the game from tournaments in the same write, and Undo restores both", async () => {
    const tournaments = [
      {
        id: "t1",
        name: "Bash",
        gameIds: ["g1", "g2"],
        pitchPlan: {
          g1: [{ playerId: "p1", role: "start" }],
          g2: [{ playerId: "p2", role: "start" }],
        },
      },
    ];
    const { result, teamData, updateTeamArrays, toast } = setup({
      games: [
        { id: "g1", opponent: "Rays" },
        { id: "g2", opponent: "Cubs" },
      ],
      tournaments,
    });
    await act(async () => result.current.deleteSavedGame("g1"));
    // One call carrying BOTH ops (atomic multi-array cascade).
    const ops = updateTeamArrays.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(2);
    const next = applyTeamOps(teamData, ops);
    expect(next.games.map((g: any) => g.id)).toEqual(["g2"]);
    expect(next.tournaments[0].gameIds).toEqual(["g2"]);
    expect(next.tournaments[0].pitchPlan).toEqual({
      g2: [{ playerId: "p2", role: "start" }],
    });

    // Undo restores games AND tournaments to their pre-delete snapshots.
    const undo = (toast.push as jest.Mock).mock.calls[0][0].action;
    act(() => undo.onClick());
    const restored = applyTeamOps(
      { games: [], tournaments: [] },
      updateTeamArrays.mock.calls[1][0],
    );
    expect(restored.games.map((g: any) => g.id)).toEqual(["g1", "g2"]);
    expect(restored.tournaments).toEqual(tournaments);
  });
});
