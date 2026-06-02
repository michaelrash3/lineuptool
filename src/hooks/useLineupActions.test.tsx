import { renderHook, act } from "@testing-library/react";
import { useLineupActions } from "./useLineupActions";
import { makeToast } from "../test-utils";

// These cover the hook's wiring (uiBridge / updateGame / updateTeam) for the
// non-engine paths. Full generation logic is covered by lineupEngine.test.js.
const setup = (over: any = {}, inputs: any = null, prevSnap: any = null) => {
  const updateTeam = jest.fn();
  const updateGame = jest.fn();
  const persistTeam = jest.fn();
  const toast = makeToast();
  const uiBridge = {
    current: {
      getInputs: () => inputs,
      applyResult: jest.fn(),
      applyTemplate: jest.fn(),
      markSaved: jest.fn(),
    },
  };
  const previousLineupRef = { current: prevSnap };
  const teamData = { players: [], games: [], lineupTemplates: [], ...over };
  const { result } = renderHook(() =>
    useLineupActions({ teamData, updateTeam, updateGame, persistTeam, toast, uiBridge, previousLineupRef })
  );
  return { result, updateTeam, updateGame, toast, uiBridge };
};

describe("useLineupActions wiring", () => {
  it("undoLineup re-applies the previous snapshot via the uiBridge", () => {
    const snap = { lineup: [{ P: { id: "p1" } }], battingLineup: [{ id: "p1" }] };
    const { result, uiBridge } = setup({}, null, snap);
    act(() => result.current.undoLineup());
    expect(uiBridge.current.applyResult).toHaveBeenCalledWith({
      lineup: snap.lineup,
      battingLineup: snap.battingLineup,
    });
  });

  it("saveCurrentGame writes the in-progress lineup to the game", () => {
    const inputs = {
      currentGame: { id: "g1" },
      currentGameAttendance: { p1: true },
      lineup: [{ P: { id: "p1" } }],
      battingLineup: [{ id: "p1" }],
      lineupQualityPenalty: 2,
    };
    const { result, updateGame, uiBridge } = setup({}, inputs);
    act(() => result.current.saveCurrentGame());
    expect(updateGame).toHaveBeenCalledWith("g1", expect.objectContaining({
      lineup: inputs.lineup,
      battingLineup: inputs.battingLineup,
      attendance: { p1: true },
      qualityPenalty: 2,
    }));
    expect(uiBridge.current.markSaved).toHaveBeenCalled();
  });

  it("saveCurrentGame warns and does not write when there is no lineup", () => {
    const { result, updateGame, toast } = setup({}, { currentGame: { id: "g1" }, lineup: null });
    act(() => result.current.saveCurrentGame());
    expect(updateGame).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledWith(expect.objectContaining({ kind: "warn" }));
  });

  it("saveLineupTemplate appends a capped template from the current lineup", () => {
    const { result, updateTeam } = setup({}, { lineup: [{ P: { id: "p1" } }], battingLineup: [] });
    act(() => result.current.saveLineupTemplate("Tournament A"));
    const tpls = updateTeam.mock.calls[0][0].lineupTemplates;
    expect(tpls[tpls.length - 1]).toMatchObject({ name: "Tournament A" });
  });

  it("applyLineupTemplate pushes the saved template into the editor via uiBridge", () => {
    const tpl = { id: "t1", name: "T1", lineup: [], battingLineup: [] };
    const { result, uiBridge } = setup({ lineupTemplates: [tpl] });
    act(() => result.current.applyLineupTemplate("t1"));
    expect(uiBridge.current.applyTemplate).toHaveBeenCalledWith(tpl);
  });

  it("deleteLineupTemplate removes the template by id", () => {
    const { result, updateTeam } = setup({ lineupTemplates: [{ id: "t1" }, { id: "t2" }] });
    act(() => result.current.deleteLineupTemplate("t1"));
    expect(updateTeam.mock.calls[0][0].lineupTemplates.map((t: any) => t.id)).toEqual(["t2"]);
  });
});
