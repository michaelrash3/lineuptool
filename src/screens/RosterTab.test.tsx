import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RosterTab } from "./RosterTab";
import { renderWithProviders } from "../test-utils";

const players = [
  { id: "p1", name: "Ava Rivera", number: "7", comfortablePositions: ["SS"] },
  { id: "p2", name: "Mia Stone", number: "12", comfortablePositions: ["C"] },
];

describe("RosterTab", () => {
  it("renders the roster header and each player's name", () => {
    renderWithProviders(<RosterTab />, {
      team: { team: { players, games: [] }, currentRole: "head" },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    expect(screen.getByText("Team Roster")).toBeInTheDocument();
    expect(screen.getByText("Ava Rivera")).toBeInTheDocument();
    expect(screen.getByText("Mia Stone")).toBeInTheDocument();
  });

  it("invokes setIsAddingPlayer when a head coach taps Add Player", async () => {
    const setIsAddingPlayer = jest.fn();
    renderWithProviders(<RosterTab />, {
      team: { team: { players, games: [] }, currentRole: "head" },
      ui: { setIsAddingPlayer },
    });
    await userEvent.click(screen.getByRole("button", { name: /add player/i }));
    expect(setIsAddingPlayer).toHaveBeenCalledWith(true);
  });

  it("shows the empty state when there are no players", () => {
    renderWithProviders(<RosterTab />, {
      team: { team: { players: [], games: [] }, currentRole: "head" },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    expect(screen.getByText("No Roster Found")).toBeInTheDocument();
  });

  const playersWithStats = [
    {
      id: "p1",
      name: "Ava Rivera",
      number: "7",
      stats: { ab: 10, h: 5, avg: 0.3, ops: 0.75, rbi: 4 },
    },
  ];

  it("shows the full per-row stat grid by default (rich)", () => {
    renderWithProviders(<RosterTab />, {
      team: {
        team: { players: playersWithStats, games: [] },
        currentRole: "head",
      },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    // Scope to the per-row grid (a <div> label) so it doesn't match the
    // stats side panel's leader rows (which label stats in <span>s).
    expect(screen.getByText("RBI", { selector: "div" })).toBeInTheDocument();
    expect(screen.queryByText("AVG · OPS")).toBeNull();
  });

  it("condenses the per-row stat strip when statDisplay is stripped", () => {
    renderWithProviders(<RosterTab />, {
      team: {
        team: { players: playersWithStats, games: [], statDisplay: "stripped" },
        currentRole: "head",
      },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    expect(screen.getByText("AVG · OPS")).toBeInTheDocument();
    // The detailed per-row grid (a <div> RBI label) is gone; the side panel's
    // leader span is unrelated and may still be present.
    expect(screen.queryByText("RBI", { selector: "div" })).toBeNull();
  });

  it("offers Import Roster at the bottom for head coaches", () => {
    renderWithProviders(<RosterTab />, {
      team: {
        team: { players, games: [] },
        currentRole: "head",
        uploadStatsCsv: jest.fn(),
      },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    expect(screen.getByText("Import Roster")).toBeInTheDocument();
  });

  it("hides Import Roster from assistant coaches", () => {
    renderWithProviders(<RosterTab />, {
      team: { team: { players, games: [] }, currentRole: "assistant" },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    expect(screen.queryByText("Import Roster")).not.toBeInTheDocument();
  });

  it("separates departed players into their own section (no Inactive status)", async () => {
    renderWithProviders(<RosterTab />, {
      team: {
        team: {
          players: [
            ...players,
            {
              id: "p3",
              name: "Zoe Kim",
              number: "18",
              present: false,
              rosterStatus: "departed",
            },
            // A legacy "inactive" player now counts as active (status retired).
            {
              id: "p4",
              name: "Lily Chen",
              number: "22",
              rosterStatus: "inactive",
            },
          ],
          games: [],
        },
        currentRole: "head",
      },
      ui: { setIsAddingPlayer: jest.fn() },
    });

    // p1, p2, and the former-inactive p4 are all active; only Zoe is departed.
    expect(screen.getByText("3 Active")).toBeInTheDocument();
    expect(screen.getAllByText("Departed").length).toBeGreaterThan(0);
    // The "Inactive" status is gone entirely.
    expect(screen.queryByText("Inactive")).toBeNull();
    expect(screen.getByText("Lily Chen")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Departed" }));
    expect(screen.getByText("Zoe Kim")).toBeInTheDocument();
    expect(screen.queryByText("Lily Chen")).toBeNull();
  });

  it("stats side panel shows team leaders and switches to a player on jersey tap", async () => {
    renderWithProviders(<RosterTab />, {
      team: {
        team: { players: playersWithStats, games: [] },
        currentRole: "head",
      },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    // Default: team leaders panel.
    expect(screen.getByText("Team Leaders")).toBeInTheDocument();
    // Tapping the jersey (View stats) selects the player.
    await userEvent.click(
      screen.getByRole("button", { name: /view ava rivera stats/i }),
    );
    expect(screen.getByText("Player stats")).toBeInTheDocument();
    expect(screen.getByText("Batting")).toBeInTheDocument();
  });

  it("opens a player's profile when their name is tapped (interaction)", async () => {
    const { uiValue } = renderWithProviders(<RosterTab />, {
      team: { team: { players, games: [] }, currentRole: "head" },
      ui: { setIsAddingPlayer: jest.fn() },
    });
    await userEvent.click(screen.getByRole("button", { name: "Ava Rivera" }));
    expect(uiValue.openPlayerProfile).toHaveBeenCalledWith("p1");
  });
});
