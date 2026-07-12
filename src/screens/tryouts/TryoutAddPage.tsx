import React, { memo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTeam, useToast } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { nextTryoutNumber } from "../../utils/tryouts";
import type { TryoutSignup } from "../../types";

// /tryouts/add — coach walk-up entry: a kid shows up without registering
// through the portal. The coach adds them on the spot; a tryout number is
// stamped automatically (next free number in that date's pool) and they're
// marked present since they're physically here. Converted from the
// TryoutsTab add dialog per the app-wide modals→pages rule.
const BLANK_FORM = {
  firstName: "",
  lastName: "",
  dob: "",
  tryoutDate: "",
  parentName: "",
  phone: "",
  notes: "",
};

export const TryoutAddPage = memo(() => {
  const { team, currentRole, appendTryoutSignup } = useTeam();
  const toast = useToast();
  const back = useBackOrFallback("/tryouts");
  const [form, setForm] = useState(BLANK_FORM);

  if (currentRole === "assistant") {
    return <Navigate to="/tryouts" replace />;
  }

  const tryoutSignups: TryoutSignup[] = team.tryoutSignups || [];

  const submit = () => {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    if (!firstName || !lastName) {
      toast.push({ kind: "warn", title: "First and last name are required" });
      return;
    }
    const tryoutDate = form.tryoutDate || undefined;
    const tryoutNumber = nextTryoutNumber(tryoutSignups, tryoutDate);
    appendTryoutSignup?.({
      firstName,
      lastName,
      dob: form.dob || undefined,
      tryoutDate,
      parentName: form.parentName.trim() || undefined,
      phone: form.phone.trim() || undefined,
      notes: form.notes.trim() || undefined,
      // Walk-ups are physically here — mark present and number them now.
      present: true,
      tryoutNumber,
    });
    toast.push({
      kind: "success",
      title: `${firstName} ${lastName} added`,
      message: `Tryout number #${tryoutNumber}`,
    });
    back();
  };

  return (
    <PageShell eyebrow="Tryouts" title="Add tryout player" onBack={back}>
      <div className="cc-card p-5 space-y-3">
        <p className="text-xs text-ink-3 font-medium">
          For walk-ups who didn't register through the portal. A tryout number
          is assigned automatically.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={form.firstName}
            onChange={(e) =>
              setForm((f) => ({ ...f, firstName: e.target.value }))
            }
            placeholder="First name *"
            aria-label="First name"
            className="px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
          />
          <input
            type="text"
            value={form.lastName}
            onChange={(e) =>
              setForm((f) => ({ ...f, lastName: e.target.value }))
            }
            placeholder="Last name *"
            aria-label="Last name"
            className="px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">
              Date of birth
            </span>
            <input
              type="date"
              value={form.dob}
              onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
              aria-label="Date of birth"
              className="w-full px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">
              Tryout date
            </span>
            <select
              value={form.tryoutDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, tryoutDate: e.target.value }))
              }
              aria-label="Tryout date"
              className="w-full px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
            >
              <option value="">No date</option>
              {(team.tryoutDates || []).map((d: string) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={form.parentName}
            onChange={(e) =>
              setForm((f) => ({ ...f, parentName: e.target.value }))
            }
            placeholder="Parent name"
            aria-label="Parent name"
            className="px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
          />
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="Parent phone"
            aria-label="Parent phone"
            className="px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
          />
        </div>
        <input
          type="text"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Notes (positions, where they came from…)"
          aria-label="Notes"
          className="w-full px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={back}
            className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-surface-2 hover:bg-line text-ink rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl shadow-sm"
            style={{
              backgroundColor: "var(--team-primary)",
              color: "var(--team-on-primary)",
            }}
          >
            Add Player
          </button>
        </div>
      </div>
    </PageShell>
  );
});
