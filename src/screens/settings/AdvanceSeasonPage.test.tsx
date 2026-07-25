import React from "react";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdvanceSeasonPage } from "./AdvanceSeasonPage";
import { TeamContext, useTeam } from "../../contexts";
import { renderWithProviders } from "../../test-utils";

// The /settings/advance-season wizard page (converted from the modal).
// advanceSeason()'s write mechanics are provider-tested; this covers the
// page wiring — marking players, promoting tryout signups, the inline offer
// sub-view keeping wizard state alive, and the confirm handoff.

const players = [
  { id: "p1", name: "Ava", number: "12", returning: true },
  { id: "p2", name: "Sam", returning: false },
  { id: "p3", name: "Kai", playerStatus: "accepted" },
];

const tryoutSignups = [
  {
    id: "s1",
    firstName: "Rory",
    lastName: "Lee",
    tryoutNumber: "4",
    status: "accepted",
    depositPaid: true,
    depositPaidAt: "2026-07-01T12:00:00Z",
  },
  { id: "s2", firstName: "Max", lastName: "Cruz", status: "offered" },
];

// Stands in for the tryout-signup subcollection subscription landing after
// the wizard has already mounted: TeamProvider republishes teamData with a new
// `team` object while the page stays put. renderWithProviders' context value is
// fixed for the life of a render, so a nested TeamContext provider supplies the
// data half — useTeam() merges actions-then-data, so this wins.
const publish = { current: (_rows: any[]) => {} };

const LateSignups = ({ children }: { children: React.ReactNode }) => {
  const base = useTeam();
  const [rows, setRows] = React.useState<any[]>([]);
  React.useEffect(() => {
    publish.current = setRows;
  }, []);
  const value = React.useMemo(
    () => ({ ...base, team: { ...base.team, tryoutSignups: rows } }),
    [base, rows],
  );
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
};

const pageRoutes = (
  <Routes>
    <Route path="/" element={<div>HOME</div>} />
    <Route path="/settings" element={<div>SETTINGS</div>} />
    <Route path="/settings/advance-season" element={<AdvanceSeasonPage />} />
  </Routes>
);

const renderPage = (
  ctxOver: any = {},
  wrap: (routes: React.ReactNode) => React.ReactNode = (routes) => routes,
) => {
  const advanceSeason = vi.fn().mockResolvedValue(undefined);
  const setPlayerReturning = vi.fn();
  const updateFinances = vi.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/settings/advance-season"]}>
      {wrap(pageRoutes)}
    </MemoryRouter>,
    {
      team: {
        team: { currentSeason: "Spring 2026", players, tryoutSignups },
        user: { uid: "u1", email: "coach@x.com" },
        currentRole: "head",
        advanceSeason,
        setPlayerReturning,
        updateFinances,
        ...ctxOver,
      } as any,
    },
  );
  return { ...utils, advanceSeason, setPlayerReturning };
};

