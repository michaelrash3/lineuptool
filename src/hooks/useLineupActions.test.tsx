import { renderHook, act } from "@testing-library/react";
import { useLineupActions } from "./useLineupActions";
import { makeToast } from "../test-utils";
import { vi } from "vitest";

// Mock the engine so we can drive the post-generation toast logic directly.
// Rec games route through generateLineup; Tournament (USSSA) games route
// through generateTournamentLineup — both mocks feed the same assertions.
const {
  generateLineupMock,
  generateTournamentLineupMock,
  generateBattingOnlyMock,
} = vi.hoisted(() => ({
  generateLineupMock: vi.fn(),
  generateTournamentLineupMock: vi.fn(),
  generateBattingOnlyMock: vi.fn(),
}));
vi.mock("../lineupEngine", () => ({
  generateLineup: generateLineupMock,
  generateTournamentLineup: generateTournamentLineupMock,
  generateBattingOnly: generateBattingOnlyMock,
  resolvePitchRuleSet: vi.fn(() => ({
    id: "littleLeague",
    limits: {},
    fallbackLimit: 105,
    restTiers: [],
  })),
}));

// These cover the hook's wiring (uiBridge / updateGame / updateTeam) for the
// non-engine paths. Full generation logic is covered by lineupEngine.test.js.
// Undo is intentionally NOT part of the hook's return — the snapshot is only
// reachable through the generate/re-roll toasts' Undo action, exercised in
// the game-scoped describe below.
const setup = (over: any = {}, inputs: any = null) => {
  const updateTeam = jest.fn();
  const updateGame = jest.fn();
  const persistTeam = jest.fn();
  const toast = makeToast();
  // Real ToastProvider.push returns a monotonically increasing id — the hook
  // records it for armed (Undo-carrying) toasts so the seams can dismiss.
  let nextToastId = 0;
  (toast.push as jest.Mock).mockImplementation(() => ++nextToastId);
  const uiBridge = {
    current: {
      getInputs: () => inputs,
      applyResult: jest.fn(),
      applyTemplate: jest.fn(),
      markSaved: jest.fn(),
    },
  };
  const previousLineupRef = { current: null };
  const undoToastIdRef = { current: null as number | null };
  const teamData = { players: [], games: [], lineupTemplates: [], ...over };
  const { result } = renderHook(() =>
    useLineupActions({
      teamDataRef: { current: teamData },
      updateTeam,
      updateGame,
      persistTeam,
      toast,
      uiBridge,
      previousLineupRef,
      undoToastIdRef,
    }),
  );
  return { result, updateTeam, updateGame, toast, uiBridge, undoToastIdRef };
};

describe("useLineupActions wiring", () => {
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
    expect(updateGame).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        lineup: inputs.lineup,
        battingLineup: inputs.battingLineup,
        attendance: { p1: true },
        qualityPenalty: 2,
      }),
    );
    expect(uiBridge.current.markSaved).toHaveBeenCalled();
  });

  it("saveCurrentGame warns and does not write when there is no lineup", () => {
    const { result, updateGame, toast } = setup(
      {},
      { currentGame: { id: "g1" }, lineup: null },
    );
    act(() => result.current.saveCurrentGame());
    expect(updateGame).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn" }),
    );
  });

  it("saveAttendance writes ONLY attendance — no lineup required", () => {
    const { result, updateGame, toast } = setup(
      {},
      {
        currentGame: { id: "g1" },
        currentGameAttendance: { p1: true, p2: false },
        lineup: null, // no lineup planned yet
      },
    );
    act(() => result.current.saveAttendance());
    expect(updateGame).toHaveBeenCalledWith("g1", {
      attendance: { p1: true, p2: false },
    });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", title: "Attendance saved" }),
    );
  });

  it("saveLineupTemplate appends a capped template from the current lineup", () => {
    const { result, updateTeam } = setup(
      {},
      { lineup: [{ P: { id: "p1" } }], battingLineup: [] },
    );
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
    const { result, updateTeam } = setup({
      lineupTemplates: [{ id: "t1" }, { id: "t2" }],
    });
    act(() => result.current.deleteLineupTemplate("t1"));
    expect(
      updateTeam.mock.calls[0][0].lineupTemplates.map((t: any) => t.id),
    ).toEqual(["t2"]);
  });
});

