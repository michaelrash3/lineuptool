import React, { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { featureEnabled } from "../../constants/features";
import { formatGameDateDisplay } from "../../utils/helpers";
import {
  orderedTournamentGames,
  unclaimedTournamentSuggestions,
} from "../../utils/tournamentPitching";
import type { Game, Tournament } from "../../types";

// The Tournaments strip on the Schedule tab: stored tournaments render as
// rows linking to their detail page (/schedule/tournaments/:id — games,
// rename/delete, and the weekend pitching plan live there); derived weekend
// clusters that nobody has claimed render as "Name this tournament"
// suggestion links into the creation page. Hidden entirely when the team
// turned the module off or there is nothing to show.
export const TournamentsSection = memo(() => {
  const { team, currentRole } = useTeam();
  const canEdit = currentRole !== "assistant";
  const games: Game[] = useMemo(() => team.games || [], [team.games]);
  const tournaments: Tournament[] = useMemo(
    () => team.tournaments || [],
    [team.tournaments],
  );

  const suggestions = useMemo(
    () =>
      unclaimedTournamentSuggestions(games, team.leagueRuleSet, tournaments),
    [games, team.leagueRuleSet, tournaments],
  );

  if (!featureEnabled(team, "tournaments")) return null;
  if (tournaments.length === 0 && suggestions.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="flex flex-col gap-3">
        {tournaments.map((t) => {
          const linked = orderedTournamentGames(t, games);
          const rangeLabel = (() => {
            if (linked.length === 0) return "No games linked";
            const first = formatGameDateDisplay(linked[0].date);
            const last = formatGameDateDisplay(linked[linked.length - 1].date);
            return first === last ? first : `${first} – ${last}`;
          })();
          return (
            <Link
              key={t.id}
              to={`/schedule/tournaments/${t.id}`}
              className="cc-card overflow-hidden block group"
            >
              <div
                className="h-1 w-full"
                style={{ backgroundColor: "var(--team-primary)" }}
              />
              <div className="flex items-center gap-3 p-4">
                <div
                  className="p-2 rounded-full shrink-0"
                  style={{ backgroundColor: "var(--team-primary-15)" }}
                >
                  <Icons.Pitch
                    className="w-4 h-4"
                    style={{ color: "var(--team-ink)" }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold text-ink text-sm truncate group-hover:underline">
                    {t.name}
                  </div>
                  <div className="t-eyebrow text-ink-3 mt-0.5">
                    {rangeLabel} · {linked.length}{" "}
                    {linked.length === 1 ? "game" : "games"}
                  </div>
                </div>
                <Icons.ChevronRight className="w-4 h-4 text-ink-3 shrink-0" />
              </div>
            </Link>
          );
        })}
        {canEdit && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Link
                key={s.id}
                to={`/schedule/tournaments/new?seed=${encodeURIComponent(s.id)}`}
                className="t-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-line-strong text-ink-2 hover:bg-surface-2 transition-colors"
                title="These games look like one tournament weekend — name it to plan pitching across its games."
              >
                <Icons.Pitch className="w-3.5 h-3.5" />
                {s.label} · {s.gameIds.length} games — Name this tournament
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
