import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PositionVarietyPanel } from "./PositionVarietyPanel";
import { renderWithProviders } from "../test-utils";

const inning = (assign: any) => ({ ...assign, BENCH: [] });
const finalGame = {
  id: "g1",
  status: "final",
  teamScore: 5,
  opponentScore: 3,
  lineup: [
    inning({ SS: { id: "p1" }, LF: { id: "p2" } }),
    inning({ SS: { id: "p1" }, CF: { id: "p2" } }),
  ],
};
const players = [
  { id: "p1", name: "Ava Rivera", number: "7" },
  { id: "p2", name: "Mia Stone", number: "9" },
];

describe("PositionVarietyPanel", () => {
  it("renders nothing until there is finalized-game data", () => {
    const { container } = renderWithProviders(<PositionVarietyPanel />, {
      team: { team: { players, games: [] } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("lists players with their positions and flags one-position players", () => {
    renderWithProviders(<PositionVarietyPanel />, {
      team: { team: { players, games: [finalGame] } },
    });
    expect(screen.getByText("Position Variety")).toBeInTheDocument();
    // Ava only played SS across both innings -> "1 position" flag.
    expect(screen.getByText("#7 Ava Rivera")).toBeInTheDocument();
    expect(screen.getByText("1 position")).toBeInTheDocument();
    // Mia played LF and CF -> chips for both.
    expect(screen.getByText("LF 1")).toBeInTheDocument();
    expect(screen.getByText("CF 1")).toBeInTheDocument();
  });

  it("opens a player's profile when their name is tapped", async () => {
    const { uiValue } = renderWithProviders(<PositionVarietyPanel />, {
      team: { team: { players, games: [finalGame] } },
    });
    await userEvent.click(screen.getByText("#7 Ava Rivera"));
    expect(uiValue.openPlayerProfile).toHaveBeenCalledWith("p1");
  });
});
