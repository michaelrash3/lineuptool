import React from "react";
import { screen, waitFor } from "@testing-library/react";
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

const render = (
  over: Record<string, unknown> = {},
  role: "head" | "assistant" = "head",
) =>
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

  it("applies the scenario: writes lineup + attendance and opens the game", async () => {
    const user = userEvent.setup();
    const updateGame = jest.fn();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const { uiValue } = renderWithProviders(
      <MemoryRouter>
        <WhatIfLineupPage />
      </MemoryRouter>,
      {
        team: {
          team: baseTeam,
          currentRole: "head",
          realRole: "head",
          updateGame,
        } as any,
      },
    );
    // Mark Player 0 out, then apply the What-If scenario.
    await user.click(screen.getByRole("button", { name: /#1 Player 0/ }));
    const applyBtn = screen.getByRole("button", {
      name: /Apply to this game/,
    });
    await user.click(applyBtn);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(updateGame).toHaveBeenCalledTimes(1));
    const [gid, patch] = updateGame.mock.calls[0];
    expect(gid).toBe("g1");
    expect(Array.isArray(patch.lineup)).toBe(true);
    expect(patch.battingLineup).toBeTruthy();
    // Attendance mirrors availability: the toggled-out player is absent.
    expect(patch.attendance.p0).toBe(false);
    expect(patch.attendance.p1).toBe(true);
    // The game opens on the Schedule after applying.
    expect(uiValue.setSelectedGameId).toHaveBeenCalledWith("g1");
    confirmSpy.mockRestore();
  });
});
