import React from "react";
import { screen } from "@testing-library/react";
import { HomeTab } from "./HomeTab";
import { renderWithProviders } from "../test-utils";

const emptyTeam = {
  players: [],
  coaches: [],
  games: [],
  evaluationEvents: [],
  leagueRuleSet: "USSSA",
  teamAge: "10U",
  currentSeason: "Spring 2026",
  pitchingFormat: "Kid Pitch",
  primaryColor: "#1d4ed8",
  tertiaryColor: "#ffffff",
};

describe("HomeTab", () => {
  it("renders the dashboard without crashing for an empty team", () => {
    renderWithProviders(<HomeTab />, {
      team: {
        team: emptyTeam,
        teams: [{ id: "t1", name: "Hawks" }],
        activeTeamId: "t1",
        record: { wins: 0, losses: 0, ties: 0 },
        user: { uid: "u1" },
        currentRole: "head",
      },
      ui: {
        setIsAddingGame: jest.fn(),
        setIsAddingPlayer: jest.fn(),
      },
    });
    // With an empty roster the dashboard shows a "get a roster in place"
    // prompt — a stable anchor proving the screen mounted without crashing.
    expect(
      screen.getByText(/add players to the roster/i)
    ).toBeInTheDocument();
  });
});
