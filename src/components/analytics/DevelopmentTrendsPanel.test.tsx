import { render, screen, fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";
import { renderWithProviders } from "../../test-utils";
import { DevelopmentTrendsPanel } from "./DevelopmentTrendsPanel";
import {
  PositionInningsStrip,
  SeasonStatTrendRow,
} from "../PlayerDevelopmentViz";
import type { EvaluationEvent, Game, Player, PlayerStats } from "../../types";

// The classification heuristics are covered in utils/playerDevelopment.test.ts
// — these tests pin the panel wiring: one row per active player with the
// fixture-driven chips, row click → onOpenPlayer, the biggest-movers gating,
// stripped mode dropping the sparklines, and insufficient-signal rendering.
// Plus direct smoke tests for the lazy-only PlayerDevelopmentViz pieces that
// don't need a chart frame (fixed-size/plain-div, so jsdom renders them).

// Same mock as playerDevelopment.test.ts: exact per-round numbers come straight
// off a `score` grade key instead of the real lineupEngine score model.
vi.mock("../../utils/evaluationScore", () => ({
  currentEvaluationScore100: (
    grades: { score?: unknown } | null | undefined,
  ): number | null => (typeof grades?.score === "number" ? grades.score : null),
  playerTopMph: () => undefined,
}));

const player = (
  id: string,
  name: string,
  extra: Partial<Player> = {},
): Player => ({
  id,
  name,
  ...extra,
});

const finalGame = (
  id: string,
  date: string,
  playerStats?: Record<string, PlayerStats>,
  extra: Partial<Game> = {},
): Game => ({
  id,
  date,
  opponent: "Opp",
  status: "final",
  teamScore: 1,
  opponentScore: 0,
  playerStats,
  ...extra,
});

// Ava: batting improving (+.125), evals improving (50→60), positions steady
// (SS both halves) → overall improving, 3 of 3 signals. Ben: no data at all.
const players = [
  player("p1", "Ava"),
  player("p2", "Ben"),
  player("p3", "Gone Kid", { rosterStatus: "departed" }),
];
const games: Game[] = [0, 1, 2, 3].map((h, i) =>
  finalGame(`g${i + 1}`, `2026-04-0${i + 1}`, {
    p1: { ab: 4, h, fInnSS: 3 },
  }),
);
const evaluationEvents: EvaluationEvent[] = [
  { id: "r1", date: "2026-04-01", grades: { p1: { score: 50 } } },
  { id: "r2", date: "2026-05-01", grades: { p1: { score: 60 } } },
];

const renderPanel = (
  overrides: Partial<{
    evaluationEvents: EvaluationEvent[];
    stripped: boolean;
  }> = {},
) => {
  const onOpenPlayer = vi.fn();
  const result = renderWithProviders(
    <DevelopmentTrendsPanel
      players={players}
      games={games}
      evaluationEvents={overrides.evaluationEvents ?? evaluationEvents}
      stripped={overrides.stripped ?? false}
      onOpenPlayer={onOpenPlayer}
    />,
  );
  return { onOpenPlayer, ...result };
};

describe("DevelopmentTrendsPanel", () => {
  it("renders one row per non-departed player with fixture-driven cells", () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    // "Ava" also appears in the movers callout — target the row button.
    expect(screen.getByRole("button", { name: "Ava" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ben" })).toBeInTheDocument();
    expect(screen.queryByText("Gone Kid")).toBeNull();
    // Ava's cells: batting delta, eval first→last, position counts, chip, tally.
    expect(screen.getByText("+.125")).toBeInTheDocument();
    expect(screen.getByText("50→60")).toBeInTheDocument();
    expect(screen.getByText("1 → 1")).toBeInTheDocument();
    expect(screen.getByText("Improving")).toBeInTheDocument();
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    expect(screen.getByText("0 of 3")).toBeInTheDocument();
  });

  it("renders em-dashes and a muted chip for a player with no usable signals", () => {
    renderPanel();
    const row = screen.getByRole("button", { name: "Ben" }).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getAllByText("—")).toHaveLength(3);
    expect(within(row!).getByText("Not enough data")).toBeInTheDocument();
  });

  it("opens the player profile on row click", () => {
    const { onOpenPlayer } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Ava" }));
    expect(onOpenPlayer).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: "Ben" }).closest("tr")!);
    expect(onOpenPlayer).toHaveBeenCalledWith("p2");
  });

  it("shows the biggest-movers callout only when an improving eval exists", () => {
    renderPanel();
    expect(screen.getByText("Biggest movers")).toBeInTheDocument();
    expect(screen.getByText("+10 eval")).toBeInTheDocument();
  });

  it("hides the biggest-movers callout without an improving eval", () => {
    renderPanel({ evaluationEvents: [] });
    expect(screen.queryByText("Biggest movers")).toBeNull();
  });

  it("drops the sparklines in stripped mode", () => {
    const rich = renderPanel();
    expect(rich.container.querySelector(".recharts-surface")).toBeTruthy();
    rich.unmount();
    const bare = renderPanel({ stripped: true });
    expect(bare.container.querySelector(".recharts-surface")).toBeNull();
    // The classification cells survive stripping.
    expect(screen.getByText("+.125")).toBeInTheDocument();
  });

  it("shows the empty state when there are no active players", () => {
    renderWithProviders(
      <DevelopmentTrendsPanel
        players={[player("p3", "Gone Kid", { rosterStatus: "departed" })]}
        games={[]}
        evaluationEvents={[]}
        stripped={false}
        onOpenPlayer={vi.fn()}
      />,
    );
    expect(screen.getByText("No development trends yet")).toBeInTheDocument();
    expect(screen.getByText(/per-game stat imports/i)).toBeInTheDocument();
  });
});

describe("PlayerDevelopmentViz smoke", () => {
  it("PositionInningsStrip renders per-position bars sorted by innings", () => {
    const { container } = render(
      <PositionInningsStrip byPosition={{ "2B": 3, SS: 8 }} />,
    );
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("SS");
    expect(rows[0]).toHaveTextContent("8");
    expect(rows[1]).toHaveTextContent("2B");
    expect(rows[1]).toHaveTextContent("3");
  });

  it("PositionInningsStrip renders nothing without innings", () => {
    const { container } = render(<PositionInningsStrip byPosition={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("SeasonStatTrendRow shows labelled sparkline tiles once 2+ counted games exist", () => {
    const { container } = render(
      <SeasonStatTrendRow
        games={[
          finalGame("g1", "2026-04-01", { p9: { ab: 4, h: 2, ops: 0.9 } }),
          finalGame("g2", "2026-04-08", { p9: { ab: 4, h: 1, ops: 0.7 } }),
        ]}
        playerId="p9"
      />,
    );
    expect(screen.getByText("AVG")).toBeInTheDocument();
    expect(screen.getByText("OPS")).toBeInTheDocument();
    // Cumulative through both games: AVG 3/8, OPS ab-weighted mean of .9/.7.
    expect(screen.getByText(".375")).toBeInTheDocument();
    expect(screen.getByText(".800")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "AVG season trend" })).toBeTruthy();
    expect(container.querySelector(".recharts-surface")).toBeTruthy();
  });

  it("SeasonStatTrendRow renders nothing when scrimmages leave under 2 points", () => {
    const { container } = render(
      <SeasonStatTrendRow
        games={[
          finalGame("g1", "2026-04-01", { p9: { ab: 4, h: 2, ops: 0.9 } }),
          finalGame(
            "scrim",
            "2026-04-08",
            { p9: { ab: 4, h: 1, ops: 0.7 } },
            { isScrimmage: true },
          ),
        ]}
        playerId="p9"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