describe("useLineupActions one-game-balance toast", () => {
  // Nine present players clears the >=7 floor; the engine is mocked to succeed
  // without seasonal fairness so the relaxed-fairness toast branch is exercised.
  const players = Array.from({ length: 9 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
  }));
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
    generateTournamentLineupMock.mockReset();
    generateTournamentLineupMock.mockReturnValue({
      lineup: [{}],
      battingLineup: [],
      tournament: { starters: {}, substitutions: [], reliefOptions: [] },
    });
  });

  it("Rec game still warns about one-game balance when fairness is off", () => {
    const { result, toast } = setup(
      { players, leagueRuleSet: "NKB", teamAge: "10U" },
      makeInputs("NKB"),
    );
    act(() => result.current.generateLineup());
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warn",
        title: "Lineup built (one-game balance)",
      }),
    );
  });

  it("Tournament game suppresses the one-game-balance warning", () => {
    const { result, toast } = setup(
      { players, leagueRuleSet: "USSSA", teamAge: "10U" },
      makeInputs("USSSA"),
    );
    act(() => result.current.generateLineup());
    // USSSA routes through the tournament pipeline, not the Rec engine.
    expect(generateTournamentLineupMock).toHaveBeenCalled();
    expect(generateLineupMock).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", title: "Lineup generated" }),
    );
    expect(toast.push).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Lineup built (one-game balance)" }),
    );
  });
});

