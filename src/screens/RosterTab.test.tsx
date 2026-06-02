import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RosterTab } from "./RosterTab";
import { renderWithProviders } from "../test-utils";

const players = [
  { id: "p1", name: "Ava Rivera", number: "7", comfortablePositions: ["SS"] },
  { id: "p2", name: "Mia Stone", number: "12", comfortablePositions: ["C"] },
];

describe("RosterTab", () => {
  it("renders the roster header and each player's name", () => {
    renderWithProviders(<RosterTab />, {
      team: { team: { players, games: [] }, currentRole: "head" },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    expect(screen.getByText("Team Roster")).toBeInTheDocument();
    expect(screen.getByText("Ava Rivera")).toBeInTheDocument();
    expect(screen.getByText("Mia Stone")).toBeInTheDocument();
  });

  it("invokes setIsAddingPlayer when a head coach taps Add Player", async () => {
    const setIsAddingPlayer = jest.fn();
    renderWithProviders(<RosterTab />, {
      team: { team: { players, games: [] }, currentRole: "head" },
      ui: { setIsAddingPlayer },
    });
    await userEvent.click(screen.getByRole("button", { name: /add player/i }));
    expect(setIsAddingPlayer).toHaveBeenCalledWith(true);
  });

  it("shows the empty state when there are no players", () => {
    renderWithProviders(<RosterTab />, {
      team: { team: { players: [], games: [] }, currentRole: "head" },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    expect(screen.getByText("No Roster Found")).toBeInTheDocument();
  });

  it("opens a player's profile when their name is tapped (interaction)", async () => {
    const { uiValue } = renderWithProviders(<RosterTab />, {
      team: { team: { players, games: [] }, currentRole: "head" },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    await userEvent.click(screen.getByRole("button", { name: "Ava Rivera" }));
    expect(uiValue.openPlayerProfile).toHaveBeenCalledWith("p1");
  });
});
