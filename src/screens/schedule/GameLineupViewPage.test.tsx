import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameLineupViewPage } from "./GameLineupViewPage";
import { renderWithProviders } from "../../test-utils";

const lineup = [
  {
    P: { id: "p1", name: "Ava" },
    C: { id: "p2", name: "Mia" },
    "1B": { id: "p3", name: "Rae" },
    BENCH: [{ id: "p4", name: "Jo" }],
  },
  {
    P: { id: "p2", name: "Mia" },
    C: { id: "p1", name: "Ava" },
    "1B": { id: "p4", name: "Jo" },
    BENCH: [{ id: "p3", name: "Rae" }],
  },
];

const game = {
  id: "g1",
  date: "2026-05-01",
  opponent: "Rivals",
  status: "scheduled",
  leagueRuleSet: "USSSA",
  pitchingFormat: "Kid Pitch",
  lineup,
  battingLineup: [
    { id: "p1", name: "Ava" },
    { id: "p2", name: "Mia" },
    { id: "p3", name: "Rae" },
  ],
};

const renderPage = (
  path = "/schedule/game/g1/lineup",
  gameOver: any = {},
  ctxOver: any = {},
) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule" element={<div>SCHEDULE LIST</div>} />
        <Route path="/schedule/game/:gameId" element={<div>GAME EDITOR</div>} />
        <Route
          path="/schedule/game/:gameId/lineup"
          element={<GameLineupViewPage />}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: {
          players: [
            { id: "p1", name: "Ava" },
            { id: "p2", name: "Mia" },
            { id: "p3", name: "Rae" },
            { id: "p4", name: "Jo" },
          ],
          games: [{ ...game, ...gameOver }],
          leagueRuleSet: "USSSA",
          pitchingFormat: "Kid Pitch",
          primaryColor: "#1d4ed8",
          tertiaryColor: "#ffffff",
        },
        currentRole: "head",
        ...ctxOver,
      },
    },
  );

describe("GameLineupViewPage", () => {
  it("shows the saved defense and batting order for the routed game", () => {
    renderPage();
    expect(screen.getByText("Lineup")).toBeInTheDocument();
    expect(screen.getByText(/vs\. Rivals/)).toBeInTheDocument();
    // Both grid layouts render under jsdom, so a name appears more than once.
    expect(
      screen.getAllByLabelText(/Inning 1, P: Ava/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Batting Order")).toBeInTheDocument();
    expect(screen.getAllByText("Mia").length).toBeGreaterThan(0);
  });

  it("renders the lineup cells as disabled controls — nothing here edits", () => {
    renderPage();
    for (const cell of screen.getAllByLabelText(/Inning 1, C: Mia/i)) {
      expect(cell).toBeDisabled();
    }
    // The editor's swap affordance never appears on this page.
    expect(screen.queryByText(/tap to assign/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Generate")).not.toBeInTheDocument();
  });

  it("flags projected innings on a game that has not been played", () => {
    renderPage();
    expect(screen.getByText(/are a projection/i)).toBeInTheDocument();
  });

  it("drops the projection note once the game is live", () => {
    renderPage("/schedule/game/g1/lineup", { status: "in_progress" });
    expect(screen.queryByText(/are a projection/i)).not.toBeInTheDocument();
  });

  it("drops the projection note once the game is final", () => {
    renderPage("/schedule/game/g1/lineup", {
      status: "final",
      teamScore: 7,
      opponentScore: 4,
    });
    expect(screen.queryByText(/are a projection/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Final 7-4/)).toBeInTheDocument();
  });

  it("hands head coaches an Edit door into the game editor", () => {
    renderPage();
    fireEvent.click(screen.getByRole("link", { name: /edit/i }));
    expect(screen.getByText("GAME EDITOR")).toBeInTheDocument();
  });

  it("gives assistants the view with no Edit door", () => {
    renderPage("/schedule/game/g1/lineup", {}, { currentRole: "assistant" });
    expect(screen.getByText("Batting Order")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /edit/i }),
    ).not.toBeInTheDocument();
  });

  it("redirects an unknown game to the schedule", () => {
    renderPage("/schedule/game/nope/lineup");
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects a game with no lineup to the schedule", () => {
    renderPage("/schedule/game/g1/lineup", { lineup: null });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });
});
