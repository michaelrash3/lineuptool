import React, { useState } from "react";
import { Icons } from "../../icons";
import { PlayerNameLink } from "../PlayerNameLink";
import type { PitcherAvailability, PitchRuleSet } from "../../lineupEngine";
import {
  planEntryStatus,
  plannedPitchesOf,
  type PlanViolation,
  type UnavailableArm,
} from "../../utils/tournamentPitching";
import type { Game, PlannedOuting, Player } from "../../types";

// Inline "+ Add arm" editor for one game's pitching plan: pick a cleared
// pitcher, start/relief, and an optional pitch budget (blank = the age daily
// max, the conservative default so later games never over-promise).
//
// The pitch-count field shows the SELECTED arm's pitches left for that date —
// on the back half of a doubleheader that is the daily max minus whatever the
// opener already spent, so the coach plans against the real remainder.
const AddArmRow = ({
  pitchers,
  taken,
  dailyMax,
  armById,
  unavailableById,
  onAdd,
  onCancel,
}: {
  pitchers: Player[];
  taken: Set<string>;
  dailyMax: number;
  armById: Map<string, PitcherAvailability>;
  unavailableById: Map<string, UnavailableArm>;
  onAdd: (entry: PlannedOuting) => void;
  onCancel: () => void;
}) => {
  // Arms who can be there come first, and are what the picker opens on. One
  // who is out stays in the list, labelled — the coach may know something
  // the profile doesn't — but adding them raises the warning below.
  const available = pitchers
    .filter((p) => !taken.has(p.id))
    .sort(
      (a, b) =>
        Number(unavailableById.has(a.id)) - Number(unavailableById.has(b.id)),
    );
  const [playerId, setPlayerId] = useState(available[0]?.id || "");
  const [role, setRole] = useState<"start" | "relief">("start");
  const [budget, setBudget] = useState("");
  const arm = armById.get(playerId);
  const left = arm ? arm.remainingToday : dailyMax;
  const spentToday = arm?.pitchedToday || 0;

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
            {unavailableById.has(p.id)
              ? ` — out (${unavailableById.get(p.id)!.reason})`
              : p.health?.status === "limited"
                ? " — limited"
                : ""}
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
        placeholder={`${left}p`}
        aria-label="Planned pitches"
        title={
          spentToday > 0
            ? `Planned pitch budget — ${spentToday} already on this day, ${left} of the ${dailyMax}-pitch daily max left`
            : `Planned pitch budget (blank = daily max ${dailyMax})`
        }
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
        className="tap-h t-chip px-3 py-1.5 rounded-lg font-black uppercase tracking-widest"
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
        className="tap-h t-chip px-3 py-1.5 rounded-lg font-black uppercase tracking-widest bg-surface border border-line text-ink-2 hover:bg-surface-2"
      >
        Cancel
      </button>
    </div>
  );
};

