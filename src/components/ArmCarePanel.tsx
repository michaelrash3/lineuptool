import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import {
  analyzePitchingWorkload,
  buildPitchingPlan,
  resolvePitchRuleSet,
  type PitcherAvailability,
} from "../lineupEngine";
import { getLocalDateString, isKidPitchFormat } from "../constants/ui";
import { Sparkline } from "./charts/Sparkline";
import { pitchOutingSeries } from "../utils/pitchingWorkload";

// Current rest standing for a pitcher, as a small color-coded chip.
const availabilityChip = (avail: PitcherAvailability) => {
  if (avail.status === "ready") {
    return (
      <span className="t-chip px-1.5 py-0.5 rounded-md border bg-win-bg border-line text-win text-[10px] font-black">
        Ready
      </span>
    );
  }
  if (avail.status === "maxed") {
    return (
      <span className="t-chip px-1.5 py-0.5 rounded-md border bg-loss-bg border-loss text-loss text-[10px] font-black">
        At limit
      </span>
    );
  }
  return (
    <span className="t-chip px-1.5 py-0.5 rounded-md border bg-warn-bg border-line text-warnfg text-[10px] font-black tabular-nums">
      Rest {avail.daysUntilReady ?? "?"}d
    </span>
  );
};

// Roster-tab arm-care dashboard: season workload per pitcher + overuse flags
// (pitched several days running, came back on short rest). Kid Pitch + head
// coach only; hidden until at least one pitcher has logged an outing. The
// numbers come straight from each player's pitching.log, rule-set aware.
export const ArmCarePanel = memo(() => {
  const { team, currentRole } = useTeam();
  const { openPlayerProfile } = useUI();
  const { players, pitchingFormat, teamAge } = team as any;
  const eligible = currentRole === "head" && isKidPitchFormat(pitchingFormat);
  const ruleSet = useMemo(() => resolvePitchRuleSet(team), [team]);
  const today = getLocalDateString();

  const rows = useMemo(() => {
    if (!eligible) return [];
    // Rest/eligibility standing as of today, joined onto each pitcher.
    const planById = new Map(
      buildPitchingPlan(players, today, teamAge, ruleSet).map((a) => [a.id, a]),
    );
    return ((players || []) as any[])
      .filter(
        (p) =>
          Array.isArray(p.comfortablePositions) &&
          p.comfortablePositions.includes("P"),
      )
      .map((p) => ({
        p,
        w: analyzePitchingWorkload(p.pitching, ruleSet),
        avail: planById.get(p.id),
        series: pitchOutingSeries(p.pitching),
      }))
      .filter((r) => r.w.outings > 0)
      .sort((a, b) => {
        const aFlag = a.w.alerts.length > 0 ? 1 : 0;
        const bFlag = b.w.alerts.length > 0 ? 1 : 0;
        if (aFlag !== bFlag) return bFlag - aFlag;
        return b.w.last7 - a.w.last7;
      });
  }, [eligible, players, ruleSet, teamAge, today]);

  if (!eligible || rows.length === 0) return null;

  const flagged = rows.filter((r) => r.w.alerts.length > 0).length;

  return (
    <div className="cc-card mb-6">
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
      <div className="p-5 border-b border-line bg-surface flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-full"
            style={{ backgroundColor: "var(--team-primary-15)" }}
          >
            <Icons.Pitch
              className="w-5 h-5"
              style={{ color: "var(--team-primary)" }}
            />
          </div>
          <div>
            <h2 className="t-h2">Arm Care</h2>
            <p className="t-eyebrow text-ink-3 mt-0.5">
              Workload, rest status &amp; overuse flags
            </p>
          </div>
        </div>
        {flagged > 0 && (
          <span className="t-chip px-2 py-0.5 rounded-md border bg-loss-bg border-loss text-loss text-[10px] font-black whitespace-nowrap">
            {flagged} flagged
          </span>
        )}
      </div>

      <div className="divide-y divide-line">
        {rows.map(({ p, w, avail, series }) => (
          <div key={p.id} className="p-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => openPlayerProfile?.(p.id)}
                    className="font-extrabold text-ink hover:text-team-primary text-left"
                  >
                    {p.name}
                    {p.number != null && p.number !== "" && (
                      <span className="ml-1.5 text-ink-3 font-bold text-[10px] tabular-nums">
                        #{p.number}
                      </span>
                    )}
                  </button>
                  {avail && availabilityChip(avail)}
                </div>
                <div className="text-[11px] font-bold text-ink-2 mt-0.5 tabular-nums">
                  {w.totalPitches} pitches · {w.outings} outing
                  {w.outings === 1 ? "" : "s"} · high {w.maxDay} · last 7d{" "}
                  {w.last7}
                </div>
              </div>
              {series.length >= 2 && (
                <Sparkline
                  values={series}
                  width={72}
                  height={26}
                  fill="var(--team-primary)"
                  label={`${p.name} recent pitch counts: ${series.join(", ")}`}
                  className="shrink-0 mt-0.5"
                />
              )}
            </div>
            {w.alerts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {w.alerts.map((a, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-md border bg-loss-bg border-loss text-loss text-[10px] font-black"
                  >
                    ⚠ {a.message}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
