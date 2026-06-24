import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { buildSeasonSummary, formatGameDateDisplay } from "../utils/helpers";

// Per-game season log: every finalized result (W/L/T, score, opponent), most
// recent first, with the current streak in the header. Complements the
// scoreboard hero's aggregate (record / run diff / form). Tapping a row jumps
// to that game on the Schedule tab. Hidden until a game is finalized.
export const GameLogPanel = memo(() => {
  const { team } = useTeam();
  const { setSelectedGameId, setActiveTab } = useUI();
  const { games } = team;

  const summary = useMemo(() => buildSeasonSummary(games || []), [games]);
  if (summary.gamesPlayed === 0) return null;

  const resultCls: Record<string, string> = {
    W: "bg-win-bg border-win text-win",
    L: "bg-loss-bg border-loss text-loss",
    T: "bg-surface-2 border-line-strong text-ink-2",
  };

  const openGame = (id: string) => {
    setSelectedGameId(id);
    setActiveTab("schedule");
  };

  return (
    <div className="cc-card">
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
      <div className="p-5 border-b border-line bg-surface flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-full"
            style={{ backgroundColor: "var(--team-primary-15)" }}
          >
            <Icons.Clipboard
              className="w-5 h-5"
              style={{ color: "var(--team-primary)" }}
            />
          </div>
          <h2 className="t-h2">Game Log</h2>
        </div>
        {summary.streakType && (
          <span className="t-eyebrow text-ink-3 whitespace-nowrap">
            Streak {summary.streakType}
            {summary.streakCount}
          </span>
        )}
      </div>

      <ul className="divide-y divide-line/60">
        {summary.results.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => openGame(r.id)}
              className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-surface-2 transition-colors"
            >
              <span
                className={`shrink-0 w-7 h-7 grid place-items-center rounded-md border text-[11px] font-black ${resultCls[r.result]}`}
              >
                {r.result}
              </span>
              <span className="font-black tabular-nums text-ink w-14 shrink-0">
                {r.teamScore}–{r.opponentScore}
              </span>
              <span className="flex-1 min-w-0 truncate text-sm font-bold text-ink">
                vs {r.opponent}
              </span>
              <span className="shrink-0 t-eyebrow text-ink-3 hidden sm:inline">
                {formatGameDateDisplay(r.date)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
