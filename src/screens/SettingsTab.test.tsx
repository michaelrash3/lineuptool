import React from "react";
import { screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
    renderWithProviders(
      <MemoryRouter>
        <SettingsTab />
      </MemoryRouter>,
      {
        team: { team: teamData, currentRole: "head", realRole: "head" },
        ui: {
          isAddingCoach: false,
          setIsAddingCoach: jest.fn(),
          newCoachForm: {},
          setNewCoachForm: jest.fn(),
        },
      },
    );
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("persists a league-rules change via updateTeam (interaction)", async () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <SettingsTab />
      </MemoryRouter>,
      {
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
        },
      },
    );
    const leagueSelect = screen
      .getAllByRole("combobox")
      .find((sel) => within(sel).queryByText("Tournament"));
    expect(leagueSelect).toBeTruthy();
    await userEvent.selectOptions(leagueSelect as HTMLSelectElement, "NKB");
    expect(teamValue.updateTeam).toHaveBeenCalledWith({ leagueRuleSet: "NKB" });
  });

  it("renames the team from Settings (commit on blur, blank snaps back)", async () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <SettingsTab />
      </MemoryRouter>,
      {
        team: {
          team: { ...teamData, name: "Hawks" },
          currentRole: "head",
          realRole: "head",
          updateTeam: jest.fn(),
        },
        ui: {
          isAddingCoach: false,
          setIsAddingCoach: jest.fn(),
          newCoachForm: {},
          setNewCoachForm: jest.fn(),
        },
      },
    );
    const input = screen.getByLabelText("Team name");
    expect(input).toHaveValue("Hawks");
    await userEvent.clear(input);
    await userEvent.type(input, "  River Hawks  ");
    fireEvent.blur(input);
    expect(teamValue.updateTeam).toHaveBeenCalledWith({ name: "River Hawks" });
    // Blanking the field must never erase the stored name.
    (teamValue.updateTeam as jest.Mock).mockClear();
    await userEvent.clear(input);
    fireEvent.blur(input);
    expect(teamValue.updateTeam).not.toHaveBeenCalled();
    expect(input).toHaveValue("Hawks");
  });

  it("no longer offers a Reminders section", () => {
    renderWithProviders(
      <MemoryRouter>
        <SettingsTab />
      </MemoryRouter>,
      {
        team: { team: teamData, currentRole: "head", realRole: "head" },
        ui: {
          isAddingCoach: false,
          setIsAddingCoach: jest.fn(),
          newCoachForm: {},
          setNewCoachForm: jest.fn(),
        },
      },
    );
    expect(
      screen.queryByRole("button", { name: /Reminders/ }),
    ).not.toBeInTheDocument();
  });

  it("Staff panel resolves member names, shows the owner, and toggles roles", async () => {
    const user = userEvent.setup();
    const setCoachRole = jest.fn();
    renderWithProviders(
      <MemoryRouter>
        <SettingsTab />
      </MemoryRouter>,
      {
        team: {
          team: {
            ...teamData,
            ownerId: "ownerUID",
            members: ["ownerUID", "asstUID"],
            coachRoles: { asstUID: "assistant" },
            coachContacts: [{ uid: "asstUID", name: "Coach Bob" }],
          },
          currentRole: "head",
          realRole: "head",
          user: { uid: "ownerUID" },
          setCoachRole,
        },
        ui: {
          isAddingCoach: false,
          setIsAddingCoach: jest.fn(),
          newCoachForm: {},
          setNewCoachForm: jest.fn(),
        },
      },
    );
    await user.click(screen.getByRole("button", { name: /^Staff$/ }));
    // Display-only names block is clearly relabeled.
    expect(screen.getByText("Lineup-Card Coaches")).toBeInTheDocument();
    // Real-access block resolves the member's name from coachContacts (not a
    // truncated UID) and surfaces the owner row.
    expect(screen.getByText("Coach Bob")).toBeInTheDocument();
    expect(screen.getByText("Head Coach · Owner")).toBeInTheDocument();
    // Role toggle drives the real setCoachRole mutation.
    await user.click(screen.getByRole("button", { name: "Make Head" }));
    expect(setCoachRole).toHaveBeenCalledWith("asstUID", "head");
  });

  it("turns a feature off and back on from the Features section", async () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <SettingsTab />
      </MemoryRouter>,
      {
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
        },
      },
    );
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

describe("SettingsTab — 9U+ pitching format is fixed to Kid Pitch", () => {
  const renderSettings = (over: Record<string, unknown> = {}) =>
    renderWithProviders(
      <MemoryRouter>
        <SettingsTab />
      </MemoryRouter>,
      {
        team: {
          team: { ...teamData, ...over },
          currentRole: "head",
          realRole: "head",
          updateTeam: jest.fn(),
        },
        ui: {
          isAddingCoach: false,
          setIsAddingCoach: jest.fn(),
          newCoachForm: {},
          setNewCoachForm: jest.fn(),
        },
      },
    );

  it("shows a read-only Kid Pitch pill at 10U — no Machine/Coach anywhere", () => {
    renderSettings();
    expect(screen.getByText("Kid Pitch")).toBeInTheDocument();
    expect(screen.queryByText("Machine Pitch")).not.toBeInTheDocument();
    expect(screen.queryByText("Coach Pitch")).not.toBeInTheDocument();
  });

  it("keeps the Kid/Coach dropdown for an 8U USSSA team", () => {
    renderSettings({ teamAge: "8U" });
    expect(
      screen.getByRole("option", { name: "Coach Pitch" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Machine Pitch" }),
    ).not.toBeInTheDocument();
  });
});
