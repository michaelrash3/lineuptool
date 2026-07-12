import React from "react";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TournamentsSection } from "./TournamentsSection";
import { renderWithProviders } from "../../test-utils";

// Two USSSA games one day apart → one derived weekend cluster.
const games = [
  { id: "g1", date: "2099-06-05", opponent: "Rays" },
  { id: "g2", date: "2099-06-06", opponent: "Cubs" },
];

const baseTeam = (over: any = {}) => ({
  games,
  tournaments: [],
  players: [],
  leagueRuleSet: "USSSA",
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  ...over,
});

const renderSection = (teamValue: any) =>
  renderWithProviders(
    <MemoryRouter>
      <TournamentsSection />
    </MemoryRouter>,
    { team: teamValue },
  );

describe("TournamentsSection", () => {
  it("offers an unclaimed weekend cluster as a link into the creation page", () => {
    renderSection({ team: baseTeam(), currentRole: "head" });
    const chip = screen.getByRole("link", { name: /Name this tournament/ });
    expect(chip).toHaveAttribute(
      "href",
      "/schedule/tournaments/new?seed=tour-2099-06-05",
    );
  });

  it("renders a stored tournament as a link to its detail page and suppresses its claimed suggestion", () => {
    renderSection({
      team: baseTeam({
        tournaments: [
          { id: "t1", name: "Memorial Bash", gameIds: ["g1", "g2"] },
        ],
      }),
      currentRole: "head",
    });
    const row = screen.getByRole("link", { name: /Memorial Bash/ });
    expect(row).toHaveAttribute("href", "/schedule/tournaments/t1");
    // Date range + game count summary on the row.
    expect(row).toHaveTextContent(/2 games/);
    expect(
      screen.queryByRole("link", { name: /Name this tournament/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a compact stakes read on the row when a structure is set", () => {
    renderSection({
      team: baseTeam({
        tournaments: [
          {
            id: "t1",
            name: "Memorial Bash",
            gameIds: ["g1", "g2"],
            structure: { teamCount: 16, poolCount: 4, advanceCount: 6 },
          },
        ],
      }),
      currentRole: "head",
    });
    expect(
      screen.getByRole("link", { name: /Memorial Bash/ }),
    ).toHaveTextContent(/16 teams · top 6/);
  });

  it("assistants see tournament rows but no suggestion links", () => {
    renderSection({
      team: baseTeam({
        tournaments: [
          { id: "t1", name: "Memorial Bash", gameIds: ["g1", "g2"] },
        ],
      }),
      currentRole: "assistant",
    });
    expect(
      screen.getByRole("link", { name: /Memorial Bash/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Name this tournament/ }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the tournaments module is toggled off", () => {
    const { container } = renderSection({
      team: baseTeam({
        disabledFeatures: ["tournaments"],
        tournaments: [
          { id: "t1", name: "Memorial Bash", gameIds: ["g1", "g2"] },
        ],
      }),
      currentRole: "head",
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no tournaments and no clusters", () => {
    const { container } = renderSection({
      team: baseTeam({ games: [{ id: "solo", date: "2099-06-05" }] }),
      currentRole: "head",
    });
    expect(container).toBeEmptyDOMElement();
  });
});
