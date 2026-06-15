// Chart-bearing pieces of the stat-trend cluster, split from ./statTrend so
// the recharts dependency stays out of the eagerly-loaded modals graph —
// modals.tsx pulls these in with React.lazy.
import React, { memo } from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Icons } from "../../icons";
import {
  ChartFrame,
  ChartTooltip,
  FadeGradient,
  useChartId,
} from "../charts/primitives";
import { Sparkline } from "../charts/Sparkline";
import { seasonSeriesFromGameLines } from "../../utils/helpers";
import { A11yDialog } from "../shared";
import { STAT_META, formatStatValue } from "./statTrend";

// X-axis tick: abbreviated season on the first line, age group beneath, with
// the current season tinted in the team color.
const SeasonTick = ({
  x,
  y,
  index,
  payload,
  series,
  primaryColor,
}: any) => {
  const s = index != null ? series[index] : undefined;
  const label = String(payload?.value ?? "").replace(
    /^(\w+)\s+(\d{4})$/,
    (_: any, sn: string, yr: string) => `${sn.slice(0, 3)} '${yr.slice(2)}`
  );
  return (
    <g>
      <text
        x={x}
        y={(y ?? 0) + 14}
        textAnchor="middle"
        fontSize="10"
        fontWeight={s?.isCurrent ? 900 : 700}
        fill={s?.isCurrent ? primaryColor : "var(--ink-3)"}
      >
        {label}
      </text>
      {s?.ageGroup && (
        <text
          x={x}
          y={(y ?? 0) + 28}
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="var(--ink-3)"
        >
          {s.ageGroup}
        </text>
      )}
    </g>
  );
};

