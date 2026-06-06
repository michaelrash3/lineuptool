import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import {
  getActivePositionList,
  getCombinedGrades,
  calcPitcherScore,
  calcCatcherScore,
  calcDefensiveScore,
} from "../lineupEngine";
import { isKidPitchFormat } from "../constants/ui";

// Full position names for the card headers.
const POSITION_LABELS: Record<string, string> = {
  P: "Pitcher",
  C: "Catcher",
  "1B": "First Base",
  "2B": "Second Base",
  "3B": "Third Base",
  SS: "Shortstop",
  LF: "Left Field",
  CF: "Center Field",
  RF: "Right Field",
  LCF: "Left-Center",
  RCF: "Right-Center",
};

// A player only appears in a position's depth chart if that position is in
// their Comfortable Positions. Catcher is opt-in (strictly "C" in the list);
// pitcher is "P" in the list — same model the Roster filters use.
const comfortableAt = (player: any, pos: string): boolean =>
  Array.isArray(player.comfortablePositions) &&
  player.comfortablePositions.includes(pos);

// Pick the position-appropriate scorer. Kid-Pitch teams rank P/C by the
// pitching/catching evals; everyone else (and non-Kid-Pitch P/C, which are
// ceremonial) ranks by general field defense. Pitchers blend imported stats
// (S%, WHIP, K/BB, …) with the eval grades, so the chart matches who's actually
// pitching well, not just the eye test.
const scoreForPlayer = (
  pos: string,
  player: any,
  grades: Record<string, any>,
  kidPitch: boolean,
  teamAge?: string
): number => {
  if (pos === "P")
    return kidPitch
      ? calcPitcherScore(grades, player?.stats, {
          topMph: player?.stats?.pTopMph ?? player?.pitching?.topMph,
          teamAge,
        })
      : calcDefensiveScore(grades, player?.stats);
  if (pos === "C")
    return kidPitch
      ? calcCatcherScore(grades, player?.stats)
      : calcDefensiveScore(grades, player?.stats);
  return calcDefensiveScore(grades, player?.stats);
};

// Auto-ranking with the saved manual order applied on top: pinned players (in
// the coach's chosen order) first, then any remaining comfortable players in
// auto-ranked order. Tolerates roster changes — ids no longer comfortable or
// off the roster simply drop out.
const orderForPosition = (
  pos: string,
  players: any[],
  grades: Record<string, any>,
  kidPitch: boolean,
  manual: string[] | null,
  teamAge?: string
): any[] => {
  const eligible = players.filter((p) => comfortableAt(p, pos));
  const auto = [...eligible].sort((a, b) => {
    const d =
      scoreForPlayer(pos, b, grades[b.id] || {}, kidPitch, teamAge) -
      scoreForPlayer(pos, a, grades[a.id] || {}, kidPitch, teamAge);
    return d !== 0 ? d : String(a.name || "").localeCompare(String(b.name || ""));
  });
  if (!manual || manual.length === 0) return auto;
  const byId = new Map(eligible.map((p) => [p.id, p]));
  const pinned = manual.map((id) => byId.get(id)).filter(Boolean) as any[];
  const pinnedIds = new Set(pinned.map((p) => p.id));
  return [...pinned, ...auto.filter((p) => !pinnedIds.has(p.id))];
};

