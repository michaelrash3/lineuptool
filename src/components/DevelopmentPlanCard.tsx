import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam } from "../contexts";
import { getCombinedGrades } from "../lineupEngine";
import { getEvalCategoriesForPlayer } from "../constants/ui";
import { featureEnabled } from "../constants/features";
import {
  FOCUS_AREAS_CAP,
  focusAreaDeltas,
  suggestDrillsForFocus,
  suggestFocusAreas,
} from "../utils/developmentPlan";
import { formatGameDateDisplay } from "../utils/helpers";
import type {
  DevGoal,
  DrillDefinition,
  EvalCategoryId,
  Player,
  PlayerHealth,
} from "../types";

const INPUT_CLASS =
  "w-full p-2.5 bg-surface border border-line-strong rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-inner";

const HEALTH_OPTIONS: Array<{
  value: PlayerHealth["status"];
  label: string;
  chip: string;
}> = [
  { value: "healthy", label: "Healthy", chip: "bg-win-bg text-win" },
  { value: "limited", label: "Limited", chip: "bg-warn-bg text-warnfg" },
  { value: "out", label: "Out", chip: "bg-loss-bg text-loss" },
];

const GOAL_CYCLE: Record<DevGoal["status"], DevGoal["status"]> = {
  active: "achieved",
  achieved: "dropped",
  dropped: "active",
};

const GOAL_CHIP: Record<DevGoal["status"], string> = {
  active: "bg-surface-2 text-ink",
  achieved: "bg-win-bg text-win",
  dropped: "bg-surface-2 text-ink-3 line-through",
};

