import React, { memo } from "react";
import { Link } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { subsForTournament } from "../../utils/subPlayers";
import type { Player, Tournament } from "../../types";

// "Subs" card on the tournament detail page: the guest players borrowed for
// this weekend. They live in team.players with isSub set, so the lineup
// engine, Game Day Attendance, the pitching plan and the in-game view treat
// them like anyone else FOR THIS TOURNAMENT'S GAMES — and every season-long
// surface (roster, cap, stats, evaluations, development, practices,
// availability, fees, advance-season) skips them entirely.
// Heads add and remove; assistants read.
export const TournamentSubsPanel = memo(
  ({ tournament }: { tournament: Tournament }) => {
    const { team, currentRole, removeSubFromTournament } = useTeam();
    const canEdit = currentRole !== "assistant";
    const subs = subsForTournament<Player>(team.players, tournament.id);
    const gameCount = (tournament.gameIds || []).length;

    return (
      <div className="cc-card overflow-hidden mb-4">
        <div className="p-4 flex items-center justify-between gap-3 border-b border-line">
          <h3 className="t-eyebrow text-ink-2 flex items-center gap-2">
            <Icons.UserPlus className="w-4 h-4" /> Subs
          </h3>
          {canEdit && (
            <Link
              to={`/schedule/tournaments/${tournament.id}/subs/new`}
              className="t-chip px-2.5 py-1 rounded-md border border-line text-ink-2 hover:bg-surface-2 transition-colors"
            >
              Add sub
            </Link>
          )}
        </div>
        {subs.length === 0 ? (
          <p className="p-4 text-sm font-bold text-ink-3">
            No subs for this tournament. Add one to pick up a guest player for
            the weekend without putting them on your roster.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {subs.map((p) => {
              const positions = Array.isArray(p.comfortablePositions)
                ? p.comfortablePositions
                : [];
              return (
                <div key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[11px] font-black uppercase tracking-widest text-ink-3 tabular-nums w-8 shrink-0">
                    {p.number ? `#${p.number}` : "--"}
                  </span>
                  <span className="font-bold text-ink text-sm truncate">
                    {p.name}
                  </span>
                  <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 ml-auto whitespace-nowrap">
                    {positions.length > 0 ? positions.join(" · ") : "Anywhere"}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        removeSubFromTournament(p.id, tournament.id)
                      }
                      className="p-1.5 text-ink-3 hover:text-loss hover:bg-loss-bg rounded-lg transition-colors shrink-0"
                      aria-label={`Remove ${p.name}`}
                      title="Remove sub"
                    >
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {subs.length > 0 && (
          <p className="px-4 pb-4 -mt-1 text-[11px] font-bold text-ink-3 leading-snug">
            {subs.length === 1 ? "This sub is" : "These subs are"} available for
            this tournament&apos;s {gameCount}{" "}
            {gameCount === 1 ? "game" : "games"} only — mark them in from Game
            Day Attendance and the lineup engine will use them.
          </p>
        )}
      </div>
    );
  },
);
