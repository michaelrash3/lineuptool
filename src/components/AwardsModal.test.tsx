import React from "react";
import { screen } from "@testing-library/react";
import { AwardsModal } from "./AwardsModal";
import { renderWithProviders } from "../test-utils";

const team = {
  name: "Hawks",
  currentSeason: "Spring 2026",
  pitchingFormat: "Machine Pitch",
  players: [
    { id: "p1", name: "Ava Rivera", stats: { ops: 0.95, rbi: 12, sb: 8 } },
    { id: "p2", name: "Mia Stone", stats: { ops: 0.7, rbi: 5, sb: 2 } },
  ],
  games: [],
  practices: [],
  evaluationEvents: [],
  seasonAwards: {},
};

describe("AwardsModal", () => {
  it("auto-nominates winners from team data", () => {
    renderWithProviders(<AwardsModal open onClose={() => {}} team={team} />, {
      team: { updateTeam: jest.fn() },
    });
    expect(screen.getByText(/Top Hitter/)).toBeInTheDocument();
    expect(screen.getByText("RBI Leader")).toBeInTheDocument();
    // Ava leads OPS, RBI, and SB — appears as a nominee.
    expect(screen.getAllByText("Ava Rivera").length).toBeGreaterThan(0);
  });
});
