import React, { memo, useState, useId } from "react";
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
import { rosterOnly } from "../../utils/subPlayers";
import { parseRosterLines } from "../../utils/rosterPaste";

// /roster/new — add a player as a real page (deep-linkable, refresh-safe,
// back-button friendly) per the app-wide modals→pages rule. Head-coach
// only: assistants bounce to the roster.
export const AddPlayerPage = memo(() => {
  const fieldId = useId();
  const { team, addPlayer, addPlayers, currentRole } = useTeam();
  const back = useBackOrFallback("/roster");
  const { primaryColor, tertiaryColor } = team;
  const [form, setForm] = useState({
    name: "",
    number: "",
    bats: "R",
    throws: "R",
    primaryPosition: "",
  });
  // One at a time, or a pasted list (one player per line).
  const [mode, setMode] = useState<"one" | "many">("one");
  const [pasted, setPasted] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const parsed = parseRosterLines(pasted);

  if (currentRole === "assistant") {
    return <Navigate to="/roster" replace />;
  }

  const locked = team.rosterLocked === true;
  const dupNames = playersWithJersey(team.players, form.number);
  const cap =
    typeof team.rosterCap === "number" && team.rosterCap > 0
      ? team.rosterCap
      : null;
  const count = activeRosterCount(rosterOnly(team.players));
  const atCap = cap != null && count >= cap;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (locked) return; // roster finalized — no new adds until unlocked
    addPlayer(form);
    back();
  };
  // Add this player and clear the form for the next — entering a whole
  // roster one by one shouldn't mean a round trip per kid.
  const saveAndNext = () => {
    if (!form.name.trim() || locked) return;
    addPlayer(form);
    setJustAdded(form.name.trim());
    setForm({ ...form, name: "", number: "", primaryPosition: "" });
  };
  const addPasted = () => {
    if (locked || parsed.length === 0) return;
    addPlayers?.(parsed);
    back();
  };

  return (
    <PageShell eyebrow="Roster" title="Add Player" onBack={back}>
      <form onSubmit={submit} className="cc-card p-6 sm:p-7 space-y-4 max-w-md">
        <div
          role="tablist"
          aria-label="How to add"
          className="grid grid-cols-2 gap-1 p-1 bg-surface-2 rounded-xl"
        >
          {(
            [
              ["one", "One player"],
              ["many", "Paste a list"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={mode === v}
              onClick={() => setMode(v)}
              className={`min-h-[44px] rounded-lg text-xs font-black uppercase tracking-widest ${
                mode === v ? "bg-surface text-ink shadow-sm" : "text-ink-3"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "many" && (
          <div className="space-y-3">
            <label
              htmlFor="roster-paste"
              className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest"
            >
              One player per line — a number is optional
            </label>
            <textarea
              id="roster-paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={8}
              placeholder={"12 Ada Lopez\n#7 Ben Cruz\nCara Diaz, 3\nDev Patel"}
              className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-inner"
            />
            {parsed.length > 0 && (
              <ul
                aria-label="Players to add"
                className="text-xs font-bold text-ink-2 space-y-0.5"
              >
                {parsed.map((p) => (
                  <li key={p.name}>
                    {p.number ? `#${p.number} ` : ""}
                    {p.name}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-3 pt-1 justify-end">
              <button
                type="button"
                onClick={back}
                className="px-5 py-2.5 bg-surface border border-line text-ink-2 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-surface-2 transition-colors shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addPasted}
                disabled={locked || parsed.length === 0}
                className="px-5 py-2.5 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-md disabled:opacity-40 disabled:pointer-events-none"
                style={{ backgroundColor: primaryColor, color: tertiaryColor }}
              >
                Add {parsed.length || ""} player{parsed.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}
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
        {mode === "one" && justAdded && (
          <p role="status" className="text-[11px] font-bold text-win">
            Added {justAdded}. Next player:
          </p>
        )}
        {mode === "one" && (
          <>
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
                Players show your team logo. Set a number and primary position
                to tell them apart at a glance.
              </p>
            </div>
            <div>
              <label
                htmlFor={`${fieldId}-name`}
                className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
              >
                Name *
              </label>
              <input
                id={`${fieldId}-name`}
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
                  htmlFor={`${fieldId}-number`}
                  className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
                >
                  Number
                </label>
                <input
                  id={`${fieldId}-number`}
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
                <label
                  htmlFor={`${fieldId}-bats`}
                  className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
                >
                  Bats
                </label>
                <select
                  id={`${fieldId}-bats`}
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
                  htmlFor={`${fieldId}-throws`}
                  className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
                >
                  Throws
                </label>
                <select
                  id={`${fieldId}-throws`}
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
                type="button"
                onClick={saveAndNext}
                disabled={locked || !form.name.trim()}
                className="px-5 py-2.5 bg-surface border border-line text-ink font-black text-xs uppercase tracking-widest rounded-xl hover:bg-surface-2 transition-colors shadow-sm disabled:opacity-40 disabled:pointer-events-none"
              >
                Save &amp; add another
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
          </>
        )}
      </form>
    </PageShell>
  );
});
