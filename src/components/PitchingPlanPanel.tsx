import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { buildPitchingPlan } from "../lineupEngine";
import { isGameFinalized, formatGameDateDisplay } from "../utils/helpers";
import { getLocalDateString } from "../constants/ui";

const ageNumOf = (age: string | undefined): number => {
  const nums = (age || "").match(/\d+/g);
  if (!nums || nums.length === 0) return 8;
  return parseInt(nums[nums.length - 1], 10);
};

const formatDate = (iso: string | undefined | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// Next-game pitching plan: for the soonest upcoming game, classify each
// pitcher (cleared for "P") as ready / resting / maxed against the age rest
// rules, ready arms first so a coach can line up the rotation. Kid-Pitch 9U+
// only (where pitch limits apply); hidden when there's no upcoming game or no
// pitchers configured.
export const PitchingPlanPanel = memo(() => {
  const { team, currentRole } = useTeam();
  const { openPlayerProfile } = useUI();
  const { players, games, teamAge, pitchingFormat } = team;

  const eligible =
    currentRole === "head" &&
    /kid/i.test(pitchingFormat || "") &&
    ageNumOf(teamAge) >= 9;

  const nextGame = useMemo(() => {
    if (!eligible) return null;
    const today = getLocalDateString();
    return (games || [])
      .filter((g: any) => (g.status || "scheduled") !== "postponed")
      .filter((g: any) => !isGameFinalized(g))
      .filter((g: any) => g.date && g.date >= today)
      .sort((a: any, b: any) => a.date.localeCompare(b.date))[0];
  }, [eligible, games]);

  const plan = useMemo(
    () => (nextGame ? buildPitchingPlan(players || [], nextGame.date, teamAge) : []),
    [nextGame, players, teamAge]
  );

  if (!eligible || !nextGame || plan.length === 0) return null;

  const readyCount = plan.filter((p) => p.status === "ready").length;

  const statusChip = (p: (typeof plan)[number]) => {
    if (p.status === "ready")
      return { label: `Up to ${p.maxPitches}`, cls: "bg-emerald-50 border-emerald-200 text-emerald-700" };
    if (p.status === "resting")
      return {
        label: p.daysUntilReady ? `Ready in ${p.daysUntilReady}d` : "Resting",
        cls: "bg-amber-100 border-amber-300 text-amber-800",
      };
    return { label: "At limit", cls: "bg-rose-50 border-rose-200 text-rose-700" };
  };

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
            <h2 className="t-h2">Next-Game Pitching</h2>
            <p className="t-eyebrow text-ink-3 mt-0.5">
              {nextGame.opponent ? `vs ${nextGame.opponent} · ` : ""}
              {formatGameDateDisplay(nextGame.date)}
            </p>
          </div>
        </div>
        <span className="t-eyebrow text-ink-3 hidden sm:inline whitespace-nowrap">
          {readyCount} ready
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface">
            <tr className="text-[10px] font-black uppercase tracking-widest text-ink-3">
              <th className="px-3 py-2">Pitcher</th>
              <th className="px-3 py-2">Last outing</th>
              <th className="px-3 py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((p) => {
              const chip = statusChip(p);
              return (
                <tr key={p.id} className="border-t border-line/60">
                  <td className="px-3 py-2 font-bold text-ink whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openPlayerProfile(p.id)}
                      className="hover:text-team-primary transition-colors text-left"
                    >
                      {p.number ? `#${p.number} ` : ""}
                      {p.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-ink-2 tabular-nums whitespace-nowrap">
                    {p.recentPitches > 0
                      ? `${p.recentPitches} P · ${formatDate(p.lastPitchDate)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`t-chip px-2 py-0.5 rounded-md border ${chip.cls} whitespace-nowrap`}
                    >
                      {chip.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
