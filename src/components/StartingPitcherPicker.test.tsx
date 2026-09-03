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
    tournaments: [{ id: "t1", name: "Bash", gameIds: ["g1", "g2"], pitchPlan }],
  });

describe("StartingPitcherPicker", () => {
  it("marks the tournament plan's starter as Planned instead of Suggested", () => {
    renderWithProviders(
      <StartingPitcherPicker game={{ ...g2, pitchingFormat: "Kid Pitch" }} />,
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
      <StartingPitcherPicker game={{ ...g2, pitchingFormat: "Kid Pitch" }} />,
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

  it("marks a STANDALONE game's week-planner starter as Planned", () => {
    // The week planner writes standalone plans to game.pitchPlan — no stored
    // tournament involved. The picker must honor them the same way.
    const planned = {
      ...g2,
      pitchingFormat: "Kid Pitch",
      pitchPlan: [{ playerId: "p2", role: "start", plannedPitches: 50 }],
    };
    renderWithProviders(<StartingPitcherPicker game={planned} />, {
      team: {
        team: baseTeam({ games: [g1, planned] }),
        currentRole: "head",
        generateLineup: jest.fn(),
      },
    });
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("discounts an arm planned for an earlier STANDALONE game", () => {
    // Wednesday's rec-game plan (game.pitchPlan) burns the arm for the
    // weekend even though neither game is in a stored tournament — the
    // pre-fix blind spot.
    const wed = {
      ...g1,
      pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
    };
    renderWithProviders(
      <StartingPitcherPicker game={{ ...g2, pitchingFormat: "Kid Pitch" }} />,
      {
        team: {
          team: baseTeam({ games: [wed, g2] }),
          currentRole: "head",
          generateLineup: jest.fn(),
        },
      },
    );
    expect(screen.getByText("Rest")).toBeInTheDocument();
    expect(screen.getByText("Ace").closest("button")).toBeDisabled();
    expect(screen.getByText("Lefty").closest("button")).toBeEnabled();
  });

  it("keeps an arm pickable for game 2 of a doubleheader, on the day's remainder", () => {
    // Both games on 2099-06-05. Ace is planned for 40 in the opener; 10U's
    // daily max is 75, so he is still a legal starter here with 35 left.
    const dhEarly = { ...g1, startUtc: "2099-06-05T14:00:00Z" };
    const dhLate = {
      ...g2,
      date: "2099-06-05",
      startUtc: "2099-06-05T18:00:00Z",
      pitchingFormat: "Kid Pitch",
    };
    renderWithProviders(<StartingPitcherPicker game={dhLate} />, {
      team: {
        team: baseTeam({
          games: [dhEarly, dhLate],
          tournaments: [
            {
              id: "t1",
              name: "Bash",
              gameIds: ["g1", "g2"],
              pitchPlan: {
                g1: [{ playerId: "p1", role: "start", plannedPitches: 40 }],
              },
            },
          ],
        }),
        currentRole: "head",
        generateLineup: jest.fn(),
      },
    });
    expect(screen.getByText("Ace").closest("button")).toBeEnabled();
    expect(screen.getByText(/40 thrown today · 35 left/)).toBeInTheDocument();
    expect(screen.queryByText("Rest")).not.toBeInTheDocument();
  });

  it("drops an arm out of game 2 once the opener spends the whole day", () => {
    const dhEarly = { ...g1, startUtc: "2099-06-05T14:00:00Z" };
    const dhLate = {
      ...g2,
      date: "2099-06-05",
      startUtc: "2099-06-05T18:00:00Z",
      pitchingFormat: "Kid Pitch",
    };
    renderWithProviders(<StartingPitcherPicker game={dhLate} />, {
      team: {
        team: baseTeam({
          games: [dhEarly, dhLate],
          tournaments: [
            {
              id: "t1",
              name: "Bash",
              gameIds: ["g1", "g2"],
              pitchPlan: {
                g1: [{ playerId: "p1", role: "start", plannedPitches: 75 }],
              },
            },
          ],
        }),
        currentRole: "head",
        generateLineup: jest.fn(),
      },
    });
    expect(screen.getByText("Day maxed")).toBeInTheDocument();
    expect(screen.getByText("Ace").closest("button")).toBeDisabled();
  });

  it("keeps the heuristic recommendation when the game has no tournament plan", () => {
    renderWithProviders(
      <StartingPitcherPicker game={{ ...g1, pitchingFormat: "Kid Pitch" }} />,
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

  it("shows the generic game-type tip without an opponent-strength read", () => {
    renderWithProviders(
      <StartingPitcherPicker game={{ ...g1, pitchingFormat: "Kid Pitch" }} />,
      {
        team: {
          team: baseTeam(),
          currentRole: "head",
          generateLineup: jest.fn(),
        },
      },
    );
    expect(screen.getByText(/Spread the staff/)).toBeInTheDocument();
  });

  it("sharpens the tip with the coach's opponent-strength read", () => {
    renderWithProviders(
      <StartingPitcherPicker
        game={{
          ...g1,
          pitchingFormat: "Kid Pitch",
          opponentStrength: "stronger",
        }}
      />,
      {
        team: {
          team: withTournament({}),
          currentRole: "head",
          generateLineup: jest.fn(),
        },
      },
    );
    expect(screen.getByText(/Stronger opponent/)).toBeInTheDocument();
    expect(screen.queryByText(/Spread the staff/)).not.toBeInTheDocument();
  });
});
