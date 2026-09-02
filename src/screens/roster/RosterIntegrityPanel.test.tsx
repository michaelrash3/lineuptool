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
  const { container } = renderWithProviders(<RosterIntegrityPanel />, {
    withRouter: true,
    team: {
      team: { ...baseTeam, ...over },
      currentRole: "head",
      realRole: "head",
      updateTeam,
    },
  });
  return { updateTeam, container };
};

describe("RosterIntegrityPanel", () => {
  it("flags duplicate numbers and age-ineligible players", () => {
    const { container } = renderPanel();
    // The names inside each warning are links now, so the sentence is split
    // across elements — assert on the flattened text.
    const text = container.textContent || "";
    expect(text).toMatch(/#7 worn by\s*Alex\s*&\s*Sam/);
    expect(text).toMatch(/TooOld\s*is 11 —\s*over the 10U division/);
  });

  // A flagged name is the moment you want to go look at that kid.
  it("links each flagged player to their page", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: "Alex" })).toHaveAttribute(
      "href",
      "/roster/alex",
    );
    expect(screen.getByRole("link", { name: "TooOld" })).toHaveAttribute(
      "href",
      "/roster/tooold",
    );
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
      withRouter: true,
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
