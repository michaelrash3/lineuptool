import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WhatIfLineupPage } from "./WhatIfLineupPage";
import { renderWithProviders } from "../test-utils";

// A modest active roster; assertions here check the sandbox scaffolding
// (game picker + availability toggles), not engine output — the pure fairness/
// rationale logic is covered in utils/lineupWhatIf.test.ts.
const roster = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i}`,
  name: `Player ${i}`,
  number: `${i + 1}`,
  comfortablePositions: ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"],
  isCatcher: i < 3,
}));

const baseTeam = {
  players: roster,
  games: [
    {
      id: "g1",
      date: "2099-05-01",
      opponent: "Rays",
      status: "scheduled",
      leagueRuleSet: "NKB",
    },
  ],
  evaluationEvents: [],
  teamAge: "10U",
  leagueRuleSet: "NKB",
  defenseSize: 9,
  positionLock: false,
  battingSize: "roster",
  pitchingFormat: "Kid Pitch",
  inningsCount: 6,
  catcherMaxInnings: 2,
  catcherConsecutive: false,
  currentSeason: "Spring 2099",
};

const render = (over: Record<string, unknown> = {}, role = "head") =>
  renderWithProviders(
    <MemoryRouter>
      <WhatIfLineupPage />
    </MemoryRouter>,
    {
      team: {
        team: { ...baseTeam, ...over },
        currentRole: role,
        realRole: role,
      },
    },
  );

describe("WhatIfLineupPage", () => {
  it("shows an empty state when there are no upcoming games", () => {
    render({ games: [] });
    expect(
      screen.getByText(/Add an upcoming game on the Schedule/),
    ).toBeInTheDocument();
  });

  it("redirects an assistant away from the sandbox", () => {
    render({}, "assistant");
    expect(screen.queryByText("What-If Sandbox")).not.toBeInTheDocument();
  });

  it("renders the game picker and toggles availability", async () => {
    const user = userEvent.setup();
    render();
    expect(screen.getByText("What-If Sandbox")).toBeInTheDocument();
    // Availability starts at full roster.
    expect(screen.getByText(/Available \(10\/10\)/)).toBeInTheDocument();
    // Mark one player out → count drops and a Reset appears.
    await user.click(screen.getByRole("button", { name: /#1 Player 0/ }));
    expect(screen.getByText(/Available \(9\/10\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reset/ })).toBeInTheDocument();
    // Both scenario columns render.
    expect(
      screen.getByText(/Baseline — everyone available/),
    ).toBeInTheDocument();
  });
});
