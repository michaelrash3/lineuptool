import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RosterIntegrityPanel } from "./RosterIntegrityPanel";
import { renderWithProviders } from "../../test-utils";

const baseTeam = {
  teamAge: "10U",
  currentSeason: "Spring 2026",
  rosterCap: 2,
  players: [
    { id: "a", name: "Alex", number: "7", dob: "2015-06-01" },
    { id: "b", name: "Sam", number: "7", dob: "2015-06-01" },
    { id: "c", name: "TooOld", number: "9", dob: "2014-06-01" },
  ],
};

const renderPanel = (over: Record<string, unknown> = {}) => {
  const updateTeam = jest.fn();
  renderWithProviders(<RosterIntegrityPanel />, {
    team: {
      team: { ...baseTeam, ...over },
      currentRole: "head",
      realRole: "head",
      updateTeam,
    },
  });
  return { updateTeam };
};

describe("RosterIntegrityPanel", () => {
  it("flags duplicate numbers and age-ineligible players", () => {
    renderPanel();
    expect(screen.getByText(/#7 worn by Alex & Sam/)).toBeInTheDocument();
    expect(
      screen.getByText(/TooOld is 11 — over the 10U division/),
    ).toBeInTheDocument();
  });

  it("shows count over cap and toggles rosterLocked", async () => {
    const user = userEvent.setup();
    const { updateTeam } = renderPanel();
    // 3 active players against a cap of 2.
    expect(screen.getByText(/3 \/ 2 players · over cap/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Finalize roster/ }));
    expect(updateTeam).toHaveBeenCalledWith({ rosterLocked: true });
  });

  it("offers to unlock when already finalized", async () => {
    const user = userEvent.setup();
    const { updateTeam } = renderPanel({ rosterLocked: true });
    await user.click(screen.getByRole("button", { name: /Unlock roster/ }));
    expect(updateTeam).toHaveBeenCalledWith({ rosterLocked: false });
  });

  it("renders nothing for an assistant", () => {
    const { container } = renderWithProviders(<RosterIntegrityPanel />, {
      team: {
        team: baseTeam,
        currentRole: "assistant",
        realRole: "assistant",
        updateTeam: jest.fn(),
      },
    });
    expect(container).toBeEmptyDOMElement();
  });
});
