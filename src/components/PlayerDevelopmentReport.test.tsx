import React from "react";
import { screen } from "@testing-library/react";
import { PlayerDevelopmentReport } from "./PlayerDevelopmentReport";
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
        open
        onClose={() => {}}
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
