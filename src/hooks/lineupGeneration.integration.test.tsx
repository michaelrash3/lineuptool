import { renderHook, act } from "@testing-library/react";
import { useLineupActions } from "./useLineupActions";
import { makeToast } from "../test-utils";

// Integration test for the lineup generate -> applyResult -> saveCurrentGame
// seam. Unlike useLineupActions.test.tsx (which mocks the bridge), this wires a
// FAITHFUL uiBridge mirroring UIProvider's real getInputs/applyResult contract
// and runs the REAL engine (no mocks), so a break in the wiring between
// TeamProvider's actions and the UI bridge would fail here.

const ALL_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

const makePlayers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    number: String(i + 1),
    present: true,
    comfortablePositions: ALL_POSITIONS,
    restrictions: [],
    pitching: { recentPitches: 0, lastPitchDate: null },
    stats: {},
  }));

const currentGame = {
  id: "g1",
  date: "2026-05-01",
  opponent: "Rays",
  status: "scheduled",
  inningsCount: 6,
  leagueRuleSet: "USSSA",
  defenseSize: 9,
  positionLock: false,
  battingSize: 10,
  pitchingFormat: "Kid Pitch",
};

const setup = () => {
  const players = makePlayers(10);
  const teamData: any = {
    players,
    games: [currentGame],
    evaluationEvents: [],
    inningsCount: 6,
    leagueRuleSet: "USSSA",
    teamAge: "10U",
    defenseSize: 9,
    positionLock: false,
    battingSize: 10,
    pitchingFormat: "Kid Pitch",
    catcherMaxInnings: 2,
    catcherConsecutive: false,
  };

  // Mirror of UIProvider's editor state + bridge wiring.
  const ui: any = {
    lineup: null,
    battingLineup: null,
    lineupQualityPenalty: null,
    saved: false,
  };
  const uiBridge = {
    current: {
      getInputs: () => ({
        currentGame,
        currentGameAttendance: {}, // empty => everyone present
        firstInningLineup: {},
        previousLineup: ui.lineup,
        previousBattingLineup: ui.battingLineup,
        lineup: ui.lineup,
        battingLineup: ui.battingLineup,
        lineupQualityPenalty: ui.lineupQualityPenalty,
      }),
      applyResult: ({ lineup, battingLineup, qualityPenalty }: any) => {
        ui.lineup = lineup;
        ui.battingLineup = battingLineup;
        ui.lineupQualityPenalty =
          typeof qualityPenalty === "number" ? qualityPenalty : null;
      },
      markSaved: () => {
        ui.saved = true;
      },
    },
  };

  const updateTeam = jest.fn();
  const updateGame = jest.fn();
  const persistTeam = jest.fn();
  const toast = makeToast();
  const previousLineupRef = { current: null };
  const { result } = renderHook(() =>
    useLineupActions({
      teamDataRef: { current: teamData },
      updateTeam,
      updateGame,
      persistTeam,
      toast,
      uiBridge,
      previousLineupRef,
    }),
  );
  return { result, ui, updateGame, toast };
};

describe("lineup generation integration (real engine through the bridge)", () => {
  it("generates a full lineup and applies it back through the bridge", () => {
    const { result, ui, toast } = setup();
    act(() => result.current.generateLineup());

    // applyResult populated the editor state via the bridge.
    expect(Array.isArray(ui.lineup)).toBe(true);
    expect(ui.lineup.length).toBe(6); // one entry per inning
    expect(Array.isArray(ui.battingLineup)).toBe(true);
    expect(ui.battingLineup.length).toBeGreaterThan(0);

    // Every defensive position is filled for the first inning.
    const firstInning = ui.lineup[0];
    for (const pos of ALL_POSITIONS) {
      expect(firstInning[pos]).toBeTruthy();
    }

    // A success toast (not an error) was raised.
    const kinds = (toast.push as jest.Mock).mock.calls.map((c) => c[0].kind);
    expect(kinds).not.toContain("error");
  });

  it("saves the generated lineup back to the game via updateGame", () => {
    const { result, ui, updateGame } = setup();
    act(() => result.current.generateLineup());
    act(() => result.current.saveCurrentGame());

    expect(updateGame).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        lineup: ui.lineup,
        battingLineup: ui.battingLineup,
      }),
    );
    expect(ui.saved).toBe(true);
  });

  it("undo restores the previous lineup through the bridge", () => {
    const { result, ui } = setup();
    act(() => result.current.generateLineup()); // first build (no previous)
    const firstLineup = ui.lineup;
    act(() => result.current.regenerateLineup()); // second build, snapshots first
    act(() => result.current.undoLineup());
    expect(ui.lineup).toEqual(firstLineup);
  });
});
