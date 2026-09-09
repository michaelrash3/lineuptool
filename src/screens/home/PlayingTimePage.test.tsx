import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PlayingTimePage } from "./PlayingTimePage";
import { renderWithProviders } from "../../test-utils";

// The fairness page: bench equity, the head-coach playing-time receipts, and
// position variety — the three surfaces moved off the Stats tab so Stats stays
// about hitting, pitching and fielding. The season math itself is covered in
// utils/season.test.ts; this covers the page's own wiring.

// Ava sits nothing (2 defensive innings), Mia sits one, Zeke sits both.
const finalGame = {
  id: "g1",
  date: "2026-04-04",
  opponent: "Hawks",
  status: "final",
  teamScore: 5,
  opponentScore: 3,
  lineup: [
    {
      P: { id: "p1", name: "Ava Rivera" },
      C: { id: "p2", name: "Mia Stone" },
      BENCH: [{ id: "p3", name: "Zeke Ford" }],
    },
    {
      P: { id: "p1", name: "Ava Rivera" },
      C: { id: "p2", name: "Mia Stone" },
      BENCH: [{ id: "p3", name: "Zeke Ford" }],
    },
  ],
  playerStats: {
    p1: { fInnSS: 2, fInnTotal: 2 },
    p2: { fInnLF: 1, fInnCF: 1, fInnTotal: 2 },
    p3: { fInnTotal: 0 },
  },
};

const players = [
  { id: "p1", name: "Ava Rivera", number: "7" },
  { id: "p2", name: "Mia Stone", number: "9" },
  { id: "p3", name: "Zeke Ford", number: "4" },
];

const renderPage = (team: any = { players, games: [finalGame] }) =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/playing-time"]}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/playing-time" element={<PlayingTimePage />} />
      </Routes>
    </MemoryRouter>,
    { team: { team, currentRole: "head" } as any },
  );

describe("PlayingTimePage", () => {
  it("gathers all three fairness surfaces in one place", () => {
    renderPage();
    expect(screen.getByText("Playing Time")).toBeInTheDocument();
    // The head-coach receipts card, sitting under the page title.
    expect(screen.getByText("Kid by Kid")).toBeInTheDocument();
    expect(screen.getByText("Bench Equity & Attendance")).toBeInTheDocument();
    expect(screen.getByText("Position Variety")).toBeInTheDocument();
    // Zeke never took the field, so he carries the extra sits.
    expect(screen.getByText("+2.0")).toBeInTheDocument();
  });

  it("prompts for data instead of empty tables when there's no roster", () => {
    renderPage({ players: [], games: [] });
    expect(screen.getByRole("status")).toHaveTextContent(
      /Add players and import a game's box score/,
    );
    expect(screen.queryByText("Bench Equity & Attendance")).toBeNull();
  });

  it("goes home from a deep link", () => {
    renderPage();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });
});
