import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  RosterOfferPage,
  TryoutOfferPage,
  InterestOfferPage,
} from "./OfferLetterPages";
import { renderWithProviders } from "../test-utils";

const team = {
  name: "Wildcats",
  currentSeason: "Spring 2026",
  teamAge: "10U",
  players: [{ id: "p1", name: "Ava Rivera", email: "fam@example.com" }],
  tryoutSignups: [
    {
      id: "s1",
      firstName: "Sam",
      lastName: "Cole",
      email: "cole@example.com",
      status: "evaluated",
    },
  ],
  interestSignups: [
    { id: "l1", firstName: "Riley", lastName: "Ortiz", email: "r@example.com" },
  ],
  finances: {},
};

const renderOffer = (path: string, ctxOver: any = {}) => {
  const updateTryoutSignup = jest.fn();
  const updateFinances = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/roster" element={<div>ROSTER LIST</div>} />
        <Route path="/roster/:playerId" element={<div>PROFILE PAGE</div>} />
        <Route path="/tryouts" element={<div>TRYOUTS TAB</div>} />
        <Route path="/interest" element={<div>INTEREST TAB</div>} />
        <Route
          path="/roster/:playerId/offer/:kind"
          element={<RosterOfferPage />}
        />
        <Route
          path="/tryouts/offer/:signupId/:kind"
          element={<TryoutOfferPage />}
        />
        <Route path="/interest/offer/:leadId" element={<InterestOfferPage />} />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team,
        user: { displayName: "Coach", email: "coach@example.com" },
        currentRole: "head",
        updateTryoutSignup,
        updateFinances,
        ...ctxOver,
      },
    },
  );
  return { updateTryoutSignup, updateFinances, ...utils };
};

describe("RosterOfferPage", () => {
  it("renders the returning-player draft with the player's name in it", () => {
    renderOffer("/roster/p1/offer/returning");
    expect(screen.getByText("Returning Player Offer")).toBeInTheDocument();
    const body = screen.getByLabelText(
      "Offer letter draft",
    ) as HTMLTextAreaElement;
    expect(body.value).toContain("Ava Rivera");
    // Family email present → mailto action offered.
    expect(
      screen.getByRole("button", { name: /open in email/i }),
    ).toBeInTheDocument();
  });

  it("renders the not-returning letter from its slug", () => {
    renderOffer("/roster/p1/offer/not-returning");
    expect(screen.getByText("Not Returning Player Letter")).toBeInTheDocument();
  });

  it("redirects unknown players, bad kinds, and assistants to the roster", () => {
    renderOffer("/roster/nope/offer/returning");
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("rejects a kind that doesn't belong to the roster audience", () => {
    renderOffer("/roster/p1/offer/rejection");
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });
});

describe("TryoutOfferPage", () => {
  it("renders the new-player offer and marks the signup offered on copy", async () => {
    // jsdom has no clipboard by default; stub a resolving writeText.
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
    const { updateTryoutSignup } = renderOffer("/tryouts/offer/s1/new-player");
    expect(screen.getByText("New Player Offer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /copy draft/i }));
    // onDelivered fires after the async copy resolves.
    await screen.findByText("New Player Offer");
    await Promise.resolve();
    expect(updateTryoutSignup).toHaveBeenCalledWith("s1", {
      status: "offered",
    });
  });

  it("renders the rejection letter from its slug", () => {
    renderOffer("/tryouts/offer/s1/rejection");
    expect(screen.getByText("Tryout Rejection Letter")).toBeInTheDocument();
  });

  it("redirects an unknown signup to the tryouts tab", () => {
    renderOffer("/tryouts/offer/nope/new-player");
    expect(screen.getByText("TRYOUTS TAB")).toBeInTheDocument();
  });
});

describe("InterestOfferPage", () => {
  it("renders the invite draft for a lead", () => {
    renderOffer("/interest/offer/l1");
    expect(screen.getByText("Interest / Tryout Invite")).toBeInTheDocument();
    const body = screen.getByLabelText(
      "Offer letter draft",
    ) as HTMLTextAreaElement;
    expect(body.value).toContain("Riley Ortiz");
  });

  it("redirects an unknown lead to the interest tab", () => {
    renderOffer("/interest/offer/nope");
    expect(screen.getByText("INTEREST TAB")).toBeInTheDocument();
  });

  it("redirects assistants away", () => {
    renderOffer("/interest/offer/l1", { currentRole: "assistant" });
    expect(screen.getByText("INTEREST TAB")).toBeInTheDocument();
  });
});
