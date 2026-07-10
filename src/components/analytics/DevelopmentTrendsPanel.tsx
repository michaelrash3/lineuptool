// Player development trends table: per-player batting form, eval movement,
// and position variety classified by the documented heuristics in
// utils/playerDevelopment (the single source of truth for the thresholds
// described in the footnote below).
import React, { useMemo } from "react";
import {
  computeDevelopmentTrends,
  type PlayerDevelopmentTrend,
  type TrendClass,
} from "../../utils/playerDevelopment";
import { useTeam } from "../../contexts";
import { Icons } from "../../icons";
import { Chip, EmptyState } from "../shared";
import { Sparkline } from "../charts/Sparkline";
import type { EvaluationEvent, Game, Player } from "../../types";

const Dash = () => <span className="text-ink-3 font-bold">—</span>;

const TrendArrow = ({ cls }: { cls: TrendClass }) =>
  cls === "improving" ? (
    <Icons.TrendingUp className="w-3.5 h-3.5 text-win shrink-0" />
  ) : cls === "declining" ? (
    <Icons.TrendingDown className="w-3.5 h-3.5 text-loss shrink-0" />
  ) : (
    <span className="text-ink-3 font-black shrink-0" aria-hidden>
      −
    </span>
  );

const toneClass = (cls: TrendClass): string =>
  cls === "improving"
    ? "text-win"
    : cls === "declining"
      ? "text-loss"
      : "text-ink-2";

// avg deltas read like the Stats tab (±.020 style); qab deltas read as points
// of QAB percentage.
const fmtBattingDelta = (
  delta: number,
  basis: "avg" | "qab" | null,
): string => {
  const sign = delta >= 0 ? "+" : "";
  if (basis === "qab") return `${sign}${(delta * 100).toFixed(1)}%`;
  return `${sign}${delta.toFixed(3).replace(/^([-+]?)0\./, "$1.")}`;
};

const OVERALL_CHIP: Record<TrendClass, { variant: string; label: string }> = {
  improving: { variant: "success", label: "Improving" },
  steady: { variant: "slate", label: "Steady" },
  declining: { variant: "danger", label: "Declining" },
  insufficient: { variant: "slate", label: "Not enough data" },
};

export const DevelopmentTrendsPanel = ({
  players,
  games,
  evaluationEvents,
  stripped,
  onOpenPlayer,
}: {
  players: Player[];
  games: Game[];
  evaluationEvents: EvaluationEvent[];
  stripped: boolean;
  onOpenPlayer: (playerId: string) => void;
}) => {
  const { team } = useTeam();
  const teamAge = (team as { teamAge?: string } | null)?.teamAge;
  const rows = useMemo(
    () =>
      computeDevelopmentTrends({ players, games, evaluationEvents, teamAge }),
    [players, games, evaluationEvents, teamAge],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        glyph="📊"
        title="No development trends yet"
        body="Trends build from per-game stat imports and evaluation rounds. Import game stats or grade an eval round and each player's trajectory shows up here."
      />
    );
  }

  const movers = rows
    .filter((r) => r.evals.class === "improving")
    .sort((a, b) => (b.evals.delta ?? 0) - (a.evals.delta ?? 0))
    .slice(0, 3);

  const sparkline = (series: number[] | undefined) =>
    !stripped && (series?.length ?? 0) >= 2 ? (
      <Sparkline values={series!} width={48} height={14} strokeWidth={1.5} />
    ) : null;

  const battingCell = (r: PlayerDevelopmentTrend) => {
    if (r.batting.class === "insufficient") return <Dash />;
    return (
      <span className="inline-flex items-center gap-1.5">
        <TrendArrow cls={r.batting.class} />
        <span
          className={`tabular-nums font-black ${toneClass(r.batting.class)}`}
        >
          {fmtBattingDelta(r.batting.delta ?? 0, r.batting.basis)}
        </span>
        {sparkline(r.batting.series)}
      </span>
    );
  };

  const evalsCell = (r: PlayerDevelopmentTrend) => {
    if (r.evals.class === "insufficient") return <Dash />;
    return (
      <span className="inline-flex items-center gap-1.5">
        <TrendArrow cls={r.evals.class} />
        <span className={`tabular-nums font-black ${toneClass(r.evals.class)}`}>
          {r.evals.first}→{r.evals.last}
        </span>
        {sparkline(r.evals.series)}
      </span>
    );
  };

  const positionsCell = (r: PlayerDevelopmentTrend) => {
    if (r.positions.class === "insufficient") return <Dash />;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="tabular-nums font-bold text-ink-2">
          {r.positions.firstHalfDistinct} → {r.positions.secondHalfDistinct}
        </span>
        <TrendArrow cls={r.positions.class} />
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {movers.length > 0 && (
        <div
          className="rounded-xl border border-line p-4"
          style={{ backgroundColor: "var(--team-primary-15)" }}
        >
          <div className="t-eyebrow mb-2 flex items-center gap-1.5">
            <Icons.TrendingUp
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "var(--team-ink)" }}
            />
            Biggest movers
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {movers.map((m) => (
              <span
                key={m.playerId}
                className="inline-flex items-center gap-1.5"
              >
                <span className="t-body-bold text-ink">{m.name}</span>
                <Chip variant="success">
                  <Icons.TrendingUp className="w-3 h-3 shrink-0" />+
                  {Math.round(m.evals.delta ?? 0)} eval
                </Chip>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
          <thead className="bg-surface-2 text-ink-2">
            <tr>
              <th className="p-2.5 t-eyebrow text-left">Player</th>
              <th className="p-2.5 t-eyebrow text-left">Batting</th>
              <th className="p-2.5 t-eyebrow text-left">Evals</th>
              <th className="p-2.5 t-eyebrow text-left">Positions</th>
              <th className="p-2.5 t-eyebrow text-left">Overall</th>
              <th className="p-2.5 t-eyebrow text-center">Signals</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const overall = OVERALL_CHIP[r.overall];
              return (
                <tr
                  key={r.playerId}
                  onClick={() => onOpenPlayer(r.playerId)}
                  className="hover:bg-surface-2 cursor-pointer"
                >
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPlayer(r.playerId);
                      }}
                      className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate min-h-[44px] inline-flex items-center"
                    >
                      {r.name}
                    </button>
                  </td>
                  <td className="p-2">{battingCell(r)}</td>
                  <td className="p-2">{evalsCell(r)}</td>
                  <td className="p-2">{positionsCell(r)}</td>
                  <td className="p-2">
                    <Chip
                      variant={overall.variant}
                      className={
                        r.overall === "insufficient" ? "opacity-70" : ""
                      }
                    >
                      {overall.label}
                    </Chip>
                  </td>
                  <td className="p-2 text-center">
                    <span className="t-meta text-ink-3 tabular-nums">
                      {r.signalCount} of 3
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="t-meta text-ink-3">
        Batting compares the last 3 imported game lines against the full season
        (needs 4+ lines and 8+ at-bats; a move beyond ±.020 counts). Evals
        compare the first and last scored evaluation rounds, tryouts excluded
        (needs 2+ rounds; a 4+ point move on the 100 scale counts). Positions
        compare distinct positions played in the first half of imported games vs
        the second (needs 4+ lines). Overall tallies one vote per signal with
        data — any net positive reads improving, any net negative declining.
      </p>
    </div>
  );
};
