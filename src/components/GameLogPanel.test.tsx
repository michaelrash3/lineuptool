import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameLogPanel } from "./GameLogPanel";
import { renderWithProviders } from "../test-utils";

const games = [
  { id: "g1", date: "2026-05-01", opponent: "Rays", status: "final", teamScore: 5, opponentScore: 3 },
  { id: "g2", date: "2026-05-08", opponent: "Cubs", status: "final", teamScore: 2, opponentScore: 6 },
  { id: "g3", date: "2026-05-15", opponent: "Sox", status: "scheduled" },
];

describe("GameLogPanel", () => {
  it("hides until a game is finalized", () => {
    const { container } = renderWithProviders(<GameLogPanel />, {
      team: { team: { games: [{ id: "x", status: "scheduled" }] } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("lists finalized results most-recent-first with scores and streak", () => {
    renderWithProviders(<GameLogPanel />, { team: { team: { games } } });
    expect(screen.getByText("Game Log")).toBeInTheDocument();
    expect(screen.getByText("vs Rays")).toBeInTheDocument();
    expect(screen.getByText("vs Cubs")).toBeInTheDocument();
    expect(screen.getByText("5–3")).toBeInTheDocument();
    // Most recent game (Cubs) was a loss -> current streak L1.
    expect(screen.getByText(/Streak L1/)).toBeInTheDocument();
    // Scheduled game is not in the log.
    expect(screen.queryByText("vs Sox")).not.toBeInTheDocument();
  });

  it("jumps to the game on the Schedule tab when a row is tapped", async () => {
    const { uiValue } = renderWithProviders(<GameLogPanel />, {
      team: { team: { games } },
    });
    await userEvent.click(screen.getByText("vs Rays"));
    expect(uiValue.setSelectedGameId).toHaveBeenCalledWith("g1");
    expect(uiValue.setActiveTab).toHaveBeenCalledWith("schedule");
  });
});
