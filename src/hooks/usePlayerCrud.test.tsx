import { vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { updateDoc } from "firebase/firestore";
import { usePlayerCrud } from "./usePlayerCrud";
import { makeToast } from "../test-utils";

// removePlayer may strip grades from subcollection eval docs, so the hook
// imports firebase. Stub it; encode doc paths for assertions.
vi.mock("../firebase", () => ({ appId: "app", db: {} }));
vi.mock("../utils/errorReporter", () => ({ reportError: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: any, ...path: string[]) => ({ path: path.join("/") })),
  updateDoc: vi.fn(() => Promise.resolve()),
}));

const mockUpdateDoc = updateDoc as unknown as ReturnType<typeof vi.fn>;

const setup = (teamOver: any = {}) => {
  const updateTeam = jest.fn();
  const toast = makeToast();
  const teamData = { players: [], games: [], evaluationEvents: [], ...teamOver };
  const { result } = renderHook(() =>
    usePlayerCrud({ teamData, updateTeam, toast, activeTeamId: "team-1" })
  );
  return { result, updateTeam, toast };
};

beforeEach(() => {
  mockUpdateDoc.mockClear();
});

describe("usePlayerCrud", () => {
  it("addPlayer appends a player with defaults and returns the id", () => {
    const { result, updateTeam } = setup();
    let id = "";
    act(() => {
      id = result.current.addPlayer({ name: " Ava " });
    });
    const players = updateTeam.mock.calls[0][0].players;
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ id, name: "Ava", bats: "R", throws: "R", present: true });
    expect(players[0].pitching).toEqual({ recentPitches: 0, lastPitchDate: null });
  });

  it("updatePlayer merges shallow updates", () => {
    const { result, updateTeam } = setup({ players: [{ id: "p1", name: "Ava", number: "1" }] });
    act(() => result.current.updatePlayer("p1", { number: "9" }));
    expect(updateTeam.mock.calls[0][0].players[0]).toMatchObject({ id: "p1", name: "Ava", number: "9" });
  });

  it("updatePlayerNested merges into a nested key", () => {
    const { result, updateTeam } = setup({
      players: [{ id: "p1", name: "Ava", pitching: { recentPitches: 0, lastPitchDate: null } }],
    });
    act(() => result.current.updatePlayerNested("p1", "pitching", { recentPitches: 30 }));
    expect(updateTeam.mock.calls[0][0].players[0].pitching).toEqual({ recentPitches: 30, lastPitchDate: null });
  });

  describe("removePlayer", () => {
    const team = {
      players: [{ id: "p1", name: "Ava" }, { id: "p2", name: "Mia" }],
      games: [
        {
          id: "g1",
          lineup: [{ P: { id: "p1" }, BENCH: [{ id: "p2" }] }],
          battingLineup: [{ id: "p1" }, { id: "p2" }],
          attendance: { p1: true, p2: false },
          pitchCounts: { p1: 20 },
        },
      ],
      evaluationEvents: [{ id: "e1", grades: { p1: { hit: 3 }, p2: { hit: 4 } } }],
    };

    it("does nothing when the confirm is declined", () => {
      const { result, updateTeam } = setup(team);
      const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
      act(() => result.current.removePlayer("p1"));
      expect(updateTeam).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("strips the player from roster, lineups, attendance, pitch counts, and evals", () => {
      const { result, updateTeam, toast } = setup(team);
      const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
      act(() => result.current.removePlayer("p1"));
      const patch = updateTeam.mock.calls[0][0];
      expect(patch.players.map((p: any) => p.id)).toEqual(["p2"]);
      expect(patch.games[0].lineup[0].P).toBeNull();
      expect(patch.games[0].battingLineup.map((p: any) => p.id)).toEqual(["p2"]);
      expect(patch.games[0].attendance).toEqual({ p2: false });
      expect(patch.games[0].pitchCounts).toEqual({});
      expect(patch.evaluationEvents[0].grades).toEqual({ p2: { hit: 4 } });
      // Undo restores all snapshots.
      const undo = (toast.push as jest.Mock).mock.calls[0][0].action;
      expect(undo.label).toBe("Undo");
      confirmSpy.mockRestore();
    });

    it("strips the player's grades from a SUBCOLLECTION eval round via its doc", () => {
      const subTeam = {
        players: [{ id: "p1", name: "Ava" }, { id: "p2", name: "Mia" }],
        games: [],
        evaluationEvents: [
          { id: "e1", _sub: "evaluationEvents", grades: { p1: { hit: 3 }, p2: { hit: 4 } } },
        ],
      };
      const { result, updateTeam } = setup(subTeam);
      const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
      act(() => result.current.removePlayer("p1"));
      // The subcollection round is patched on its own doc, not the root array.
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining("/evaluationEvents/e1") }),
        { grades: { p2: { hit: 4 } } }
      );
      // The root-array evaluationEvents in the team write stays empty (no legacy).
      expect(updateTeam.mock.calls[0][0].evaluationEvents).toEqual([]);
      confirmSpy.mockRestore();
    });
  });
});
