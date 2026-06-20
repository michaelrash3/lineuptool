import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { StatsTab } from "./StatsTab";
import { renderWithProviders } from "../test-utils";

const team = {
  players: [
    {
      id: "a",
      name: "Apex",
      number: "1",
      stats: {
        ab: 20,
        ops: 1.2,
        avg: 0.4,
        hr: 3,
        pEra: 2.5,
        pWhip: 1.1,
        pGoAo: 2.1,
      },
    },
    {
      id: "b",
      name: "Bolt",
      number: "2",
      stats: {
        ab: 18,
        ops: 0.6,
        avg: 0.25,
        hr: 0,
        pEra: 6.0,
        pWhip: 1.9,
        pGoAo: 0.8,
      },
    },
  ],
  games: [],
  evaluationEvents: [],
  primaryColor: "#1d4ed8",
  tertiaryColor: "#ffffff",
};

describe("StatsTab", () => {
  it("shows an empty state when there are no players (no header card)", () => {
    renderWithProviders(<StatsTab />, {
      team: { team: { players: [], games: [] } },
    });
    expect(
      screen.getByText(/Add players and import stats/i),
    ).toBeInTheDocument();
    // The "Stats & Dashboard" title card was removed — content leads the tab.
    expect(screen.queryByText("Stats & Dashboard")).toBeNull();
  });

  it("renders the batting table with players and sortable headers", () => {
    renderWithProviders(<StatsTab />, { team: { team } });
    expect(screen.getByRole("button", { name: /OPS/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Overall/ })).toBeInTheDocument();
    // Player appears at least in the table (and possibly leader cards).
    expect(
      screen.getAllByRole("button", { name: /Apex/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /Bolt/ }).length,
    ).toBeGreaterThan(0);
    // Pitching-only columns are not shown in the batting view.
    expect(screen.queryByRole("button", { name: /WHIP/ })).toBeNull();
  });

  it("switches to the pitching view and reveals advanced pitching columns", () => {
    renderWithProviders(<StatsTab />, { team: { team } });
    fireEvent.click(screen.getByRole("button", { name: "Pitching" }));
    expect(screen.getByRole("button", { name: /WHIP/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SM%/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GO\/AO/ })).toBeInTheDocument();
  });

  it("does not render the removed Game Log or Leaders sections", () => {
    renderWithProviders(<StatsTab />, { team: { team } });
    expect(screen.queryByText("Leaders")).toBeNull();
    expect(screen.queryByText(/Season Log|Recent Games|Game Log/i)).toBeNull();
  });

  it("opens the player profile when a name is tapped", () => {
    const openPlayerProfile = jest.fn();
    renderWithProviders(<StatsTab />, {
      team: { team },
      ui: { openPlayerProfile },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Apex/ })[0]);
    expect(openPlayerProfile).toHaveBeenCalledWith("a");
  });

  it("draws an eval-trend sparkline for a player with multiple rounds", () => {
    const withEvals = {
      ...team,
      evaluationEvents: [
        {
          id: "r1",
          date: "2026-02-01",
          coachRole: "Head",
          grades: { a: { contact: 2, glove: 2 } },
        },
        {
          id: "r2",
          date: "2026-03-01",
          coachRole: "Head",
          grades: { a: { contact: 5, glove: 5 } },
        },
      ],
    };
    const { container } = renderWithProviders(<StatsTab />, {
      team: { team: withEvals },
    });
    // The sparkline is a fixed-size recharts AreaChart, which draws paths.
    expect(container.querySelector("svg .recharts-area-curve")).toBeTruthy();
  });

  it("surfaces an arm-care banner for an overused Kid-Pitch pitcher", () => {
    const kidPitch = {
      ...team,
      pitchingFormat: "Kid Pitch",
      players: [
        {
          id: "a",
          name: "Apex",
          number: "1",
          stats: {},
          pitching: {
            log: [
              { date: "2026-05-01", pitches: 20 },
              { date: "2026-05-02", pitches: 20 },
              { date: "2026-05-03", pitches: 20 },
            ],
          },
        },
      ],
    };
    renderWithProviders(<StatsTab />, {
      team: { team: kidPitch, currentRole: "head" },
    });
    expect(screen.getByText(/Arm Care/i)).toBeInTheDocument();
  });
});
