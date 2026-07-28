import React, { useState } from "react";
import { Icons } from "../../icons";
import { useUI } from "../../contexts";
import type { PitcherAvailability, PitchRuleSet } from "../../lineupEngine";
import {
  planEntryStatus,
  plannedPitchesOf,
  type PlanViolation,
} from "../../utils/tournamentPitching";
import type { Game, PlannedOuting, Player } from "../../types";

// Inline "+ Add arm" editor for one game's pitching plan: pick a cleared
// pitcher, start/relief, and an optional pitch budget (blank = the age daily
// max, the conservative default so later games never over-promise).
const AddArmRow = ({
  pitchers,
  taken,
  dailyMax,
  onAdd,
  onCancel,
}: {
  pitchers: Player[];
  taken: Set<string>;
  dailyMax: number;
  onAdd: (entry: PlannedOuting) => void;
  onCancel: () => void;
}) => {
  const available = pitchers.filter((p) => !taken.has(p.id));
  const [playerId, setPlayerId] = useState(available[0]?.id || "");
  const [role, setRole] = useState<"start" | "relief">("start");
  const [budget, setBudget] = useState("");

  if (available.length === 0)
    return (
      <div className="mt-2 text-[11px] font-bold text-ink-3">
        Every cleared pitcher is already in this game's plan.
        <button
          type="button"
          onClick={onCancel}
          className="ml-2 underline text-ink-2"
        >
          Close
        </button>
      </div>
    );

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={playerId}
        onChange={(e) => setPlayerId(e.target.value)}
        aria-label="Pitcher"
        className="p-1.5 bg-surface border border-line rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer"
      >
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.number ? `#${p.number} ` : ""}
            {p.name}
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as "start" | "relief")}
        aria-label="Role"
        className="p-1.5 bg-surface border border-line rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer"
      >
        <option value="start">Start</option>
        <option value="relief">Relief</option>
      </select>
      <input
        type="number"
        min="1"
        inputMode="numeric"
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        placeholder={`${dailyMax}p`}
        aria-label="Planned pitches"
        title={`Planned pitch budget (blank = daily max ${dailyMax})`}
        className="w-20 p-1.5 bg-surface border border-line rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] tabular-nums"
      />
      <button
        type="button"
        onClick={() => {
          if (!playerId) return;
          const n = parseInt(budget, 10);
          const entry: PlannedOuting = { playerId, role };
          if (Number.isFinite(n) && n > 0) entry.plannedPitches = n;
          onAdd(entry);
        }}
        className="t-chip px-3 py-1.5 rounded-lg font-black uppercase tracking-widest"
        style={{
          backgroundColor: "var(--team-primary)",
          color: "var(--team-on-primary)",
        }}
      >
        Add
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="t-chip px-3 py-1.5 rounded-lg font-black uppercase tracking-widest bg-surface border border-line text-ink-2 hover:bg-surface-2"
      >
        Cancel
      </button>
    </div>
  );
};

export interface PitchPlanGameBodyProps {
  game: Game;
  entries: PlannedOuting[];
  arms: PitcherAvailability[];
  violations: PlanViolation[];
  teamAge: string;
  ruleSet: PitchRuleSet;
  dailyMax: number;
  // Roster arms offered by the Add row (players with P comfort).
  pitchers: Player[];
  playerById: Map<string, Player>;
  canEdit: boolean;
  // Replace this game's planned outings wherever they live (tournament
  // pitchPlan or game.pitchPlan — the host decides).
  onSetEntries: (next: PlannedOuting[]) => void;
}