export const StatTrendModal = memo(
  ({
    statKey,
    player,
    currentSeason,
    currentPitchingFormat,
    primaryColor,
    tertiaryColor,
    teamAverages,
    onClose,
  }: any) => {
    const chartId = useChartId();
    if (!statKey) return null;
    const meta = STAT_META[statKey];
    if (!meta) return null;

    // Team-average baseline only makes sense for rate stats (a mean of
    // counting totals like HR/RBI would be meaningless). Drawn as a dashed
    // "Team avg" reference so a dipping line reads against the roster.
    const rawBaseline =
      meta.kind === "decimal" || meta.kind === "percent"
        ? Number(teamAverages?.[statKey])
        : NaN;
    const baseline = Number.isFinite(rawBaseline) ? rawBaseline : null;

    // Build a chronological data series. Each entry: { season, ageGroup, value, isCurrent }.
    // Sort: by year ascending, then Spring before Fall within a year.
    const seasonSortKey = (label: any) => {
      if (!label) return 99999;
      const m = String(label).match(/(spring|fall)\s+(\d{4})/i);
      if (!m) return 99999;
      const year = parseInt(m[2], 10);
      const seasonOffset = m[1].toLowerCase() === "spring" ? 0 : 1;
      return year * 10 + seasonOffset;
    };

    const series: Array<{
      season: string;
      ageGroup: string | null;
      value: number;
      sortKey: number;
      isCurrent: boolean;
    }> = [];

    // Past seasons
    for (const ps of player.pastSeasons || []) {
      // Skip pitching stats for non-Kid Pitch seasons
      if (meta.category === "pitching" && ps.pitchingFormat !== "Kid Pitch")
        continue;
      const v = ps.stats?.[statKey];
      if (v === null || v === undefined) continue;
      const num = Number(v);
      if (Number.isNaN(num)) continue;
      series.push({
        season: ps.season,
        ageGroup: ps.ageGroup,
        value: num,
        sortKey: seasonSortKey(ps.season),
        isCurrent: false,
      });
    }

    // Current season
    if (
      !(meta.category === "pitching" && currentPitchingFormat !== "Kid Pitch")
    ) {
      const v = player.stats?.[statKey];
      if (v !== null && v !== undefined && !Number.isNaN(Number(v))) {
        series.push({
          season: currentSeason,
          ageGroup: null,
          value: Number(v),
          sortKey: seasonSortKey(currentSeason),
          isCurrent: true,
        });
      }
    }

    series.sort((a, b) => a.sortKey - b.sortKey);

    // Y range: pad by 10%; for percent stats clamp to [0, 100] sensibly.
    // Include the baseline so the dashed team-avg line is never clipped.
    const values = series.map((s) => s.value);
    const domainValues = baseline != null ? [...values, baseline] : values;
    let yMin = domainValues.length ? Math.min(...domainValues) : 0;
    let yMax = domainValues.length ? Math.max(...domainValues) : 1;
    if (yMin === yMax) {
      // Single point or all-equal: pad symmetrically
      if (yMin === 0) {
        yMin = 0;
        yMax = 1;
      } else {
        yMin = yMin * 0.9;
        yMax = yMax * 1.1;
      }
    } else {
      const range = yMax - yMin;
      yMin = yMin - range * 0.1;
      yMax = yMax + range * 0.1;
    }
    // Don't go negative for stats that can't be negative
    if (meta.kind === "int" || meta.kind === "percent" || meta.kind === "ip") {
      if (yMin < 0) yMin = 0;
    }

    // Compute trend (first vs last)
    let trend = null;
    if (series.length >= 2) {
      const first = series[0].value;
      const last = series[series.length - 1].value;
      if (first !== last) {
        const direction = last > first ? "up" : "down";
        const isImproving = (direction === "up") === meta.higherIsBetter;
        const change = last - first;
        trend = { direction, isImproving, change };
      }
    }

    return (
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <A11yDialog
          label="Stat trend"
          onClose={onClose}
          className="bg-surface rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        >
          <div
            className="p-1.5"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          <div className="p-5 sm:p-6 border-b border-line flex items-start justify-between gap-4">
            <div>
              <div className="t-eyebrow mb-1">{player.name}</div>
              <h3 className="t-card-title">{meta.label}</h3>
              {trend && (
                <div
                  className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border tabular-nums ${
                    trend.isImproving
                      ? "bg-green-50 text-green-800 border-green-200"
                      : "bg-red-50 text-red-800 border-red-200"
                  }`}
                >
                  {trend.direction === "up" ? "↑" : "↓"}
                  {meta.kind === "decimal" || meta.kind === "ip"
                    ? Math.abs(trend.change).toFixed(3)
                    : meta.kind === "percent"
                    ? `${Math.abs(
                        trend.change <= 1 ? trend.change * 100 : trend.change
                      ).toFixed(1)}%`
                    : Math.abs(Math.round(trend.change))}
                  {trend.isImproving ? "Improving" : "Declining"}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 sm:p-7 overflow-y-auto custom-scrollbar flex-1">
            {series.length === 0 ? (
              <div className="bg-app border border-line rounded-xl p-12 text-center">
                <Icons.Bat className="w-10 h-10 text-ink-3 mx-auto mb-3" />
                <p className="text-sm font-black uppercase tracking-widest text-ink-3 mb-1">
                  No Data Available
                </p>
                <p className="text-xs text-ink-3 font-medium">
                  {meta.category === "pitching"
                    ? "No Kid Pitch seasons with this stat on file."
                    : "No seasons have data for this stat yet."}
                </p>
              </div>
            ) : series.length === 1 ? (
              <div className="bg-app border border-line rounded-xl p-8 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-2">
                  {series[0].season}
                  {series[0].ageGroup ? ` · ${series[0].ageGroup}` : ""}
                </div>
                <div className="text-5xl font-black tabular-nums text-ink mb-2">
                  {formatStatValue(statKey, series[0].value)}
                </div>
                <p className="text-xs text-ink-3 font-medium">
                  Add past seasons to see year-over-year trends.
                </p>
              </div>
            ) : (
              <>
                <div className="bg-app border border-line rounded-xl p-4 mb-4">
                  <ChartFrame label={`${meta.label} by season`} height={300}>
                    <ComposedChart
                      data={series}
                      margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <FadeGradient
                          id={chartId}
                          color={primaryColor}
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
                        dataKey="season"
                        interval={0}
                        height={42}
                        tickLine={false}
                        axisLine={{ stroke: "var(--line)" }}
                        tick={
                          <SeasonTick
                            series={series}
                            primaryColor={primaryColor}
                          />
                        }
                      />
                      <YAxis
                        domain={[yMin, yMax]}
                        width={56}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) =>
                          formatStatValue(statKey, v)
                        }
                        tick={{
                          fontSize: 11,
                          fontWeight: 700,
                          fill: "var(--ink-3)",
                          fontFamily: "ui-monospace, monospace",
                        }}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            formatter={(v) => formatStatValue(statKey, v)}
                            labelFormatter={(label) => {
                              const s = series.find(
                                (r) => r.season === label
                              );
                              return s?.ageGroup
                                ? `${label} · ${s.ageGroup}`
                                : String(label);
                            }}
                          />
                        }
                        cursor={{
                          stroke: "var(--line-strong)",
                          strokeDasharray: "3 3",
                        }}
                      />
                      {baseline != null && (
                        <ReferenceLine
                          y={baseline}
                          stroke="var(--ink-3)"
                          strokeDasharray="4 4"
                          strokeWidth={1.5}
                          ifOverflow="extendDomain"
                          label={{
                            value: `Team avg ${formatStatValue(
                              statKey,
                              baseline
                            )}`,
                            position: "insideTopRight",
                            fontSize: 10,
                            fontWeight: 700,
                            fill: "var(--ink-3)",
                          }}
                        />
                      )}
                      <Area
                        dataKey="value"
                        name={meta.label}
                        type="monotone"
                        stroke={primaryColor}
                        strokeWidth={3}
                        fill={`url(#${chartId})`}
                        animationDuration={600}
                        style={{
                          filter:
                            "drop-shadow(0 2px 6px var(--team-primary-15))",
                        }}
                        dot={(props: any) => (
                          <circle
                            key={props.index}
                            cx={props.cx}
                            cy={props.cy}
                            r={props.payload?.isCurrent ? 7 : 5}
                            fill={
                              props.payload?.isCurrent
                                ? primaryColor
                                : "var(--surface)"
                            }
                            stroke={primaryColor}
                            strokeWidth={2.5}
                          />
                        )}
                        activeDot={{
                          r: 8,
                          stroke: primaryColor,
                          strokeWidth: 2.5,
                          fill: "var(--surface)",
                        }}
                      />
                    </ComposedChart>
                  </ChartFrame>
                </div>

                {/* Season-by-season breakdown table */}
                <div className="bg-surface border border-line rounded-xl overflow-hidden">
                  <div className="grid grid-cols-3 px-4 py-2 bg-app border-b border-line">
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
                      Season
                    </div>
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
                      Age
                    </div>
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 text-right">
                      {meta.label}
                    </div>
                  </div>
                  {series.map((s, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-3 px-4 py-2 ${
                        i < series.length - 1 ? "border-b border-line" : ""
                      } ${s.isCurrent ? "bg-blue-50/30" : ""}`}
                    >
                      <div className="text-xs font-black text-ink uppercase">
                        {s.season}
                        {s.isCurrent ? " ·" : ""}
                      </div>
                      <div className="text-xs font-bold text-ink-2">
                        {s.ageGroup || "—"}
                      </div>
                      <div className="text-xs font-black tabular-nums text-ink text-right">
                        {formatStatValue(statKey, s.value)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </A11yDialog>
      </div>
    );
  }
);

/* EvalTrendModal — see ./screens/EvaluationTab */

// Compact per-stat trend grid for the PlayerProfileModal. One panel per
// tracked stat (AVG / OPS / OBP / H / RBI / HR) showing current value,
// net delta over the last ~5 import snapshots, and a tiny sparkline.
// Replaces the prior per-import row list, which surfaced every CSV upload
// and got noisy fast.
const RECENT_MOVEMENT_WINDOW = 5;
const RECENT_MOVEMENT_TRACKED = [
  { key: "avg", label: "AVG", decimals: 3 },
  { key: "ops", label: "OPS", decimals: 3 },
  { key: "obp", label: "OBP", decimals: 3 },
  { key: "h", label: "H", decimals: 0 },
  { key: "rbi", label: "RBI", decimals: 0 },
  { key: "hr", label: "HR", decimals: 0 },
];

const fmtTrendVal = (v: any, decimals: any) =>
  decimals > 0
    ? Number(v || 0).toFixed(decimals).replace(/^0\./, ".")
    : String(Math.round(Number(v) || 0));

const fmtTrendDelta = (delta: any, decimals: any) => {
  if (delta === 0) return "0";
  const sign = delta > 0 ? "+" : "";
  return decimals > 0
    ? `${sign}${delta.toFixed(decimals).replace(/^([-+]?)0\./, "$1.")}`
    : `${sign}${Math.round(delta)}`;
};

export const RecentMovementPanel = memo(({ player, games, teamAverages }: any) => {
  const history = Array.isArray(player.statsHistory) ? player.statsHistory : [];
  // Series = past snapshots + live stats. Coaches who import stats per game
  // have no snapshots, so fall back to the cumulative season line after each
  // imported game — same trajectory, derived from the game lines themselves.
  let series: Array<Record<string, any>>;
  let unitLabel = "updates";
  if (history.length > 0) {
    series = [...history.map((h: any) => h.stats || {}), player.stats || {}];
  } else {
    series = seasonSeriesFromGameLines(games, player.id);
    unitLabel = "games";
  }
  if (series.length < 2) {
    return (
      <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
        <h4 className="font-black text-[11px] uppercase tracking-widest text-ink flex items-center gap-2 mb-3">
          <Icons.Forward className="w-4 h-4" /> Recent Movement
        </h4>
        <p className="text-[11px] text-ink-3 font-medium italic">
          No trend data yet — import stats (season CSV or per game) to start
          tracking.
        </p>
      </div>
    );
  }
  // Sparkline uses the last WINDOW+1 values so it shows the full trajectory
  // the delta covers.
  const windowed = series.slice(-Math.min(RECENT_MOVEMENT_WINDOW + 1, series.length));

  return (
    <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
      <h4 className="font-black text-[11px] uppercase tracking-widest text-ink flex items-center gap-2 mb-3">
        <Icons.Forward className="w-4 h-4" /> Recent Movement
        <span className="ml-auto text-[9px] font-bold text-ink-3 normal-case tracking-normal">
          Last {Math.min(RECENT_MOVEMENT_WINDOW, series.length - 1)} {unitLabel}
        </span>
      </h4>
      <div className="grid grid-cols-2 gap-2.5">
        {RECENT_MOVEMENT_TRACKED.map(({ key, label, decimals }) => {
          const values = windowed.map((s) => Number(s?.[key]) || 0);
          // Dashed team-avg baseline on rate stats only (decimals > 0).
          const avg = Number(teamAverages?.[key]);
          const baseline =
            decimals > 0 && Number.isFinite(avg) ? avg : undefined;
          const current = values[values.length - 1];
          const prior = values[0];
          const delta = current - prior;
          const deltaTone =
            delta > 0
              ? "text-win bg-win-bg border-line"
              : delta < 0
              ? "text-loss bg-loss-bg border-line"
              : "text-ink-3 bg-app border-line";
          return (
            <div
              key={key}
              className="rounded-lg border border-line bg-app/40 px-3 py-2.5 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-extrabold uppercase tracking-widest text-ink-3">
                  {label}
                </div>
                <div className="text-base font-black tabular-nums text-ink leading-tight">
                  {fmtTrendVal(current, decimals)}
                </div>
              </div>
              <Sparkline
                values={values}
                width={40}
                strokeWidth={1.5}
                baseline={baseline}
              />
              <span
                className={`text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded border ${deltaTone}`}
                title={`Net change over the last ${values.length - 1} ${unitLabel}`}
              >
                {delta > 0 ? "↑" : delta < 0 ? "↓" : "—"}
                {fmtTrendDelta(delta, decimals)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

