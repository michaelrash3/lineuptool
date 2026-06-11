import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils";
import { DepthChartTab } from "./DepthChartTab";

// Names are chosen so the BETTER-rated player sorts LATER alphabetically. That
// way these tests fail if the position score is ignored and ranking silently
// falls back to name order (the bug Codex caught: Kid-Pitch add-on grades being
// dropped on the way through getCombinedGrades). As of schema v9 the pitching
// and catching slots are graded from imported stats, so the rating signal here
// is a stat line rather than a coach grade.
const pitchers = [
  {
    id: "p1",
    name: "Zane",
    number: "1",
    comfortablePositions: ["P"],
    stats: { pStrikePct: 0.65, pWhip: 1.0, pBf: 40 },
  },
  {
    id: "p2",
    name: "Abel",
    number: "2",
    comfortablePositions: ["P"],
    stats: { pStrikePct: 0.45, pWhip: 2.2, pBf: 40 },
  },
];
const pitcherTeam: any = {
  players: pitchers,
  evaluationEvents: [],
  pitchingFormat: "Kid Pitch",
  defenseSize: "9",
};

describe("DepthChartTab", () => {
  it("ranks pitchers by their pitching stat line, not by name", () => {
    renderWithProviders(<DepthChartTab />, { team: { team: pitcherTeam } });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Zane"); // strikes 5, sorts last by name
    expect(items[1]).toHaveTextContent("Abel");
  });

  it("ranks catchers by catching value (CS% stats + Game Calling), not by name", () => {
    const catcherTeam: any = {
      players: [
        {
          id: "c1",
          name: "Yara",
          number: "8",
          comfortablePositions: ["C"],
          stats: { fCsPct: 0.55, fSbAtt: 15 },
        },
        {
          id: "c2",
          name: "Cara",
          number: "9",
          comfortablePositions: ["C"],
          stats: { fCsPct: 0.15, fSbAtt: 15 },
        },
      ],
      evaluationEvents: [
        {
          id: "e1",
          date: "2026-01-01",
          coachRole: "Head",
          grades: { c1: { gameCalling: 5 }, c2: { gameCalling: 1 } },
        },
      ],
      pitchingFormat: "Kid Pitch",
      defenseSize: "9",
    };
    renderWithProviders(<DepthChartTab />, { team: { team: catcherTeam } });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Yara"); // better catcher, sorts last
  });

  it("persists the new order to team.depthChart when a player is moved", () => {
    const { teamValue } = renderWithProviders(<DepthChartTab />, {
      team: { team: pitcherTeam },
    });
    fireEvent.click(screen.getByLabelText("Move Zane down"));
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      depthChart: { P: ["p2", "p1"] },
    });
  });

  it("respects a saved manual order over the auto ranking", () => {
    renderWithProviders(<DepthChartTab />, {
      team: { team: { ...pitcherTeam, depthChart: { P: ["p2", "p1"] } } },
    });
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Abel"); // pinned first despite the weaker stat line
    expect(items[1]).toHaveTextContent("Zane");
  });

  it("lists primary-position kids first, then the rest by score", () => {
    // Bortz is the better fielder (higher glove/range), but Apple has SS as his
    // primary — so Apple leads SS despite the lower defensive score.
    const team: any = {
      players: [
        {
          id: "a",
          name: "Apple",
          comfortablePositions: ["SS"],
          primaryPosition: "SS",
        },
        { id: "b", name: "Bortz", comfortablePositions: ["SS"] },
      ],
      evaluationEvents: [
        {
          id: "e1",
          date: "2026-01-01",
          coachRole: "Head",
          grades: {
            a: { glove: 1, range: 1, armStrength: 1 },
            b: { glove: 5, range: 5, armStrength: 5 },
          },
        },
      ],
      pitchingFormat: "Kid Pitch",
      defenseSize: "9",
    };
    renderWithProviders(<DepthChartTab />, { team: { team } });
    // SS card is the 6th position card (P, C, 1B, 2B, 3B, SS, ...). Scope by
    // finding the SS heading's card.
    const items = screen.getAllByRole("listitem");
    const apple = items.find((el) => el.textContent?.includes("Apple"))!;
    const bortz = items.find((el) => el.textContent?.includes("Bortz"))!;
    // Apple (primary SS) appears before Bortz in document order within the SS card.
    expect(
      apple.compareDocumentPosition(bortz) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps Pitcher on pure pitching-score order (primary is ignored at P)", () => {
    const team: any = {
      players: [
        // Abel has P primary but a worse stat line; Zane's line is better.
        {
          id: "z",
          name: "Zane",
          comfortablePositions: ["P"],
          stats: { pStrikePct: 0.65, pWhip: 1.0, pBf: 40 },
        },
        {
          id: "a",
          name: "Abel",
          comfortablePositions: ["P"],
          primaryPosition: "P",
          stats: { pStrikePct: 0.45, pWhip: 2.2, pBf: 40 },
        },
      ],
      evaluationEvents: [],
      pitchingFormat: "Kid Pitch",
      defenseSize: "9",
    };
    renderWithProviders(<DepthChartTab />, { team: { team } });
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Zane"); // better stat line leads despite Abel's P primary
    expect(items[1]).toHaveTextContent("Abel");
  });

  it("is read-only for assistant coaches (no reorder controls)", () => {
    renderWithProviders(<DepthChartTab />, {
      team: { team: pitcherTeam, currentRole: "assistant" },
    });
    expect(screen.queryByLabelText(/^Move /)).toBeNull();
  });
});
