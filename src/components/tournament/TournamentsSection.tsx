import React, { memo, useMemo, useState } from "react";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { Modal } from "../shared";
import { featureEnabled } from "../../constants/features";
import { formatGameDateDisplay, isGameFinalized } from "../../utils/helpers";
import { unclaimedTournamentSuggestions } from "../../utils/tournamentPitching";
import type { Game, Tournament } from "../../types";
import { TournamentCard } from "./TournamentCard";

// Create/edit dialog shared by the "Name this tournament" suggestion chips
// and the card's Edit action: a name field plus a checkbox list of candidate
// games. Candidates are dated, non-scrimmage games not claimed by another
// tournament (a game belongs to at most one tournament).
const TournamentEditorModal = ({
  open,
  title,
  initialName,
  initialGameIds,
  candidates,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  initialName: string;
  initialGameIds: string[];
  candidates: Game[];
  onSave: (name: string, gameIds: string[]) => void;
  onClose: () => void;
}) => {
  const [name, setName] = useState(initialName);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialGameIds),
  );
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const valid = name.trim().length > 0 && selected.size > 0;

  return (
    <Modal open={open} onClose={onClose} title={title} eyebrow="Tournament">
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
      <div className="mt-4 text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
        Games
      </div>
      {candidates.length === 0 ? (
        <p className="text-sm font-bold text-ink-3">
          No unclaimed games available — add games to the schedule first.
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto border border-line rounded-xl divide-y divide-line">
          {candidates.map((g) => (
            <label
              key={g.id}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2"
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
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="bg-surface hover:bg-surface-2 text-ink font-bold uppercase tracking-widest text-xs px-5 py-2.5 rounded-lg shadow-sm border border-line transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => onSave(name, [...selected])}
          className="font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-lg shadow-md transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: "var(--team-primary)",
            color: "var(--team-on-primary)",
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
};

// The Tournaments strip on the Schedule tab: stored tournaments render as
// expandable cards (game list + weekend pitching plan); derived weekend
// clusters that nobody has claimed render as "Name this tournament"
// suggestion chips. Hidden entirely when the team turned the module off or
// there is nothing to show.
export const TournamentsSection = memo(() => {
  const { team, currentRole, addTournament, updateTournament } = useTeam();
  const canEdit = currentRole !== "assistant";
  const games: Game[] = useMemo(() => team.games || [], [team.games]);
  const tournaments: Tournament[] = useMemo(
    () => team.tournaments || [],
    [team.tournaments],
  );

  // null = closed; a seed-shaped object = creating; a Tournament = editing.
  const [editor, setEditor] = useState<
    | null
    | { mode: "create"; name: string; gameIds: string[]; seedKey?: string }
    | { mode: "edit"; tournament: Tournament }
  >(null);

  const suggestions = useMemo(
    () =>
      unclaimedTournamentSuggestions(games, team.leagueRuleSet, tournaments),
    [games, team.leagueRuleSet, tournaments],
  );

  if (!featureEnabled(team, "tournaments")) return null;
  if (tournaments.length === 0 && suggestions.length === 0) return null;

  // Games a tournament may claim: dated, non-scrimmage, and not already in a
  // DIFFERENT tournament. The one being edited keeps its own games listed.
  const editingId = editor?.mode === "edit" ? editor.tournament.id : null;
  const claimedElsewhere = new Set(
    tournaments
      .filter((t) => t.id !== editingId)
      .flatMap((t) => t.gameIds || []),
  );
  const candidates = games
    .filter((g) => g.date && !g.isScrimmage && !claimedElsewhere.has(g.id))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  return (
    <div className="mt-4">
      <div className="flex flex-col gap-3">
        {tournaments.map((t) => (
          <TournamentCard
            key={t.id}
            tournament={t}
            canEdit={canEdit}
            onEditGames={(tournament) => setEditor({ mode: "edit", tournament })}
          />
        ))}
        {canEdit && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setEditor({
                    mode: "create",
                    name: "",
                    gameIds: s.gameIds,
                    seedKey: s.id,
                  })
                }
                className="t-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-line-strong text-ink-2 hover:bg-surface-2 transition-colors"
                title="These games look like one tournament weekend — name it to plan pitching across its games."
              >
                <Icons.Pitch className="w-3.5 h-3.5" />
                {s.label} · {s.gameIds.length} games — Name this tournament
              </button>
            ))}
          </div>
        )}
      </div>

      {editor && (
        <TournamentEditorModal
          open
          title={
            editor.mode === "create" ? "Name this tournament" : "Edit tournament"
          }
          initialName={
            editor.mode === "create" ? editor.name : editor.tournament.name
          }
          initialGameIds={
            editor.mode === "create"
              ? editor.gameIds
              : editor.tournament.gameIds || []
          }
          candidates={candidates}
          onClose={() => setEditor(null)}
          onSave={(name, gameIds) => {
            if (editor.mode === "create") {
              addTournament({ name, gameIds, seedKey: editor.seedKey });
            } else {
              updateTournament(editor.tournament.id, { name, gameIds });
            }
            setEditor(null);
          }}
        />
      )}
    </div>
  );
});
