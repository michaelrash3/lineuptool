import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WeekPlannerPage } from "./WeekPlannerPage";
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

// 2099-06-01 is a Monday: Wednesday rec game + Saturday/Sunday tournament
// games share a Mon–Sun week; the following Monday opens a new week.
const games = [
  {
    id: "wed",
    date: "2099-06-03",
    opponent: "Rec Rivals",
    leagueRuleSet: "NKB",
  },
  {
    id: "sat",
    date: "2099-06-06",
    opponent: "Bandits",
    leagueRuleSet: "USSSA",
  },
  {
    id: "mon2",
    date: "2099-06-08",
    opponent: "Next Week",
    leagueRuleSet: "USSSA",
    gameType: "bracket",
  },
];

const baseTeam = (over: any = {}) => ({
  players,
  games,
  tournaments: [],
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  leagueRuleSet: "NKB",
  ...over,
});

const renderPage = (teamOver: any = {}, ctxOver: any = {}) => {
  const updateGame = jest.fn();
  const setPlannedOutings = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/schedule/week"]}>
      <WeekPlannerPage />
    </MemoryRouter>,
    {
      team: {
        team: baseTeam(teamOver),
        currentRole: "head",
        updateGame,
        setPlannedOutings,
        ...ctxOver,
      },
    },
  );
  return { ...utils, updateGame, setPlannedOutings };
};

describe("WeekPlannerPage", () => {
  it("groups rec AND tournament games into Mon–Sun weeks with classification chips", () => {
    renderPage();
    // Two week sections.
    expect(screen.getByText(/Week of Jun 1 – Jun 7/)).toBeInTheDocument();
    expect(screen.getByText(/Week of Jun 8 – Jun 14/)).toBeInTheDocument();
    // All three games, rec included.
    expect(screen.getByText(/vs Rec Rivals/)).toBeInTheDocument();
    expect(screen.getByText(/vs Bandits/)).toBeInTheDocument();
    expect(screen.getByText(/vs Next Week/)).toBeInTheDocument();
    // Classification chips: NKB → Rec, unstamped USSSA → Pool, stamped bracket.
    expect(screen.getByText("Rec")).toBeInTheDocument();
    expect(screen.getByText("Pool")).toBeInTheDocument();
    expect(screen.getByText("Bracket")).toBeInTheDocument();
  });

  it("Wednesday burns Saturday: a rec-game plan shows the arm resting for the weekend game", () => {
    renderPage({
      games: [
        {
          ...games[0],
          pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
        },
        games[1],
      ],
    });
    // Wednesday card shows the planned chip…
    expect(screen.getByText(/#1 Ace · start · 60p/)).toBeInTheDocument();
    // …and Saturday's card shows the consequence: Ace resting, ready in 1 day
    // (60p on Wednesday → 3 rest days → back Sunday).
    expect(screen.getByText(/#1 Ace · 1d/)).toBeInTheDocument();
    // Lefty stays ready on both cards.
    expect(screen.getAllByText("#2 Lefty")).toHaveLength(2);
  });

  it("surfaces a rest violation when the burned arm is planned again that week", () => {
    renderPage({
      games: [
        {
          ...games[0],
          pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 60 }],
        },
        {
          ...games[1],
          pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 20 }],
        },
      ],
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Ace threw 60 .* isn't rested/,
    );
  });

  it("adding an arm to a standalone game writes the game's own pitchPlan", async () => {
    const { updateGame, setPlannedOutings } = renderPage();
    await userEvent.click(screen.getAllByText(/Add arm/)[0]); // Wednesday (rec)
    await userEvent.click(screen.getByText("Add"));
    expect(updateGame).toHaveBeenCalledWith("wed", {
      pitchPlan: [{ playerId: "p1", role: "start" }],
    });
    expect(setPlannedOutings).not.toHaveBeenCalled();
  });

  it("adding an arm to a tournament-claimed game writes the tournament's pitchPlan", async () => {
    const { updateGame, setPlannedOutings } = renderPage({
      tournaments: [{ id: "t1", name: "Memorial Bash", gameIds: ["sat"] }],
    });
    await userEvent.click(screen.getAllByText(/Add arm/)[1]); // Saturday
    await userEvent.click(screen.getByText("Add"));
    expect(setPlannedOutings).toHaveBeenCalledWith("t1", "sat", [
      { playerId: "p1", role: "start" },
    ]);
    expect(updateGame).not.toHaveBeenCalled();
    // The claimed game links back to its tournament.
    expect(screen.getByText("Memorial Bash")).toBeInTheDocument();
  });

  it("removing a planned arm from a standalone game clears the field to null", async () => {
    const { updateGame } = renderPage({
      games: [
        {
          ...games[0],
          pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 30 }],
        },
      ],
    });
    await userEvent.click(
      screen.getByLabelText("Remove Ace from this game's plan"),
    );
    expect(updateGame).toHaveBeenCalledWith("wed", { pitchPlan: null });
  });

  it("keeps the week grouping but drops pitch planning outside Kid Pitch 9U+", () => {
    renderPage({ pitchingFormat: "Machine Pitch" });
    expect(screen.getByText(/vs Rec Rivals/)).toBeInTheDocument();
    expect(screen.queryByText(/Add arm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Arms for this game/)).not.toBeInTheDocument();
  });

  it("assistants read the plan without edit affordances", () => {
    renderPage(
      {
        games: [
          {
            ...games[0],
            pitchPlan: [{ playerId: "p1", role: "start", plannedPitches: 30 }],
          },
        ],
      },
      { currentRole: "assistant" },
    );
    expect(screen.getByText(/#1 Ace · start · 30p/)).toBeInTheDocument();
    expect(screen.queryByText(/Add arm/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Remove Ace from this game's plan"),
    ).not.toBeInTheDocument();
  });

  it("excludes scrimmages from the planner", () => {
    renderPage({
      games: [games[0], { ...games[1], isScrimmage: true }],
    });
    expect(screen.getByText(/vs Rec Rivals/)).toBeInTheDocument();
    expect(screen.queryByText(/vs Bandits/)).not.toBeInTheDocument();
  });
});
