import React from "react";
import { screen } from "@testing-library/react";
import { OptimalLineupPanel } from "./OptimalLineupPanel";
import { renderWithProviders } from "../test-utils";

const ALL_POS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const players = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i}`,
  name: `P${i}`,
  number: String(i),
  present: true,
  comfortablePositions: ALL_POS,
  stats: {},
  pitching: { recentPitches: 0, lastPitchDate: null },
}));

const futureGame = {
  id: "g1",
  date: "2099-05-10",
  opponent: "Rays",
  status: "scheduled",
  leagueRuleSet: "NKB",
};

const baseTeam = (over: any = {}) => ({
  players,
  games: [futureGame],
  evaluationEvents: [],
  teamAge: "10U",
  leagueRuleSet: "NKB",
  defenseSize: "9",
  positionLock: "0",
  battingSize: "roster",
  pitchingFormat: "Kid Pitch",
  inningsCount: "6",
  ...over,
});

describe("OptimalLineupPanel", () => {
  it("shows the next game's recommended lineup for present players", () => {
    renderWithProviders(<OptimalLineupPanel />, {
      team: { team: baseTeam(), currentRole: "head" },
    });
    expect(screen.getByText("Optimal Lineup — Next Game")).toBeInTheDocument();
    expect(screen.getByText(/vs Rays/)).toBeInTheDocument();
    // The success branch rendered a real lineup (this caption only shows then).
    expect(
      screen.getByText(/Starting pitcher is chosen from arms rested/)
    ).toBeInTheDocument();
  });

  it("hides for non-head coaches", () => {
    const { container } = renderWithProviders(<OptimalLineupPanel />, {
      team: { team: baseTeam(), currentRole: "assistant" },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("hides when there is no upcoming game", () => {
    const { container } = renderWithProviders(<OptimalLineupPanel />, {
      team: {
        team: baseTeam({
          games: [
            { id: "old", date: "2000-01-01", status: "final", teamScore: 1, opponentScore: 0 },
          ],
        }),
        currentRole: "head",
      },
    });
    expect(container).toBeEmptyDOMElement();
  });
});
