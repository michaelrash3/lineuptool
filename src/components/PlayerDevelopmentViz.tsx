// Chart-bearing pieces of the player development report, mirroring
// modals/statTrendViz: this module is loaded ONLY via React.lazy (from
// PlayerDevelopmentReport, with `.then((mod) => ({ default: mod.X }))`) so
// the recharts dependency stays out of the eagerly-loaded modals graph.
// Never import it statically.
import React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartFrame,
  ChartTooltip,
  FadeGradient,
  useChartId,
} from "./charts/primitives";
import { Sparkline } from "./charts/Sparkline";
import { seasonSeriesFromGameLines } from "../utils/stats";
import { countsTowardStats } from "../utils/gameStatus";
import type { Game } from "../types";

export interface EvalTrajectoryPoint {
  date: string;
  score: number;
}

// ISO yyyy-mm-dd → M/D. String surgery, not Date parsing — the stored dates
// are local calendar days and a UTC round-trip would shift them. Accepts
// string | number to satisfy the tooltip labelFormatter signature.
const tickDate = (iso: string | number): string => {
  const m = String(iso).match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : String(iso);
};

const AXIS_TICK = {
  fontSize: 10,
  fontWeight: 800,
  fill: "var(--ink-3)",
} as const;

// Per-round eval score (0-100) over the season. One point per scored round.
export const EvalTrajectoryChart = ({
  series,
}: {
  series: EvalTrajectoryPoint[];
}) => {
  const id = useChartId();
  if (series.length < 2) return null;
  return (
    <ChartFrame label="Evaluation score trajectory" height={160}>
      <AreaChart
        data={series}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <defs>
          <FadeGradient
            id={id}
            color="var(--team-primary)"
            from={0.35}
            to={0.02}
          />
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--line)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          interval={Math.max(0, Math.ceil(series.length / 6) - 1)}
          tickFormatter={tickDate}
          tick={AXIS_TICK}
        />
        <YAxis
          domain={[0, 100]}
          width={30}
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(v) => `${Math.round(Number(v))}/100`}
              labelFormatter={tickDate}
            />
          }
          cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }}
        />
        <Area
          dataKey="score"
          name="Eval score"
          type="monotone"
          stroke="var(--team-primary)"
          strokeWidth={2.5}
          fill={`url(#${id})`}
          dot={{ r: 3, fill: "var(--team-primary)", strokeWidth: 0 }}
          animationDuration={600}
        />
      </AreaChart>
    </ChartFrame>
  );
};

const TRACKED: Array<{ key: string; label: string }> = [
  { key: "avg", label: "AVG" },
  { key: "ops", label: "OPS" },
];

const fmtDec3 = (v: number): string => v.toFixed(3).replace(/^0\./, ".");

// Cumulative season line (AVG / OPS) after each imported game, as labelled
// sparkline tiles. A stat only earns a tile once it has 2+ points.
export const SeasonStatTrendRow = ({
  games,
  playerId,
}: {
  games: Game[];
  playerId: string;
}) => {
  // Same finalized/non-scrimmage filter as every other stat surface.
  const counted = (games || []).filter((g) => countsTowardStats(g));
  const series = seasonSeriesFromGameLines(counted, playerId);
  const tiles = TRACKED.map(({ key, label }) => ({
    label,
    values: series
      .map((s) => s[key])
      .filter((v): v is number => Number.isFinite(v)),
  })).filter((t) => t.values.length >= 2);
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {tiles.map(({ label, values }) => (
        <div
          key={label}
          className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="t-eyebrow text-ink-3">{label}</div>
            <div className="text-base font-black tabular-nums text-ink leading-tight">
              {fmtDec3(values[values.length - 1])}
            </div>
          </div>
          <Sparkline
            values={values}
            width={48}
            strokeWidth={1.5}
            label={`${label} season trend`}
          />
        </div>
      ))}
    </div>
  );
};

// Horizontal per-position innings bars. Plain divs with % widths (no
// recharts) — trivially measurable under jsdom and cheap in the report.
export const PositionInningsStrip = ({
  byPosition,
}: {
  byPosition: Record<string, number>;
}) => {
  const rows = Object.entries(byPosition || {})
    .filter(([, innings]) => Number.isFinite(innings) && innings > 0)
    .sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return null;
  const max = rows[0][1];
  return (
    <ul className="space-y-1.5">
      {rows.map(([pos, innings]) => (
        <li key={pos} className="flex items-center gap-2">
          <span className="t-eyebrow text-ink-3 w-8 shrink-0">{pos}</span>
          <span
            className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden"
            aria-hidden
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(innings / max) * 100}%`,
                backgroundColor: "var(--team-primary)",
              }}
            />
          </span>
          <span className="text-xs font-black tabular-nums text-ink w-10 text-right shrink-0">
            {Number.isInteger(innings) ? innings : innings.toFixed(1)}
          </span>
        </li>
      ))}
    </ul>
  );
};
