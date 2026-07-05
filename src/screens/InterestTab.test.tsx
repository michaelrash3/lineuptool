import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InterestTab } from "./InterestTab";
import { renderWithProviders } from "../test-utils";

const lead = (over: any = {}) => ({
  id: "i1",
  firstName: "Mia",
  lastName: "Stone",
  email: "mia@example.com",
  phone: "555-0100",
  submittedAt: "2026-06-01T00:00:00.000Z",
  ...over,
});

const setup = (over: any = {}, teamCtx: any = {}) => {
  const deleteInterestSignup = jest.fn();
  const convertInterestToTryout = jest.fn();
  const utils = renderWithProviders(<InterestTab />, {
    team: {
      currentRole: "head",
      user: { uid: "u1" },
      deleteInterestSignup,
      convertInterestToTryout,
      team: { currentSeason: "2026", interestSignups: [], ...over },
      ...teamCtx,
    },
  });
  return { deleteInterestSignup, convertInterestToTryout, ...utils };
};

describe("InterestTab", () => {
  it("shows the empty state when there are no leads", () => {
    setup({ interestSignups: [] });
    expect(screen.getByText(/no interest signups yet/i)).toBeInTheDocument();
  });

  it("hides the list from assistants (head-only screen)", () => {
    setup({ interestSignups: [lead()] }, { currentRole: "assistant" });
    expect(
      screen.getByText(/only visible to the head coach/i),
    ).toBeInTheDocument();
    // The lead's name must not render for an assistant.
    expect(screen.queryByText(/Mia Stone/i)).not.toBeInTheDocument();
  });

  it("renders a lead and promotes it via Move to Tryouts", async () => {
    const user = userEvent.setup();
    const { convertInterestToTryout } = setup({ interestSignups: [lead()] });
    expect(screen.getByText(/Mia Stone/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /move to tryouts/i }));
    expect(convertInterestToTryout).toHaveBeenCalledWith("i1");
  });

  it("requires a second tap to confirm a delete", async () => {
    const user = userEvent.setup();
    const { deleteInterestSignup } = setup({ interestSignups: [lead()] });
    const del = screen.getByRole("button", { name: /delete lead/i });
    // First tap arms — no delete yet.
    await user.click(del);
    expect(deleteInterestSignup).not.toHaveBeenCalled();
    // Now armed: the confirm affordance appears and a second tap fires.
    const confirm = screen.getByRole("button", { name: /confirm delete/i });
    await user.click(confirm);
    expect(deleteInterestSignup).toHaveBeenCalledWith("i1");
  });

  it("filters leads by the search box", async () => {
    const user = userEvent.setup();
    setup({
      interestSignups: [
        lead({ id: "i1", firstName: "Mia", lastName: "Stone" }),
        lead({ id: "i2", firstName: "Cai", lastName: "Nguyen" }),
      ],
    });
    expect(screen.getByText(/Mia Stone/i)).toBeInTheDocument();
    expect(screen.getByText(/Cai Nguyen/i)).toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText(/search name, email/i),
      "nguyen",
    );
    expect(screen.queryByText(/Mia Stone/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Cai Nguyen/i)).toBeInTheDocument();
  });
});
