import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvailabilityTab } from "./AvailabilityTab";
import { renderWithProviders } from "../test-utils";

const submission = (over: any = {}) => ({
  id: "sub1",
  firstName: "Ava",
  lastName: "Rivera",
  dates: ["2026-07-04", "2026-07-11"],
  submittedAt: "2026-06-01T00:00:00.000Z",
  ...over,
});

const setup = (teamOver: any = {}, ctx: any = {}) => {
  const applyAvailabilityToPlayer = jest.fn();
  const deleteAvailabilitySubmission = jest.fn();
  const autoApplyAvailability = jest.fn();
  const utils = renderWithProviders(<AvailabilityTab />, {
    team: {
      currentRole: "head",
      applyAvailabilityToPlayer,
      deleteAvailabilitySubmission,
      autoApplyAvailability,
      team: {
        currentSeason: "2026",
        defenseSize: 9,
        players: [],
        games: [],
        practices: [],
        availabilitySubmissions: [],
        ...teamOver,
      },
      ...ctx,
    },
  });
  return {
    applyAvailabilityToPlayer,
    deleteAvailabilitySubmission,
    autoApplyAvailability,
    ...utils,
  };
};

describe("AvailabilityTab", () => {
  it("auto-applies confident matches once on mount (head coach)", () => {
    const { autoApplyAvailability } = setup();
    expect(autoApplyAvailability).toHaveBeenCalledTimes(1);
  });

  it("does not auto-apply for an assistant", () => {
    const { autoApplyAvailability } = setup({}, { currentRole: "assistant" });
    expect(autoApplyAvailability).not.toHaveBeenCalled();
  });

  it("auto-matches a pending submission by name and applies its dates", async () => {
    const user = userEvent.setup();
    const { applyAvailabilityToPlayer } = setup({
      players: [{ id: "p1", name: "Ava Rivera" }],
      availabilitySubmissions: [submission()],
    });
    // guessMatch defaults the dropdown to the name-matched player, enabling
    // Apply without a manual pick.
    await user.click(screen.getByRole("button", { name: /apply dates/i }));
    expect(applyAvailabilityToPlayer).toHaveBeenCalledWith("sub1", "p1");
  });

  it("leaves Apply disabled until a submission is matched", () => {
    setup({
      players: [{ id: "p1", name: "Nobody Match" }],
      availabilitySubmissions: [submission()],
    });
    expect(screen.getByRole("button", { name: /apply dates/i })).toBeDisabled();
  });

  it("requires a second tap to confirm deleting a submission", async () => {
    const user = userEvent.setup();
    const { deleteAvailabilitySubmission } = setup({
      players: [{ id: "p1", name: "Ava Rivera" }],
      availabilitySubmissions: [submission()],
    });
    // Before arming, the icon-only button's accessible name comes from its
    // title ("Delete"). Once armed it has no aria-label, so its name becomes
    // the visible "Confirm" text.
    const del = screen.getByRole("button", { name: /^delete$/i });
    await user.click(del);
    expect(deleteAvailabilitySubmission).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    expect(deleteAvailabilitySubmission).toHaveBeenCalledWith("sub1");
  });

  it("tracks form completion across active players", () => {
    setup({
      players: [
        { id: "p1", name: "Ava Rivera", availabilitySubmittedAt: "2026-06-01" },
        { id: "p2", name: "Ben Stone" },
      ],
    });
    // 1 of 2 active players has submitted.
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });
});
