import { memo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Icons } from "../../icons";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { useTeam } from "../../contexts";
import { ChartFrame, ChartTooltip } from "../../components/charts/primitives";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { EVAL_CATEGORIES } from "../../constants/ui";
import { evalRoundRecency } from "../../utils/helpers";
import type { EvalRound } from "../../utils/evalScoring";
import type { Player } from "../../types";

// Per-player evaluation trend: one line per category across the head coach's
// rounds. Lives at /evaluation/trend/:playerId (see EvalTrendPage below) —
// converted from an A11yDialog overlay per the app-wide modals→pages rule.
// This is the only eval surface that pulls in recharts.
export const EvalTrendView = memo(
  ({
    player,
    evaluationEvents,
    userUid,
    onBack,
  }: {
    player?: Player;
    evaluationEvents?: EvalRound[];
    userUid?: string;
    onBack: () => void;
  }) => {
    if (!player) return null;

    // Collect this user's head-coach evals, oldest first
    const myEvals = (evaluationEvents || [])
      .filter(
        (e: EvalRound) =>
          e.coachRole === "Head" && (!userUid || e.evaluatorId === userUid),
      )
      .sort((a: EvalRound, b: EvalRound) => evalRoundRecency(b, a));

    // Each category gets its own line. Build series of {label, date, value}
    // entries per category, only including evals where the player has a grade.
    const categorySeries = EVAL_CATEGORIES.map((cat) => {
      const points: Array<{ label: string; date: string; value: number }> = [];
      for (const ev of myEvals) {
        const grade = ev.grades?.[player.id]?.[cat.id];
        if (typeof grade === "number" && Number.isFinite(grade)) {
          points.push({
            label: ev.label || `Eval (${ev.date})`,
            date: ev.date,
            value: grade,
          });
        }
      }
      return { ...cat, points };
    });

    // X-axis evals (use the union of all dates that have any data)
    const xLabels: Array<{ id: string; label: string; date: string }> = [];
    const seenIds = new Set<string>();
    for (const ev of myEvals) {
      // Only include this eval if at least one category has a value
      const hasAny = EVAL_CATEGORIES.some((cat) =>
        Number.isFinite(ev.grades?.[player.id]?.[cat.id]),
      );
      if (hasAny && !seenIds.has(ev.id)) {
        seenIds.add(ev.id);
        xLabels.push({
          id: ev.id,
          label: ev.label || `(${ev.date})`,
          date: ev.date,
        });
      }
    }
    const evalCount = xLabels.length;

    // Pivot into one row per eval round, keyed by category id, so each
    // category renders as its own <Line dataKey>. Points match by eval date
    // (same matching the old hand-rolled chart used).
    const chartRows = xLabels.map((x) => {
      const row: Record<string, string | number> = {
        id: x.id,
        label: x.label,
      };
      for (const cs of categorySeries) {
        const p = cs.points.find((pt) => pt.date === x.date);
        if (p) row[cs.id] = p.value;
      }
      return row;
    });
    const shortLabel = (label: string) =>
      label.length > 18 ? `${label.slice(0, 16)}…` : label;
    const labelById = new Map(xLabels.map((x) => [x.id, x.label]));

    // Color palette for the 6 categories — distinct, accessible
    const palette = [
      "#2563eb", // blue (Fielding)
      "#9333ea", // purple (Baseball IQ)
      "#dc2626", // red (Arm Strength)
      "#ea580c", // orange (Arm Accuracy)
      "#16a34a", // green (Speed & Agility)
      "#0891b2", // teal (Coachability)
    ];

    // Trend summary per category: first vs last
    const trends = categorySeries.map((cs, idx) => {
      if (cs.points.length < 2) return null;
      const first = cs.points[0].value;
      const last = cs.points[cs.points.length - 1].value;
      const change = last - first;
      return {
        label: cs.label,
        change,
        color: palette[idx % palette.length],
      };
    });

    return (
      <PageShell eyebrow={player.name} title="Evaluation Trend" onBack={onBack}>
        <p className="text-[11px] text-ink-3 font-medium -mt-3 mb-4">
          {evalCount === 0
            ? "No eval data yet."
            : evalCount === 1
              ? "1 eval recorded — add more to see trends."
              : `${evalCount} evals over time`}
        </p>

        <div>
          {evalCount === 0 ? (
            <div className="bg-app border border-line rounded-xl p-12 text-center">
              <Icons.Clipboard className="w-10 h-10 text-ink-3 mx-auto mb-3" />
              <p className="text-sm font-black uppercase tracking-widest text-ink-3 mb-1">
                No Evals Recorded
              </p>
              <p className="text-xs text-ink-3 font-medium">
                Save an eval round to start tracking this player&apos;s trends.
              </p>
            </div>
          ) : evalCount === 1 ? (
            <div className="bg-app border border-line rounded-xl p-8 text-center">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-2">
                {xLabels[0].label}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                {categorySeries.map((cs, idx) => (
                  <div key={cs.id} className="cc-card p-3">
                    <div
                      className="text-[10px] font-black uppercase tracking-widest mb-1"
                      style={{ color: palette[idx % palette.length] }}
                    >
                      {cs.label}
                    </div>
                    <div className="text-2xl font-black tabular-nums text-ink">
                      {cs.points[0]?.value ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-3 font-medium mt-4">
                Add more eval rounds to see trends.
              </p>
            </div>
          ) : (
            <>
              {/* Chart */}
              <div className="bg-app border border-line rounded-xl p-4 mb-4">
                <ChartFrame label="Evaluation trend by category" height={320}>
                  <LineChart
                    data={chartRows}
                    margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--line)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="id"
                      interval={0}
                      height={evalCount > 4 ? 56 : 30}
                      tickLine={false}
                      axisLine={{ stroke: "var(--line)" }}
                      tickFormatter={(id: string) =>
                        shortLabel(labelById.get(id) || "")
                      }
                      tick={{
                        fontSize: 10,
                        fontWeight: 700,
                        fill: "var(--ink-3)",
                        ...(evalCount > 4
                          ? { angle: -30, textAnchor: "end" }
                          : {}),
                      }}
                    />
                    <YAxis
                      domain={[1, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      width={32}
                      tickLine={false}
                      axisLine={false}
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
                          labelFormatter={(id) =>
                            labelById.get(String(id)) || String(id)
                          }
                        />
                      }
                      cursor={{
                        stroke: "var(--line-strong)",
                        strokeDasharray: "3 3",
                      }}
                    />
                    {categorySeries.map((cs, idx) => {
                      if (cs.points.length === 0) return null;
                      const color = palette[idx % palette.length];
                      return (
                        <Line
                          key={cs.id}
                          dataKey={cs.id}
                          name={cs.label}
                          type="monotone"
                          connectNulls
                          stroke={color}
                          strokeWidth={2.5}
                          dot={{
                            r: 3.5,
                            fill: color,
                            stroke: "var(--surface)",
                            strokeWidth: 1.5,
                          }}
                          activeDot={{ r: 5 }}
                          animationDuration={600}
                        />
                      );
                    })}
                  </LineChart>
                </ChartFrame>
              </div>

              {/* Legend with trend summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {categorySeries.map((cs, idx) => {
                  const trend = trends[idx];
                  const color = palette[idx % palette.length];
                  return (
                    <div
                      key={cs.id}
                      className="cc-card p-2.5 flex items-center gap-2"
                    >
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-widest text-ink truncate">
                          {cs.label}
                        </div>
                        {trend && (
                          <div
                            className={`text-[10px] font-black tabular-nums ${
                              trend.change > 0
                                ? "text-win"
                                : trend.change < 0
                                  ? "text-loss"
                                  : "text-ink-3"
                            }`}
                          >
                            {trend.change > 0
                              ? "↑"
                              : trend.change < 0
                                ? "↓"
                                : "—"}
                            {trend.change !== 0
                              ? ` ${Math.abs(trend.change)}`
                              : " flat"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </PageShell>
    );
  },
);

// /evaluation/trend/:playerId — the routed page. Head-coach surface (the
// chart plots the head's own rounds); assistants and unknown players land
// back on the evaluation tab.
export const EvalTrendPage = memo(() => {
  const { playerId } = useParams();
  const { team, user, currentRole } = useTeam();
  const back = useBackOrFallback("/evaluation");
  const player = (team.players || []).find((p: Player) => p.id === playerId);
  if (currentRole === "assistant" || !player) {
    return <Navigate to="/evaluation" replace />;
  }
  return (
    <EvalTrendView
      player={player}
      evaluationEvents={team.evaluationEvents || []}
      userUid={user?.uid}
      onBack={back}
    />
  );
});