// The forward-looking half of a player's profile: coach-set health status
// (which gates game availability via isPlayerUnavailable), focus areas seeded
// from the weakest eval grades, goals, assigned drills from the team library,
// and dated progress check-ins. Editing follows the profile's canEdit gate;
// hidden entirely when the team turned the Development module off.
export const DevelopmentPlanCard = memo(
  ({ player, canEdit }: { player: Player; canEdit: boolean }) => {
    const {
      team,
      setPlayerHealth,
      updateDevPlan,
      addGoal,
      setGoalStatus,
      removeGoal,
      addCheckIn,
      toggleAssignedDrill,
    } = useTeam();
    const [goalText, setGoalText] = useState("");
    const [goalDate, setGoalDate] = useState("");
    const [checkInText, setCheckInText] = useState("");
    const [showAllCheckIns, setShowAllCheckIns] = useState(false);

    const categories = useMemo(
      () => getEvalCategoriesForPlayer(team.pitchingFormat, player),
      [team.pitchingFormat, player],
    );
    const labelOf = useMemo(
      () => new Map(categories.map((c) => [c.id, c.label])),
      [categories],
    );
    const grades = useMemo(() => {
      const all = getCombinedGrades(
        team.evaluationEvents || [],
        team.players || [],
        { teamAge: team.teamAge, games: team.games || [] },
      );
      return all?.[player.id] || null;
    }, [
      team.evaluationEvents,
      team.players,
      team.teamAge,
      team.games,
      player.id,
    ]);
    // First→last grade movement per focus area — the "is the focus working"
    // read-back, shown on the chips once two rounds have graded a category.
    const deltas = useMemo(
      () =>
        focusAreaDeltas(
          team.evaluationEvents || [],
          player.id,
          player.devPlan?.focusAreas,
        ),
      [team.evaluationEvents, player.id, player.devPlan?.focusAreas],
    );

    if (!featureEnabled(team, "development")) return null;

    const health = player.health;
    const status: PlayerHealth["status"] = health?.status || "healthy";
    const plan = player.devPlan || {};
    const focus = plan.focusAreas || [];
    const goals = plan.goals || [];
    const drillIds = plan.drillIds || [];
    const checkIns = plan.checkIns || [];
    const library: DrillDefinition[] = team.drillLibrary || [];
    const drillById = new Map(library.map((d) => [d.id, d]));

    const suggestedFocus = suggestFocusAreas(grades, categories);
    const suggestedDrills = suggestDrillsForFocus(library, focus, categories)
      .filter((d) => !drillIds.includes(d.id))
      .slice(0, 4);
    const visibleCheckIns = showAllCheckIns ? checkIns : checkIns.slice(0, 3);

    return (
      <div className="cc-card p-5">
        <h4 className="font-black text-xs uppercase tracking-widest text-ink mb-2 flex items-center gap-2">
          <Icons.TrendingUp className="w-4 h-4" /> Development Plan
        </h4>

        {/* Health status */}
        <div className="mb-4">
          <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
            Health
          </div>
          <div className="flex flex-wrap gap-1.5">
            {HEALTH_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={!canEdit}
                aria-pressed={status === o.value}
                onClick={() =>
                  setPlayerHealth(
                    player.id,
                    o.value === "healthy"
                      ? null
                      : { ...(health || {}), status: o.value },
                  )
                }
                className={`t-chip px-2.5 py-1 rounded-md border transition-colors ${
                  status === o.value
                    ? `${o.chip} border-line-strong`
                    : "bg-surface text-ink-3 border-line hover:bg-surface-2"
                } ${canEdit ? "cursor-pointer" : "cursor-default"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {status !== "healthy" && (
            <div className="mt-2 flex flex-col gap-2">
              {canEdit ? (
                <>
                  <input
                    type="text"
                    value={health?.note || ""}
                    maxLength={200}
                    placeholder="What happened? (optional)"
                    aria-label={`Health note for ${player.name}`}
                    onChange={(e) =>
                      setPlayerHealth(player.id, {
                        ...(health as PlayerHealth),
                        note: e.target.value,
                      })
                    }
                    className={INPUT_CLASS}
                  />
                  <label className="block">
                    <span className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1">
                      Expected return (optional)
                    </span>
                    <input
                      type="date"
                      value={health?.expectedReturn || ""}
                      aria-label={`Expected return date for ${player.name}`}
                      onChange={(e) =>
                        setPlayerHealth(player.id, {
                          ...(health as PlayerHealth),
                          expectedReturn: e.target.value || undefined,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </label>
                </>
              ) : (
                <p className="text-[11px] font-bold text-ink-2">
                  {health?.note || ""}
                  {health?.expectedReturn
                    ? ` Back ${formatGameDateDisplay(health.expectedReturn)}.`
                    : ""}
                </p>
              )}
              {status === "out" && (
                <p className="t-meta text-ink-3">
                  While Out, games default{" "}
                  {player.name?.split(" ")[0] || "them"} to absent{" "}
                  {health?.expectedReturn
                    ? `until ${formatGameDateDisplay(health.expectedReturn)}`
                    : "until you set them back to Healthy"}
                  .
                </p>
              )}
            </div>
          )}
        </div>

        {/* Focus areas */}
        <div className="mb-4">
          <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
            Focus Areas
          </div>
          <div className="flex flex-wrap gap-1.5">
            {focus.map((id) => {
              const d = deltas[id];
              const moved = d && d.first !== d.last;
              return (
                <span
                  key={id}
                  className="t-chip inline-flex items-center gap-1 px-2 py-1 rounded-md border border-line-strong bg-surface text-ink"
                >
                  {labelOf.get(id) || id}
                  {moved && (
                    <span
                      className={`tabular-nums font-black ${
                        d.last > d.first ? "text-win" : "text-loss"
                      }`}
                      title={`Graded ${d.first} on the first round, ${d.last} on the latest`}
                    >
                      {d.first}→{d.last}
                    </span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove focus ${labelOf.get(id) || id}`}
                      onClick={() =>
                        updateDevPlan(player.id, {
                          focusAreas: focus.filter((f) => f !== id),
                        })
                      }
                      className="text-ink-3 hover:text-loss leading-none"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
            {canEdit &&
              focus.length < FOCUS_AREAS_CAP &&
              suggestedFocus
                .filter((id) => !focus.includes(id))
                .slice(0, FOCUS_AREAS_CAP - focus.length)
                .map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      updateDevPlan(player.id, { focusAreas: [...focus, id] })
                    }
                    className="t-chip inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-line-strong text-ink-2 hover:bg-surface-2"
                    title="Suggested from the weakest eval grades"
                  >
                    <Icons.Plus className="w-3 h-3" />
                    {labelOf.get(id) || id}
                  </button>
                ))}
            {focus.length === 0 && suggestedFocus.length === 0 && (
              <span className="text-[11px] font-bold text-ink-3">
                Grade an eval round to get focus suggestions.
              </span>
            )}
          </div>
        </div>

        {/* Goals */}
        <div className="mb-4">
          <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
            Goals
          </div>
          {goals.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-2">
              {goals.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() =>
                      setGoalStatus(player.id, g.id, GOAL_CYCLE[g.status])
                    }
                    title={canEdit ? "Tap to cycle status" : g.status}
                    className={`t-chip px-2 py-0.5 rounded-md border border-line shrink-0 ${GOAL_CHIP[g.status]}`}
                  >
                    {g.status}
                  </button>
                  <span
                    className={`text-sm font-bold min-w-0 flex-1 ${
                      g.status === "dropped"
                        ? "text-ink-3 line-through"
                        : "text-ink"
                    }`}
                  >
                    {g.text}
                    {g.targetDate && (
                      <span className="text-ink-3 font-medium">
                        {" "}
                        · by {formatGameDateDisplay(g.targetDate)}
                      </span>
                    )}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove goal ${g.text}`}
                      onClick={() => removeGoal(player.id, g.id)}
                      className="p-1 text-ink-3 hover:text-loss rounded"
                    >
                      <Icons.X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canEdit && (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={goalText}
                maxLength={200}
                placeholder="e.g. Get the glove down on backhands"
                aria-label={`New goal for ${player.name}`}
                onChange={(e) => setGoalText(e.target.value)}
                className={INPUT_CLASS}
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={goalDate}
                  aria-label="Goal target date"
                  title="Target date (optional)"
                  onChange={(e) => setGoalDate(e.target.value)}
                  className={`${INPUT_CLASS} flex-1`}
                />
                <button
                  type="button"
                  disabled={!goalText.trim()}
                  aria-label={`Add goal for ${player.name}`}
                  onClick={() => {
                    addGoal(player.id, goalText, goalDate || undefined);
                    setGoalText("");
                    setGoalDate("");
                  }}
                  className="px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-opacity"
                  style={{
                    backgroundColor: "var(--team-primary)",
                    color: "var(--team-on-primary)",
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Assigned drills */}
        <div className="mb-4">
          <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
            Assigned Drills
          </div>
          <div className="flex flex-wrap gap-1.5">
            {drillIds.map((id) => (
              <span
                key={id}
                className="t-chip inline-flex items-center gap-1 px-2 py-1 rounded-md border border-line-strong bg-surface text-ink"
              >
                {drillById.get(id)?.name || "Removed drill"}
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Unassign drill ${drillById.get(id)?.name || id}`}
                    onClick={() => toggleAssignedDrill(player.id, id)}
                    className="text-ink-3 hover:text-loss leading-none"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {canEdit &&
              suggestedDrills.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleAssignedDrill(player.id, d.id)}
                  className="t-chip inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-line-strong text-ink-2 hover:bg-surface-2"
                  title="Suggested for the focus areas above"
                >
                  <Icons.Plus className="w-3 h-3" />
                  {d.name}
                </button>
              ))}
            {drillIds.length === 0 && suggestedDrills.length === 0 && (
              <span className="text-[11px] font-bold text-ink-3">
                Pick focus areas to see matching drills from your library.
              </span>
            )}
          </div>
        </div>

        {/* Check-ins */}
        <div>
          <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
            Check-ins
          </div>
          {canEdit && (
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={checkInText}
                maxLength={500}
                placeholder="How's it going?"
                aria-label={`New check-in for ${player.name}`}
                onChange={(e) => setCheckInText(e.target.value)}
                className={`${INPUT_CLASS} flex-1`}
              />
              <button
                type="button"
                disabled={!checkInText.trim()}
                aria-label={`Add check-in for ${player.name}`}
                onClick={() => {
                  addCheckIn(player.id, checkInText);
                  setCheckInText("");
                }}
                className="px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-opacity"
                style={{
                  backgroundColor: "var(--team-primary)",
                  color: "var(--team-on-primary)",
                }}
              >
                Log
              </button>
            </div>
          )}
          {visibleCheckIns.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {visibleCheckIns.map((c) => (
                <div key={c.id} className="text-[11px] leading-snug">
                  <span className="font-black text-ink-3 uppercase tracking-widest tabular-nums">
                    {formatGameDateDisplay(c.date)}
                  </span>{" "}
                  <span className="font-bold text-ink-2">{c.note}</span>
                </div>
              ))}
              {checkIns.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllCheckIns((s) => !s)}
                  className="self-start text-[11px] font-black uppercase tracking-widest text-ink-3 hover:text-ink"
                >
                  {showAllCheckIns
                    ? "Show fewer"
                    : `Show all ${checkIns.length}`}
                </button>
              )}
            </div>
          ) : (
            !canEdit && (
              <span className="text-[11px] font-bold text-ink-3">
                No check-ins yet.
              </span>
            )
          )}
        </div>
      </div>
    );
  },
);
