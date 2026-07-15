import React, { memo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { PlayerAvatar } from "../../components/shared";
import { Icons } from "../../icons";
import {
  playersWithJersey,
  activeRosterCount,
} from "../../utils/rosterIntegrity";

// /roster/new — add a player as a real page (deep-linkable, refresh-safe,
// back-button friendly) per the app-wide modals→pages rule. Head-coach
// only: assistants bounce to the roster.
export const AddPlayerPage = memo(() => {
  const { team, addPlayer, currentRole } = useTeam();
  const back = useBackOrFallback("/roster");
  const { primaryColor, tertiaryColor } = team;
  const [form, setForm] = useState({
    name: "",
    number: "",
    bats: "R",
    throws: "R",
    primaryPosition: "",
  });

  if (currentRole === "assistant") {
    return <Navigate to="/roster" replace />;
  }

  const locked = team.rosterLocked === true;
  const dupNames = playersWithJersey(team.players, form.number);
  const cap =
    typeof team.rosterCap === "number" && team.rosterCap > 0
      ? team.rosterCap
      : null;
  const count = activeRosterCount(team.players);
  const atCap = cap != null && count >= cap;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (locked) return; // roster finalized — no new adds until unlocked
    addPlayer(form);
    back();
  };

  return (
    <PageShell eyebrow="Roster" title="Add Player" onBack={back}>
      <form onSubmit={submit} className="cc-card p-6 sm:p-7 space-y-4 max-w-md">
        {locked && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-loss-bg border border-loss text-loss">
            <Icons.Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-[11px] font-bold leading-snug">
              The roster is finalized. Unlock it from Roster → Roster Integrity
              to add players.
            </p>
          </div>
        )}
        {!locked && atCap && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-surface-2 border border-line text-ink-2">
            <Icons.Alert className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-[11px] font-bold leading-snug">
              Roster is at its {cap}-player cap ({count}). You can still add —
              consider finalizing the roster when it&apos;s set.
            </p>
          </div>
        )}
        <div className="flex items-center gap-4">
          <PlayerAvatar
            player={{
              name: form.name,
              number: form.number,
              primaryPosition: form.primaryPosition,
            }}
            size={64}
            showNumber
            showPosition
          />
          <p className="flex-1 text-xs font-medium text-ink-3 leading-snug">
            Players show your team logo. Set a number and primary position to
            tell them apart at a glance.
          </p>
        </div>
        <div>
          <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
            Name *
          </label>
          <input
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
            <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
              Number
            </label>
            <input
              type="text"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-inner"
            />
          </div>
          {dupNames.length > 0 && (
            <p className="col-span-3 -mt-1 text-[10px] font-bold text-loss flex items-center gap-1.5">
              <Icons.Alert className="w-3.5 h-3.5 shrink-0" />#
              {form.number.trim()} already worn by{" "}
              {dupNames.map((d) => d.name).join(", ")}
            </p>
          )}
          <div>
            <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
              Bats
            </label>
            <select
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
            <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
              Throws
            </label>
            <select
              value={form.throws}
              onChange={(e) => setForm({ ...form, throws: e.target.value })}
              className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-sm"
            >
              <option>R</option>
              <option>L</option>
            </select>
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
            disabled={locked}
            className="px-5 py-2.5 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md disabled:opacity-40 disabled:pointer-events-none"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            Add Player
          </button>
        </div>
      </form>
    </PageShell>
  );
});
