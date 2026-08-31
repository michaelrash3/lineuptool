import { renderHook, act } from "@testing-library/react";
import { useLineupActions } from "./useLineupActions";
import { makeToast } from "../test-utils";

// A tournament sub is a guest player carried in team.players with isSub set.
// The whole feature rests on one rule: they enter the pool for the games of
// the tournament they were added to, and for no other game. This runs the
// REAL engine through the same bridge contract UIProvider implements, so a
// regression in that gate shows up as a sub actually appearing in (or missing
// from) a generated lineup — not just a predicate returning false.

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

const sub = {
  id: "sub1",
  name: "Guest Kid",
  number: "42",
  present: true,
  isSub: true,
  subTournamentIds: ["t1"],
  comfortablePositions: ALL_POSITIONS,
  restrictions: [],
  pitching: { recentPitches: 0, lastPitchDate: null },
  stats: {},
};

const gameShape = (id: string, date: string) => ({
  id,
  date,
  opponent: `Rivals ${id}`,
  status: "scheduled",
  inningsCount: 6,
  leagueRuleSet: "USSSA",
  defenseSize: 9,
  positionLock: false,
  battingSize: 12,
  pitchingFormat: "Kid Pitch",
});

// g1 belongs to the sub's tournament; g2 is an unrelated league game.
const TOURNEY_GAME = gameShape("g1", "2026-05-01");
const OTHER_GAME = gameShape("g2", "2026-06-14");

const setup = (currentGame = TOURNEY_GAME, attendance: any = {}) => {
  const teamData: any = {
    players: [...makePlayers(9), sub],
    games: [TOURNEY_GAME, OTHER_GAME],
    tournaments: [{ id: "t1", name: "Memorial Day Classic", gameIds: ["g1"] }],
    evaluationEvents: [],
    inningsCount: 6,
    leagueRuleSet: "USSSA",
    teamAge: "10U",
    defenseSize: 9,
    positionLock: false,
    battingSize: 12,
    pitchingFormat: "Kid Pitch",
    catcherMaxInnings: 2,
    catcherConsecutive: false,
  };

  const ui: any = { lineup: null, battingLineup: null };
  const uiBridge = {
    current: {
      getInputs: () => ({
        currentGame,
        currentGameAttendance: attendance,
        firstInningLineup: {},
        previousLineup: ui.lineup,
        previousBattingLineup: ui.battingLineup,
        lineup: ui.lineup,
        battingLineup: ui.battingLineup,
        lineupQualityPenalty: null,
      }),
      applyResult: ({ lineup, battingLineup }: any) => {
        ui.lineup = lineup;
        ui.battingLineup = battingLineup;
      },
      markSaved: () => {},
    },
  };

  const toast = makeToast();
  let nextToastId = 0;
  (toast.push as jest.Mock).mockImplementation(() => ++nextToastId);
  const { result } = renderHook(() =>
    useLineupActions({
      teamDataRef: { current: teamData },
      updateTeam: jest.fn(),
      updateGame: jest.fn(),
      persistTeam: jest.fn(),
      toast,
      uiBridge,
      previousLineupRef: { current: null },
      undoToastIdRef: { current: null },
    }),
  );
  return { result, ui, teamData, toast };
};

const idsIn = (lineup: any[]): Set<string> => {
  const ids = new Set<string>();
  for (const inning of lineup || []) {
    for (const pos of Object.keys(inning)) {
      if (pos === "BENCH") {
        for (const b of inning.BENCH || []) if (b?.id) ids.add(b.id);
      } else if (inning[pos]?.id) {
        ids.add(inning[pos].id);
      }
    }
  }
  return ids;
};

describe("tournament subs reach the engine only for their own tournament", () => {
  it("plays in a game of the tournament they were added to", () => {
    const { result, ui } = setup(TOURNEY_GAME);
    act(() => result.current.generateLineup());
    expect(idsIn(ui.lineup).has("sub1")).toBe(true);
    expect(ui.battingLineup.some((p: any) => p.id === "sub1")).toBe(true);
  });

  it("is nowhere in an unrelated game, even with an empty attendance map", () => {
    // An empty map means "nobody marked out" — the historical shortcut for
    // everyone-present. A sub must not ride in on it.
    const { result, ui } = setup(OTHER_GAME, {});
    act(() => result.current.generateLineup());
    expect(idsIn(ui.lineup).has("sub1")).toBe(false);
    expect(ui.battingLineup.some((p: any) => p.id === "sub1")).toBe(false);
  });

  it("is nowhere in an unrelated game even if a stale map marks them present", () => {
    // Attendance carried over from the tournament weekend must not leak them
    // into June's league game.
    const { result, ui } = setup(OTHER_GAME, { sub1: true });
    act(() => result.current.generateLineup());
    expect(idsIn(ui.lineup).has("sub1")).toBe(false);
  });

  it("stays out when marked absent for their own tournament game", () => {
    const { result, ui } = setup(TOURNEY_GAME, { sub1: false });
    act(() => result.current.generateLineup());
    expect(idsIn(ui.lineup).has("sub1")).toBe(false);
  });

  it("drops out of the pool once the tournament stops claiming the game", () => {
    const { result, ui, teamData } = setup(TOURNEY_GAME);
    teamData.tournaments = [
      { id: "t1", name: "Memorial Day Classic", gameIds: [] },
    ];
    act(() => result.current.generateLineup());
    expect(idsIn(ui.lineup).has("sub1")).toBe(false);
  });
});
