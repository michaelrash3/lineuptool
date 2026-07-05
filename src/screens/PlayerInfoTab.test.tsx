import React from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerInfoTab } from "./PlayerInfoTab";
import { renderWithProviders } from "../test-utils";

const submission = (over: any = {}) => ({
  id: "sub1",
  firstName: "Ava",
  lastName: "Rivera",
  email: "ava@example.com",
  phone: "555-0101",
  shirtSize: "YM",
  submittedAt: "2026-06-01T00:00:00.000Z",
  ...over,
});

const setup = (over: any = {}, teamCtx: any = {}) => {
  const applyPlayerInfoToPlayer = jest.fn();
  const deletePlayerInfoSubmission = jest.fn();
  const utils = renderWithProviders(<PlayerInfoTab />, {
    team: {
      currentRole: "head",
      applyPlayerInfoToPlayer,
      deletePlayerInfoSubmission,
      team: {
        currentSeason: "2026",
        players: [],
        playerInfoSubmissions: [],
        ...over,
      },
      ...teamCtx,
    },
  });
  return { applyPlayerInfoToPlayer, deletePlayerInfoSubmission, ...utils };
};

describe("PlayerInfoTab", () => {
  it("shows the empty state when nothing is submitted", () => {
    setup({ playerInfoSubmissions: [] });
    expect(
      screen.getByText(/no player info submitted yet/i),
    ).toBeInTheDocument();
  });

  it("hides submissions from assistants (head-only screen)", () => {
    setup(
      { playerInfoSubmissions: [submission()] },
      { currentRole: "assistant" },
    );
    expect(
      screen.getByText(/only visible to the head coach/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ava Rivera/)).not.toBeInTheDocument();
  });

  it("auto-matches a submission by name and applies it to that player", async () => {
    const user = userEvent.setup();
    const { applyPlayerInfoToPlayer } = setup({
      players: [{ id: "p1", name: "Ava Rivera" }],
      playerInfoSubmissions: [submission()],
    });
    // guessMatch defaults the dropdown to the name-matched player, so Apply is
    // enabled without the coach choosing manually.
    await user.click(screen.getByRole("button", { name: /apply to player/i }));
    expect(applyPlayerInfoToPlayer).toHaveBeenCalledWith("sub1", "p1");
  });

  it("leaves Apply disabled until a player is matched", () => {
    setup({
      players: [{ id: "p1", name: "Someone Else" }],
      playerInfoSubmissions: [submission()],
    });
    // No name/DOB match → dropdown stays on the placeholder and Apply is off.
    expect(
      screen.getByRole("button", { name: /apply to player/i }),
    ).toBeDisabled();
  });

  it("requires a second tap to confirm a delete", async () => {
    const user = userEvent.setup();
    const { deletePlayerInfoSubmission } = setup({
      players: [{ id: "p1", name: "Ava Rivera" }],
      playerInfoSubmissions: [submission()],
    });
    await user.click(
      screen.getByRole("button", { name: /delete submission/i }),
    );
    expect(deletePlayerInfoSubmission).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(deletePlayerInfoSubmission).toHaveBeenCalledWith("sub1");
  });

  it("tracks form completion across active players", () => {
    setup({
      players: [
        { id: "p1", name: "Ava Rivera", playerInfoSubmittedAt: "2026-06-01" },
        { id: "p2", name: "Ben Stone" },
      ],
      playerInfoSubmissions: [submission()],
    });
    const completion = screen
      .getByText(/form completion/i)
      .closest("h3") as HTMLElement;
    // "1 / 2" submitted count renders alongside the heading.
    expect(within(completion).getByText("1 / 2")).toBeInTheDocument();
  });
});
