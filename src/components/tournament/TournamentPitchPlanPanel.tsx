import React, { memo, useMemo, useState } from "react";
import { Icons } from "../../icons";
import { useTeam, useUI } from "../../contexts";
import { maxPitchesForAge, resolvePitchRuleSet } from "../../lineupEngine";
import {
  assessTournamentPlan,
  planEntryStatus,
  plannedPitchesOf,
} from "../../utils/tournamentPitching";
import { formatGameDateDisplay } from "../../utils/helpers";
import type { Game, PlannedOuting, Player, Tournament } from "../../types";

const ageNumOf = (age: string | undefined): number => {
  const nums = (age || "").match(/\d+/g);
  if (!nums || nums.length === 0) return 8;
  return parseInt(nums[nums.length - 1], 10);
};

// Inline "+ Add arm" editor for one tournament game: pick a cleared pitcher,
// start/relief, and an optional pitch budget (blank = the age daily max, the
// conservative default so later games never over-promise).
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

// The cross-game pitching plan for one stored tournament: per game, the
// planned outings (greyed once reality logs them), rule violations, and the
// arms-remaining view where every EARLIER game's plan is already deducted —
// the fix for "the ace shows ready for all three weekend games". Only
// rendered for Kid-Pitch 9U+ teams (pitch limits don't exist elsewhere).
// Heads edit; assistants read.
export const TournamentPitchPlanPanel = memo(
  ({ tournament }: { tournament: Tournament }) => {
    const { team, currentRole, setPlannedOutings } = useTeam();
    const { openPlayerProfile } = useUI();
    const { players, games, teamAge, pitchingFormat } = team;
    const canEdit = currentRole === "head";
    const [addingFor, setAddingFor] = useState<string | null>(null);

    const applies = /kid/i.test(pitchingFormat || "") && ageNumOf(teamAge) >= 9;
    const ruleSet = useMemo(() => resolvePitchRuleSet(team), [team]);

    const assessments = useMemo(
      () =>
        applies
          ? assessTournamentPlan({
              tournament,
              games: games || [],
              players: players || [],
              teamAge,
              ruleSet,
            })
          : [],
      [applies, tournament, games, players, teamAge, ruleSet],
    );

    if (!applies || assessments.length === 0) return null;

    const dailyMax = maxPitchesForAge(teamAge, ruleSet);
    const playerById = new Map<string, Player>(
      (players || []).map((p: Player) => [p.id, p]),
    );
    const gameById = new Map<string, Game>(
      (games || []).map((g: Game) => [g.id, g]),
    );
    const pitchers = (players || []).filter(
      (p: Player) =>
        Array.isArray(p.comfortablePositions) &&
        p.comfortablePositions.includes("P"),
    );

    return (
      <div className="border-t border-line">
        <div className="px-4 pt-3 flex items-center gap-2">
          <h4 className="t-eyebrow text-ink-2">Weekend Pitching Plan</h4>
          <span
            className="t-chip px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "var(--team-primary-15)",
              color: "var(--team-ink)",
            }}
            title="Planned pitches in earlier games count against daily max and rest rules for every later game."
          >
            cross-game
          </span>
        </div>
        <div className="divide-y divide-line">
          {assessments.map(({ gameId, arms, violations }) => {
            const game = gameById.get(gameId);
            if (!game) return null;
            const entries = tournament.pitchPlan?.[gameId] || [];
            // Only known players count as "taken" — an orphaned entry (its
            // player since removed) must not block re-adding a real arm.
            const taken = new Set(
              entries
                .map((e) => e.playerId)
                .filter((pid) => playerById.has(pid)),
            );
            const ready = arms.filter((a) => a.status === "ready");
            const resting = arms.filter((a) => a.status === "resting");
            const maxed = arms.filter((a) => a.status === "maxed");

            return (
              <div key={gameId} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-ink text-sm">
                    {game.opponent ? `vs ${game.opponent}` : "Game"}
                    <span className="text-ink-3 font-medium">
                      {" · "}
                      {formatGameDateDisplay(game.date)}
                    </span>
                  </div>
                  <span className="t-eyebrow text-ink-3 whitespace-nowrap">
                    {ready.length} ready
                  </span>
                </div>

                {/* Planned outings */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {entries.map((entry) => {
                    const p = playerById.get(entry.playerId);
                    if (!p) return null;
                    const consumed =
                      planEntryStatus(entry, game, p) === "consumed";
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
                              setPlannedOutings(
                                tournament.id,
                                gameId,
                                entries.filter(
                                  (e) => e.playerId !== entry.playerId,
                                ),
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
                  {canEdit && addingFor !== gameId && (
                    <button
                      type="button"
                      onClick={() => setAddingFor(gameId)}
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
                {canEdit && addingFor === gameId && (
                  <AddArmRow
                    pitchers={pitchers}
                    taken={taken}
                    dailyMax={dailyMax}
                    onAdd={(entry) => {
                      setPlannedOutings(tournament.id, gameId, [
                        ...entries,
                        entry,
                      ]);
                      setAddingFor(null);
                    }}
                    onCancel={() => setAddingFor(null)}
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
                  <div className="t-eyebrow text-ink-3 mb-1.5">
                    Arms for this game
                  </div>
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
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
