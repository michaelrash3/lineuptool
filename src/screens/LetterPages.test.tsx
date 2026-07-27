import React from "react";
import { vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  RosterLetterPage,
  TryoutLetterPage,
  InterestLetterPage,
} from "./LetterPages";
import { RouteAlias } from "../components/RouteAlias";
import { TeamContext, useTeam } from "../contexts";
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

// Stands in for the signup subcollection subscription landing after the page
// has already mounted: TeamProvider republishes teamData with a new `team`
// object while the route stays put. renderWithProviders' context value is
// fixed for the life of a render, so a nested TeamContext provider supplies
// the data half — useTeam() merges actions-then-data, so this wins.
const publish = { current: (_rows: any[]) => {} };

const LateSignups = ({
  field,
  children,
}: {
  field: "tryoutSignups" | "interestSignups";
  children: React.ReactNode;
}) => {
  const base = useTeam();
  const [rows, setRows] = React.useState<any[]>([]);
  React.useEffect(() => {
    publish.current = setRows;
  }, []);
  const value = React.useMemo(
    () => ({ ...base, team: { ...base.team, [field]: rows } }),
    [base, field, rows],
  );
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
};

const letterRoutes = (
  <Routes>
    <Route path="/roster" element={<div>ROSTER LIST</div>} />
    <Route path="/roster/:playerId" element={<div>PROFILE PAGE</div>} />
    <Route path="/tryouts" element={<div>TRYOUTS TAB</div>} />
    <Route path="/interest" element={<div>INTEREST TAB</div>} />
    <Route
      path="/roster/:playerId/letter/:kind"
      element={<RosterLetterPage />}
    />
    <Route
      path="/tryouts/letter/:signupId/:kind"
      element={<TryoutLetterPage />}
    />
    <Route path="/interest/letter/:leadId" element={<InterestLetterPage />} />
    {/* Legacy alias, mirroring App.tsx — old /offer/ bookmarks resolve. */}
    <Route
      path="/roster/:playerId/offer/:kind"
      element={
        <RouteAlias to={(p) => `/roster/${p.playerId}/letter/${p.kind}`} />
      }
    />
  </Routes>
);

const renderLetter = (
  path: string,
  ctxOver: any = {},
  wrap: (routes: React.ReactNode) => React.ReactNode = (routes) => routes,
) => {
  const updateTryoutSignup = jest.fn();
  const updateFinances = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={[path]}>{wrap(letterRoutes)}</MemoryRouter>,
    {
      team: {
        team,
        user: { displayName: "Coach", email: "coach@example.com" },
        currentRole: "head",
        // Most cases exercise data that has already arrived; the in-flight
        // cases override this to false.
        signupsReady: true,
        signupsDenied: false,
        updateTryoutSignup,
        updateFinances,
        ...ctxOver,
      },
    },
  );
  return { updateTryoutSignup, updateFinances, ...utils };
};

