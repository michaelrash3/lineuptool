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
      { team: { team: baseTeam(), currentRole: "head" } },
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
      { team: { team: baseTeam(), currentRole: "head" } },
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
      { team: { team: baseTeam(), currentRole: "head", setPlannedOutings } },
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
      { team: { team: baseTeam({ players: logged }), currentRole: "head" } },
    );
    expect(screen.getByText("logged")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Remove Ace from this game's plan"),
    ).not.toBeInTheDocument();
  });

  it("assistants see the plan read-only", () => {
    renderWithProviders(
      <TournamentPitchPlanPanel
        tournament={tournament({
          g1: [{ playerId: "p1", role: "start", plannedPitches: 40 }],
        })}
      />,
      { team: { team: baseTeam(), currentRole: "assistant" } },
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
        team: {
          team: baseTeam({ pitchingFormat: "Machine Pitch" }),
          currentRole: "head",
        },
      },
    );
    expect(container).toBeEmptyDOMElement();
  });
});