describe("useLineupActions game-scoped undo buffer", () => {
  // The undo snapshot is stamped with the game it was captured from, and its
  // single reader — the toast's Undo action (which outlives a game switch:
  // the ToastProvider stack is not remounted when selectedGameId changes) —
  // must refuse once a DIFFERENT game is selected. Otherwise game 1's
  // pre-roll lineup lands in game 2's editor and the next Save writes it onto
  // game 2. Sibling of the team-switch clear covered by
  // TeamProvider.teamSwitch.test.tsx.
  const players = Array.from({ length: 9 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
  }));
  const g1Lineup = [
    { P: { id: "p0" }, C: { id: "p1" }, BENCH: [{ id: "p2" }] },
  ];
  // Deliberately disjoint from the defense slots above (p3+), so each
  // stale-roster case below exercises exactly one scan: position slot (p1),
  // BENCH (p2), batting order (p8).
  const g1Batting = players.slice(3).map((p) => ({ id: p.id, name: p.name }));

  // Inputs object is mutated in place to simulate UIProvider's game switch:
  // getInputs() closes over it, so readers see the NEW selection at click time
  // exactly as the real bridge does. The roster is a fresh copy per mount so
  // the stale-roster tests can splice players out without leaking.
  const mount = () => {
    const roster = players.map((p) => ({ ...p }));
    const inputs: any = {
      currentGame: { id: "g1" },
      currentGameAttendance: {},
      firstInningLineup: {},
      lineup: g1Lineup,
      battingLineup: g1Batting,
      previousLineup: g1Lineup,
      previousBattingLineup: g1Batting,
    };
    const mounted = setup({ players: roster }, inputs);
    const switchToGame = (id: string) => {
      inputs.currentGame = { id };
      // The game-switch effect loads the new game's saved state into the
      // editor; the fresh game has none.
      inputs.lineup = null;
      inputs.battingLineup = null;
      inputs.previousLineup = null;
      inputs.previousBattingLineup = null;
    };
    const lastUndoAction = () =>
      (mounted.toast.push as jest.Mock).mock.calls
        .map((c) => c[0])
        .filter((t) => t.action)
        .pop()?.action;
    const dropFromRoster = (id: string) =>
      roster.splice(
        roster.findIndex((p) => p.id === id),
        1,
      );
    return {
      ...mounted,
      inputs,
      roster,
      switchToGame,
      lastUndoAction,
      dropFromRoster,
    };
  };

  beforeEach(() => {
    generateLineupMock.mockReset();
    generateLineupMock.mockReturnValue({
      lineup: [{ P: { id: "p2" } }],
      battingLineup: g1Batting,
    });
    generateBattingOnlyMock.mockReset();
    generateBattingOnlyMock.mockReturnValue({
      battingLineup: [...g1Batting].reverse(),
    });
  });

  // All three paths that arm the buffer (and push an Undo toast).
  const reRolls: Array<[string, (r: any) => void]> = [
    ["generateLineup", (r) => r.generateLineup()],
    ["regenerateDefense", (r) => r.regenerateDefense()],
    ["regenerateBatting", (r) => r.regenerateBatting()],
  ];

  it.each(reRolls)(
    "%s: undo after a game switch is a no-op — no cross-game write",
    (_name, run) => {
      const { result, uiBridge, switchToGame, lastUndoAction } = mount();
      act(() => run(result.current));
      const undoAction = lastUndoAction();
      expect(undoAction).toBeTruthy();

      switchToGame("g2");
      (uiBridge.current.applyResult as jest.Mock).mockClear();

      // The still-live toast button is the snapshot's only reader.
      act(() => undoAction.onClick());
      expect(uiBridge.current.applyResult).not.toHaveBeenCalled();
    },
  );

  it.each(reRolls)(
    "%s: undo without a game switch still restores",
    (_name, run) => {
      const { result, uiBridge, lastUndoAction } = mount();
      act(() => run(result.current));
      (uiBridge.current.applyResult as jest.Mock).mockClear();

      act(() => lastUndoAction().onClick());
      expect(uiBridge.current.applyResult).toHaveBeenCalledWith({
        lineup: g1Lineup,
        battingLineup: g1Batting,
      });
    },
  );

  it("re-arms for the new game — the refusal doesn't disable undo permanently", () => {
    const { result, uiBridge, inputs, switchToGame, lastUndoAction } = mount();
    act(() => result.current.regenerateDefense());

    switchToGame("g2");
    // The coach builds game 2 a lineup, then re-rolls it — arming the buffer
    // with game 2's own pre-roll state.
    const g2Lineup = [{ P: { id: "p3" } }];
    const g2Batting = [{ id: "p3", name: "P3" }];
    inputs.lineup = g2Lineup;
    inputs.battingLineup = g2Batting;
    act(() => result.current.regenerateDefense());

    (uiBridge.current.applyResult as jest.Mock).mockClear();
    act(() => lastUndoAction().onClick());
    expect(uiBridge.current.applyResult).toHaveBeenCalledWith({
      lineup: g2Lineup,
      battingLineup: g2Batting,
    });
  });

  // Stale-roster guard: a re-roll toast can outlive a player removal, and
  // restoring a snapshot that still contains the deleted kid would write them
  // back into the editor (and, on Save, onto the game). Same silent no-op
  // contract as the game/team mismatch refusals above.
  it.each([
    ["a defense slot", "p1"],
    ["the bench", "p2"],
    ["the batting order only", "p8"],
  ])(
    "undo refuses when the snapshot references a player removed from %s",
    (_where, removedId) => {
      const { result, uiBridge, lastUndoAction, dropFromRoster } = mount();
      act(() => result.current.regenerateDefense());
      dropFromRoster(removedId);
      (uiBridge.current.applyResult as jest.Mock).mockClear();

      act(() => lastUndoAction().onClick());
      expect(uiBridge.current.applyResult).not.toHaveBeenCalled();
    },
  );

  it("undo still restores after an unrelated roster change (only snapshot players matter)", () => {
    const { result, uiBridge, roster, lastUndoAction } = mount();
    act(() => result.current.regenerateDefense());
    // A NEW player joining is not a stale snapshot — nothing in the snapshot
    // is missing from the roster.
    roster.push({ id: "p9", name: "P9" });
    (uiBridge.current.applyResult as jest.Mock).mockClear();

    act(() => lastUndoAction().onClick());
    expect(uiBridge.current.applyResult).toHaveBeenCalledWith({
      lineup: g1Lineup,
      battingLineup: g1Batting,
    });
  });
});