describe("AdvanceSeasonPage", () => {
  it("shows the season transition and per-player Returning toggles", () => {
    const { setPlayerReturning } = renderPage();
    expect(screen.getByText("Spring 2026 → Fall 2026")).toBeInTheDocument();
    // Accepted tryout player is locked in, not togglable.
    expect(screen.getByText("Tryout Accept")).toBeInTheDocument();
    expect(screen.getByText("1 yes · 1 no · 1 tryout")).toBeInTheDocument();

    const avaGroup = screen.getByRole("group", {
      name: "Ava returning next season",
    });
    fireEvent.click(within(avaGroup).getByRole("button", { name: "No" }));
    expect(setPlayerReturning).toHaveBeenCalledWith("p1", false);
  });

  it("bulk All No flips only players not already released", () => {
    const { setPlayerReturning } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "All No" }));
    // Ava was returning → flipped; Sam already No; Kai locked (accepted).
    expect(setPlayerReturning).toHaveBeenCalledTimes(1);
    expect(setPlayerReturning).toHaveBeenCalledWith("p1", false);
  });

  it("confirm advances with pre-checked accepted signups and their deposits", async () => {
    const { advanceSeason } = renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /Confirm Advance Season/i }),
    );
    expect(advanceSeason).toHaveBeenCalledWith({
      skipConfirm: true,
      tryoutsToPromote: ["s1"],
      tryoutDepositPayments: { s1: "2026-07-01" },
    });
    // Lands back on Settings once the write resolves.
    expect(await screen.findByText("SETTINGS")).toBeInTheDocument();
  });

  it("keeps wizard checkbox state across the inline offer sub-view", () => {
    renderPage();
    // Check the extra (non-accepted) signup — local wizard state.
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Promote Max Cruz to next season",
      }),
    );
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();

    // Open the returning-player offer inline, then come back.
    fireEvent.click(screen.getByRole("button", { name: /Offer/ }));
    expect(screen.getByText("Returning Player Offer")).toBeInTheDocument();
    expect(screen.getByLabelText("Offer letter draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Advance Season" }));

    // The manual check survived the round trip.
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
  });

  it("buckets a declined player as not returning, matching advanceSeason", () => {
    // Regression: the wizard previously read only playerStatus==="released",
    // so a "declined" player DISPLAYED as returning while the actual season
    // advance (isReturning) dropped them.
    const { setPlayerReturning } = renderPage({
      team: {
        currentSeason: "Spring 2026",
        players: [
          { id: "p1", name: "Ava", returning: true },
          { id: "pd", name: "Dee", playerStatus: "declined" },
        ],
        tryoutSignups: [],
      },
    });
    expect(screen.getByText("1 yes · 1 no · 0 tryout")).toBeInTheDocument();
    const deeGroup = screen.getByRole("group", {
      name: "Dee returning next season",
    });
    expect(
      within(deeGroup).getByRole("button", { name: "No" }),
    ).toHaveAttribute("aria-pressed", "true");
    // All Yes flips Dee through the boolean writer.
    fireEvent.click(screen.getByRole("button", { name: "All Yes" }));
    expect(setPlayerReturning).toHaveBeenCalledWith("pd", true);
  });

  // Signups now stream in from a subcollection subscription, so the wizard can
  // mount before any of them exist. Latching the pre-check set at mount used to
  // silently commit to promoting NOBODY.
  it("seeds accepted signups that only arrive after mount", () => {
    const { advanceSeason } = renderPage(
      { team: { currentSeason: "Spring 2026", players, tryoutSignups: [] } },
      (routes) => <LateSignups>{routes}</LateSignups>,
    );
    // Nothing has landed yet — no signup section at all.
    expect(screen.queryByText("Tryout Signups")).not.toBeInTheDocument();

    act(() => {
      publish.current(tryoutSignups);
    });

    // The accepted signup is pre-checked exactly as if it had been there at
    // mount, deposit amount and date included.
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Confirm Advance Season/i }),
    );
    expect(advanceSeason).toHaveBeenCalledWith({
      skipConfirm: true,
      tryoutsToPromote: ["s1"],
      tryoutDepositPayments: { s1: "2026-07-01" },
    });
  });

  it("seeds a second batch too (legacy array paints, then the union lands)", () => {
    renderPage(
      { team: { currentSeason: "Spring 2026", players, tryoutSignups: [] } },
      (routes) => <LateSignups>{routes}</LateSignups>,
    );
    // The team doc's legacy array paints first...
    act(() => {
      publish.current([tryoutSignups[0]]);
    });
    expect(screen.getByText("1 of 1 selected")).toBeInTheDocument();

    // ...then the subcollection union lands, carrying another accepted signup.
    // Seeding is additive per id, so the newcomer is pre-checked too.
    act(() => {
      publish.current([
        ...tryoutSignups,
        { id: "s3", firstName: "Jo", lastName: "Kim", status: "accepted" },
      ]);
    });
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();
  });

  it("never re-checks a signup the coach deliberately unticked", () => {
    renderPage(
      { team: { currentSeason: "Spring 2026", players, tryoutSignups: [] } },
      (routes) => <LateSignups>{routes}</LateSignups>,
    );
    act(() => {
      publish.current(tryoutSignups);
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Promote Rory Lee to next season" }),
    );
    expect(screen.getByText("0 of 2 selected")).toBeInTheDocument();

    // A later snapshot re-delivers the same still-"accepted" signup. Seeding is
    // once per id, so the coach's decision stands.
    act(() => {
      publish.current([...tryoutSignups]);
    });
    expect(screen.getByText("0 of 2 selected")).toBeInTheDocument();
  });

  it("redirects assistants home", () => {
    renderPage({ currentRole: "assistant" });
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });

  it("Back falls back to Settings on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("SETTINGS")).toBeInTheDocument();
  });
});
