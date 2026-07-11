import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TournamentsSection } from "./TournamentsSection";
import { renderWithProviders } from "../../test-utils";

// Two USSSA games one day apart → one derived weekend cluster.
const games = [
  { id: "g1", date: "2099-06-05", opponent: "Rays" },
  { id: "g2", date: "2099-06-06", opponent: "Cubs" },
];

const baseTeam = (over: any = {}) => ({
  games,
  tournaments: [],
  players: [],
  leagueRuleSet: "USSSA",
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  ...over,
});

describe("TournamentsSection", () => {
  it("offers an unclaimed weekend cluster as a suggestion and creates from it", async () => {
    const addTournament = jest.fn();
    renderWithProviders(<TournamentsSection />, {
      team: { team: baseTeam(), currentRole: "head", addTournament },
    });
    const chip = screen.getByText(/Name this tournament/);
    await userEvent.click(chip);
    await userEvent.type(screen.getByLabelText("Name"), "June Bash");
    await userEvent.click(screen.getByText("Save"));
    expect(addTournament).toHaveBeenCalledWith({
      name: "June Bash",
      gameIds: ["g1", "g2"],
      seedKey: "tour-2099-06-05",
    });
  });

  it("renders a stored tournament as a card and suppresses its claimed suggestion", () => {
    renderWithProviders(<TournamentsSection />, {
      team: {
        team: baseTeam({
          tournaments: [
            { id: "t1", name: "Memorial Bash", gameIds: ["g1", "g2"] },
          ],
        }),
        currentRole: "head",
        removeTournament: jest.fn(),
      },
    });
    expect(screen.getByText("Memorial Bash")).toBeInTheDocument();
    expect(screen.queryByText(/Name this tournament/)).not.toBeInTheDocument();
  });

  it("expanding a card lists its games chronologically", async () => {
    renderWithProviders(<TournamentsSection />, {
      team: {
        team: baseTeam({
          tournaments: [
            { id: "t1", name: "Memorial Bash", gameIds: ["g2", "g1"] },
          ],
        }),
        currentRole: "head",
        removeTournament: jest.fn(),
      },
    });
    await userEvent.click(screen.getByText("Memorial Bash"));
    // Both the game list and the pitch-plan panel name each game.
    expect(screen.getAllByText(/vs Rays/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/vs Cubs/).length).toBeGreaterThan(0);
  });

  it("assistants get no suggestion chips and no edit/delete controls", () => {
    renderWithProviders(<TournamentsSection />, {
      team: {
        team: baseTeam({
          tournaments: [
            { id: "t1", name: "Memorial Bash", gameIds: ["g1", "g2"] },
          ],
        }),
        currentRole: "assistant",
      },
    });
    expect(screen.queryByText(/Name this tournament/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Delete Memorial Bash"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Edit Memorial Bash"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the tournaments module is toggled off", () => {
    const { container } = renderWithProviders(<TournamentsSection />, {
      team: {
        team: baseTeam({
          disabledFeatures: ["tournaments"],
          tournaments: [
            { id: "t1", name: "Memorial Bash", gameIds: ["g1", "g2"] },
          ],
        }),
        currentRole: "head",
      },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no tournaments and no clusters", () => {
    const { container } = renderWithProviders(<TournamentsSection />, {
      team: {
        team: baseTeam({ games: [{ id: "solo", date: "2099-06-05" }] }),
        currentRole: "head",
      },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("editing a card re-opens the picker and saves via updateTournament", async () => {
    const updateTournament = jest.fn();
    renderWithProviders(<TournamentsSection />, {
      team: {
        team: baseTeam({
          tournaments: [{ id: "t1", name: "Memorial Bash", gameIds: ["g1"] }],
        }),
        currentRole: "head",
        updateTournament,
        removeTournament: jest.fn(),
      },
    });
    await userEvent.click(screen.getByLabelText("Edit Memorial Bash"));
    // Link the second game too.
    await userEvent.click(screen.getByText("vs Cubs"));
    await userEvent.click(screen.getByText("Save"));
    expect(updateTournament).toHaveBeenCalledWith("t1", {
      name: "Memorial Bash",
      gameIds: expect.arrayContaining(["g1", "g2"]),
    });
  });
});
