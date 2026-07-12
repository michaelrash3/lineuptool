import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  PlayerDevelopmentReport,
  PlayerReportPage,
} from "./PlayerDevelopmentReport";
import { renderWithProviders } from "../test-utils";

const player = {
  id: "p1",
  name: "Ava Rivera",
  number: "7",
  primaryPosition: "SS",
  bats: "R",
  throws: "R",
  stats: { ab: 20, h: 8, avg: 0.4, obp: 0.45, ops: 0.95, hr: 2, rbi: 10 },
  pastSeasons: [
    {
      season: "Fall 2025",
      stats: { avg: 0.3, obp: 0.35, ops: 0.75, hr: 1, rbi: 6 },
    },
  ],
  notes: "Great hustle.",
};

const team = {
  pitchingFormat: "Kid Pitch",
  currentSeason: "Spring 2026",
  teamAge: "10U",
};

// Two rounds using real eval category ids so the within-season trend computes.
const evaluationEvents = [
  {
    id: "r1",
    date: "2026-02-01",
    createdAt: 1,
    grades: { p1: { approach: 3, coachability: 3 } },
  },
  {
    id: "r2",
    date: "2026-05-01",
    createdAt: 2,
    grades: { p1: { approach: 4, coachability: 4 } },
  },
];

describe("PlayerDevelopmentReport", () => {
  it("renders the stat line, evaluation, growth, and notes", () => {
    renderWithProviders(
      <PlayerDevelopmentReport
        onBack={() => {}}
        player={player}
        team={team}
        evaluationEvents={evaluationEvents}
        games={[]}
        practices={[]}
      />,
    );
    expect(screen.getByText("Batting")).toBeInTheDocument();
    expect(screen.getByText("Evaluation")).toBeInTheDocument();
    expect(screen.getByText("Season-over-Season")).toBeInTheDocument();
    // Archived past season shows as a growth column.
    expect(screen.getByText("Fall 2025")).toBeInTheDocument();
    expect(screen.getByText("Coach Notes")).toBeInTheDocument();
    expect(screen.getByText("Great hustle.")).toBeInTheDocument();
  });
});

describe("PlayerReportPage", () => {
  const renderPage = (path: string) =>
    renderWithProviders(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/roster" element={<div>ROSTER LIST</div>} />
          <Route path="/roster/:playerId" element={<div>PROFILE PAGE</div>} />
          <Route
            path="/roster/:playerId/report"
            element={<PlayerReportPage />}
          />
        </Routes>
      </MemoryRouter>,
      {
        team: {
          team: { ...team, players: [player], games: [], evaluationEvents },
        },
      },
    );

  it("renders the report for the routed player", () => {
    renderPage("/roster/p1/report");
    expect(
      screen.getByRole("heading", { name: "Ava Rivera" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Batting")).toBeInTheDocument();
    expect(screen.getByText("Great hustle.")).toBeInTheDocument();
  });

  it("redirects an unknown player to the roster", () => {
    renderPage("/roster/nope/report");
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("Back falls back to the player's profile on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage("/roster/p1/report");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("PROFILE PAGE")).toBeInTheDocument();
  });
});