// One game's pitching-plan block: planned-outing chips (greyed once reality
// logs them), the add-arm editor, this game's rule violations, and the
// arms-remaining view with every earlier planned outing already deducted.
// Shared verbatim between the tournament panel and the week planner so the
// two surfaces render the same plan identically.
export const PitchPlanGameBody = ({
  game,
  entries,
  arms,
  violations,
  teamAge,
  ruleSet,
  dailyMax,
  pitchers,
  playerById,
  canEdit,
  onSetEntries,
}: PitchPlanGameBodyProps) => {
  const { openPlayerProfile } = useUI();
  const [adding, setAdding] = useState(false);
  // Only known players count as "taken" — an orphaned entry (its player since
  // removed) must not block re-adding a real arm.
  const taken = new Set(
    entries.map((e) => e.playerId).filter((pid) => playerById.has(pid)),
  );
  const ready = arms.filter((a) => a.status === "ready");
  const resting = arms.filter((a) => a.status === "resting");
  const maxed = arms.filter((a) => a.status === "maxed");

  return (
    <>
      {/* Planned outings */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {entries.map((entry) => {
          const p = playerById.get(entry.playerId);
          if (!p) return null;
          const consumed = planEntryStatus(entry, game, p) === "consumed";
          const label = `${p.number ? `#${p.number} ` : ""}${p.name} · ${
            entry.role === "start" ? "start" : "relief"
          } · ${plannedPitchesOf(entry, teamAge, ruleSet)}p`;
          return (
            <span
              key={entry.playerId}
              className={`t-chip inline-flex items-center gap-1 px-2 py-1 rounded-md border whitespace-nowrap ${
                consumed
                  ? "bg-surface-2 border-line text-ink-3"
                  : "bg-surface border-line-strong text-ink"
              }`}
              title={
                consumed
                  ? "Logged — the imported box score now carries this outing."
                  : "Planned outing"
              }
            >
              {consumed && <span aria-hidden="true">✓</span>}
              {label}
              {consumed && (
                <span className="uppercase tracking-widest text-[9px]">
                  logged
                </span>
              )}
              {canEdit && !consumed && (
                <button
                  type="button"
                  onClick={() =>
                    onSetEntries(
                      entries.filter((e) => e.playerId !== entry.playerId),
                    )
                  }
                  aria-label={`Remove ${p.name} from this game's plan`}
                  className="ml-0.5 text-ink-3 hover:text-loss leading-none"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="t-chip inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-line-strong text-ink-2 hover:bg-surface-2 whitespace-nowrap"
          >
            <Icons.Plus className="w-3 h-3" /> Add arm
          </button>
        )}
        {entries.length === 0 && !canEdit && (
          <span className="text-[11px] font-bold text-ink-3">
            No arms planned yet.
          </span>
        )}
      </div>
      {canEdit && adding && (
        <AddArmRow
          pitchers={pitchers}
          taken={taken}
          dailyMax={dailyMax}
          onAdd={(entry) => {
            onSetEntries([...entries, entry]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Rule violations for this game's own plan */}
      {violations.map((v) => (
        <div
          key={`${v.playerId}-${v.kind}`}
          className="mt-2 px-3 py-2 rounded-lg bg-loss-bg border border-line text-loss text-[11px] font-bold flex items-center gap-2"
          role="alert"
        >
          <Icons.Alert className="w-3.5 h-3.5 shrink-0" />
          {v.message}
        </div>
      ))}

      {/* Arms remaining with earlier planned outings deducted */}
      <div className="mt-3">
        <div className="t-eyebrow text-ink-3 mb-1.5">Arms for this game</div>
        {ready.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {ready.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openPlayerProfile(a.id)}
                className="t-chip px-2 py-0.5 rounded-md border bg-win-bg border-line text-win hover:bg-surface-2 transition-colors whitespace-nowrap"
                title={`Up to ${a.maxPitches} pitches`}
              >
                {a.number ? `#${a.number} ` : ""}
                {a.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[11px] font-bold text-loss">
            No rested arms for this game under the current plan.
          </div>
        )}
        {resting.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {resting.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openPlayerProfile(a.id)}
                className="t-chip px-2 py-0.5 rounded-md border bg-warn-bg border-line text-warnfg hover:bg-surface-2 transition-colors whitespace-nowrap"
                title="Resting (planned or logged workload)"
              >
                {a.number ? `#${a.number} ` : ""}
                {a.name}
                {a.daysUntilReady ? ` · ${a.daysUntilReady}d` : ""}
              </button>
            ))}
          </div>
        )}
        {maxed.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {maxed.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openPlayerProfile(a.id)}
                className="t-chip px-2 py-0.5 rounded-md border bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors whitespace-nowrap"
                title="At the pitch ceiling until their next recorded outing"
              >
                {a.number ? `#${a.number} ` : ""}
                {a.name} · at limit
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
