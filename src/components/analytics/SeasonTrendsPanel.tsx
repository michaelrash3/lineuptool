// Team season-trend analytics: stat tiles + four trend charts (or a compact
// game log in stripped mode) over buildTeamTrendSeries. Chart-bearing — this
// module only enters the lazily loaded StatsTab chunk, so top-level recharts
// imports don't touch the startup bundle (same rationale as financeViz).
import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  buildTeamTrendSeries,
  type MarginBucket,
} from "../../utils/teamTrends";
import {
  ChartFrame,
  ChartTooltip,
  FadeGradient,
  useChartId,
} from "../charts/primitives";
import { Chip, EmptyState, StatTile } from "../shared";
import type { Game } from "../../types";

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

// ISO yyyy-mm-dd → M/D. String surgery, not Date parsing — the stored dates
// are local calendar days and a UTC round-trip would shift them. Accepts
// string | number to satisfy the tooltip labelFormatter signature.
const tickDate = (iso: string | number): string => {
  const m = String(iso).match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : String(iso);
};

// recharts `interval` = ticks skipped between labels; keep ~6 date labels
// however long the season runs.
const sparseInterval = (count: number): number =>
  Math.max(0, Math.ceil(count / 6) - 1);

const AXIS_TICK = {
  fontSize: 10,
  fontWeight: 800,
  fill: "var(--ink-3)",
} as const;

const MARGIN_COLOR: Record<MarginBucket["kind"], string> = {
  loss: "var(--loss)",
  close: "var(--ink-3)",
  win: "var(--win)",
};

const RESULT_VARIANT: Record<"W" | "L" | "T", string> = {
  W: "success",
  L: "danger",
  T: "slate",
};

const ChartCard = ({
  title,
  explainer,
  children,
}: {
  title: string;
  explainer: string;
  children: React.ReactNode;
}) => (
  <div className="cc-card p-4 sm:p-5">
    <h3 className="t-card-title">{title}</h3>
    <p className="t-meta text-ink-3 mb-3">{explainer}</p>
    {children}
  </div>
);

