import { renderHook, act } from "@testing-library/react";
import { useGameCrud } from "./useGameCrud";
import { makeToast } from "../test-utils";

const setup = (teamOver: any = {}) => {
  const updateTeam = jest.fn();
  const toast = makeToast();
  const teamData = {
    games: [],
    players: [],
    defenseSize: 9,
    battingSize: 10,
    positionLock: false,
    ...teamOver,
  };
  const { result } = renderHook(() =>
    useGameCrud({ teamData, updateTeam, toast })
  );
  return { result, updateTeam, toast };
};

describe("useGameCrud", () => {
  it("addGame appends a scheduled game", () => {
    const { result, updateTeam } = setup();
    act(() => result.current.addGame({ date: "2026-05-01", opponent: " Rays ", leagueRuleSet: "USSSA", pitchingFormat: "Kid Pitch" }));
    const games = updateTeam.mock.calls[0][0].games;
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ date: "2026-05-01", opponent: "Rays", status: "scheduled" });
  });

  it("addGame warns and does not persist when date/opponent missing", () => {
    const { result, updateTeam, toast } = setup();
    act(() => result.current.addGame({ date: "", opponent: "", leagueRuleSet: "USSSA", pitchingFormat: "Kid Pitch" }));
    expect(updateTeam).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledWith(expect.objectContaining({ kind: "warn" }));
  });

  it("updateGame normalizes a slash date and drops an unparseable one", () => {
    const { result, updateTeam } = setup({ games: [{ id: "g1", date: "2026-05-01" }] });
    act(() => result.current.updateGame("g1", { date: "05/08/2026" }));
    expect(updateTeam.mock.calls[0][0].games[0].date).toBe("2026-05-08");

    updateTeam.mockClear();
    act(() => result.current.updateGame("g1", { date: "garbage" }));
    // Only key was a bad date -> nothing to persist.
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("finalizeGame sets score and final status", () => {
    const { result, updateTeam } = setup({ games: [{ id: "g1", date: "2026-05-01", lineup: null }] });
    act(() => result.current.finalizeGame("g1", 5, 3, 6));
    const games = updateTeam.mock.calls[0][0].games;
    expect(games[0]).toMatchObject({ teamScore: 5, opponentScore: 3, status: "final" });
  });

  it("finalizeGame commits entered pitch counts onto the pitcher record", () => {
    const { result, updateTeam } = setup({
      games: [{ id: "g1", date: "2026-05-01", lineup: null, pitchCounts: { p1: 40 } }],
      players: [{ id: "p1", name: "Ace", pitching: { recentPitches: 0, lastPitchDate: null } }],
    });
    act(() => result.current.finalizeGame("g1", 1, 0, 6));
    const patch = updateTeam.mock.calls[0][0];
    expect(patch.players[0].pitching).toEqual({ recentPitches: 40, lastPitchDate: "2026-05-01" });
  });

  it("postponeGame clears scores and marks postponed", () => {
    const { result, updateTeam } = setup({ games: [{ id: "g1", date: "2026-05-01", teamScore: 2, opponentScore: 1 }] });
    act(() => result.current.postponeGame("g1"));
    const games = updateTeam.mock.calls[0][0].games;
    expect(games[0]).toMatchObject({ status: "postponed", teamScore: null, opponentScore: null });
  });

  it("deleteSavedGame removes the game and offers undo, gated by confirm", () => {
    const { result, updateTeam, toast } = setup({ games: [{ id: "g1", opponent: "Rays" }] });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    act(() => result.current.deleteSavedGame("g1"));
    expect(updateTeam).not.toHaveBeenCalled(); // declined

    confirmSpy.mockReturnValue(true);
    act(() => result.current.deleteSavedGame("g1"));
    expect(updateTeam.mock.calls[0][0].games).toEqual([]);
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Game deleted", action: expect.objectContaining({ label: "Undo" }) })
    );
    confirmSpy.mockRestore();
  });
});
