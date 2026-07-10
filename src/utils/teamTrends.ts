// Team-trend series for the season analytics view: the chronological game
// log annotated with cumulative run differential and a rolling win pct, plus
// a fixed-shape margin histogram. Pure aggregation over finalized games —
// scrimmages and unfinalized games are excluded via buildSeasonSummary's
// countsTowardStats filter.

import { buildSeasonSummary, type SeasonSummary } from "./season";
import type { Game } from "../types";

export interface TeamTrendPoint {
  id: string;
  date: string;
  opponent: string;
  runsFor: number;
  runsAgainst: number;
  margin: number;
  // Running sum of `margin` in chronological order.
  cumRunDiff: number;
  // Win pct over the last 5 games INCLUDING this one (ties = half a win);
  // null until the window holds at least 3 games, so the line doesn't
  // whipsaw off a 1-2 game sample.
  rollingWinPct: number | null;
  result: "W" | "L" | "T";
}

export interface MarginBucket {
  label: string;
  count: number;
  kind: "loss" | "close" | "win";
}

export interface TeamTrendSeries {
  points: TeamTrendPoint[];
  marginBuckets: MarginBucket[];
  summary: SeasonSummary;
}

const ROLLING_WINDOW = 5;
const ROLLING_MIN_GAMES = 3;

// Fixed bucket edges so the histogram keeps a stable shape (zero-count
// buckets included). A tie is "close", not its own kind.
const MARGIN_BUCKETS: Array<{
  label: string;
  kind: MarginBucket["kind"];
  min: number;
  max: number;
}> = [
  { label: "≤ -7", kind: "loss", min: -Infinity, max: -7 },
  { label: "-6 to -3", kind: "loss", min: -6, max: -3 },
  { label: "-2 to -1", kind: "close", min: -2, max: -1 },
  { label: "Tie", kind: "close", min: 0, max: 0 },
  { label: "+1 to +2", kind: "close", min: 1, max: 2 },
  { label: "+3 to +6", kind: "win", min: 3, max: 6 },
  { label: "≥ +7", kind: "win", min: 7, max: Infinity },
];

export const buildTeamTrendSeries = (
  games: Game[] | null | undefined,
): TeamTrendSeries => {
  const summary = buildSeasonSummary(games);
  // summary.results are most-recent-first; the trend line wants oldest-first.
  const chronological = summary.results.slice().reverse();

  let cumRunDiff = 0;
  const points: TeamTrendPoint[] = chronological.map((r, i) => {
    const margin = r.teamScore - r.opponentScore;
    cumRunDiff += margin;

    const window = chronological.slice(
      Math.max(0, i + 1 - ROLLING_WINDOW),
      i + 1,
    );
    let rollingWinPct: number | null = null;
    if (window.length >= ROLLING_MIN_GAMES) {
      let winPoints = 0;
      for (const g of window) {
        if (g.result === "W") winPoints += 1;
        else if (g.result === "T") winPoints += 0.5;
      }
      rollingWinPct = winPoints / window.length;
    }

    return {
      id: r.id,
      date: r.date,
      opponent: r.opponent,
      runsFor: r.teamScore,
      runsAgainst: r.opponentScore,
      margin,
      cumRunDiff,
      rollingWinPct,
      result: r.result,
    };
  });

  const marginBuckets: MarginBucket[] = MARGIN_BUCKETS.map(
    ({ label, kind, min, max }) => ({
      label,
      kind,
      count: points.filter((p) => p.margin >= min && p.margin <= max).length,
    }),
  );

  return { points, marginBuckets, summary };
};