// Per-position ranked card. Head coaches can nudge players up/down; the order
// persists to team.depthChart. Assistants see it read-only.
const PositionCard = memo(
  ({ pos, ranked, customized, canEdit, onMove, onReset, onOpen }: any) => {
    const ids: string[] = ranked.map((p: any) => p.id);
    return (
      <div className="glass-card">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-4 border-b border-line bg-surface flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded-lg text-xs font-black tracking-widest"
              style={{
                backgroundColor: "var(--team-primary-15)",
                color: "var(--team-primary)",
              }}
            >
              {pos}
            </span>
            <h2 className="t-h2">{POSITION_LABELS[pos] || pos}</h2>
          </div>
          {customized && canEdit && (
            <button
              type="button"
              onClick={() => onReset(pos)}
              className="t-eyebrow text-ink-3 hover:text-ink flex items-center gap-1"
              title="Reset to the auto ranking"
            >
              <Icons.Refresh className="w-3.5 h-3.5" /> Reset
            </button>
          )}
        </div>

        {ranked.length === 0 ? (
          <div className="p-4 text-xs text-ink-3 font-medium">
            No players are set comfortable here yet.
          </div>
        ) : (
          <ol className="divide-y divide-line">
            {ranked.map((p: any, idx: number) => (
              <li
                key={p.id}
                className="px-3 py-2 flex items-center gap-3 hover:bg-surface transition-colors"
              >
                <span className="w-5 text-center font-black tabular-nums text-ink-3 text-xs">
                  {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onOpen?.(p.id)}
                  className="flex-1 min-w-0 text-left font-extrabold text-ink hover:text-team-primary truncate"
                >
                  {p.name}
                  {p.number != null && p.number !== "" && (
                    <span className="ml-1.5 text-ink-3 font-bold text-[10px] tabular-nums">
                      #{p.number}
                    </span>
                  )}
                </button>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onMove(pos, ids, idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Move ${p.name} up`}
                      className="p-1 rounded-md border border-line text-ink-2 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Icons.ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(pos, ids, idx, 1)}
                      disabled={idx === ranked.length - 1}
                      aria-label={`Move ${p.name} down`}
                      className="p-1 rounded-md border border-line text-ink-2 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Icons.ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }
);

export const DepthChartTab = memo(() => {
  const { team, currentRole, updateTeam } = useTeam();
  const { openPlayerProfile } = useUI();
  // Memoized off `team` so the `|| fallback` defaults stay referentially stable
  // as deps for the useMemo blocks below.
  const players: any[] = useMemo(() => (team as any).players || [], [team]);
  const evaluationEvents: any[] = useMemo(
    () => (team as any).evaluationEvents || [],
    [team]
  );
  const depthChart: Record<string, string[]> = useMemo(
    () => (team as any).depthChart || {},
    [team]
  );
  const { defenseSize, pitchingFormat, teamAge } = team as any;
  const canEdit = currentRole === "head";
  const kidPitch = isKidPitchFormat(pitchingFormat);

  const combinedGrades = useMemo(
    () => getCombinedGrades(evaluationEvents, players),
    [evaluationEvents, players]
  );

  const board = useMemo(
    () =>
      getActivePositionList(defenseSize).map((pos) => {
        const manual = Array.isArray(depthChart[pos]) ? depthChart[pos] : null;
        return {
          pos,
          ranked: orderForPosition(pos, players, combinedGrades, kidPitch, manual, teamAge),
          customized: !!manual,
        };
      }),
    [defenseSize, players, combinedGrades, kidPitch, depthChart, teamAge]
  );

  // Swap a player with its neighbor and persist the full new order. We write the
  // complete current order (not just the moved pair) so the auto-ranked tail is
  // pinned once a coach starts adjusting a position.
  const move = (pos: string, ids: string[], idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[idx], next[j]] = [next[j], next[idx]];
    updateTeam({ depthChart: { ...depthChart, [pos]: next } });
  };

  const reset = (pos: string) => {
    const { [pos]: _drop, ...rest } = depthChart;
    updateTeam({ depthChart: rest });
  };

  return (
    <div className="space-y-6">
      <div className="glass-card">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 border-b border-line bg-surface flex items-center gap-3">
          <div
            className="p-2 rounded-full"
            style={{ backgroundColor: "var(--team-primary-15)" }}
          >
            <Icons.Glove
              className="w-5 h-5"
              style={{ color: "var(--team-primary)" }}
            />
          </div>
          <div>
            <h1 className="t-h1">Depth Chart</h1>
            <p className="t-eyebrow text-ink-3 mt-0.5">
              {kidPitch
                ? "Auto-ranked from evals — pitchers by strikes, catchers by glove & arm, fielders by defense."
                : "Auto-ranked from evals by field defense."}
              {canEdit ? " Nudge anyone up or down to adjust." : ""}
            </p>
          </div>
        </div>
      </div>

      {players.length === 0 ? (
        <div className="glass-card p-8 text-center text-ink-3 font-medium">
          Add players to your roster to build a depth chart.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {board.map(({ pos, ranked, customized }) => (
            <PositionCard
              key={pos}
              pos={pos}
              ranked={ranked}
              customized={customized}
              canEdit={canEdit}
              onMove={move}
              onReset={reset}
              onOpen={openPlayerProfile}
            />
          ))}
        </div>
      )}
    </div>
  );
});
