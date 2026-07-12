import React, { memo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam, useConfirm } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { featureEnabled } from "../../constants/features";
import { formatGameDateDisplay, isGameFinalized } from "../../utils/helpers";
import { orderedTournamentGames } from "../../utils/tournamentPitching";
import { TournamentPitchPlanPanel } from "../../components/tournament/TournamentPitchPlanPanel";
import type { Game, Tournament } from "../../types";

// /schedule/tournaments/:tournamentId — one tournament as a real page:
// its games, membership editing, rename/delete, and the cross-game weekend
// pitching plan. Converted from the old expandable TournamentCard + editor
// modal per the app-wide modals→pages rule.
export const TournamentDetailPage = memo(() => {
  const { tournamentId } = useParams();
  const { team, currentRole, updateTournament, removeTournament } = useTeam();
  const { confirm, promptText } = useConfirm();
  const back = useBackOrFallback("/schedule");
  const canEdit = currentRole !== "assistant";
  const [editingGames, setEditingGames] = useState(false);

  const tournament: Tournament | undefined = (team.tournaments || []).find(
    (t: Tournament) => t.id === tournamentId,
  );

  if (!featureEnabled(team, "tournaments") || !tournament) {
    return <Navigate to="/schedule" replace />;
  }

  const games: Game[] = team.games || [];
  const ordered = orderedTournamentGames(tournament, games);
  const rangeLabel = (() => {
    if (ordered.length === 0) return "No games linked";
    const first = formatGameDateDisplay(ordered[0].date);
    const last = formatGameDateDisplay(ordered[ordered.length - 1].date);
    return first === last ? first : `${first} – ${last}`;
  })();

  // Games this tournament may claim: dated, non-scrimmage, not already in a
  // DIFFERENT tournament (a game belongs to at most one).
  const claimedElsewhere = new Set(
    (team.tournaments || [])
      .filter((t: Tournament) => t.id !== tournament.id)
      .flatMap((t: Tournament) => t.gameIds || []),
  );
  const candidates = games
    .filter((g) => g.date && !g.isScrimmage && !claimedElsewhere.has(g.id))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const memberIds = new Set(tournament.gameIds || []);

  const rename = async () => {
    const name = await promptText({
      title: "Rename tournament",
      defaultValue: tournament.name,
      confirmLabel: "Rename",
    });
    if (name) updateTournament(tournament.id, { name });
  };

  const remove = async () => {
    // removeTournament runs its own confirm + Undo toast; it resolves false
    // when the coach cancels, in which case the page stays put.
    const removed = await removeTournament(tournament.id);
    if (removed) back();
  };

  const toggleGame = async (gameId: string) => {
    const cur = tournament.gameIds || [];
    const next = cur.includes(gameId)
      ? cur.filter((id) => id !== gameId)
      : [...cur, gameId];
    if (next.length === 0) {
      const ok = await confirm({
        title: "Remove the last game?",
        message:
          "A tournament needs at least one game. Removing it deletes nothing else — add a game back to keep planning.",
        confirmLabel: "Remove anyway",
        danger: true,
      });
      if (!ok) return;
    }
    updateTournament(tournament.id, { gameIds: next });
  };

  return (
    <PageShell
      eyebrow="Tournament"
      title={tournament.name}
      onBack={back}
      actions={
        canEdit ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={rename}
              className="p-2 text-ink-3 hover:text-ink hover:bg-surface-2 rounded-lg transition-colors"
              aria-label={`Rename ${tournament.name}`}
              title="Rename tournament"
            >
              <Icons.Edit className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={remove}
              className="p-2 text-ink-3 hover:text-loss hover:bg-loss-bg rounded-lg transition-colors"
              aria-label={`Delete ${tournament.name}`}
              title="Delete tournament (games stay on the schedule)"
            >
              <Icons.Trash className="w-4 h-4" />
            </button>
          </div>
        ) : undefined
      }
    >
      <p className="t-eyebrow text-ink-3 -mt-3 mb-4">
        {rangeLabel} · {ordered.length}{" "}
        {ordered.length === 1 ? "game" : "games"}
      </p>

      {/* Games */}
      <div className="cc-card overflow-hidden mb-4">
        <div className="p-4 flex items-center justify-between gap-3 border-b border-line">
          <h3 className="t-eyebrow text-ink-2">Games</h3>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditingGames((e) => !e)}
              className="t-chip px-2.5 py-1 rounded-md border border-line text-ink-2 hover:bg-surface-2 transition-colors"
            >
              {editingGames ? "Done" : "Edit games"}
            </button>
          )}
        </div>
        {editingGames ? (
          <div className="divide-y divide-line max-h-80 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="p-4 text-sm font-bold text-ink-3">
                No unclaimed games on the schedule.
              </p>
            ) : (
              candidates.map((g) => (
                <label
                  key={g.id}
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={memberIds.has(g.id)}
                    onChange={() => toggleGame(g.id)}
                    className="w-4 h-4 accent-[var(--team-primary)]"
                  />
                  <span className="text-[11px] font-black uppercase tracking-widest text-ink-3 whitespace-nowrap">
                    {formatGameDateDisplay(g.date)}
                  </span>
                  <span className="font-bold text-ink text-sm truncate">
                    {g.opponent ? `vs ${g.opponent}` : "TBD"}
                  </span>
                  {isGameFinalized(g) && (
                    <span className="t-chip px-1.5 py-0.5 rounded border border-line bg-surface-2 text-ink-3 ml-auto">
                      Final
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        ) : ordered.length === 0 ? (
          <p className="p-4 text-sm font-bold text-ink-3">
            The games linked to this tournament are no longer on the schedule.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {ordered.map((g) => {
              const final = isGameFinalized(g);
              return (
                <div key={g.id} className="px-4 py-2.5 flex items-center gap-3">
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
      </div>

      {/* Weekend pitching plan */}
      <div className="cc-card overflow-hidden">
        <TournamentPitchPlanPanel tournament={tournament} />
      </div>
    </PageShell>
  );
});
