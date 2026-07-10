import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils";
import { SeasonTrendsPanel } from "./SeasonTrendsPanel";
import type { Game } from "../../types";

// The trend math itself is covered in utils/teamTrends.test.ts — these tests
// pin the panel wiring: the <2-games empty state, the four ChartFrame regions
// in rich mode (asserted via the wrapper's aria-label; ResponsiveContainer is
// 0x0 under jsdom so SVG internals are off-limits), the chart-free game log
// in stripped mode, and scrimmage exclusion end to end.

const finalGame = (
  id: string,
  date: string,
  teamScore: number,
  opponentScore: number,
  extra: Partial<Game> = {},
): Game => ({
  id,
  date,
  opponent: `Opp ${id}`,
  status: "final",
  teamScore,
  opponentScore,
  ...extra,
});

// W (+5), L (-2), T (0) → record 1-1-1, run diff +3; the scrimmage blowout
// must never count.
const games: Game[] = [
  finalGame("g1", "2026-04-01", 8, 3),
  finalGame("g2", "2026-04-08", 1, 3),
  finalGame("g3", "2026-04-15", 4, 4),
  finalGame("scrim", "2026-04-20", 20, 0, { isScrimmage: true }),
];

const CHART_LABELS = [
  "Cumulative run differential",
  "Runs scored vs runs allowed per game",
  "Rolling win percentage",
  "Margin of victory distribution",
];

describe("SeasonTrendsPanel", () => {
  it("shows only the empty state until two games are finalized (scrimmages don't count)", () => {
    renderWithProviders(
      <SeasonTrendsPanel
        games={[
          finalGame("g1", "2026-04-01", 8, 3),
          finalGame("scrim", "2026-04-08", 9, 0, { isScrimmage: true }),
          { id: "g2", date: "2026-04-15", opponent: "Later", status: "draft" },
        ]}
        stripped={false}
      />,
    );
    expect(
      screen.getByText("Not enough finalized games yet"),
    ).toBeInTheDocument();
    expect(screen.getByText(/enter final scores/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Record")).toBeNull();
  });

  it("renders stat tiles and the four chart frames in rich mode", () => {
    renderWithProviders(<SeasonTrendsPanel games={games} stripped={false} />);
    // Record / diff / per-game tiles, scrimmage excluded throughout.
    expect(screen.getByText("1-1-1")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument(); // 13 runs / 3 games
    expect(screen.getByText("3.3")).toBeInTheDocument();
    for (const label of CHART_LABELS) {
      expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("img")).toHaveLength(4);
  });

  it("renders the compact game log and zero charts in stripped mode", () => {
    const { container } = renderWithProviders(
      <SeasonTrendsPanel games={games} stripped={true} />,
    );
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(container.querySelector(".recharts-surface")).toBeNull();
    // One row per finalized non-scrimmage game, most recent first.
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Opp g3");
    expect(rows[2]).toHaveTextContent("Opp g1");
    expect(screen.queryByText("Opp scrim")).toBeNull();
    // Result chips + the running diff column (g1 +5 → g2 +3 → g3 +3).
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("T")).toBeInTheDocument();
    expect(screen.getByText("+5")).toBeInTheDocument();
    // Tiles still render in stripped mode.
    expect(screen.getByText("1-1-1")).toBeInTheDocument();
  });
});
