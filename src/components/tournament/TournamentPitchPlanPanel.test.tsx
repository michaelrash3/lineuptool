import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TournamentPitchPlanPanel } from "./TournamentPitchPlanPanel";
import { renderWithProviders } from "../../test-utils";

const players = [
  {
    id: "p1",
    name: "Ace",
    number: "1",
    comfortablePositions: ["P"],
    pitching: {},
  },
  {
    id: "p2",
    name: "Lefty",
    number: "2",
    comfortablePositions: ["P"],
    pitching: {},
  },
];

// A Saturday game and the Sunday bracket game.
const games = [
  { id: "g1", date: "2099-06-05", opponent: "Rays" },
  { id: "g2", date: "2099-06-06", opponent: "Cubs" },
];

// A Saturday doubleheader: both games on one date, opener first.
const dhGames = [
  {
    id: "g1",
    date: "2099-06-05",
    opponent: "Rays",
    startUtc: "2099-06-05T14:00:00Z",
  },
  {
    id: "g2",
    date: "2099-06-05",
    opponent: "Cubs",
    startUtc: "2099-06-05T18:00:00Z",
  },
];

const tournament = (pitchPlan: any = {}) => ({
  id: "t1",
  name: "Memorial Bash",
  gameIds: ["g1", "g2"],
  pitchPlan,
});

const baseTeam = (over: any = {}) => ({
  players,
  games,
  tournaments: [tournament()],
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  leagueRuleSet: "USSSA",
  ...over,
});

describe("TournamentPitchPlanPanel", () => {
  it("folds a planned Saturday outing into Sunday's availability", () => {
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
        })}
      />,
      { withRouter: true, team: { team: baseTeam(), currentRole: "head" } },
    );
    // Saturday shows the planned chip; Sunday shows Ace resting (60p → 3 days).
    expect(screen.getByText(/#1 Ace · start · 60p/)).toBeInTheDocument();
    expect(screen.getByText(/#1 Ace · 3d/)).toBeInTheDocument();
    // Lefty stays ready both days.
    expect(screen.getAllByText("#2 Lefty")).toHaveLength(2);
  });

  it("flags a rest violation when the same arm is planned for both days", () => {
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
          g2: [{ playerId: "p1", role: "start", plannedPitches: 20 }],
        })}
      />,
      { withRouter: true, team: { team: baseTeam(), currentRole: "head" } },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Ace threw 60 .* isn't rested/,
    );
  });

  it("head can add an arm to a game's plan", async () => {
    const setPlannedOutings = jest.fn();
    renderWithProviders(
      <TournamentPitchPlanPanel tournament={tournament()} />,
      {
        withRouter: true,
        team: { team: baseTeam(), currentRole: "head", setPlannedOutings },
      },
    );
    await userEvent.click(screen.getAllByText(/Add arm/)[0]);
    await userEvent.click(screen.getByText("Add"));
    expect(setPlannedOutings).toHaveBeenCalledWith("t1", "g1", [
      { playerId: "p1", role: "start" },
    ]);
  });

  it("head can remove a planned outing", async () => {
    const setPlannedOutings = jest.fn();
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [
            { playerId: "p1", role: "start", plannedPitches: 40 },
            { playerId: "p2", role: "relief" },
          ],
        })}
      />,
      {
        withRouter: true,
        team: { team: baseTeam(), currentRole: "head", setPlannedOutings },
      },
    );
    await userEvent.click(
      screen.getByLabelText("Remove Ace from this game's plan"),
    );
    expect(setPlannedOutings).toHaveBeenCalledWith("t1", "g1", [
      { playerId: "p2", role: "relief" },
    ]);
  });

  it("greys a consumed entry once the real log carries the outing", () => {
    const logged = [
      {
        ...players[0],
        pitching: {
          log: [{ date: "2099-06-05", pitches: 45, gameId: "g1" }],
        },
      },
      players[1],
    ];
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
        })}
      />,
      {
        withRouter: true,
        team: { team: baseTeam({ players: logged }), currentRole: "head" },
      },
    );
    expect(screen.getByText("logged")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Remove Ace from this game's plan"),
    ).not.toBeInTheDocument();
  });

  it("keeps an arm available for game 2 of a doubleheader, minus game 1's plan", () => {
    // 10U daily max is 75. Ace is penciled for 40 in the opener, so the
    // nightcap must still offer him — with 35 left, not a fresh 75.
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [{ playerId: "p1", role: "start", plannedPitches: 40 }],
        })}
      />,
      {
        withRouter: true,
        team: { team: baseTeam({ games: dhGames }), currentRole: "head" },
      },
    );
    expect(screen.getByText(/#1 Ace · start · 40p/)).toBeInTheDocument();
    expect(screen.getByText(/· 35 left/)).toBeInTheDocument();
    // Untouched arms carry no remainder label — nothing has been spent.
    expect(screen.getAllByText("#2 Lefty")).toHaveLength(2);
  });

  it("shows the day as maxed once game 1 spends the whole budget", () => {
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [{ playerId: "p1", role: "start", plannedPitches: 75 }],
        })}
      />,
      {
        withRouter: true,
        team: { team: baseTeam({ games: dhGames }), currentRole: "head" },
      },
    );
    expect(screen.getByText(/#1 Ace · day maxed/)).toBeInTheDocument();
  });

  it("flags a doubleheader pair that would pass the daily max, naming what's left", () => {
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [{ playerId: "p1", role: "start", plannedPitches: 50 }],
          g2: [{ playerId: "p1", role: "relief", plannedPitches: 40 }],
        })}
      />,
      {
        withRouter: true,
        team: { team: baseTeam({ games: dhGames }), currentRole: "head" },
      },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/25 left today/);
  });

  it("assistants see the plan read-only", () => {
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [{ playerId: "p1", role: "start", plannedPitches: 40 }],
        })}
      />,
      {
        withRouter: true,
        team: { team: baseTeam(), currentRole: "assistant" },
      },
    );
    expect(screen.getByText(/#1 Ace · start · 40p/)).toBeInTheDocument();
    expect(screen.queryByText(/Add arm/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Remove Ace from this game's plan"),
    ).not.toBeInTheDocument();
  });

  it("hides entirely for non-Kid-Pitch formats", () => {
    const { container } = renderWithProviders(
      <TournamentPitchPlanPanel tournament={tournament()} />,
      {
        withRouter: true,
        team: {
          team: baseTeam({ pitchingFormat: "Machine Pitch" }),
          currentRole: "head",
        },
      },
    );
    expect(container).toBeEmptyDOMElement();
  });
});
