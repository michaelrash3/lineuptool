import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import {
  getActivePositionList,
  getCombinedGrades,
  calcPitcherScore,
  calcCatcherScore,
  calcDefensiveScore,
  fieldFitScore,
  suggestPrimaryPosition,
} from "../lineupEngine";
import { canonicalizeOutfield, isDepartedPlayer } from "../utils/helpers";
import { EmptyState } from "../components/shared";
import { isKidPitchFormat } from "../constants/ui";
import type { GradeMap, Player, Team } from "../types";

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
const comfortableAt = (player: Player, pos: string): boolean =>
  Array.isArray(player.comfortablePositions) &&
  player.comfortablePositions.includes(pos);

// Pick the position-appropriate scorer. Kid-Pitch teams rank P/C by the
// pitching/catching evals; everyone else (and non-Kid-Pitch P/C, which are
// ceremonial) ranks by general field defense. Pitchers blend imported stats
// (S%, WHIP, K/BB, …) with the eval grades, so the chart matches who's actually
// pitching well, not just the eye test.
const scoreForPlayer = (
  pos: string,
  player: Player,
  grades: GradeMap,
  kidPitch: boolean,
  teamAge?: string,
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
  return (
    fieldFitScore(pos, grades) * 100 ||
    calcDefensiveScore(grades, player?.stats)
  );
};

// Does a position match a player's (canonical) primary? CF collapses onto the
// LCF/RCF field cards so a kid whose primary is "CF" leads center in either
// alignment.
const samePos = (a?: string, b?: string): boolean =>
  !!a && !!b && canonicalizeOutfield(a) === canonicalizeOutfield(b);

// Primary-first grouping rank for a position (lower = listed earlier). Pitcher
// is exempt — it keeps its pure pitching-score order. Everywhere else the
// coach's explicit primary leads (tier 0); a kid with no explicit primary but
// an eval-suggested primary here follows (tier 1); everyone else fills in after
// (tier 2). Within each tier the existing position score breaks the order.
const primaryTier = (
  pos: string,
  player: Player,
  suggestedById: Map<string, string | null>,
): number => {
  if (pos === "P") return 0;
  if (samePos(player.primaryPosition, pos)) return 0;
  if (
    !player.primaryPosition &&
    samePos(suggestedById.get(player.id) || undefined, pos)
  )
    return 1;
  return 2;
};

// Auto-ranking with the saved manual order applied on top: pinned players (in
// the coach's chosen order) first, then any remaining comfortable players in
// auto-ranked order. Tolerates roster changes — ids no longer comfortable or
// off the roster simply drop out.
const orderForPosition = (
  pos: string,
  players: Player[],
  grades: Record<string, GradeMap>,
  kidPitch: boolean,
  manual: string[] | null,
  suggestedById: Map<string, string | null>,
  teamAge?: string,
): Player[] => {
  const eligible = players.filter((p) => comfortableAt(p, pos));
  const auto = [...eligible].sort((a, b) => {
    const ta = primaryTier(pos, a, suggestedById);
    const tb = primaryTier(pos, b, suggestedById);
    if (ta !== tb) return ta - tb;
    const d =
      scoreForPlayer(pos, b, grades[b.id] || {}, kidPitch, teamAge) -
      scoreForPlayer(pos, a, grades[a.id] || {}, kidPitch, teamAge);
    return d !== 0
      ? d
      : String(a.name || "").localeCompare(String(b.name || ""));
  });
  if (!manual || manual.length === 0) return auto;
  const byId = new Map(eligible.map((p) => [p.id, p]));
  const pinned = manual
    .map((id) => byId.get(id))
    .filter((p): p is Player => !!p);
  const pinnedIds = new Set(pinned.map((p) => p.id));
  return [...pinned, ...auto.filter((p) => !pinnedIds.has(p.id))];
};

