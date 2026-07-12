import React, { memo, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { DEFAULT_DRILL_LIBRARY } from "../../constants/ui";
import { featureEnabled } from "../../constants/features";
import { drillAssignmentIndex } from "../../utils/developmentPlan";
import { isDepartedPlayer } from "../../utils/helpers";
import {
  buildTeamSkillProfile,
  generatePracticePlan,
  describeEmphasis,
} from "../../utils/practicePlanner";
import type { DrillDefinition } from "../../types";

// /practices/:practiceId/plan — the Smart Practice Planner as a routed page.
// Proposes a time-budgeted agenda weighted to the team's weakest eval areas,
// drawn from the drill library; the coach picks a length, eyeballs the
// preview, and applies it to the practice. Converted from the
// PracticePlannerModal per the app-wide modals→pages rule.
const PLAN_LENGTHS = [60, 75, 90, 105, 120];

export const PracticePlanPage = memo(() => {
  const { practiceId } = useParams();
  const { team, currentRole, updatePractice } = useTeam();
  const back = useBackOrFallback("/practices");
  const [minutes, setMinutes] = useState(90);
  // Reshuffle counter — each bump pulls a different drill per category when
  // the library has options, so a coach can vary the agenda week to week.
  const [variation, setVariation] = useState(0);

  const practice = (team.practices || []).find((p: any) => p.id === practiceId);

  // Team-wide weak-area signal (latest eval round).
  const skillProfile = useMemo(
    () => buildTeamSkillProfile(team),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [team.evaluationEvents],
  );
  // Older teams have no stored drillLibrary; fall back to the seed so the
  // planner is never empty.
  const library: DrillDefinition[] = useMemo(() => {
    const lib = team.drillLibrary;
    return Array.isArray(lib) && lib.length > 0 ? lib : DEFAULT_DRILL_LIBRARY;
  }, [team.drillLibrary]);
  // Drill ids assigned on players' development plans — preferred by the
  // generator so assigned homework actually lands on the agenda.
  const assignedDrillIds = useMemo(() => {
    if (!featureEnabled(team, "development")) return undefined;
    const players = (team.players || []).filter(
      (p: any) => p && p.inactive !== true && !isDepartedPlayer(p),
    );
    return new Set(Object.keys(drillAssignmentIndex(players)));
  }, [team]);

  const env: "indoor" | "outdoor" =
    practice?.environment === "indoor" ? "indoor" : "outdoor";
  const plan = useMemo(
    () =>
      generatePracticePlan({
        profile: skillProfile,
        minutes,
        environment: env,
        library,
        pitchingFormat: team.pitchingFormat,
        variation,
        assignedDrillIds,
      }),
    [
      skillProfile,
      minutes,
      env,
      library,
      team.pitchingFormat,
      variation,
      assignedDrillIds,
    ],
  );

  if (currentRole === "assistant" || !practice) {
    return <Navigate to="/practices" replace />;
  }

  const drills = Array.isArray(practice.drills) ? practice.drills : [];
  const existingCount = drills.length;
  const total = plan.reduce((s, d) => s + (Number(d.minutes) || 0), 0);
  // Plan entries don't carry the (long) description — look it up from the
  // library so the preview can show it on hover without bloating the agenda.
  const drillById = new Map((library || []).map((d) => [d.id, d]));

  const apply = () => {
    updatePractice(practice.id, { drills: plan });
    back();
  };

  return (
    <PageShell
      eyebrow="Smart Planner"
      title="Build a practice plan"
      onBack={back}
    >
      <div className="cc-card p-5">
        <p className="t-body mb-4">{describeEmphasis(skillProfile)}</p>

        <span className="t-eyebrow text-ink-3 block mb-1.5">
          Practice length
        </span>
        <div className="flex flex-wrap gap-2 mb-5">
          {PLAN_LENGTHS.map((m) => {
            const active = m === minutes;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={`px-3 py-2 text-xs font-black uppercase tracking-widest rounded-sm border transition-colors ${
                  active
                    ? "border-transparent text-white"
                    : "bg-surface border-line text-ink-2 hover:text-ink"
                }`}
                style={
                  active
                    ? { backgroundColor: "var(--team-primary)" }
                    : undefined
                }
              >
                {m} min
              </button>
            );
          })}
        </div>

        {plan.length === 0 ? (
          <p className="t-body text-ink-3 italic">
            Your drill library has nothing tagged for an {env} practice — add a
            few drills to the library and try again.
          </p>
        ) : (
          <>
            <div className="border border-line rounded-sm divide-y divide-line">
              {plan.map((d, i) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 px-3 py-2"
                  title={
                    drillById.get(d.libraryId || "")?.description || undefined
                  }
                >
                  <span className="t-stat-num-sm text-ink-3 w-6 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block t-body-bold text-ink truncate">
                      {d.name}
                    </span>
                    {d.category && (
                      <span className="t-chip text-ink-3">{d.category}</span>
                    )}
                  </span>
                  <span className="t-stat-num-sm text-ink tabular-nums shrink-0">
                    {d.minutes}m
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 px-1 gap-2">
              <button
                type="button"
                onClick={() => setVariation((v) => v + 1)}
                className="t-eyebrow text-ink-2 hover:text-ink flex items-center gap-1.5 transition-colors"
              >
                <Icons.Refresh className="w-3.5 h-3.5" /> Reshuffle
              </button>
              <span className="t-eyebrow text-ink-3 truncate">
                {plan.length} blocks · {env}
              </span>
              <span className="t-body-bold text-ink tabular-nums">
                {total} min
              </span>
            </div>
            {existingCount > 0 && (
              <p className="t-meta text-warnfg mt-3">
                Applying replaces the {existingCount} drill
                {existingCount === 1 ? "" : "s"} already on this practice.
              </p>
            )}
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={back}
            className="px-5 py-2.5 bg-surface border border-line text-ink font-black text-xs uppercase tracking-widest rounded-sm hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={plan.length === 0}
            onClick={apply}
            className="btn-premium px-5 py-2.5 rounded-sm text-xs font-black uppercase tracking-widest disabled:opacity-50"
            style={{ color: "var(--team-on-primary)" }}
          >
            {existingCount > 0
              ? `Replace ${existingCount} drill${existingCount === 1 ? "" : "s"}`
              : "Apply to practice"}
          </button>
        </div>
      </div>
    </PageShell>
  );
});
