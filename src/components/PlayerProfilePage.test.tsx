import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PlayerProfilePage } from "./modals";
import { renderWithProviders } from "../test-utils";

// The player profile is a routed PAGE at /roster/:playerId — not a modal.
// These tests pin the page semantics: the URL param drives which player
// renders (deep-linkable), and Back returns to the previous history entry
// (with a roster fallback for deep links that have no in-app history).

// jsdom has no IntersectionObserver; the profile's section scroll-spy needs a
// no-op stand-in to mount.
beforeAll(() => {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const team = {
  players: [
    {
      id: "p1",
      name: "Ava",
      number: "3",
      bats: "R",
      throws: "R",
      present: true,
      stats: {},
      pitching: { recentPitches: 0, lastPitchDate: null },
    },
  ],
  games: [],
  evaluationEvents: [],
  currentSeason: "Spring 2026",
  pitchingFormat: "Kid Pitch",
  defenseSize: "10",
  teamAge: "8U",
  primaryColor: "#2563eb",
  secondaryColor: "#f8fafc",
  tertiaryColor: "#ffffff",
};

const mountAt = (entries: string[], initialIndex: number) => {
  const setViewingPlayerId = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <Routes>
        <Route path="/roster" element={<div>ROSTER LIST</div>} />
        <Route path="/roster/:playerId" element={<PlayerProfilePage />} />
      </Routes>
    </MemoryRouter>,
    {
      team: { team },
      // The route owns which player renders: PlayerProfilePage mirrors the
      // URL param into viewingPlayerId, which the profile content reads. The
      // test provider is a plain mock, so supply the mirrored value directly
      // and assert the page performed the mirroring call.
      ui: { viewingPlayerId: "p1", setViewingPlayerId } as any,
    },
  );
  return { setViewingPlayerId, ...utils };
};

describe("PlayerProfilePage — a real navigable page", () => {
  it("renders the player from the URL param (deep-linkable)", () => {
    const { setViewingPlayerId } = mountAt(["/roster/p1"], 0);
    expect(setViewingPlayerId).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("heading", { name: "Ava" })).toBeInTheDocument();
  });

  it("Back returns to the PREVIOUS history entry — one press, like any page", () => {
    // Arrived from the roster list: history is [/roster, /roster/p1].
    window.history.replaceState({ idx: 1 }, "");
    mountAt(["/roster", "/roster/p1"], 1);
    // Header back chip and footer Back button do the same thing.
    fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]);
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("a deep link with no in-app history falls back to the roster", () => {
    // Fresh tab: this entry is the whole history (react-router idx 0).
    window.history.replaceState(null, "");
    mountAt(["/roster/p1"], 0);
    fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]);
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });
});
