import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdvanceSeasonPage } from "./AdvanceSeasonPage";
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

const renderPage = (ctxOver: any = {}) => {
  const advanceSeason = vi.fn().mockResolvedValue(undefined);
  const setPlayerReturning = vi.fn();
  const updateFinances = vi.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/settings/advance-season"]}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/settings" element={<div>SETTINGS</div>} />
        <Route
          path="/settings/advance-season"
          element={<AdvanceSeasonPage />}
        />
      </Routes>
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
