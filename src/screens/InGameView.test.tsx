import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InGameView } from "./InGameView";
import { renderWithProviders } from "../test-utils";
import { DEFAULT_TEAM_DATA } from "../constants/ui";
import { generateLineup } from "../lineupEngine";
import type { CoachRole } from "../types";

// The in-game swap *engine* (applySwap, fillVacatedSpot, …) is covered by
// src/lineup/inGameSwap.test.ts. These tests cover the component wiring that
// sits on top of it: what renders for each role, how a tap maps to a selection,
// that a committed swap persists, and the score / inning / close controls.

const slim = (id: string, name: string, number: string) => ({
  id,
  name,
  number,
});

const alice = slim("p1", "Alice", "1"); // P
const bob = slim("p2", "Bob", "2"); // 1B
const cara = slim("p3", "Cara", "3"); // C
const dave = slim("p4", "Dave", "4"); // 2B
const evan = slim("p5", "Evan", "5"); // bench

const players = [alice, bob, cara, dave, evan];

const oneInning = () => ({
  P: alice,
  C: cara,
  "1B": bob,
  "2B": dave,
  BENCH: [evan],
});

const makeGame = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  date: "2026-07-01",
  opponent: "Rivals",
  teamScore: 2,
  opponentScore: 1,
  battingLineup: players,
  midGameRemovals: {},
  manualLocks: {},
  attendance: {},
  lineup: [oneInning()],
  ...over,
});

const renderInGame = ({
  role = "head",
  game = makeGame(),
  ui = {},
  team: teamOver = {},
}: {
  role?: CoachRole;
  game?: ReturnType<typeof makeGame>;
  ui?: Record<string, unknown>;
  team?: Record<string, unknown>;
} = {}) => {
  const updateGame = vi.fn();
  const updatePlayer = vi.fn();
  const finalizeGame = vi.fn();
  const removePlayerMidGame = vi.fn();
  const setPlayerHealth = vi.fn();
  const utils = renderWithProviders(
    <MemoryRouter>
      <InGameView />
    </MemoryRouter>,
    {
      team: {
        team: { ...DEFAULT_TEAM_DATA, players, games: [game], ...teamOver },
        currentRole: role,
        realRole: role,
        updateGame,
        updatePlayer,
        finalizeGame,
        removePlayerMidGame,
        setPlayerHealth,
      },
      ui: {
        inGameId: game.id,
        setInGameId: vi.fn(),
        inGameInning: 0,
        setInGameInning: vi.fn(),
        inGameSelection: null,
        setInGameSelection: vi.fn(),
        inGameUndoStack: [],
        setInGameUndoStack: vi.fn(),
        ...ui,
      },
    },
  );
  return {
    ...utils,
    updateGame,
    updatePlayer,
    finalizeGame,
    removePlayerMidGame,
    setPlayerHealth,
  };
};

