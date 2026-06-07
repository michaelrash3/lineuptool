import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { StatsTab } from "./StatsTab";
import { renderWithProviders } from "../test-utils";

const team = {
  players: [
    {
      id: "a",
      name: "Apex",
      number: "1",
      stats: { ab: 20, ops: 1.2, avg: 0.4, hr: 3, pEra: 2.5, pWhip: 1.1 },
    },
    {
      id: "b",
      name: "Bolt",
      number: "2",
      stats: { ab: 18, ops: 0.6, avg: 0.25, hr: 0, pEra: 6.0, pWhip: 1.9 },
    },
  ],
  games: [],
  evaluationEvents: [],
  primaryColor: "#1d4ed8",
  tertiaryColor: "#ffffff",
};

describe("StatsTab", () => {
  it("shows an empty state when there are no players", () => {
    renderWithProviders(<StatsTab />, { team: { team: { players: [], games: [] } } });
    expect(screen.getByText("Stats & Dashboard")).toBeInTheDocument();
    expect(
      screen.getByText(/Add players and import stats/i)
    ).toBeInTheDocument();
  });

  it("renders the batting table with players and sortable headers", () => {
    renderWithProviders(<StatsTab />, { team: { team } });
    expect(screen.getByRole("button", { name: /OPS/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Overall/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apex/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bolt/ })).toBeInTheDocument();
    // Pitching-only columns are not shown in the batting view.
    expect(screen.queryByRole("button", { name: /WHIP/ })).toBeNull();
  });

  it("switches to the pitching view and reveals pitching columns", () => {
    renderWithProviders(<StatsTab />, { team: { team } });
    fireEvent.click(screen.getByRole("button", { name: "Pitching" }));
    expect(screen.getByRole("button", { name: /WHIP/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ERA/ })).toBeInTheDocument();
  });

  it("opens the player profile when a name is tapped", () => {
    const openPlayerProfile = jest.fn();
    renderWithProviders(<StatsTab />, {
      team: { team },
      ui: { openPlayerProfile },
    });
    fireEvent.click(screen.getByRole("button", { name: /Apex/ }));
    expect(openPlayerProfile).toHaveBeenCalledWith("a");
  });
});
