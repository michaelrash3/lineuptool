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

const lineup = [
  {
    P: { id: "p1", name: "Pitcher" },
    C: { id: "p2", name: "Catcher" },
    "1B": { id: "p3", name: "First Base" },
    "2B": { id: "p4", name: "Second Base" },
    "3B": { id: "p5", name: "Third Base" },
    SS: { id: "p6", name: "Shortstop" },
    LF: { id: "p7", name: "Left Field" },
    CF: { id: "p8", name: "Center Field" },
    RF: { id: "p9", name: "Right Field" },
    BENCH: [],
  },
  {
    P: { id: "p2", name: "Catcher" },
    C: { id: "p1", name: "Pitcher" },
    "1B": { id: "p3", name: "First Base" },
    "2B": { id: "p4", name: "Second Base" },
    "3B": { id: "p5", name: "Third Base" },
    SS: { id: "p6", name: "Shortstop" },
    LF: { id: "p7", name: "Left Field" },
    CF: { id: "p8", name: "Center Field" },
    RF: { id: "p9", name: "Right Field" },
    BENCH: [],
  },
];

const players = [
  { id: "p1", name: "Pitcher" },
  { id: "p2", name: "Catcher" },
  { id: "p3", name: "First Base" },
  { id: "p4", name: "Second Base" },
  { id: "p5", name: "Third Base" },
  { id: "p6", name: "Shortstop" },
  { id: "p7", name: "Left Field" },
  { id: "p8", name: "Center Field" },
  { id: "p9", name: "Right Field" },
];

const renderGameEditor = (leagueRuleSet: string) => {
  const handleCellClick = jest.fn();
  return renderWithProviders(<ScheduleTab />, {
    team: {
      team: {
        ...baseTeam,
        leagueRuleSet,
        players,
        games: [
          {
            id: "g1",
            date: "2026-05-01",
            opponent: "Rays",
            status: "scheduled",
            leagueRuleSet,
            pitchingFormat: "Kid Pitch",
            defenseSize: 9,
            battingSize: 9,
            lineup,
            battingLineup: players,
          },
        ],
      },
      record: { wins: 0, losses: 0, ties: 0 },
      currentRole: "head",
      updateGame: jest.fn(),
      saveCurrentGame: jest.fn(),
      saveAttendance: jest.fn(),
    },
    ui: {
      selectedGameId: "g1",
      currentGameAttendance: {},
      setCurrentGameAttendance: jest.fn(),
      firstInningLineup: {},
      setFirstInningLineup: jest.fn(),
      lineup,
      battingLineup: players,
      swapSelection: null,
      handleCellClick,
      addInning: jest.fn(),
      removeInning: jest.fn(),
      moveBatter: jest.fn(),
    },
  });
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
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("No Games Scheduled")).toBeInTheDocument();
  });

  it("lists scheduled games by opponent", () => {
    renderWithProviders(<ScheduleTab />, {
      team: {
        team: {
          ...baseTeam,
          games: [
            {
              id: "g1",
              date: "2026-05-01",
              opponent: "Rays",
              status: "scheduled",
            },
            {
              id: "g2",
              date: "2026-05-08",
              opponent: "Cubs",
              status: "scheduled",
            },
          ],
        },
        record: { wins: 0, losses: 0, ties: 0 },
        currentRole: "head",
      },
    });
    expect(screen.queryByText("No Games Scheduled")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Rays/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Cubs/).length).toBeGreaterThan(0);
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

  it("deletes a game from its row action (interaction)", async () => {
    const { teamValue } = renderWithProviders(<ScheduleTab />, {
      team: {
        team: {
          ...baseTeam,
          games: [
            {
              id: "g1",
              date: "2026-05-01",
              opponent: "Rays",
              status: "scheduled",
            },
          ],
        },
        record: { wins: 0, losses: 0, ties: 0 },
        currentRole: "head",
        deleteSavedGame: jest.fn(),
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete game" }));
    expect(teamValue.deleteSavedGame).toHaveBeenCalledWith("g1");
  });

  it("shows the Starting Lineup in tournament game edit view when a lineup exists", () => {
    renderGameEditor("USSSA");

    expect(screen.getByText("Starting Lineup")).toBeInTheDocument();
  });

  it("does not show the Active Lineup Grid in tournament game edit view", () => {
    renderGameEditor("USSSA");

    expect(screen.queryByText("Active Lineup Grid")).not.toBeInTheDocument();
  });

  it("only shows the first inning for tournament game lineups", () => {
    renderGameEditor("USSSA");

    expect(screen.getByText("Inn 1")).toBeInTheDocument();
    expect(screen.queryByText("Inn 2")).not.toBeInTheDocument();
  });

  it("keeps the tournament starting lineup editable", async () => {
    const { uiValue } = renderGameEditor("USSSA");

    await userEvent.click(
      screen.getAllByRole("button", { name: "Inning 1, P: Pitcher" })[0],
    );

    expect(uiValue.handleCellClick).toHaveBeenCalledWith(
      0,
      "P",
      expect.objectContaining({ id: "p1", name: "Pitcher" }),
    );
  });

  it("shows the Active Lineup Grid in non-tournament game edit view when a lineup exists", () => {
    renderGameEditor("NKB");

    expect(screen.getByText("Active Lineup Grid")).toBeInTheDocument();
  });
});
