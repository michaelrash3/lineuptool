import React from "react";
import { screen } from "@testing-library/react";
import { StartingPitcherPicker } from "./StartingPitcherPicker";
import { renderWithProviders } from "../test-utils";

const players = [
  {
    id: "p1",
    name: "Ace",
    number: "1",
    comfortablePositions: ["P"],
    pitching: {},
  },
  {
    id: "p2",
    name: "Lefty",
    number: "2",
    comfortablePositions: ["P"],
    pitching: {},
  },
];

const g1 = { id: "g1", date: "2099-06-05", opponent: "Rays", gameType: "pool" };
const g2 = {
  id: "g2",
  date: "2099-06-06",
  opponent: "Cubs",
  gameType: "bracket",
};

const baseTeam = (over: any = {}) => ({
  players,
  games: [g1, g2],
  evaluationEvents: [],
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  ...over,
});

const withTournament = (pitchPlan: any) =>
  baseTeam({
    tournaments: [
      { id: "t1", name: "Bash", gameIds: ["g1", "g2"], pitchPlan },
    ],
  });

describe("StartingPitcherPicker", () => {
  it("marks the tournament plan's starter as Planned instead of Suggested", () => {
    renderWithProviders(
      <StartingPitcherPicker
        game={{ ...g2, pitchingFormat: "Kid Pitch" }}
      />,
      {
        team: {
          team: withTournament({
            g2: [{ playerId: "p2", role: "start", plannedPitches: 50 }],
          }),
          currentRole: "head",
          generateLineup: jest.fn(),
        },
      },
    );
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("discounts an arm planned for an earlier tournament game", () => {
    renderWithProviders(
      <StartingPitcherPicker
        game={{ ...g2, pitchingFormat: "Kid Pitch" }}
      />,
      {
        team: {
          team: withTournament({
            g1: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
          }),
          currentRole: "head",
          generateLineup: jest.fn(),
        },
      },
    );
    // Ace threw a planned 60 the day before → Rest chip; Lefty selectable.
    expect(screen.getByText("Rest")).toBeInTheDocument();
    expect(screen.getByText("Ace").closest("button")).toBeDisabled();
    expect(screen.getByText("Lefty").closest("button")).toBeEnabled();
  });

  it("keeps the heuristic recommendation when the game has no tournament plan", () => {
    renderWithProviders(
      <StartingPitcherPicker
        game={{ ...g1, pitchingFormat: "Kid Pitch" }}
      />,
      {
        team: {
          team: baseTeam(),
          currentRole: "head",
          generateLineup: jest.fn(),
        },
      },
    );
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
  });
});
