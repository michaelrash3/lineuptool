import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, act } from "@testing-library/react";
import { InGameView } from "./InGameView";
import { renderWithProviders } from "../test-utils";
import { DEFAULT_TEAM_DATA } from "../constants/ui";
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
  const finalizeGame = vi.fn();
  const removePlayerMidGame = vi.fn();
  const setPlayerHealth = vi.fn();
  const utils = renderWithProviders(<InGameView />, {
    team: {
      team: { ...DEFAULT_TEAM_DATA, players, games: [game], ...teamOver },
      currentRole: role,
      realRole: role,
      updateGame,
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
  });
  return {
    ...utils,
    updateGame,
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
});
