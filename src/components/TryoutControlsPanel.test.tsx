import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TryoutControlsPanel } from "./TryoutControlsPanel";
import { renderWithProviders } from "../test-utils";

const team = {
  name: "Hawks",
  tryoutShareId: "abc123",
  tryoutDates: [],
  players: [],
  games: [],
};

describe("TryoutControlsPanel", () => {
  it("shows the share link and regenerates it from the share block", async () => {
    const user = userEvent.setup();
    const generateTryoutShareId = jest.fn();
    renderWithProviders(<TryoutControlsPanel />, {
      team: { team, currentRole: "head", generateTryoutShareId },
    });
    // Collapsed by default once configured — expand the setup panel first.
    await user.click(screen.getByRole("button", { name: /tryout setup/i }));
    expect(screen.getByText(/tryouts-portal\/abc123/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(generateTryoutShareId).toHaveBeenCalledTimes(1);
  });
});
