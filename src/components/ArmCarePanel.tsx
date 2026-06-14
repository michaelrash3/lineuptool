import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { analyzePitchingWorkload, resolvePitchRuleSet } from "../lineupEngine";
import { isKidPitchFormat } from "../constants/ui";

// Roster-tab arm-care dashboard: season workload per pitcher + overuse flags
// (pitched several days running, came back on short rest). Kid Pitch + head
// coach only; hidden until at least one pitcher has logged an outing. The
// numbers come straight from each player's pitching.log, rule-set aware.
export const ArmCarePanel = memo(() => {
  const { team, currentRole } = useTeam();
  const { openPlayerProfile } = useUI();
  const { players, pitchingFormat } = team as any;
  const eligible = currentRole === "head" && isKidPitchFormat(pitchingFormat);
  const ruleSet = useMemo(() => resolvePitchRuleSet(team), [team]);

  const rows = useMemo(() => {
    if (!eligible) return [];
    return ((players || []) as any[])
      .filter(
        (p) =>
          Array.isArray(p.comfortablePositions) &&
          p.comfortablePositions.includes("P")
      )
      .map((p) => ({ p, w: analyzePitchingWorkload(p.pitching, ruleSet) }))
      .filter((r) => r.w.outings > 0)
      .sort((a, b) => {
        const aFlag = a.w.alerts.length > 0 ? 1 : 0;
        const bFlag = b.w.alerts.length > 0 ? 1 : 0;
        if (aFlag !== bFlag) return bFlag - aFlag;
        return b.w.last7 - a.w.last7;
      });
  }, [eligible, players, ruleSet]);

  if (!eligible || rows.length === 0) return null;

  const flagged = rows.filter((r) => r.w.alerts.length > 0).length;

  return (
    <div className="glass-card mb-6">
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
              Season workload &amp; overuse flags
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
        {rows.map(({ p, w }) => (
          <div key={p.id} className="p-4 sm:px-5">
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
            <div className="text-[11px] font-bold text-ink-2 mt-0.5 tabular-nums">
              {w.totalPitches} pitches · {w.outings} outing
              {w.outings === 1 ? "" : "s"} · high {w.maxDay} · last 7d{" "}
              {w.last7}
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
