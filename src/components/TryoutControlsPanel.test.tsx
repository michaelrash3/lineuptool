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

  it("lets the head choose whether signups are for this season or next", async () => {
    const user = userEvent.setup();
    const updateTeam = jest.fn();
    renderWithProviders(<TryoutControlsPanel />, {
      team: {
        team: { ...team, currentSeason: "Fall 2026", teamAge: "9U" },
        currentRole: "head",
        updateTeam,
      },
    });
    // The collapsed header names what the link recruits for.
    expect(
      screen.getByRole("button", { name: /tryout setup/i }),
    ).toHaveTextContent("Spring 2027 · 9U");
    await user.click(screen.getByRole("button", { name: /tryout setup/i }));
    const next = screen.getByRole("radio", { name: /next season/i });
    const current = screen.getByRole("radio", { name: /this season/i });
    expect(next).toHaveAttribute("aria-checked", "true");
    expect(next).toHaveTextContent("Spring 2027 · 9U");
    expect(current).toHaveTextContent("Fall 2026 · 9U");
    await user.click(current);
    expect(updateTeam).toHaveBeenCalledWith({ tryoutTarget: "current" });
    // The mock never saves, so Next is still the selected option: re-picking
    // it is a no-op, not a redundant write.
    await user.click(next);
    expect(updateTeam).toHaveBeenCalledTimes(1);
  });
});