// Per-position ranked card. Head coaches can nudge players up/down; the order
// persists to team.depthChart. Assistants see it read-only.
const PositionCard = memo(
  ({
    pos,
    ranked,
    customized,
    canEdit,
    onDropPlayer,
    onMove,
    onReset,
    onOpen,
  }: {
    pos: string;
    ranked: Player[];
    customized: boolean;
    canEdit: boolean;
    onDropPlayer: (
      pos: string,
      ids: string[],
      playerId: string,
      toIndex: number,
    ) => void;
    onMove: (pos: string, ids: string[], idx: number, dir: -1 | 1) => void;
    onReset: (pos: string) => void;
    onOpen?: (id: string) => void;
  }) => {
    const ids: string[] = ranked.map((p) => p.id);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const finishDrop = (toIndex: number) => {
      if (!draggingId) return;
      onDropPlayer(pos, ids, draggingId, toIndex);
      setDraggingId(null);
      setDropIndex(null);
    };

    return (
      <div className="cc-card overflow-hidden">
        <div
          className="h-1 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="px-3 py-2.5 border-b border-line flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded-sm text-[11px] font-black tracking-widest"
              style={{
                backgroundColor: "var(--team-tertiary)",
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
          <div className="px-3 py-4 text-xs text-ink-3 font-medium">
            No players are set comfortable here yet.
          </div>
        ) : (
          <ol
            className="divide-y divide-line"
            onDragOver={(event) => {
              if (!canEdit || !draggingId) return;
              event.preventDefault();
              setDropIndex(ranked.length);
            }}
            onDrop={(event) => {
              event.preventDefault();
              finishDrop(ranked.length);
            }}
          >
            {ranked.map((p, idx) => (
              <li
                key={p.id}
                draggable={canEdit}
                onDragStart={(event) => {
                  setDraggingId(p.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", p.id);
                }}
                onDragEnter={(event) => {
                  event.stopPropagation();
                  canEdit && draggingId && setDropIndex(idx);
                }}
                onDragOver={(event) => {
                  if (!canEdit || !draggingId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDropIndex(idx);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  finishDrop(idx);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropIndex(null);
                }}
                className={`px-2.5 py-1.5 flex items-center gap-2 transition-colors ${
                  canEdit ? "cursor-grab active:cursor-grabbing" : ""
                } ${draggingId === p.id ? "opacity-45" : "hover:bg-surface"} ${
                  dropIndex === idx && draggingId !== p.id
                    ? "bg-[var(--team-primary-15)] shadow-[inset_3px_0_0_var(--team-primary)]"
                    : ""
                }`}
              >
                <span className="w-5 text-center font-black tabular-nums text-ink-3 text-[11px]">
                  {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onOpen?.(p.id)}
                  className="flex-1 min-w-0 text-left text-sm font-extrabold text-ink hover:text-team-primary truncate"
                >
                  {p.name}
                  {p.number != null && p.number !== "" && (
                    <span className="ml-1.5 text-ink-3 font-bold text-[10px] tabular-nums">
                      #{p.number}
                    </span>
                  )}
                </button>
                {canEdit && (
                  <div
                    className="flex items-center gap-1 shrink-0"
                    aria-label="Reorder controls"
                  >
                    <button
                      type="button"
                      onClick={() => onMove(pos, ids, idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Move ${p.name} up`}
                      className="p-1 rounded-sm border border-line text-ink-2 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Icons.ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(pos, ids, idx, 1)}
                      disabled={idx === ranked.length - 1}
                      aria-label={`Move ${p.name} down`}
                      className="p-1 rounded-sm border border-line text-ink-2 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed"
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
  },
);

export const DepthChartTab = memo(() => {
  const { team: teamRaw, currentRole, updateTeam } = useTeam();
  const { openPlayerProfile } = useUI();
  // TeamContextValue.team is intentionally `any` (see types.ts); narrow it to
  // the known Team shape for this screen.
  const team = teamRaw as Team;
  // Memoized off `team` so the `|| fallback` defaults stay referentially stable
  // as deps for the useMemo blocks below.
  // Departed players are excluded everywhere but the Roster tab.
  const players: Player[] = useMemo(
    () => (team.players || []).filter((p: Player) => !isDepartedPlayer(p)),
    [team],
  );
  const evaluationEvents = useMemo(() => team.evaluationEvents || [], [team]);
  const depthChart: Record<string, string[]> = useMemo(
    () => team.depthChart || {},
    [team],
  );
  const { defenseSize, pitchingFormat, teamAge } = team;
  const canEdit = currentRole === "head";
  const kidPitch = isKidPitchFormat(pitchingFormat);

  const combinedGrades = useMemo(
    () =>
      getCombinedGrades(evaluationEvents, players, {
        teamAge,
        games: team.games || [],
      }),
    [evaluationEvents, players, teamAge, team],
  );

  // Eval-suggested primary per player — used only as the fallback ordering
  // basis for kids the coach hasn't given an explicit primaryPosition.
  const suggestedById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of players) {
      const s = suggestPrimaryPosition(p, combinedGrades[p.id], {
        kidPitch,
        teamAge,
      });
      m.set(p.id, s?.position || null);
    }
    return m;
  }, [players, combinedGrades, kidPitch, teamAge]);

  const board = useMemo(
    () =>
      getActivePositionList(defenseSize).map((pos) => {
        const manual = Array.isArray(depthChart[pos]) ? depthChart[pos] : null;
        return {
          pos,
          ranked: orderForPosition(
            pos,
            players,
            combinedGrades,
            kidPitch,
            manual,
            suggestedById,
            teamAge,
          ),
          customized: !!manual,
        };
      }),
    [
      defenseSize,
      players,
      combinedGrades,
      kidPitch,
      depthChart,
      suggestedById,
      teamAge,
    ],
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

  const dropPlayer = (
    pos: string,
    ids: string[],
    playerId: string,
    toIndex: number,
  ) => {
    const fromIndex = ids.indexOf(playerId);
    if (fromIndex < 0) return;
    const next = [...ids];
    const [moved] = next.splice(fromIndex, 1);
    const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    next.splice(Math.max(0, Math.min(adjustedIndex, next.length)), 0, moved);
    updateTeam({ depthChart: { ...depthChart, [pos]: next } });
  };

  const reset = (pos: string) => {
    const { [pos]: _drop, ...rest } = depthChart;
    updateTeam({ depthChart: rest });
  };

  return (
    <div className="space-y-4 max-w-screen-2xl mx-auto">
      <div className="cc-card px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
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
            <p className="t-body text-xs mt-0.5">
              Drag players into order, or use the arrow buttons for precise
              moves.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center md:min-w-[22rem]">
          <div className="border border-line bg-surface/60 px-3 py-2">
            <div className="t-stat-num-sm tabular-nums">{players.length}</div>
            <div className="t-meta">Players</div>
          </div>
          <div className="border border-line bg-surface/60 px-3 py-2">
            <div className="t-stat-num-sm tabular-nums">{board.length}</div>
            <div className="t-meta">Positions</div>
          </div>
          <div className="border border-line bg-surface/60 px-3 py-2">
            <div className="t-stat-num-sm tabular-nums">
              {Object.keys(depthChart).length}
            </div>
            <div className="t-meta">Custom</div>
          </div>
        </div>
      </div>

      {players.length === 0 ? (
        <EmptyState
          glyph="📋"
          title="No Depth Chart Yet"
          body="Add players to your roster to build a depth chart."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {board.map(({ pos, ranked, customized }) => (
            <PositionCard
              key={pos}
              pos={pos}
              ranked={ranked}
              customized={customized}
              canEdit={canEdit}
              onDropPlayer={dropPlayer}
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
