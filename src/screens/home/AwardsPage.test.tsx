import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AwardsPage } from "./AwardsPage";
import { renderWithProviders } from "../../test-utils";

const team = {
  name: "Hawks",
  currentSeason: "Spring 2026",
  pitchingFormat: "Machine Pitch",
  players: [
    { id: "p1", name: "Ava Rivera", stats: { ops: 0.95, rbi: 12, sb: 8 } },
    { id: "p2", name: "Mia Stone", stats: { ops: 0.7, rbi: 5, sb: 2 } },
  ],
  games: [],
  practices: [],
  evaluationEvents: [],
  seasonAwards: {},
};

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/awards"]}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/awards" element={<AwardsPage />} />
      </Routes>
    </MemoryRouter>,
    { team: { team, updateTeam: jest.fn() } as any },
  );

describe("AwardsPage", () => {
  it("auto-nominates winners from team data", () => {
    renderPage();
    expect(screen.getByText(/Top Hitter/)).toBeInTheDocument();
    expect(screen.getByText("RBI Leader")).toBeInTheDocument();
    // Ava leads OPS, RBI, and SB — appears as a nominee.
    expect(screen.getAllByText("Ava Rivera").length).toBeGreaterThan(0);
  });

  it("persists a coach override through updateTeam", () => {
    const { teamValue } = renderPage();
    fireEvent.change(screen.getByLabelText("Winner for RBI Leader"), {
      target: { value: "p2" },
    });
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      seasonAwards: { rbiLeader: "p2" },
    });
  });

  it("switches to the certificates view and back", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Certificates" }));
    expect(
      screen.getAllByText("Certificate of Achievement").length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Award List" }));
    expect(screen.getByText("RBI Leader")).toBeInTheDocument();
  });

  it("Back falls back to the dashboard on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });
});
