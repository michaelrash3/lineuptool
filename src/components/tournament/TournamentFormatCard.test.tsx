import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { TournamentFormatCard } from "./TournamentFormatCard";
import { renderWithProviders } from "../../test-utils";
import { DEFAULT_TIEBREAKERS } from "../../utils/tournamentStakes";
import type { Tournament } from "../../types";

const games = [
  {
    id: "g1",
    date: "2099-06-05",
    opponent: "Rays",
    status: "final",
    teamScore: 15,
    opponentScore: 2,
  },
  { id: "g2", date: "2099-06-06", opponent: "Cubs" },
];

const baseTournament = (over: Partial<Tournament> = {}): Tournament => ({
  id: "t1",
  name: "June Bash",
  gameIds: ["g1", "g2"],
  ...over,
});

const renderCard = (tournament: Tournament, ctxOver: any = {}) => {
  const updateTournament = jest.fn();
  const utils = renderWithProviders(
    <TournamentFormatCard tournament={tournament} />,
    {
      team: {
        team: { games, tournaments: [tournament], players: [] },
        currentRole: "head",
        updateTournament,
        ...ctxOver,
      },
    },
  );
  return { ...utils, updateTournament };
};

describe("TournamentFormatCard", () => {
  it("renders the default USSSA ladder in order with coaching copy", () => {
    renderCard(baseTournament());
    const labels = [
      "Head-to-head",
      "Fewest runs allowed",
      "Run differential",
      "Most runs scored",
      "Coin flip",
    ];
    const positions = labels.map((l) => screen.getByText(l, { exact: false }));
    positions.forEach((el) => expect(el).toBeInTheDocument());
    // Cap-aware copy on the run-diff rung.
    expect(screen.getByText(/\+8 a game/)).toBeInTheDocument();
    // Default ladder → no reset chip.
    expect(screen.queryByText("Reset to USSSA")).not.toBeInTheDocument();
  });

  it("commits structure numbers on blur and describes the field", () => {
    const { updateTournament } = renderCard(
      baseTournament({
        structure: { poolCount: 4, advanceCount: 6, poolWinnersAdvance: true },
      }),
    );
    const teams = screen.getByLabelText("Teams");
    fireEvent.change(teams, { target: { value: "16" } });
    fireEvent.blur(teams);
    expect(updateTournament).toHaveBeenCalledWith("t1", {
      structure: {
        teamCount: 16,
        poolCount: 4,
        advanceCount: 6,
        poolWinnersAdvance: true,
      },
    });
  });

  it("shows the wildcard scramble framing for a 16/4/6 pool-winner format", () => {
    renderCard(
      baseTournament({
        structure: {
          teamCount: 16,
          poolCount: 4,
          advanceCount: 6,
          poolWinnersAdvance: true,
        },
      }),
    );
    expect(
      screen.getByText(
        "16 teams · 4 pools of 4 · top 6 advance — 4 pool winners + 2 wildcards",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/wildcard scramble for 2 spots/),
    ).toBeInTheDocument();
  });

  it("reorders the ladder with the move buttons", () => {
    const { updateTournament } = renderCard(baseTournament());
    fireEvent.click(screen.getByLabelText("Move Fewest runs allowed up"));
    expect(updateTournament).toHaveBeenCalledWith("t1", {
      tiebreakers: [
        { id: "runsAllowed" },
        { id: "h2h" },
        { id: "runDiff", cap: 8 },
        { id: "runsScored" },
        { id: "coinFlip" },
      ],
    });
  });

  it("removes a rung and offers it back as an add chip", () => {
    const { updateTournament } = renderCard(
      baseTournament({
        tiebreakers: [{ id: "h2h" }, { id: "runsAllowed" }],
      }),
    );
    // Missing criteria render as add chips.
    fireEvent.click(screen.getByText("Most runs scored"));
    expect(updateTournament).toHaveBeenCalledWith("t1", {
      tiebreakers: [{ id: "h2h" }, { id: "runsAllowed" }, { id: "runsScored" }],
    });

    fireEvent.click(screen.getByLabelText("Remove Head-to-head"));
    expect(updateTournament).toHaveBeenCalledWith("t1", {
      tiebreakers: [{ id: "runsAllowed" }],
    });
  });

  it("adding run differential seeds the USSSA +8 cap, and the cap edits on blur", () => {
    const { updateTournament } = renderCard(
      baseTournament({ tiebreakers: [{ id: "h2h" }] }),
    );
    fireEvent.click(screen.getByText("Run differential"));
    expect(updateTournament).toHaveBeenCalledWith("t1", {
      tiebreakers: [{ id: "h2h" }, { id: "runDiff", cap: 8 }],
    });
  });

  it("edits the run-diff cap on blur", () => {
    const { updateTournament } = renderCard(
      baseTournament({ tiebreakers: [{ id: "runDiff", cap: 8 }] }),
    );
    const cap = screen.getByLabelText("Run differential cap");
    fireEvent.change(cap, { target: { value: "10" } });
    fireEvent.blur(cap);
    expect(updateTournament).toHaveBeenCalledWith("t1", {
      tiebreakers: [{ id: "runDiff", cap: 10 }],
    });
  });

  it("offers Reset to USSSA only for a customized ladder", () => {
    const { updateTournament } = renderCard(
      baseTournament({ tiebreakers: [{ id: "runsScored" }] }),
    );
    fireEvent.click(screen.getByText("Reset to USSSA"));
    expect(updateTournament).toHaveBeenCalledWith("t1", {
      tiebreakers: DEFAULT_TIEBREAKERS.map((r) => ({ ...r })),
    });
  });

  it("summarizes the team's own pool currency with the cap applied", () => {
    renderCard(baseTournament());
    // g1 final 15-2 (+13 counted +8), g2 pending.
    expect(screen.getByText(/Pool so far 1-0/)).toBeInTheDocument();
    expect(screen.getByText("RA 2")).toBeInTheDocument();
    expect(screen.getByText("Diff +8")).toBeInTheDocument();
    expect(screen.getByText("cap ate 5")).toBeInTheDocument();
    expect(screen.getByText("1 pool game left")).toBeInTheDocument();
  });

  it("is read-only for assistants", () => {
    renderCard(baseTournament(), { currentRole: "assistant" });
    expect(screen.getByLabelText("Teams")).toBeDisabled();
    expect(
      screen.queryByLabelText("Move Fewest runs allowed up"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Remove Head-to-head"),
    ).not.toBeInTheDocument();
    // Guidance copy still reads for assistants.
    expect(screen.getByText(/two-team ties/)).toBeInTheDocument();
  });
});
