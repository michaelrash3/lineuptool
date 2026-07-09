import React from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("persists a league-rules change via updateTeam (interaction)", async () => {
    const { teamValue } = renderWithProviders(<SettingsTab />, {
      team: {
        team: teamData,
        currentRole: "head",
        realRole: "head",
        updateTeam: jest.fn(),
      },
      ui: {
        isAddingCoach: false,
        setIsAddingCoach: jest.fn(),
        newCoachForm: {},
        setNewCoachForm: jest.fn(),
        setPastSeasonImport: jest.fn(),
      },
    });
    const leagueSelect = screen
      .getAllByRole("combobox")
      .find((sel) => within(sel).queryByText("Tournament"));
    expect(leagueSelect).toBeTruthy();
    await userEvent.selectOptions(leagueSelect as HTMLSelectElement, "NKB");
    expect(teamValue.updateTeam).toHaveBeenCalledWith({ leagueRuleSet: "NKB" });
  });

  it("turns a feature off and back on from the Features section", async () => {
    const { teamValue } = renderWithProviders(<SettingsTab />, {
      team: {
        team: { ...teamData, disabledFeatures: ["tryouts"] },
        currentRole: "head",
        realRole: "head",
        updateTeam: jest.fn(),
      },
      ui: {
        isAddingCoach: false,
        setIsAddingCoach: jest.fn(),
        newCoachForm: {},
        setNewCoachForm: jest.fn(),
        setPastSeasonImport: jest.fn(),
      },
    });
    await userEvent.click(screen.getByRole("button", { name: /Features/ }));
    // Finances is on → unchecking it disables it ALONGSIDE the stored tryouts.
    const finances = screen.getByRole("checkbox", {
      name: "Finances feature",
    });
    expect(finances).toBeChecked();
    await userEvent.click(finances);
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      disabledFeatures: ["tryouts", "finances"],
    });
    // Tryouts is stored as off → its switch reads unchecked, and re-checking
    // it re-enables (leaving nothing disabled from THIS fixture's list).
    const tryouts = screen.getByRole("checkbox", { name: "Tryouts feature" });
    expect(tryouts).not.toBeChecked();
    await userEvent.click(tryouts);
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      disabledFeatures: [],
    });
  });
});
