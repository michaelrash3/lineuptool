import React from "react";
import { screen } from "@testing-library/react";
import { SettingsTab } from "./SettingsTab";
import { renderWithProviders } from "../test-utils";

const teamData = {
  leagueRuleSet: "USSSA",
  pitchingFormat: "Kid Pitch",
  teamAge: "10U",
  inningsCount: 6,
  positionLock: false,
  battingSize: 10,
  defenseSize: 9,
  catcherMaxInnings: 2,
  catcherConsecutive: false,
  primaryColor: "#1d4ed8",
  secondaryColor: "#0f172a",
  tertiaryColor: "#ffffff",
  logoUrl: "",
  coaches: [],
  players: [],
  currentSeason: "Spring 2026",
};

describe("SettingsTab", () => {
  it("renders the settings shell on the default Team section", () => {
    renderWithProviders(<SettingsTab />, {
      team: { team: teamData, currentRole: "head", realRole: "head" },
      ui: {
        isAddingCoach: false,
        setIsAddingCoach: jest.fn(),
        newCoachForm: {},
        setNewCoachForm: jest.fn(),
        setPastSeasonImport: jest.fn(),
      },
    });
    expect(screen.getByText("Team Settings")).toBeInTheDocument();
  });
});
