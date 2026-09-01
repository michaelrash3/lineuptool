import React, { memo, useState } from "react";
import { Link } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { isSubPlayer, subsForTournament } from "../../utils/subPlayers";
import { formatStat } from "../../utils/helpers";
import type { Player, Tournament } from "../../types";

// "Subs" card on the tournament detail page: the guest players borrowed for
// this weekend. They live in team.players with isSub set, so the lineup
// engine, Game Day Attendance, the pitching plan and the in-game view treat
// them like anyone else FOR THIS TOURNAMENT'S GAMES — and every season-long
// surface (roster, cap, stats leaders, evaluations, development, practices,
// availability, fees) skips them entirely.
//
// A sub who comes back for another weekend is ADDED here, not re-created:
// their stats and pitching log live on the player record, so a second row for
// the same kid would show the rest rules a fresh arm. Heads edit; assistants
// read.

// Their line so far, for the coach deciding whether to bring them back.
const statLine = (p: Player): string | null => {
  const s = (p.stats || {}) as Record<string, unknown>;
  const ab = Number(s.ab) || 0;
  const ip = Number(s.ip) || 0;
  const parts: string[] = [];
  if (ab > 0) parts.push(`${formatStat(s.avg)} · ${ab} AB`);
  if (ip > 0) parts.push(`${ip} IP`);
  const recent = Number(p.pitching?.recentPitches) || 0;
  if (recent > 0) parts.push(`${recent} recent pitches`);
  return parts.length > 0 ? parts.join(" · ") : null;
};

export const TournamentSubsPanel = memo(
  ({ tournament }: { tournament: Tournament }) => {
    const { team, currentRole, addSubToTournament, removeSubFromTournament } =
      useTeam();
    const canEdit = currentRole !== "assistant";
    const [adding, setAdding] = useState(false);
    const players: Player[] = team.players || [];
    const subs = subsForTournament<Player>(players, tournament.id);
    const gameCount = (tournament.gameIds || []).length;

    // Subs the team has used before who are not on this tournament yet.
    const reusable = players.filter(
      (p) => isSubPlayer(p) && !subs.some((s) => s.id === p.id),
    );

    return (
      <div className="cc-card overflow-hidden mb-4">
        <div className="p-4 flex items-center justify-between gap-3 border-b border-line">
          <h3 className="t-eyebrow text-ink-2 flex items-center gap-2">
            <Icons.UserPlus className="w-4 h-4" /> Subs
          </h3>
          {canEdit && (
            <div className="flex items-center gap-2">
              {reusable.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAdding((a) => !a)}
                  className="t-chip px-2.5 py-1 rounded-md border border-line text-ink-2 hover:bg-surface-2 transition-colors"
                >
                  {adding ? "Done" : "Add past sub"}
                </button>
              )}
              <Link
                to={`/schedule/tournaments/${tournament.id}/subs/new`}
                className="t-chip px-2.5 py-1 rounded-md border border-line text-ink-2 hover:bg-surface-2 transition-colors"
              >
                New sub
              </Link>
            </div>
          )}
        </div>

        {adding && (
          <div
            role="group"
            aria-label="Past subs"
            className="divide-y divide-line max-h-64 overflow-y-auto bg-surface-2"
          >
            <p className="px-4 py-2 text-[11px] font-bold text-ink-3 leading-snug">
              Subs you have used before. Adding one here reuses their record, so
              their stats and pitch count carry over instead of starting fresh.
            </p>
            {reusable.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  addSubToTournament(p.id, tournament.id);
                  setAdding(false);
                }}
                className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-surface transition-colors"
              >
                <Icons.Plus className="w-4 h-4 shrink-0 text-ink-3" />
                <span className="text-[11px] font-black uppercase tracking-widest text-ink-3 tabular-nums w-8 shrink-0">
                  {p.number ? `#${p.number}` : "--"}
                </span>
                <span className="font-bold text-ink text-sm truncate">
                  {p.name}
                </span>
                {statLine(p) && (
                  <span className="t-chip text-ink-3 ml-auto whitespace-nowrap tabular-nums">
                    {statLine(p)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

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
              const line = statLine(p);
              return (
                <div key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                  {/* Their profile is the only place to fix a number, add a
                      position, or read the stats they have piled up. */}
                  <Link
                    to={`/roster/${p.id}`}
                    className="flex items-center gap-3 min-w-0 flex-1 group"
                  >
                    <span className="text-[11px] font-black uppercase tracking-widest text-ink-3 tabular-nums w-8 shrink-0">
                      {p.number ? `#${p.number}` : "--"}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-ink text-sm truncate group-hover:text-team-primary transition-colors">
                        {p.name}
                      </span>
                      {line && (
                        <span className="block t-chip text-ink-3 tabular-nums normal-case tracking-normal">
                          {line}
                        </span>
                      )}
                    </span>
                  </Link>
                  <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 whitespace-nowrap shrink-0">
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
