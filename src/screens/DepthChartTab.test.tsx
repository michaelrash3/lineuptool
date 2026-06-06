import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils";
import { DepthChartTab } from "./DepthChartTab";

// Two players, both comfortable only at Pitcher, so only the Pitcher card lists
// anyone (every other position card is empty). Ace has the better strike grade.
const players = [
  { id: "p1", name: "Ace", number: "1", comfortablePositions: ["P"] },
  { id: "p2", name: "Bobby", number: "2", comfortablePositions: ["P"] },
];
const evaluationEvents = [
  {
    id: "e1",
    date: "2026-01-01",
    coachRole: "Head",
    grades: { p1: { strikes: 5 }, p2: { strikes: 1 } },
  },
];
const teamData: any = {
  players,
  evaluationEvents,
  pitchingFormat: "Kid Pitch",
  defenseSize: "9",
};

describe("DepthChartTab", () => {
  it("auto-ranks comfortable players by the position score (strikes for P)", () => {
    renderWithProviders(<DepthChartTab />, { team: { team: teamData } });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ace");
    expect(items[1]).toHaveTextContent("Bobby");
  });

  it("persists the new order to team.depthChart when a player is moved", () => {
    const { teamValue } = renderWithProviders(<DepthChartTab />, {
      team: { team: teamData },
    });
    fireEvent.click(screen.getByLabelText("Move Ace down"));
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      depthChart: { P: ["p2", "p1"] },
    });
  });

  it("respects a saved manual order over the auto ranking", () => {
    renderWithProviders(<DepthChartTab />, {
      team: { team: { ...teamData, depthChart: { P: ["p2", "p1"] } } },
    });
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Bobby");
    expect(items[1]).toHaveTextContent("Ace");
  });

  it("is read-only for assistant coaches (no reorder controls)", () => {
    renderWithProviders(<DepthChartTab />, {
      team: { team: teamData, currentRole: "assistant" },
    });
    expect(screen.queryByLabelText(/^Move /)).toBeNull();
  });
});
