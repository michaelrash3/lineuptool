import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduleTab } from "./ScheduleTab";
import { renderWithProviders } from "../test-utils";

const baseTeam = {
  games: [],
  players: [],
  leagueRuleSet: "USSSA",
  pitchingFormat: "Kid Pitch",
  defenseSize: 9,
  positionLock: false,
  battingSize: 10,
  teamAge: "10U",
  primaryColor: "#1d4ed8",
  tertiaryColor: "#ffffff",
  logoUrl: "",
};

describe("ScheduleTab", () => {
  it("renders the schedule header and the empty state with no games", () => {
    renderWithProviders(<ScheduleTab />, {
      team: {
        team: baseTeam,
        record: { wins: 0, losses: 0, ties: 0 },
        currentRole: "head",
      },
    });
    expect(screen.getByText("Schedule & Lineups")).toBeInTheDocument();
    expect(screen.getByText("No Games Scheduled")).toBeInTheDocument();
  });

  it("lists scheduled games by opponent", () => {
    renderWithProviders(<ScheduleTab />, {
      team: {
        team: {
          ...baseTeam,
          games: [
            { id: "g1", date: "2026-05-01", opponent: "Rays", status: "scheduled" },
            { id: "g2", date: "2026-05-08", opponent: "Cubs", status: "scheduled" },
          ],
        },
        record: { wins: 0, losses: 0, ties: 0 },
        currentRole: "head",
      },
    });
    expect(screen.queryByText("No Games Scheduled")).not.toBeInTheDocument();
    expect(screen.getByText(/Rays/)).toBeInTheDocument();
    expect(screen.getByText(/Cubs/)).toBeInTheDocument();
  });

  it("submits the add-game form with the entered values (interaction)", async () => {
    const newGameForm = {
      date: "2026-05-01",
      opponent: "Rays",
      leagueRuleSet: "USSSA",
      pitchingFormat: "Kid Pitch",
    };
    const { teamValue } = renderWithProviders(<ScheduleTab />, {
      team: {
        team: baseTeam,
        record: { wins: 0, losses: 0, ties: 0 },
        currentRole: "head",
        addGame: jest.fn(),
      },
      ui: {
        isAddingGame: true,
        newGameForm,
        setNewGameForm: jest.fn(),
        setIsAddingGame: jest.fn(),
      },
    });
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(teamValue.addGame).toHaveBeenCalledWith(newGameForm);
  });
});