export const SeasonTrendsPanel = ({
  games,
  stripped,
}: {
  games: Game[];
  stripped: boolean;
}) => {
  const id = useChartId();
  const { points, marginBuckets, summary } = useMemo(
    () => buildTeamTrendSeries(games),
    [games],
  );

  if (summary.gamesPlayed < 2) {
    return (
      <EmptyState
        glyph="📊"
        title="Not enough finalized games yet"
        body="Season trends need at least two finalized games. Enter final scores on the Schedule and the trend lines fill in from there."
      />
    );
  }

  const perGame = (total: number) => (total / summary.gamesPlayed).toFixed(1);
  const tiles = (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <StatTile
        label="Record"
        value={`${summary.wins}-${summary.losses}-${summary.ties}`}
      />
      <StatTile label="Run Diff" value={signed(summary.runDiff)} />
      <StatTile
        label="Streak"
        value={
          summary.streakType
            ? `${summary.streakType}${summary.streakCount}`
            : "—"
        }
      />
      <StatTile label="Runs For / Gm" value={perGame(summary.runsFor)} />
      <StatTile
        label="Runs Against / Gm"
        value={perGame(summary.runsAgainst)}
      />
    </div>
  );

  if (stripped) {
    // Stripped stat display: tiles + a compact game log, no charts.
    return (
      <div className="space-y-4">
        {tiles}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
            <thead className="bg-surface-2 text-ink-2">
              <tr>
                <th className="p-2.5 t-eyebrow text-left">Date</th>
                <th className="p-2.5 t-eyebrow text-left">Opponent</th>
                <th className="p-2.5 t-eyebrow text-center">Score</th>
                <th className="p-2.5 t-eyebrow text-center">Result</th>
                <th className="p-2.5 t-eyebrow text-center">Run Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {points
                .slice()
                .reverse()
                .map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2">
                    <td className="p-2.5 tabular-nums font-bold text-ink-2">
                      {tickDate(p.date)}
                    </td>
                    <td className="p-2.5 t-body-bold text-ink uppercase tracking-tight truncate max-w-[12rem]">
                      {p.opponent}
                    </td>
                    <td className="p-2.5 text-center tabular-nums font-black text-ink">
                      {p.runsFor}–{p.runsAgainst}
                    </td>
                    <td className="p-2.5 text-center">
                      <Chip variant={RESULT_VARIANT[p.result]}>{p.result}</Chip>
                    </td>
                    <td
                      className={`p-2.5 text-center tabular-nums font-black ${
                        p.cumRunDiff > 0
                          ? "text-win"
                          : p.cumRunDiff < 0
                            ? "text-loss"
                            : "text-ink-3"
                      }`}
                    >
                      {signed(p.cumRunDiff)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const interval = sparseInterval(points.length);
  const cursor = { stroke: "var(--line-strong)", strokeDasharray: "3 3" };

  return (
    <div className="space-y-4">
      {tiles}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Cumulative Run Differential"
          explainer="Running total of runs scored minus runs allowed, game by game."
        >
          <ChartFrame label="Cumulative run differential" height={200}>
            <AreaChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <defs>
                <FadeGradient
                  id={`${id}-diff`}
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
                interval={interval}
                tickFormatter={tickDate}
                tick={AXIS_TICK}
              />
              <YAxis
                width={34}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                content={<ChartTooltip labelFormatter={tickDate} />}
                cursor={cursor}
              />
              <ReferenceLine
                y={0}
                stroke="var(--ink-3)"
                strokeDasharray="4 4"
              />
              <Area
                dataKey="cumRunDiff"
                name="Run diff"
                type="monotone"
                stroke="var(--team-primary)"
                strokeWidth={2.5}
                fill={`url(#${id}-diff)`}
                dot={false}
                animationDuration={600}
              />
            </AreaChart>
          </ChartFrame>
        </ChartCard>

        <ChartCard
          title="Runs Scored vs Allowed"
          explainer="Per-game offense (green) against runs given up (red)."
        >
          <ChartFrame label="Runs scored vs runs allowed per game" height={200}>
            <BarChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              barGap={2}
            >
              <defs>
                <FadeGradient
                  id={`${id}-for`}
                  color="var(--win)"
                  from={0.9}
                  to={0.35}
                />
                <FadeGradient
                  id={`${id}-against`}
                  color="var(--loss)"
                  from={0.9}
                  to={0.35}
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
                interval={interval}
                tickFormatter={tickDate}
                tick={AXIS_TICK}
              />
              <YAxis
                width={28}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                content={<ChartTooltip labelFormatter={tickDate} />}
                cursor={{ fill: "var(--team-primary-15)" }}
              />
              <Bar
                dataKey="runsFor"
                name="Runs scored"
                fill={`url(#${id}-for)`}
                radius={[3, 3, 0, 0]}
                maxBarSize={14}
              />
              <Bar
                dataKey="runsAgainst"
                name="Runs allowed"
                fill={`url(#${id}-against)`}
                radius={[3, 3, 0, 0]}
                maxBarSize={14}
              />
            </BarChart>
          </ChartFrame>
        </ChartCard>

        <ChartCard
          title="Rolling Win %"
          explainer="Win rate over the last 5 games; starts at game 3, ties count half."
        >
          <ChartFrame label="Rolling win percentage" height={200}>
            <LineChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--line)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                interval={interval}
                tickFormatter={tickDate}
                tick={AXIS_TICK}
              />
              <YAxis
                width={38}
                domain={[0, 1]}
                ticks={[0, 0.25, 0.5, 0.75, 1]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(v) => `${Math.round(Number(v) * 100)}%`}
                    labelFormatter={tickDate}
                  />
                }
                cursor={cursor}
              />
              <Line
                dataKey="rollingWinPct"
                name="Win %"
                type="monotone"
                stroke="var(--team-primary)"
                strokeWidth={2.5}
                connectNulls={false}
                dot={{ r: 2.5, fill: "var(--team-primary)", strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                animationDuration={600}
              />
            </LineChart>
          </ChartFrame>
        </ChartCard>

        <ChartCard
          title="Margin Distribution"
          explainer="How many games landed in each final-margin range — blowouts vs one-run games."
        >
          <ChartFrame label="Margin of victory distribution" height={200}>
            <BarChart
              data={marginBuckets}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--line)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval={0}
                tick={{ ...AXIS_TICK, fontSize: 9 }}
              />
              <YAxis
                width={28}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: "var(--team-primary-15)" }}
              />
              <Bar
                dataKey="count"
                name="Games"
                radius={[3, 3, 0, 0]}
                maxBarSize={26}
              >
                {marginBuckets.map((b) => (
                  <Cell key={b.label} fill={MARGIN_COLOR[b.kind]} />
                ))}
              </Bar>
            </BarChart>
          </ChartFrame>
        </ChartCard>
      </div>
    </div>
  );
};
