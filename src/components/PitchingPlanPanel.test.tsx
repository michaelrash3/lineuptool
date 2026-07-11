import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PitchingPlanPanel } from "./PitchingPlanPanel";
import { renderWithProviders } from "../test-utils";

// A game far in the future so it's always "upcoming" relative to test runtime,
// and rest windows are well clear.
const upcoming = {
  id: "g1",
  date: "2099-05-10",
  opponent: "Rays",
  status: "scheduled",
};
const players = [
  {
    id: "p1",
    name: "Ace",
    number: "1",
    comfortablePositions: ["P"],
    pitching: { recentPitches: 0, lastPitchDate: null },
  },
  {
    id: "p2",
    name: "Maxed Out",
    number: "2",
    comfortablePositions: ["P"],
    pitching: { recentPitches: 90, lastPitchDate: "2099-05-09" },
  },
  {
    id: "p3",
    name: "Fielder",
    number: "3",
    comfortablePositions: ["SS"],
    pitching: { recentPitches: 0, lastPitchDate: null },
  },
];

const baseTeam = (over: any = {}) => ({
  players,
  games: [upcoming],
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  ...over,
});

describe("PitchingPlanPanel", () => {
  it("lists cleared pitchers for the next game with their status", () => {
    renderWithProviders(<PitchingPlanPanel />, {
      team: { team: baseTeam(), currentRole: "head" },
    });
    expect(screen.getByText("Pitching Rotation")).toBeInTheDocument();
    expect(screen.getByText(/vs Rays/)).toBeInTheDocument();
    // Cleared pitcher ready; maxed pitcher flagged "at limit"; fielder excluded.
    expect(screen.getByText("#1 Ace")).toBeInTheDocument();
    expect(screen.getByText(/Maxed Out · at limit/)).toBeInTheDocument();
    expect(screen.queryByText("#3 Fielder")).not.toBeInTheDocument();
  });

  it("opens a pitcher's profile when tapped", async () => {
    const { uiValue } = renderWithProviders(<PitchingPlanPanel />, {
      team: { team: baseTeam(), currentRole: "head" },
    });
    await userEvent.click(screen.getByText("#1 Ace"));
    expect(uiValue.openPlayerProfile).toHaveBeenCalledWith("p1");
  });

  it("hides for non-Kid-Pitch formats", () => {
    const { container } = renderWithProviders(<PitchingPlanPanel />, {
      team: {
        team: baseTeam({ pitchingFormat: "Coach Pitch" }),
        currentRole: "head",
      },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("deducts a tournament's planned outings from later games' ready lists", () => {
    // Same weekend, two games. Ace is planned for 60 pitches in game 1 —
    // without the fold he'd show "ready" for game 2 as well (the old flaw).
    const g1 = { id: "g1", date: "2099-05-10", opponent: "Rays" };
    const g2 = { id: "g2", date: "2099-05-11", opponent: "Cubs" };
    renderWithProviders(<PitchingPlanPanel />, {
      team: {
        team: baseTeam({
          games: [g1, g2],
          tournaments: [
            {
              id: "t1",
              name: "Bash",
              gameIds: ["g1", "g2"],
              pitchPlan: {
                g1: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
              },
            },
          ],
        }),
        currentRole: "head",
      },
    });
    // Game 1: Ace unaffected (his own game). Game 2: resting from the plan.
    const aceChips = screen.getAllByText(/#1 Ace/);
    expect(aceChips).toHaveLength(2);
    expect(aceChips[1]).toHaveTextContent("#1 Ace · 3d");
  });

  it("hides when there is no upcoming game", () => {
    const { container } = renderWithProviders(<PitchingPlanPanel />, {
      team: {
        team: baseTeam({
          games: [
            {
              id: "old",
              date: "2000-01-01",
              status: "final",
              teamScore: 1,
              opponentScore: 0,
            },
          ],
        }),
        currentRole: "head",
      },
    });
    expect(container).toBeEmptyDOMElement();
  });
});