export interface PitchPlanGameBodyProps {
  game: Game;
  entries: PlannedOuting[];
  // Cleared pitchers who can be there, and (separately) those who can't —
  // out injured or away on the game's date. See assessGamesPlan.
  arms: PitcherAvailability[];
  unavailable: UnavailableArm[];
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
  unavailable,
  violations,
  teamAge,
  ruleSet,
  dailyMax,
  pitchers,
  playerById,
  canEdit,
  onSetEntries,
}: PitchPlanGameBodyProps) => {
  const [adding, setAdding] = useState(false);
  // Only known players count as "taken" — an orphaned entry (its player since
  // removed) must not block re-adding a real arm.
  const taken = new Set(
    entries.map((e) => e.playerId).filter((pid) => playerById.has(pid)),
  );
  const ready = arms.filter((a) => a.status === "ready");
  const resting = arms.filter((a) => a.status === "resting");
  const maxed = arms.filter((a) => a.status === "maxed");
  const armById = new Map(arms.map((a) => [a.id, a]));
  const unavailableById = new Map(unavailable.map((u) => [u.id, u]));
  // "Limited" never rules a kid out, but on a pitching plan it is exactly
  // what the coach wants in front of them (often it IS "no pitching").
  const limitedNote = (id: string): string | null => {
    const health = playerById.get(id)?.health;
    return health?.status === "limited" ? health.note || "Limited" : null;
  };

  return (
    <>
      {/* Planned outings */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {entries.map((entry) => {
          const p = playerById.get(entry.playerId);
          if (!p) return null;
          const consumed = planEntryStatus(entry, game, p) === "consumed";
          // Not via unavailableById: that only covers cleared pitchers, and
          // the violation list already speaks for whoever is in the plan.
          const isOut =
            !consumed &&
            violations.some(
              (v) => v.playerId === entry.playerId && v.kind === "unavailable",
            );
          const label = `${p.number ? `#${p.number} ` : ""}${p.name} · ${
            entry.role === "start" ? "start" : "relief"
          } · ${plannedPitchesOf(entry, teamAge, ruleSet)}p`;
          return (
            <span
              key={entry.playerId}
              className={`t-chip inline-flex items-center gap-1 px-2 py-1 rounded-md border whitespace-nowrap ${
                consumed
                  ? "bg-surface-2 border-line text-ink-3"
                  : isOut
                    ? "bg-loss-bg border-line text-loss"
                    : "bg-surface border-line-strong text-ink"
              }`}
              title={
                consumed
                  ? "Logged — the imported box score now carries this outing."
                  : isOut
                    ? "Planned, but not available for this game"
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
                  className="tap ml-0.5 text-ink-3 hover:text-loss leading-none"
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
          armById={armById}
          unavailableById={unavailableById}
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

      {/* Arms remaining with earlier planned outings deducted. An arm that
          already worked earlier THIS date (the front half of a doubleheader,
          logged or planned) stays available and carries its remaining count —
          the day is one shared budget, not one appearance. */}
      <div className="mt-3">
        <div className="t-eyebrow text-ink-3 mb-1.5">Arms for this game</div>
        {ready.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {ready.map((a) => (
              <PlayerNameLink
                key={a.id}
                playerId={a.id}
                className="t-chip px-2 py-0.5 rounded-md border bg-win-bg border-line text-win hover:bg-surface-2 transition-colors whitespace-nowrap"
                title={
                  a.pitchedToday > 0
                    ? `${a.pitchedToday} already thrown or planned this day — up to ${a.remainingToday} more of the ${a.maxPitches}-pitch daily max`
                    : `Up to ${a.remainingToday} pitches`
                }
              >
                {a.number ? `#${a.number} ` : ""}
                {a.name}
                {a.pitchedToday > 0 && (
                  <span className="tabular-nums">{` · ${a.remainingToday} left`}</span>
                )}
                {limitedNote(a.id) && (
                  <span
                    className="text-warnfg"
                    title={`Limited: ${limitedNote(a.id)}`}
                  >
                    {" · limited"}
                  </span>
                )}
              </PlayerNameLink>
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
              <PlayerNameLink
                key={a.id}
                playerId={a.id}
                className="t-chip px-2 py-0.5 rounded-md border bg-warn-bg border-line text-warnfg hover:bg-surface-2 transition-colors whitespace-nowrap"
                title="Resting (planned or logged workload)"
              >
                {a.number ? `#${a.number} ` : ""}
                {a.name}
                {a.daysUntilReady ? ` · ${a.daysUntilReady}d` : ""}
              </PlayerNameLink>
            ))}
          </div>
        )}
        {maxed.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {maxed.map((a) => (
              <PlayerNameLink
                key={a.id}
                playerId={a.id}
                className="t-chip px-2 py-0.5 rounded-md border bg-loss-bg border-line text-loss hover:bg-surface-2 transition-colors whitespace-nowrap"
                title={`${a.pitchedToday} pitches already on this date — the ${a.maxPitches}-pitch daily max is spent`}
              >
                {a.number ? `#${a.number} ` : ""}
                {a.name} · day maxed
              </PlayerNameLink>
            ))}
          </div>
        )}
        {/* Rested or not, these arms won't be there: out injured, or marked
            away that day. Shown so the coach sees WHY a pitcher is missing
            from the list above instead of wondering where he went. */}
        {unavailable.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="t-eyebrow text-ink-3">Out</span>
            {unavailable.map((u) => (
              <PlayerNameLink
                key={u.id}
                playerId={u.id}
                className="t-chip px-2 py-0.5 rounded-md border bg-surface-2 border-line text-ink-3 hover:bg-surface transition-colors whitespace-nowrap"
                title={
                  u.reason === "injured"
                    ? `Out injured — ${u.detail}`
                    : "Marked away on this date"
                }
              >
                {u.number ? `#${u.number} ` : ""}
                {u.name}
                {u.reason === "injured" ? ` · injured, ${u.detail}` : " · away"}
              </PlayerNameLink>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
