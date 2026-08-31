import React, { memo, useState } from "react";
import { Navigate, useParams, useNavigate } from "react-router-dom";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { PlayerAvatar } from "../../components/shared";
import { Icons } from "../../icons";
import { featureEnabled } from "../../constants/features";
import { ROSTER_POSITIONS, formatGameDateDisplay } from "../../utils/helpers";
import { normalizeJersey } from "../../utils/rosterIntegrity";
import { orderedTournamentGames } from "../../utils/tournamentPitching";
import type { Player, Tournament } from "../../types";

// /schedule/tournaments/:tournamentId/subs/new — add a guest player for one
// tournament weekend, as a routed page per the app-wide modals→pages rule.
// Head-coach only; assistants bounce back to the tournament.
//
// A sub is deliberately NOT a roster add: no cap check, no roster lock, no
// age-eligibility gate. All the form collects is what the lineup engine needs
// to seat them for a few games — name, number, handedness, and where they can
// play. Everything season-long (stats, evals, development, fees) skips them.
export const AddTournamentSubPage = memo(() => {
  const { tournamentId } = useParams();
  const { team, addSubPlayer, currentRole } = useTeam();
  const navigate = useNavigate();
  const back = useBackOrFallback(`/schedule/tournaments/${tournamentId}`);
  const { primaryColor, tertiaryColor } = team;
  const [form, setForm] = useState({
    name: "",
    number: "",
    bats: "R",
    throws: "R",
    comfortablePositions: [] as string[],
  });

  const tournament: Tournament | undefined = (team.tournaments || []).find(
    (t: Tournament) => t.id === tournamentId,
  );

  if (!featureEnabled(team, "tournaments") || !tournament) {
    return <Navigate to="/schedule" replace />;
  }
  if (currentRole === "assistant") {
    return <Navigate to={`/schedule/tournaments/${tournament.id}`} replace />;
  }

  const linked = orderedTournamentGames(tournament, team.games || []);
  // A jersey clash matters on game day, so warn against everyone who could be
  // in the dugout this weekend — roster and already-added subs alike.
  const target = normalizeJersey(form.number);
  const jerseyClash = target
    ? ((team.players || []) as Player[]).filter(
        (p) =>
          p.rosterStatus !== "departed" && normalizeJersey(p.number) === target,
      )
    : [];

  const togglePosition = (pos: string) =>
    setForm((f) => ({
      ...f,
      comfortablePositions: f.comfortablePositions.includes(pos)
        ? f.comfortablePositions.filter((p) => p !== pos)
        : [...f.comfortablePositions, pos],
    }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const id = addSubPlayer(tournament.id, form);
    if (id)
      navigate(`/schedule/tournaments/${tournament.id}`, { replace: true });
  };

  return (
    <PageShell eyebrow={tournament.name} title="Add Sub" onBack={back}>
      <form onSubmit={submit} className="cc-card p-6 sm:p-7 space-y-4 max-w-md">
        <div className="flex items-start gap-2 p-3 rounded-xl bg-surface-2 border border-line text-ink-2">
          <Icons.Users className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold leading-snug">
            Subs play this tournament only — they never join your roster, count
            against the cap, or show up in stats, evaluations, or team fees.
            {linked.length > 0 && (
              <>
                {" "}
                Available for {linked.length}{" "}
                {linked.length === 1 ? "game" : "games"} (
                {formatGameDateDisplay(linked[0].date)}
                {linked.length > 1
                  ? ` – ${formatGameDateDisplay(linked[linked.length - 1].date)}`
                  : ""}
                ).
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <PlayerAvatar
            player={{ name: form.name, number: form.number }}
            size={64}
            showNumber
          />
          <p className="flex-1 text-xs font-medium text-ink-3 leading-snug">
            Give them a number so the lineup card and the dugout agree on who
            they are.
          </p>
        </div>

        <div>
          <label
            htmlFor="sub-name"
            className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
          >
            Name *
          </label>
          <input
            id="sub-name"
            autoFocus
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-inner"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="sub-number"
              className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
            >
              Number
            </label>
            <input
              id="sub-number"
              type="text"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-inner"
            />
          </div>
          <div>
            <label
              htmlFor="sub-bats"
              className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
            >
              Bats
            </label>
            <select
              id="sub-bats"
              value={form.bats}
              onChange={(e) => setForm({ ...form, bats: e.target.value })}
              className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-sm"
            >
              <option>R</option>
              <option>L</option>
              <option>S</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="sub-throws"
              className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
            >
              Throws
            </label>
            <select
              id="sub-throws"
              value={form.throws}
              onChange={(e) => setForm({ ...form, throws: e.target.value })}
              className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-sm"
            >
              <option>R</option>
              <option>L</option>
            </select>
          </div>
          {jerseyClash.length > 0 && (
            <p className="col-span-3 -mt-1 text-[10px] font-bold text-loss flex items-center gap-1.5">
              <Icons.Alert className="w-3.5 h-3.5 shrink-0" />#{target} already
              worn by {jerseyClash.map((d) => d.name).join(", ")}
            </p>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
            Can Play
          </label>
          <p className="text-[11px] text-ink-3 font-medium mb-2">
            Leave empty to let the engine use them anywhere except catcher — C
            is opt-in, and P is what puts them on the weekend pitching plan.
          </p>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 cc-card p-3">
            {ROSTER_POSITIONS.map((pos) => {
              const active = form.comfortablePositions.includes(pos);
              return (
                <button
                  key={pos}
                  type="button"
                  aria-pressed={active}
                  onClick={() => togglePosition(pos)}
                  className={`p-2 text-xs font-black uppercase rounded-lg transition-all border ${
                    active
                      ? "bg-win-bg border-line text-win shadow-sm"
                      : "bg-surface border-line text-ink hover:bg-surface-2 hover:border-line-strong"
                  }`}
                >
                  {pos}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3 pt-3 justify-end">
          <button
            type="button"
            onClick={back}
            className="px-5 py-2.5 bg-surface border border-line text-ink-2 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-surface-2 transition-colors shadow-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2.5 font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            Add Sub
          </button>
        </div>
      </form>
    </PageShell>
  );
});
