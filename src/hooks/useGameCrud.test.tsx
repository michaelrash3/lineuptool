import { vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { useGameCrud } from "./useGameCrud";
import { makeToast } from "../test-utils";

// Games now live in a subcollection, so the hook imports firebase. Stub it;
// encode doc paths for source-routing assertions.
vi.mock("../firebase", () => ({ appId: "app", db: {} }));
vi.mock("../utils/errorReporter", () => ({ reportError: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: any, ...path: string[]) => ({ path: path.join("/") })),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
}));

const mockSetDoc = setDoc as unknown as ReturnType<typeof vi.fn>;
const mockUpdateDoc = updateDoc as unknown as ReturnType<typeof vi.fn>;
const mockDeleteDoc = deleteDoc as unknown as ReturnType<typeof vi.fn>;

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
    useGameCrud({ teamData, updateTeam, toast, activeTeamId: "team-1" })
  );
  return { result, updateTeam, toast };
};

beforeEach(() => {
  mockSetDoc.mockClear();
  mockUpdateDoc.mockClear();
  mockDeleteDoc.mockClear();
});

describe("useGameCrud", () => {
  it("addGame creates a scheduled game in the subcollection", () => {
    const { result, updateTeam } = setup();
    act(() => result.current.addGame({ date: "2026-05-01", opponent: " Rays ", leagueRuleSet: "USSSA", pitchingFormat: "Kid Pitch" }));
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, game] = mockSetDoc.mock.calls[0];
    expect(ref.path).toContain("/games/");
    expect(game).toMatchObject({ date: "2026-05-01", opponent: "Rays", status: "scheduled" });
    expect(updateTeam).not.toHaveBeenCalled();
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
    expect(patch.players[0].pitching).toMatchObject({ recentPitches: 40, lastPitchDate: "2026-05-01" });
    // The outing is also recorded in the rolling history log, keyed by game id.
    expect(patch.players[0].pitching.log).toEqual([{ date: "2026-05-01", pitches: 40, gameId: "g1" }]);
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

  // ---- subcollection routing (Phase 3 games migration) --------------------

  it("updateGame patches a subcollection game on its own doc (slimmed)", () => {
    const { result, updateTeam } = setup({
      games: [{ id: "g1", _sub: "games", date: "2026-05-01" }],
    });
    act(() => result.current.updateGame("g1", { opponent: "Jays" }));
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("/games/g1") }),
      expect.objectContaining({ opponent: "Jays" })
    );
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("deleteSavedGame deletes a subcollection game via its doc", () => {
    const { result, updateTeam } = setup({
      games: [{ id: "g1", _sub: "games", opponent: "Rays" }],
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    act(() => result.current.deleteSavedGame("g1"));
    expect(mockDeleteDoc.mock.calls[0][0].path).toContain("/games/g1");
    expect(updateTeam).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("finalizeGame on a subcollection game writes players (array) and the game doc", () => {
    const { result, updateTeam } = setup({
      games: [{ id: "g1", _sub: "games", date: "2026-05-01", lineup: null, pitchCounts: { p1: 40 } }],
      players: [{ id: "p1", name: "Ace", pitching: { recentPitches: 0, lastPitchDate: null } }],
    });
    act(() => result.current.finalizeGame("g1", 1, 0, 6));
    // Players still go to the root array…
    expect(updateTeam).toHaveBeenCalledWith(
      expect.objectContaining({ players: expect.any(Array) })
    );
    // …and the game status flips on its subcollection doc.
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("/games/g1") }),
      expect.objectContaining({ status: "final", teamScore: 1, opponentScore: 0 })
    );
  });
});
