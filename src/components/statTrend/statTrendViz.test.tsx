import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StatTrendPage } from "./statTrendViz";
import { renderWithProviders } from "../../test-utils";

const player = {
  id: "p1",
  name: "Ava Rivera",
  stats: { avg: 0.4, ops: 0.95 },
  pastSeasons: [
    {
      season: "Fall 2025",
      ageGroup: "9U",
      pitchingFormat: "Kid Pitch",
      stats: { avg: 0.3, ops: 0.75 },
    },
  ],
};

const renderPage = (path: string) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/roster" element={<div>ROSTER LIST</div>} />
        <Route path="/roster/:playerId" element={<div>PROFILE PAGE</div>} />
        <Route
          path="/roster/:playerId/trend/:statKey"
          element={<StatTrendPage />}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: {
          players: [player],
          currentSeason: "Spring 2026",
          pitchingFormat: "Kid Pitch",
          primaryColor: "#1d4ed8",
        },
      },
    },
  );

describe("StatTrendPage", () => {
  it("renders the routed player's year-over-year view for the stat", () => {
    renderPage("/roster/p1/trend/avg");
    expect(screen.getByText("Ava Rivera")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AVG" })).toBeInTheDocument();
    // Both seasons appear in the breakdown table.
    expect(screen.getByText("Fall 2025")).toBeInTheDocument();
    expect(screen.getByText(/Spring 2026/)).toBeInTheDocument();
    // Two rising points → improving chip.
    expect(screen.getByText(/Improving/)).toBeInTheDocument();
  });

  it("redirects an unknown stat key to the player's profile", () => {
    renderPage("/roster/p1/trend/not-a-stat");
    expect(screen.getByText("PROFILE PAGE")).toBeInTheDocument();
  });

  it("redirects an unknown player to the roster", () => {
    renderPage("/roster/nope/trend/avg");
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("Back falls back to the player's profile on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage("/roster/p1/trend/avg");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("PROFILE PAGE")).toBeInTheDocument();
  });
});
