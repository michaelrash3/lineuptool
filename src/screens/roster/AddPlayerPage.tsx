import React, { memo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { PlayerAvatar } from "../../components/shared";

// /roster/new — add a player as a real page (deep-linkable, refresh-safe,
// back-button friendly). Converted from AddPlayerModal per the app-wide
// modals→pages rule. Head-coach only: assistants bounce to the roster.
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    addPlayer(form);
    back();
  };

  return (
    <PageShell eyebrow="Roster" title="Add Player" onBack={back}>
      <form onSubmit={submit} className="cc-card p-6 sm:p-7 space-y-4 max-w-md">
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
            className="px-5 py-2.5 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            Add Player
          </button>
        </div>
      </form>
    </PageShell>
  );
});
