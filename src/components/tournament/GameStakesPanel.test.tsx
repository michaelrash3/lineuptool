import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GameStakesPanel } from "./GameStakesPanel";
import { renderWithProviders } from "../../test-utils";

const games = [
  {
    id: "g1",
    date: "2099-06-05",
    opponent: "Cubs",
    leagueRuleSet: "USSSA",
    status: "final",
    teamScore: 6,
    opponentScore: 2,
  },
  { id: "g2", date: "2099-06-06", opponent: "Cubs", leagueRuleSet: "USSSA" },
];

const renderPanel = (game: any, teamOver: any = {}, ctxOver: any = {}) => {
  const updateGame = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter>
      <GameStakesPanel game={game} />
    </MemoryRouter>,
    {
      team: {
        team: {
          games,
          players: [],
          tournaments: [],
          leagueRuleSet: "USSSA",
          ...teamOver,
        },
        currentRole: "head",
        updateGame,
        ...ctxOver,
      },
    },
  );
  return { ...utils, updateGame };
};

describe("GameStakesPanel", () => {
  it("renders nothing for Rec games and scrimmages", () => {
    const { container } = renderPanel({
      id: "g9",
      leagueRuleSet: "NKB",
      opponent: "Rays",
    });
    expect(container.querySelector(".cc-card")).toBeNull();
    const { container: c2 } = renderPanel({
      id: "g9",
      leagueRuleSet: "USSSA",
      isScrimmage: true,
      opponent: "Rays",
    });
    expect(c2.querySelector(".cc-card")).toBeNull();
  });

  it("writes the opponent-strength read and clears it on a second tap", () => {
    const { updateGame } = renderPanel(games[1]);
    fireEvent.click(screen.getByRole("button", { name: "Stronger" }));
    expect(updateGame).toHaveBeenCalledWith("g2", {
      opponentStrength: "stronger",
    });
  });

  it("tapping the active strength chip clears the read", () => {
    const { updateGame } = renderPanel({
      ...games[1],
      opponentStrength: "stronger",
    });
    expect(screen.getByRole("button", { name: "Stronger" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Stronger" }));
    expect(updateGame).toHaveBeenCalledWith("g2", { opponentStrength: null });
    // The read renders its ladder-aware guidance.
    expect(
      screen.getByText(/runs allowed is the currency/i),
    ).toBeInTheDocument();
  });

  it("shows the name-matched head-to-head across seasons", () => {
    renderPanel(games[1], {
      opponentArchive: [
        {
          season: "Spring 2025",
          opponent: "cubs",
          wins: 3,
          losses: 2,
          ties: 0,
          runsFor: 30,
          runsAgainst: 22,
        },
      ],
    });
    expect(screen.getByText(/1-0 this season/)).toBeInTheDocument();
    expect(screen.getByText(/3-2 in Spring 2025/)).toBeInTheDocument();
  });

  it("labels a first meeting when there's no history", () => {
    renderPanel({
      id: "g9",
      leagueRuleSet: "USSSA",
      opponent: "Sharks",
    });
    expect(screen.getByText(/First meeting with Sharks/)).toBeInTheDocument();
  });

  it("frames the stakes when a stored tournament claims the game", () => {
    renderPanel(games[1], {
      tournaments: [
        {
          id: "t1",
          name: "June Bash",
          gameIds: ["g1", "g2"],
          structure: {
            teamCount: 16,
            poolCount: 4,
            advanceCount: 6,
            poolWinnersAdvance: true,
          },
        },
      ],
    });
    // Link chip to the tournament page.
    expect(screen.getByRole("link", { name: /June Bash/ })).toHaveAttribute(
      "href",
      "/schedule/tournaments/t1",
    );
    expect(screen.getByText("Pool game 2 of 2")).toBeInTheDocument();
    expect(screen.getByText(/wildcard scramble/)).toBeInTheDocument();
    // Ledger chips: g1 final 6-2 → 1-0, RA 2, capped diff +4.
    expect(screen.getByText(/Pool so far 1-0/)).toBeInTheDocument();
    expect(screen.getByText("Diff +4")).toBeInTheDocument();
  });

  it("omits the stakes block when the tournaments module is off", () => {
    renderPanel(games[1], {
      disabledFeatures: ["tournaments"],
      tournaments: [{ id: "t1", name: "June Bash", gameIds: ["g1", "g2"] }],
    });
    expect(screen.queryByText(/Pool game/)).not.toBeInTheDocument();
    // Scouting itself still renders — it's game-level, not module-level.
    expect(screen.getByRole("button", { name: "Weaker" })).toBeInTheDocument();
  });

  it("disables the strength chips for assistants", () => {
    renderPanel(games[1], {}, { currentRole: "assistant" });
    expect(screen.getByRole("button", { name: "Stronger" })).toBeDisabled();
  });
});
