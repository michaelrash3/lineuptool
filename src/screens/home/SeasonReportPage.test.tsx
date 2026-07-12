import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SeasonReportPage } from "./SeasonReportPage";
import { renderWithProviders } from "../../test-utils";

const team = {
  name: "Hawks",
  currentSeason: "Spring 2026",
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  players: [
    {
      id: "p1",
      name: "Ava Rivera",
      stats: { ab: 20, ops: 0.95, hr: 3, rbi: 12 },
    },
    { id: "p2", name: "Mia Stone", stats: { ab: 18, ops: 0.7, hr: 1, rbi: 5 } },
  ],
  games: [
    {
      id: "g1",
      date: "2026-04-01",
      status: "final",
      opponent: "Tigers",
      teamScore: 8,
      opponentScore: 2,
    },
    {
      id: "g2",
      date: "2026-04-08",
      status: "final",
      opponent: "Bears",
      teamScore: 5,
      opponentScore: 1,
    },
  ],
  practices: [],
  evaluationEvents: [
    {
      id: "r1",
      date: "2026-02-01",
      createdAt: 1,
      grades: { p1: { approach: 2, coachability: 2 } },
    },
    {
      id: "r2",
      date: "2026-05-01",
      createdAt: 2,
      grades: { p1: { approach: 4, coachability: 4 } },
    },
  ],
};

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/season-report"]}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/season-report" element={<SeasonReportPage />} />
      </Routes>
    </MemoryRouter>,
    { team: { team } as any },
  );

describe("SeasonReportPage", () => {
  it("renders record, top performers, and most improved", () => {
    renderPage();
    expect(screen.getByText("Top Performers")).toBeInTheDocument();
    // Ava leads OPS/HR/RBI.
    expect(screen.getAllByText("Ava Rivera").length).toBeGreaterThan(0);
    // 2-0 record after two wins.
    expect(screen.getByText("2-0")).toBeInTheDocument();
    expect(screen.getByText("Most Improved (Eval)")).toBeInTheDocument();
  });

  it("Back falls back to the dashboard on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });
});
