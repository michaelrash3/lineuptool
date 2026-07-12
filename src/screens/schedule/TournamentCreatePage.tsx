import React, { memo, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { featureEnabled } from "../../constants/features";
import { formatGameDateDisplay, isGameFinalized } from "../../utils/helpers";
import { unclaimedTournamentSuggestions } from "../../utils/tournamentPitching";
import type { Game, Tournament } from "../../types";

// /schedule/tournaments/new — name a tournament and pick its games. Replaces
// the TournamentEditorModal's create mode per the app-wide modals→pages rule.
// A "Name this tournament" suggestion chip links here with ?seed=<clusterId>
// so the derived weekend's games arrive pre-checked (and the stored entry
// remembers the seed, which retires that suggestion).
export const TournamentCreatePage = memo(() => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { team, currentRole, addTournament } = useTeam();
  const back = useBackOrFallback("/schedule");

  const games: Game[] = useMemo(() => team.games || [], [team.games]);
  const tournaments: Tournament[] = useMemo(
    () => team.tournaments || [],
    [team.tournaments],
  );

  const seedKey = params.get("seed") || undefined;
  const seed = useMemo(
    () =>
      seedKey
        ? unclaimedTournamentSuggestions(
            games,
            team.leagueRuleSet,
            tournaments,
          ).find((s) => s.id === seedKey)
        : undefined,
    [seedKey, games, team.leagueRuleSet, tournaments],
  );

  const [name, setName] = useState("");
  // Lazy init: the seed cluster's games arrive pre-checked on first render;
  // a stale/unknown seed just starts the list empty.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(seed?.gameIds || []),
  );

  if (!featureEnabled(team, "tournaments") || currentRole === "assistant") {
    return <Navigate to="/schedule" replace />;
  }

  // Games a new tournament may claim: dated, non-scrimmage, and not already
  // in another tournament (a game belongs to at most one).
  const claimed = new Set(tournaments.flatMap((t) => t.gameIds || []));
  const candidates = games
    .filter((g) => g.date && !g.isScrimmage && !claimed.has(g.id))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const valid = name.trim().length > 0 && selected.size > 0;
  const save = () => {
    const id = addTournament({
      name,
      gameIds: candidates.map((g) => g.id).filter((id) => selected.has(id)),
      seedKey: seed?.id,
    });
    // Land on the new tournament's page; replace so Back skips this form.
    if (id) navigate(`/schedule/tournaments/${id}`, { replace: true });
  };

  return (
    <PageShell eyebrow="Tournament" title="Name this tournament" onBack={back}>
      <div className="cc-card p-4 mb-4">
        <label
          htmlFor="tournament-name"
          className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
        >
          Name
        </label>
        <input
          id="tournament-name"
          type="text"
          value={name}
          autoFocus
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="Memorial Day Bash"
          className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner"
        />
      </div>

      <div className="cc-card overflow-hidden mb-5">
        <div className="p-4 border-b border-line">
          <h3 className="t-eyebrow text-ink-2">Games</h3>
        </div>
        {candidates.length === 0 ? (
          <p className="p-4 text-sm font-bold text-ink-3">
            No unclaimed games available — add games to the schedule first.
          </p>
        ) : (
          <div className="divide-y divide-line max-h-80 overflow-y-auto">
            {candidates.map((g) => (
              <label
                key={g.id}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selected.has(g.id)}
                  onChange={() => toggle(g.id)}
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
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={back}
          className="bg-surface hover:bg-surface-2 text-ink font-bold uppercase tracking-widest text-xs px-5 py-2.5 rounded-lg shadow-sm border border-line transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={save}
          className="font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-lg shadow-md transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: "var(--team-primary)",
            color: "var(--team-on-primary)",
          }}
        >
          Create Tournament
        </button>
      </div>
    </PageShell>
  );
});