describe("useLineupActions undo-toast id tracking", () => {
  // The hook's half of the stale-toast fix: record the id of every ARMED
  // (Undo-carrying) toast in the shared undoToastIdRef so the seams — game
  // switch (UIProvider → TeamProvider.dismissLineupUndoToast) and team switch
  // (TeamProvider's team-doc teardown) — can dismiss the live toast. And keep
  // at most ONE alive: a re-roll overwrites the snapshot, so the previous
  // toast's Undo button no longer describes what tapping it would restore.
  const players = Array.from({ length: 9 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
  }));
  const lineup = [{ P: { id: "p0" } }];
  const batting = [{ id: "p0", name: "P0" }];
  const armedInputs = () => ({
    currentGame: { id: "g1" },
    currentGameAttendance: {},
    firstInningLineup: {},
    lineup,
    battingLineup: batting,
    previousLineup: lineup,
    previousBattingLineup: batting,
  });

  beforeEach(() => {
    generateLineupMock.mockReset();
    generateLineupMock.mockReturnValue({ lineup, battingLineup: batting });
    generateBattingOnlyMock.mockReset();
    generateBattingOnlyMock.mockReturnValue({
      battingLineup: [...batting].reverse(),
    });
  });

  it("records the armed toast's id so the seams can dismiss it", () => {
    const { result, toast, undoToastIdRef } = setup({ players }, armedInputs());
    act(() => result.current.generateLineup());
    const results = (toast.push as jest.Mock).mock.results;
    const armedId = results[results.length - 1].value;
    expect(undoToastIdRef.current).toBe(armedId);
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it("does NOT track an Undo-less first build (nothing for the seams to dismiss)", () => {
    const { result, undoToastIdRef } = setup(
      { players },
      { ...armedInputs(), previousLineup: null, previousBattingLineup: null },
    );
    act(() => result.current.generateLineup());
    expect(undoToastIdRef.current).toBeNull();
  });

  it("a new roll dismisses ONLY the previous undo toast and re-arms with the new id", () => {
    const { result, toast, undoToastIdRef } = setup({ players }, armedInputs());
    act(() => result.current.regenerateDefense());
    const firstId = undoToastIdRef.current;
    act(() => result.current.regenerateBatting());
    const secondId = undoToastIdRef.current;
    expect(secondId).not.toBe(firstId);
    // Exactly the stale toast was dismissed — no unrelated ids.
    expect((toast.dismiss as jest.Mock).mock.calls).toEqual([[firstId]]);
  });

  it("a failed roll leaves the live toast (its snapshot is still valid)", () => {
    const { result, toast, undoToastIdRef } = setup({ players }, armedInputs());
    act(() => result.current.regenerateDefense());
    const armedId = undoToastIdRef.current;
    generateLineupMock.mockReturnValue({ error: "unsatisfiable" });
    act(() => result.current.regenerateDefense());
    // The error path never reached the snapshot overwrite — the armed toast's
    // Undo still restores exactly what it says.
    expect(toast.dismiss).not.toHaveBeenCalled();
    expect(undoToastIdRef.current).toBe(armedId);
  });
});

describe("useLineupActions mid-game removal redraft", () => {
  const players = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
  }));
  const lineup = [
    { P: { id: "p0" } },
    { P: { id: "p0" } },
    { P: { id: "p0" } },
  ];
  const game = (leagueRuleSet: string) => ({
    id: "g1",
    date: "2026-06-20",
    leagueRuleSet,
    lineup,
    battingLineup: players.map((p) => ({ id: p.id, name: p.name })),
    attendance: {},
    tournamentPlan: { starters: {}, substitutions: [] },
  });
  const depthChart = { SS: ["p3"] };

  beforeEach(() => {
    generateLineupMock.mockReset();
    generateLineupMock.mockReturnValue({ lineup, battingLineup: [] });
  });

  it("tournament removal redrafts competitively and clears the stale subs script", () => {
    const usssa = game("USSSA");
    const { result, updateGame } = setup(
      { players, games: [usssa], depthChart, leagueRuleSet: "USSSA" },
      { currentGame: usssa },
    );
    act(() =>
      result.current.removePlayerMidGame("p1", { fromInning: 1, gameId: "g1" }),
    );
    expect(generateLineupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitive: true,
        depthChart,
        fromInning: 1,
        currentLineup: lineup,
      }),
    );
    // The removed player is out of the active pool fed to the engine.
    const call = generateLineupMock.mock.calls[0][0];
    expect(call.activePlayers.some((p: any) => p.id === "p1")).toBe(false);
    const patch = updateGame.mock.calls[0][1];
    expect(patch.tournamentPlan).toBeNull();
    expect(patch.midGameRemovals.p1).toMatchObject({ fromInning: 1 });
    expect(patch.battingLineup.some((p: any) => p.id === "p1")).toBe(false);
  });

  it("rec removal keeps the relaxed rebuild and leaves the plan untouched", () => {
    const rec = game("NKB");
    const { result, updateGame } = setup(
      { players, games: [rec], depthChart, leagueRuleSet: "NKB" },
      { currentGame: rec },
    );
    act(() =>
      result.current.removePlayerMidGame("p1", { fromInning: 1, gameId: "g1" }),
    );
    expect(generateLineupMock).toHaveBeenCalledWith(
      expect.objectContaining({ competitive: false, relaxFairness: true }),
    );
    const patch = updateGame.mock.calls[0][1];
    expect(patch).not.toHaveProperty("tournamentPlan");
  });
});