describe("InGameView", () => {
  it("renders nothing when no game is in progress", () => {
    const { container } = renderInGame({ ui: { inGameId: null } });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a guard when the live game has no lineup yet", () => {
    const { uiValue } = renderInGame({ game: makeGame({ lineup: [] }) });
    expect(screen.getByText("No Lineup Generated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(uiValue.setInGameId).toHaveBeenCalledWith(null);
  });

  it("renders the live lineup and the head-coach controls", () => {
    renderInGame();
    // Players can appear in more than one panel (the field cell plus the head
    // coach's Pitchers list), so match all occurrences rather than exactly one.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
    // Head coaches get the destructive / scoring controls.
    expect(screen.getByText(/End Game/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Edit live score")).toBeInTheDocument();
    expect(screen.queryByText(/View only/i)).not.toBeInTheDocument();
  });

  it("closes in-game mode from the header", () => {
    const { uiValue } = renderInGame();
    fireEvent.click(screen.getByLabelText("Close in-game mode"));
    expect(uiValue.setInGameId).toHaveBeenCalledWith(null);
  });

  it("first tap on a field spot selects it", () => {
    const { uiValue } = renderInGame();
    fireEvent.click(screen.getByRole("button", { name: /1B/ }));
    expect(uiValue.setInGameSelection).toHaveBeenCalledWith({
      type: "position",
      pos: "1B",
    });
  });

  it("tapping the already-selected spot deselects without recording an undo", () => {
    const { uiValue } = renderInGame({
      ui: { inGameSelection: { type: "position", pos: "1B" } },
    });
    fireEvent.click(screen.getByRole("button", { name: /1B/ }));
    expect(uiValue.setInGameSelection).toHaveBeenCalledWith(null);
    // Deselect is not a move — no undo snapshot is pushed.
    expect(uiValue.setInGameUndoStack).not.toHaveBeenCalled();
  });

  it("commits a field swap, records an undo snapshot, and persists the lineup", () => {
    vi.useFakeTimers();
    try {
      const { uiValue, updateGame } = renderInGame({
        ui: { inGameSelection: { type: "position", pos: "1B" } },
      });
      // 1B already selected; tap 2B to swap the two fielders.
      fireEvent.click(screen.getByRole("button", { name: /2B/ }));

      // Synchronous effects of a committed swap.
      expect(uiValue.setInGameUndoStack).toHaveBeenCalledTimes(1);
      expect(uiValue.setInGameSelection).toHaveBeenLastCalledWith(null);

      // The write is debounced; flush it.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(updateGame).toHaveBeenCalledTimes(1);
      const [gameId, patch] = updateGame.mock.calls[0];
      expect(gameId).toBe("g1");
      expect(patch.lineup[0]["1B"].id).toBe("p4"); // Dave moved to 1B
      expect(patch.lineup[0]["2B"].id).toBe("p2"); // Bob moved to 2B
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an assistant view the game read-only", () => {
    const { uiValue } = renderInGame({ role: "assistant" });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/View only/i)).toBeInTheDocument();
    // Head-only controls are gone.
    expect(screen.queryByText(/End Game/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Edit live score")).not.toBeInTheDocument();
    // Taps do nothing for an assistant.
    fireEvent.click(screen.getByRole("button", { name: /1B/ }));
    expect(uiValue.setInGameSelection).not.toHaveBeenCalled();
  });

  it("steps to the next inning", () => {
    const twoInnings = makeGame({ lineup: [oneInning(), oneInning()] });
    const { uiValue } = renderInGame({ game: twoInnings });
    fireEvent.click(screen.getByLabelText("Next inning"));
    expect(uiValue.setInGameInning).toHaveBeenCalled();
  });

  it("adjusts the live score for the head coach", () => {
    const { updateGame } = renderInGame();
    fireEvent.click(screen.getByLabelText("Edit live score"));
    fireEvent.click(screen.getByLabelText("Increase Us score"));
    expect(updateGame).toHaveBeenCalledWith("g1", { teamScore: 3 });
  });

  it("flags an available pitcher who is planned for a later tournament game", () => {
    const game = makeGame({ date: "2026-07-01" });
    renderInGame({
      game,
      team: {
        teamAge: "10U",
        pitchingFormat: "Kid Pitch",
        games: [game, { id: "g2", date: "2026-07-02", opponent: "Cubs" }],
        tournaments: [
          {
            id: "t1",
            name: "Bash",
            gameIds: ["g1", "g2"],
            pitchPlan: {
              g2: [{ playerId: "p5", role: "start", plannedPitches: 50 }],
            },
          },
        ],
      },
    });
    // Evan (bench, cleared) is penciled in for tomorrow — advisory, still tappable.
    const evan = screen.getByRole("button", { name: /Evan.*planned/ });
    expect(evan).toBeEnabled();
    expect(evan.title).toMatch(/planned to pitch vs Cubs/);
  });

  it("flags an available pitcher who is planned for a later STANDALONE game", () => {
    // Week-planner plans on standalone games live in game.pitchPlan — no
    // stored tournament. The advisory must read them too (pre-fix it only
    // looked at stored tournaments).
    const game = makeGame({ date: "2026-07-01" });
    renderInGame({
      game,
      team: {
        teamAge: "10U",
        pitchingFormat: "Kid Pitch",
        games: [
          game,
          {
            id: "g2",
            date: "2026-07-02",
            opponent: "Cubs",
            pitchPlan: [{ playerId: "p5", role: "start", plannedPitches: 50 }],
          },
        ],
        tournaments: [],
      },
    });
    const evan = screen.getByRole("button", { name: /Evan.*planned/ });
    expect(evan).toBeEnabled();
    expect(evan.title).toMatch(/planned to pitch vs Cubs/);
  });

  it("marks a relieved arm as done and never offers it for a one-tap re-pin", () => {
    // Alice pitched innings 1-2, Bob relieved her for inning 3 (Alice moved
    // to 1B). Viewing inning 3: Alice is a dead arm — her Used row says so
    // and she must not appear in the Available re-pin pool (the engine's
    // documented coach-override door stays shut at the UI).
    const inn12 = oneInning();
    const inn3 = {
      P: bob,
      C: cara,
      "1B": alice,
      "2B": dave,
      BENCH: [evan],
    };
    const game = makeGame({ lineup: [inn12, oneInning(), inn3] });
    renderInGame({
      game,
      team: { teamAge: "10U", pitchingFormat: "Kid Pitch" },
      ui: { inGameInning: 2 },
    });
    expect(
      screen.getByText("Relieved — done for this game"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/pulled arm can't return to the mound/i),
    ).toBeInTheDocument();
    // No one-tap re-pin button for the relieved arm…
    expect(screen.queryByTitle(/Make Alice the pitcher/)).toBeNull();
    // …while a fresh arm is still offered.
    expect(screen.getByTitle(/Make Evan the pitcher/)).toBeInTheDocument();
  });

  it("shows no relieved marking while one arm has held the whole game", () => {
    const game = makeGame({ lineup: [oneInning(), oneInning()] });
    renderInGame({
      game,
      team: { teamAge: "10U", pitchingFormat: "Kid Pitch" },
      ui: { inGameInning: 1 },
    });
    expect(screen.queryByText(/Relieved — done for this game/)).toBeNull();
    expect(screen.queryByText(/pulled arm can't return/i)).toBeNull();
  });

  it("injury removal also persists an Out health status by default", () => {
    const { removePlayerMidGame, setPlayerHealth } = renderInGame();
    fireEvent.click(
      screen.getByLabelText("Remove a player (injured / ill / left)"),
    );
    // Two-tap confirm on Bob's row.
    const row = screen.getByRole("button", { name: /#2 Bob/ });
    fireEvent.click(row);
    fireEvent.click(row);
    expect(removePlayerMidGame).toHaveBeenCalledWith(
      "p2",
      expect.objectContaining({ reason: "injury" }),
    );
    expect(setPlayerHealth).toHaveBeenCalledWith("p2", {
      status: "out",
      note: "Removed mid-game (injury)",
    });
  });

  it("unticking the checkbox removes without touching health", () => {
    const { removePlayerMidGame, setPlayerHealth } = renderInGame();
    fireEvent.click(
      screen.getByLabelText("Remove a player (injured / ill / left)"),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    const row = screen.getByRole("button", { name: /#2 Bob/ });
    fireEvent.click(row);
    fireEvent.click(row);
    expect(removePlayerMidGame).toHaveBeenCalled();
    expect(setPlayerHealth).not.toHaveBeenCalled();
  });

  it("shows the run-diff cap advisory once a tournament pool lead hits the cap", () => {
    const game = makeGame({
      gameType: "pool",
      teamScore: 10,
      opponentScore: 1,
    });
    renderInGame({
      game,
      team: {
        tournaments: [{ id: "t1", name: "Bash", gameIds: ["g1"] }],
      },
    });
    expect(
      screen.getByText(/margin past \+8 doesn't count/i),
    ).toBeInTheDocument();
  });

  it("keeps the advisory quiet under the cap and outside a stored tournament", () => {
    renderInGame({
      game: makeGame({ gameType: "pool", teamScore: 6, opponentScore: 1 }),
      team: { tournaments: [{ id: "t1", name: "Bash", gameIds: ["g1"] }] },
    });
    expect(
      screen.queryByText(/doesn't count for tiebreakers/i),
    ).not.toBeInTheDocument();

    // Same blowout, but the game isn't claimed by any tournament.
    renderInGame({
      game: makeGame({ gameType: "pool", teamScore: 10, opponentScore: 1 }),
    });
    expect(
      screen.queryByText(/doesn't count for tiebreakers/i),
    ).not.toBeInTheDocument();
  });
});

// An in-game edit is a FACT: the inning the coach is on becomes exactly what
// they set — nothing is refused — and every inning after it is re-planned
// around what has happened.
describe("InGameView edits are facts, and the rest of the game re-plans", () => {
  const flushWrite = () =>
    act(() => {
      vi.advanceTimersByTime(500);
    });
  const lineupPatch = (updateGame: any) =>
    updateGame.mock.calls.find(([, patch]: any) => patch.lineup)?.[1].lineup;
  const lastToast = (toastValue: any) =>
    toastValue.push.mock.calls[toastValue.push.mock.calls.length - 1][0];

  // 11 kids, 9 in the field, Rec rules — a real engine-built game.
  const ALL = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  const roster = Array.from({ length: 11 }, (_, i) => ({
    id: `k${i}`,
    name: `Kid${i}`,
    number: String(i),
    comfortablePositions: ALL,
  }));
  const recTeam = {
    players: roster,
    leagueRuleSet: "NKB",
    defenseSize: "9",
    pitchingFormat: "Machine Pitch",
    teamAge: "10U",
    catcherMaxInnings: "2",
    catcherConsecutive: true,
  };
  const builtGame = () => {
    const res = generateLineup({
      activePlayers: roster,
      allPlayers: roster,
      games: [],
      evaluationEvents: [],
      currentGame: { id: "g1", date: "2026-07-01", opponent: "Rivals" },
      firstInningOverridesById: {},
      totalInnings: 4,
      leagueRuleSet: "NKB",
      teamAge: "10U",
      defenseSize: "9",
      positionLock: "0",
      battingSize: "roster",
      pitchingFormat: "Machine Pitch",
      catcherMaxInnings: "2",
      catcherConsecutive: true,
      seed: 3,
    } as any);
    expect(res.error).toBeUndefined();
    return makeGame({ lineup: res.lineup as any, battingLineup: roster });
  };

  it("sets the current inning exactly as tapped and re-plans every inning after it", () => {
    vi.useFakeTimers();
    try {
      const game = builtGame();
      const before = game.lineup[0] as any;
      const { updateGame, toastValue, uiValue } = renderInGame({
        game,
        team: recTeam,
        ui: { inGameSelection: { type: "position", pos: "1B" } },
      });
      fireEvent.click(screen.getByRole("button", { name: /2B/ }));
      flushWrite();

      const lineup = lineupPatch(updateGame);
      // Inning 1 is exactly the swap — nothing else in it moved.
      expect(lineup[0]).toEqual({
        ...before,
        "1B": before["2B"],
        "2B": before["1B"],
      });
      // Innings 2-4 are a full, valid re-plan.
      for (const inn of lineup.slice(1)) {
        const onField = ALL.map((pos) => inn[pos]?.id);
        expect(onField.every(Boolean)).toBe(true);
        const everyone = [...onField, ...inn.BENCH.map((b: any) => b.id)];
        expect(new Set(everyone).size).toBe(11);
      }
      // One undo snapshot holds the whole pre-edit game.
      const undoEntry = uiValue.setInGameUndoStack.mock.calls[0][0][0];
      expect(undoEntry.lineup).toEqual(game.lineup);
      const toast = lastToast(toastValue);
      expect(toast.kind).toBe("success");
      expect(toast.message).toMatch(/Innings 2–4 re-planned around it/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts a kid who isn't set as a catcher behind the plate, with a heads-up", () => {
    vi.useFakeTimers();
    try {
      const { updateGame, toastValue } = renderInGame({
        ui: { inGameSelection: { type: "position", pos: "C" } },
      });
      // Bob has no catcher clearance on the roster — applied anyway.
      fireEvent.click(screen.getByRole("button", { name: /1B/ }));
      flushWrite();
      const lineup = lineupPatch(updateGame);
      expect(lineup[0].C.id).toBe("p2");
      expect(lineup[0]["1B"].id).toBe("p3");
      const toast = lastToast(toastValue);
      expect(toast.kind).toBe("warn");
      expect(toast.message).toMatch(/Bob isn't set as a catcher/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies an arm-care conflict with a heads-up instead of refusing it", () => {
    vi.useFakeTimers();
    try {
      // Alice pitched inning 1; in inning 2 the coach puts her behind the plate.
      const game = makeGame({ lineup: [oneInning(), oneInning()] });
      const { updateGame, toastValue } = renderInGame({
        game,
        ui: {
          inGameInning: 1,
          inGameSelection: { type: "position", pos: "C" },
        },
      });
      fireEvent.click(screen.getByRole("button", { name: /^P\b/ }));
      flushWrite();
      const lineup = lineupPatch(updateGame);
      expect(lineup[1].C.id).toBe("p1");
      expect(lineup[1].P.id).toBe("p3");
      expect(lineup[0]).toEqual(oneInning()); // inning 1 is history
      const toast = lastToast(toastValue);
      expect(toast.kind).toBe("warn");
      expect(toast.message).toMatch(/Alice pitched this game/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the edit when the rest of the game can't be re-planned", () => {
    vi.useFakeTimers();
    try {
      // Five kids — too few for the engine — so the re-plan fails.
      const game = makeGame({ lineup: [oneInning(), oneInning()] });
      const { updateGame, toastValue } = renderInGame({
        game,
        ui: { inGameSelection: { type: "position", pos: "1B" } },
      });
      fireEvent.click(screen.getByRole("button", { name: /2B/ }));
      flushWrite();
      const lineup = lineupPatch(updateGame);
      expect(lineup[0]["1B"].id).toBe("p4");
      expect(lineup[0]["2B"].id).toBe("p2");
      expect(lineup[1]).toEqual(oneInning()); // keeps its old plan
      const toast = lastToast(toastValue);
      expect(toast.kind).toBe("warn");
      expect(toast.message).toMatch(/Couldn't re-plan inning 2/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a pitching change from the Available list trades places with the pitcher this inning", () => {
    vi.useFakeTimers();
    try {
      const { updateGame, toastValue } = renderInGame();
      fireEvent.click(screen.getByTitle("Make Evan the pitcher for inning 1"));
      flushWrite();
      const lineup = lineupPatch(updateGame);
      expect(lineup[0].P.id).toBe("p5");
      expect(lineup[0].BENCH.map((b: any) => b.id)).toEqual(["p1"]);
      expect(lineup[0].C.id).toBe("p3"); // nobody else moved
      expect(lastToast(toastValue).title).toBe("Pitching change");
    } finally {
      vi.useRealTimers();
    }
  });

  it("undo restores the whole game, including the re-planned innings", () => {
    vi.useFakeTimers();
    try {
      const snapshot = [oneInning(), oneInning()];
      const game = makeGame({
        lineup: [{ ...oneInning(), "1B": dave, "2B": bob }, oneInning()],
      });
      const { updateGame } = renderInGame({
        game,
        ui: { inGameUndoStack: [{ lineup: snapshot, locks: {} }] },
      });
      fireEvent.click(screen.getByLabelText("Undo last swap"));
      flushWrite();
      expect(lineupPatch(updateGame)).toEqual(snapshot);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("InGameView — inning memory, closing, pitch counts", () => {
  it("saves the inning on the game as the head coach steps through it", () => {
    const twoInnings = makeGame({ lineup: [oneInning(), oneInning()] });
    const { updateGame, uiValue } = renderInGame({ game: twoInnings });
    fireEvent.click(screen.getByLabelText("Next inning"));
    expect(uiValue.setInGameInning).toHaveBeenCalledWith(1);
    expect(updateGame).toHaveBeenCalledWith("g1", { liveInning: 1 });
  });

  it("an assistant's view follows the head coach's saved inning", () => {
    const game = makeGame({
      lineup: [oneInning(), oneInning(), oneInning()],
      liveInning: 2,
    });
    const { uiValue, updateGame } = renderInGame({ role: "assistant", game });
    expect(uiValue.setInGameInning).toHaveBeenCalledWith(2);
    expect(updateGame).not.toHaveBeenCalled();
  });

  it("closing keeps the undo history (it survives until another game opens)", () => {
    const { uiValue } = renderInGame({
      ui: { inGameUndoStack: [{ lineup: [oneInning()], locks: {} }] },
    });
    fireEvent.click(screen.getByLabelText("Close in-game mode"));
    expect(uiValue.setInGameId).toHaveBeenCalledWith(null);
    expect(uiValue.setInGameUndoStack).not.toHaveBeenCalled();
  });

  it("counts pitches for the pitcher and saves them as this game's outing", () => {
    const { updatePlayer } = renderInGame();
    fireEvent.click(screen.getByLabelText("Five more pitches for Alice"));
    fireEvent.click(screen.getByLabelText("One more pitch for Alice"));
    expect(
      screen.getByLabelText("Alice: 6 pitches this game"),
    ).toBeInTheDocument();
    const [id, patch] =
      updatePlayer.mock.calls[updatePlayer.mock.calls.length - 1];
    expect(id).toBe("p1");
    // ONE outing for this game, tagged with its id — what a later box-score
    // import replaces.
    const outings = patch.pitching.log.filter((o: any) => o.gameId === "g1");
    expect(outings).toEqual([
      expect.objectContaining({ date: "2026-07-01", pitches: 6, gameId: "g1" }),
    ]);
  });

  it("taking the count back to zero removes this game's outing", () => {
    const game = makeGame();
    const { updatePlayer } = renderInGame({
      game,
      team: {
        players: [
          {
            ...alice,
            pitching: {
              log: [{ date: "2026-07-01", pitches: 1, gameId: "g1" }],
            },
          },
          bob,
          cara,
          dave,
          evan,
        ],
      },
    });
    expect(
      screen.getByLabelText("Alice: 1 pitches this game"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("One fewer pitch for Alice"));
    const [, patch] =
      updatePlayer.mock.calls[updatePlayer.mock.calls.length - 1];
    expect((patch.pitching.log || []).some((o: any) => o.gameId === "g1")).toBe(
      false,
    );
  });
});
