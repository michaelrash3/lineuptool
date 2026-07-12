import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameFinalizePage } from "./GameFinalizePage";
import { renderWithProviders } from "../../test-utils";

const game = {
  id: "g1",
  date: "2026-07-01",
  opponent: "Rivals",
  teamScore: 5,
  opponentScore: 3,
  lineup: [{}, {}, {}, {}, {}, {}],
};

const renderPage = (path = "/schedule/game/g1/final", ctxOver: any = {}) => {
  const finalizeGame = jest.fn();
  const updateGame = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule" element={<div>SCHEDULE LIST</div>} />
        <Route
          path="/schedule/game/:gameId/final"
          element={<GameFinalizePage />}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: {
          games: [game],
          primaryColor: "#1d4ed8",
          tertiaryColor: "#fff",
        },
        currentRole: "head",
        finalizeGame,
        updateGame,
        ...ctxOver,
      },
    },
  );
  return { finalizeGame, updateGame, ...utils };
};

describe("GameFinalizePage", () => {
  it("finalizes the routed game and lands on the schedule", () => {
    const { finalizeGame } = renderPage();
    expect(screen.getByText("Final Score")).toBeInTheDocument();
    expect(screen.getByText(/vs\. Rivals/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save final/i }));
    expect(finalizeGame).toHaveBeenCalledWith("g1", 5, 3, 6);
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("Cancel goes back without finalizing", () => {
    window.history.replaceState({ idx: 0 }, "");
    const { finalizeGame } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(finalizeGame).not.toHaveBeenCalled();
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects an unknown game to the schedule", () => {
    renderPage("/schedule/game/nope/final");
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects assistants to the schedule", () => {
    renderPage("/schedule/game/g1/final", { currentRole: "assistant" });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });
});