describe("RosterLetterPage", () => {
  it("renders the returning-player draft with the player's name in it", () => {
    renderLetter("/roster/p1/letter/returning");
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
    renderLetter("/roster/p1/letter/not-returning");
    expect(screen.getByText("Not Returning Player Letter")).toBeInTheDocument();
  });

  it("resolves a pre-rename /offer/ bookmark via the legacy alias", () => {
    renderLetter("/roster/p1/offer/returning");
    expect(screen.getByText("Returning Player Offer")).toBeInTheDocument();
  });

  it("redirects unknown players, bad kinds, and assistants to the roster", () => {
    renderLetter("/roster/nope/letter/returning");
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("rejects a kind that doesn't belong to the roster audience", () => {
    renderLetter("/roster/p1/letter/rejection");
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });
});

describe("TryoutLetterPage", () => {
  it("renders the new-player offer and marks the signup offered on copy", async () => {
    // jsdom has no clipboard by default; stub a resolving writeText.
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
    const { updateTryoutSignup } = renderLetter(
      "/tryouts/letter/s1/new-player",
    );
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
    renderLetter("/tryouts/letter/s1/rejection");
    expect(screen.getByText("Tryout Rejection Letter")).toBeInTheDocument();
  });

  it("redirects an unknown signup to the tryouts tab", () => {
    renderLetter("/tryouts/letter/nope/new-player");
    expect(screen.getByText("TRYOUTS TAB")).toBeInTheDocument();
  });

  // Signups arrive from a subcollection subscription now, so an empty list is
  // the normal first frame after a load/refresh — not proof the id is bogus.
  it("holds a loading state instead of bouncing while signups are still arriving", () => {
    renderLetter("/tryouts/letter/s1/new-player", {
      team: { ...team, tryoutSignups: [] },
      signupsReady: false,
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("TRYOUTS TAB")).not.toBeInTheDocument();
  });

  it("renders the draft when the signup subscription lands after mount", () => {
    renderLetter(
      "/tryouts/letter/s9/new-player",
      // The nested provider below owns tryoutSignups; this half only proves
      // the outer (mount-time) value is empty, as it is post-array-drop, and
      // that the subscription has not landed yet.
      { team: { ...team, tryoutSignups: [] }, signupsReady: false },
      (routes) => <LateSignups field="tryoutSignups">{routes}</LateSignups>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      publish.current([
        { id: "s9", firstName: "Nia", lastName: "Park", status: "tryout" },
      ]);
    });
    expect(screen.getByText("New Player Offer")).toBeInTheDocument();
    const body = screen.getByLabelText(
      "Offer letter draft",
    ) as HTMLTextAreaElement;
    expect(body.value).toContain("Nia Park");
  });

  it("waits on an in-flight signup subscription instead of redirecting", () => {
    renderLetter("/tryouts/letter/nope/new-player", {
      team: { ...team, tryoutSignups: [] },
      signupsReady: false,
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("TRYOUTS TAB")).not.toBeInTheDocument();
  });

  it("redirects a genuinely unknown id once the subscriptions have landed", () => {
    renderLetter("/tryouts/letter/nope/new-player", {
      team: { ...team, tryoutSignups: [] },
      signupsReady: true,
    });
    expect(screen.getByText("TRYOUTS TAB")).toBeInTheDocument();
  });

  it("does NOT redirect a subdoc-only signup just because the legacy array is non-empty", () => {
    // The regression this guards: mid-migration the team doc paints the
    // legacy array on the first frame, so any "is the list non-empty?"
    // heuristic reads as settled while the subscription is still in flight —
    // and every signup created after the cutover exists ONLY as a subdoc, so
    // deep-linking one bounced the coach straight out.
    renderLetter("/tryouts/letter/s9/new-player", {
      team: { ...team, tryoutSignups: [{ id: "legacy-1", firstName: "Old" }] },
      signupsReady: false,
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("TRYOUTS TAB")).not.toBeInTheDocument();
  });

  it("shows an error, not an eternal loader, when the signup lane was DENIED", () => {
    // A denied subscription is terminal for the session: signupsReady will
    // never flip, so the loader's promise — "the wait ends" — is false. The
    // page must say what happened and offer a way out instead.
    renderLetter("/tryouts/letter/s9/new-player", {
      team: { ...team, tryoutSignups: [] },
      signupsReady: false,
      signupsDenied: true,
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load signups")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("TRYOUTS TAB")).not.toBeInTheDocument();
  });

  it("redirects an assistant immediately, without waiting on signups", () => {
    // Role is known from context alone — no reason to sit on a skeleton.
    renderLetter("/tryouts/letter/s1/new-player", {
      currentRole: "assistant",
      team: { ...team, tryoutSignups: [] },
    });
    expect(screen.getByText("TRYOUTS TAB")).toBeInTheDocument();
  });
});

describe("InterestLetterPage", () => {
  it("renders the invite draft for a lead", () => {
    renderLetter("/interest/letter/l1");
    expect(screen.getByText("Interest / Tryout Invite")).toBeInTheDocument();
    const body = screen.getByLabelText(
      "Offer letter draft",
    ) as HTMLTextAreaElement;
    expect(body.value).toContain("Riley Ortiz");
  });

  it("redirects an unknown lead to the interest tab", () => {
    renderLetter("/interest/letter/nope");
    expect(screen.getByText("INTEREST TAB")).toBeInTheDocument();
  });

  it("waits on an unlanded interest subscription instead of redirecting", () => {
    renderLetter("/interest/letter/l1", {
      team: { ...team, interestSignups: [] },
      signupsReady: false,
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("INTEREST TAB")).not.toBeInTheDocument();
  });

  it("redirects an unknown lead once the interest subscription has landed", () => {
    renderLetter("/interest/letter/nope", {
      team: { ...team, interestSignups: [] },
      signupsReady: true,
    });
    expect(screen.getByText("INTEREST TAB")).toBeInTheDocument();
  });

  it("shows the denied error for a dead interest lane too", () => {
    renderLetter("/interest/letter/nope", {
      team: { ...team, interestSignups: [] },
      signupsReady: false,
      signupsDenied: true,
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("redirects assistants away", () => {
    renderLetter("/interest/letter/l1", { currentRole: "assistant" });
    expect(screen.getByText("INTEREST TAB")).toBeInTheDocument();
  });
});
