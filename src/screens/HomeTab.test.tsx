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

  it("shows the Kid Pitch / Machine record split when the team played both", () => {
    renderWithProviders(<HomeTab />, {
      team: {
        team: emptyTeam,
        teams: [{ id: "t1", name: "Hawks" }],
        activeTeamId: "t1",
        record: {
          wins: 5,
          losses: 3,
          ties: 0,
          byFormat: {
            kidPitch: { wins: 3, losses: 1, ties: 0 },
            machine: { wins: 2, losses: 2, ties: 0 },
          },
        },
        user: { uid: "u1" },
        currentRole: "head",
      },
      ui: { setIsAddingGame: jest.fn(), setIsAddingPlayer: jest.fn() },
    });
    expect(screen.getByText(/Kid Pitch 3–1/)).toBeInTheDocument();
    expect(screen.getByText(/Machine\/Coach 2–2/)).toBeInTheDocument();
  });

  it("renders the new dashboard tiles (summary, run/streak, attendance, this week)", () => {
    renderWithProviders(<HomeTab />, {
      team: {
        team: {
          ...emptyTeam,
          players: [
            {
              id: "p1",
              name: "Ava Rivera",
              stats: { ab: 10, h: 4, avg: 0.4, obp: 0.45, ops: 0.9, hr: 1, rbi: 5 },
            },
          ],
          games: [
            {
              id: "g1",
              date: "2026-05-01",
              status: "final",
              opponent: "Tigers",
              teamScore: 7,
              opponentScore: 3,
              attendance: { p1: true },
            },
            {
              id: "g2",
              date: "2026-06-17",
              status: "draft",
              opponent: "Bears",
              time: "10:00",
            },
          ],
          practices: [{ id: "pr1", date: "2026-06-18", attendance: { p1: false } }],
        },
        teams: [{ id: "t1", name: "Hawks" }],
        activeTeamId: "t1",
        record: { wins: 1, losses: 0, ties: 0 },
        user: { uid: "u1" },
        currentRole: "head",
      },
      ui: {
        setIsAddingGame: jest.fn(),
        setIsAddingPlayer: jest.fn(),
        openPlayerProfile: jest.fn(),
        setActiveTab: jest.fn(),
      },
    });
    expect(screen.getByText("Team Summary")).toBeInTheDocument();
    expect(screen.getByText("Run Diff & Streak")).toBeInTheDocument();
    // Attendance tile's unique line (the word "Attendance" alone also appears
    // in the Up Next digest).
    expect(screen.getByText(/present ·/)).toBeInTheDocument();
    expect(screen.getByText("This Week")).toBeInTheDocument();
    expect(screen.getByText("vs Bears")).toBeInTheDocument();
  });

  it("hides the split when only one format has games (no redundancy)", () => {
    renderWithProviders(<HomeTab />, {
      team: {
        team: emptyTeam,
        teams: [{ id: "t1", name: "Hawks" }],
        activeTeamId: "t1",
        record: {
          wins: 3,
          losses: 1,
          ties: 0,
          byFormat: {
            kidPitch: { wins: 3, losses: 1, ties: 0 },
            machine: { wins: 0, losses: 0, ties: 0 },
          },
        },
        user: { uid: "u1" },
        currentRole: "head",
      },
      ui: { setIsAddingGame: jest.fn(), setIsAddingPlayer: jest.fn() },
    });
    expect(screen.queryByText(/Machine\/Coach/)).toBeNull();
  });
});
