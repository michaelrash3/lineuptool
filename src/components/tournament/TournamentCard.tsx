import React, { memo, useState } from "react";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { formatGameDateDisplay, isGameFinalized } from "../../utils/helpers";
import { orderedTournamentGames } from "../../utils/tournamentPitching";
import type { Game, Tournament } from "../../types";
import { TournamentPitchPlanPanel } from "./TournamentPitchPlanPanel";

// One stored tournament on the Schedule tab: header (name, date range, game
// count) with head-coach rename/delete, and an expandable body listing the
// weekend's games plus the cross-game pitching plan panel. Assistants see
// everything read-only.
export const TournamentCard = memo(
  ({
    tournament,
    canEdit,
    onEditGames,
  }: {
    tournament: Tournament;
    canEdit: boolean;
    onEditGames: (t: Tournament) => void;
  }) => {
    const { team, removeTournament } = useTeam();
    const [expanded, setExpanded] = useState(false);

    const games: Game[] = orderedTournamentGames(tournament, team.games || []);
    const rangeLabel = (() => {
      if (games.length === 0) return "No games linked";
      const first = formatGameDateDisplay(games[0].date);
      const last = formatGameDateDisplay(games[games.length - 1].date);
      return first === last ? first : `${first} – ${last}`;
    })();

    return (
      <div className="cc-card overflow-hidden">
        <div
          className="h-1 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="flex items-center gap-3 p-4">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 cursor-pointer group"
          >
            <div
              className="p-2 rounded-full shrink-0"
              style={{ backgroundColor: "var(--team-primary-15)" }}
            >
              <Icons.Pitch
                className="w-4 h-4"
                style={{ color: "var(--team-ink)" }}
              />
            </div>
            <div className="min-w-0">
              <div className="font-extrabold text-ink text-sm truncate group-hover:underline">
                {tournament.name}
              </div>
              <div className="t-eyebrow text-ink-3 mt-0.5">
                {rangeLabel} · {games.length}{" "}
                {games.length === 1 ? "game" : "games"}
              </div>
            </div>
            {expanded ? (
              <Icons.ChevronUp className="w-4 h-4 text-ink-3 shrink-0 ml-auto" />
            ) : (
              <Icons.ChevronDown className="w-4 h-4 text-ink-3 shrink-0 ml-auto" />
            )}
          </button>
          {canEdit && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onEditGames(tournament)}
                className="p-2 text-ink-3 hover:text-ink hover:bg-surface-2 rounded-lg transition-colors"
                aria-label={`Edit ${tournament.name}`}
                title="Rename or change linked games"
              >
                <Icons.Edit className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => removeTournament(tournament.id)}
                className="p-2 text-ink-3 hover:text-loss hover:bg-loss-bg rounded-lg transition-colors"
                aria-label={`Delete ${tournament.name}`}
                title="Delete tournament (games stay on the schedule)"
              >
                <Icons.Trash className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {expanded && (
          <div className="border-t border-line">
            {games.length === 0 ? (
              <p className="p-4 text-sm font-bold text-ink-3">
                The games linked to this tournament are no longer on the
                schedule.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {games.map((g) => {
                  const final = isGameFinalized(g);
                  return (
                    <div
                      key={g.id}
                      className="px-4 py-2.5 flex items-center gap-3"
                    >
                      <span className="text-[11px] font-black uppercase tracking-widest text-ink-3 whitespace-nowrap">
                        {formatGameDateDisplay(g.date)}
                      </span>
                      <span className="font-bold text-ink text-sm truncate">
                        {g.opponent ? `vs ${g.opponent}` : "TBD"}
                      </span>
                      {final ? (
                        <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface-2 text-ink-2 ml-auto whitespace-nowrap tabular-nums">
                          Final {g.teamScore as any}-{g.opponentScore as any}
                        </span>
                      ) : (
                        <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 ml-auto whitespace-nowrap">
                          {g.gameType === "bracket" ? "Bracket" : "Pool"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <TournamentPitchPlanPanel tournament={tournament} />
          </div>
        )}
      </div>
    );
  },
);
