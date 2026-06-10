import { renderHook, act } from "@testing-library/react";
import { useLineupActions } from "./useLineupActions";
import { makeToast } from "../test-utils";
import { vi } from "vitest";

// Mock the engine so we can drive the post-generation toast logic directly.
const { generateLineupMock } = vi.hoisted(() => ({
  generateLineupMock: vi.fn(),
}));
vi.mock("../lineupEngine", () => ({
  generateLineup: generateLineupMock,
  generateBattingOnly: vi.fn(),
  resolvePitchRuleSet: vi.fn(() => ({ id: "littleLeague", limits: {}, fallbackLimit: 105, restTiers: [] })),
}));

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

  it("saveAttendance writes ONLY attendance — no lineup required", () => {
    const { result, updateGame, toast } = setup({}, {
      currentGame: { id: "g1" },
      currentGameAttendance: { p1: true, p2: false },
      lineup: null, // no lineup planned yet
    });
    act(() => result.current.saveAttendance());
    expect(updateGame).toHaveBeenCalledWith("g1", { attendance: { p1: true, p2: false } });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", title: "Attendance saved" })
    );
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

describe("useLineupActions one-game-balance toast", () => {
  // Nine present players clears the >=7 floor; the engine is mocked to succeed
  // without seasonal fairness so the relaxed-fairness toast branch is exercised.
  const players = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const makeInputs = (leagueRuleSet: string) => ({
    currentGame: { id: "g1", leagueRuleSet, applySeasonalFairness: false },
    currentGameAttendance: {},
    firstInningLineup: {},
    previousLineup: null,
    previousBattingLineup: null,
  });

  beforeEach(() => {
    generateLineupMock.mockReset();
    generateLineupMock.mockReturnValue({ lineup: [{}], battingLineup: [] });
  });

  it("Rec game still warns about one-game balance when fairness is off", () => {
    const { result, toast } = setup(
      { players, leagueRuleSet: "NKB", teamAge: "10U" },
      makeInputs("NKB")
    );
    act(() => result.current.generateLineup());
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warn",
        title: "Lineup built (one-game balance)",
      })
    );
  });

  it("Tournament game suppresses the one-game-balance warning", () => {
    const { result, toast } = setup(
      { players, leagueRuleSet: "USSSA", teamAge: "10U" },
      makeInputs("USSSA")
    );
    act(() => result.current.generateLineup());
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", title: "Lineup generated" })
    );
    expect(toast.push).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Lineup built (one-game balance)" })
    );
  });
});
