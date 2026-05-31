import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import {
  checkPitchEligibility,
  getCombinedGrades,
  calcPitcherScore,
} from "../lineupEngine";

const ageNumOf = (age: string | undefined): number => {
  const nums = (age || "").match(/\d+/g);
  if (!nums || nums.length === 0) return 8;
  return parseInt(nums[nums.length - 1], 10);
};

// Days until eligible to pitch again (0 = today). Returns null when the
// player has no recent pitching activity (always eligible).
const daysUntilEligible = (player: any, teamAge: string): number | null => {
  const pitching = player.pitching || {};
  const last = pitching.lastPitchDate;
  if (!last || !pitching.recentPitches) return null;
  const today = new Date();
  for (let d = 0; d < 14; d++) {
    const target = new Date(today);
    target.setDate(target.getDate() + d);
    const targetStr = target.toISOString().slice(0, 10);
    if (checkPitchEligibility(player, targetStr, teamAge)) return d;
  }
  return null;
};

const formatPitchDate = (iso: string | undefined | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const PitcherRankingPanel = memo(() => {
  const { team, currentRole } = useTeam();
  const { openPlayerProfile } = useUI();
  const { players, evaluationEvents, pitchingFormat, teamAge } = team;

  const eligible =
    currentRole === "head" &&
    /kid/i.test(pitchingFormat || "") &&
    ageNumOf(teamAge) >= 9;

  // Combined head + assistant grades (already 50/50 weighted in
  // lineupEngine.getCombinedGrades after Round 2 PR C).
  const combinedGrades = useMemo(
    () => (eligible ? getCombinedGrades(evaluationEvents || [], players || []) : null),
    [eligible, evaluationEvents, players]
  );

  const ranked = useMemo(() => {
    if (!eligible || !combinedGrades) return [];
    const todayStr = new Date().toISOString().slice(0, 10);
    return ((players || []) as any[])
      .map((p) => {
        const g = combinedGrades[p.id] || {};
        const score = calcPitcherScore(g);
        const eligibleToday = checkPitchEligibility(p, todayStr, teamAge);
        const daysUntil = eligibleToday ? 0 : daysUntilEligible(p, teamAge);
        return {
          p,
          score,
          eligibleToday,
          daysUntil,
          lastPitchDate: p.pitching?.lastPitchDate,
          recentPitches: p.pitching?.recentPitches || 0,
        };
      })
      // Drop players who have never been graded for pitching at all — no
      // point listing kids the coach hasn't evaluated as pitchers.
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [eligible, combinedGrades, players, teamAge]);

  if (!eligible) return null;
  if (ranked.length === 0) return null;

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
          <h2 className="t-h2">Pitcher Ranking</h2>
        </div>
        <span className="t-eyebrow text-ink-3 hidden sm:inline">
          Eval-weighted · {ranked.length} ranked
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface">
            <tr className="text-[10px] font-black uppercase tracking-widest text-ink-3">
              <th className="px-3 py-2 w-8">#</th>
              <th className="px-3 py-2">Pitcher</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 text-right hidden sm:table-cell">Last Pitched</th>
              <th className="px-3 py-2 text-right hidden md:table-cell">Recent Pitches</th>
              <th className="px-3 py-2 text-right">Eligible</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row, idx) => (
              <tr
                key={row.p.id}
                className="border-t border-line hover:bg-surface transition-colors"
              >
                <td className="px-3 py-2 font-black tabular-nums text-ink-3">
                  {idx + 1}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => openPlayerProfile?.(row.p.id)}
                    className="font-extrabold text-ink hover:text-team-primary text-left"
                  >
                    {row.p.name}
                    {row.p.number != null && row.p.number !== "" && (
                      <span className="ml-1.5 text-ink-3 font-bold text-[10px] tabular-nums">
                        #{row.p.number}
                      </span>
                    )}
                  </button>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-black text-ink">
                  {row.score.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right hidden sm:table-cell text-ink-2 tabular-nums">
                  {formatPitchDate(row.lastPitchDate)}
                </td>
                <td className="px-3 py-2 text-right hidden md:table-cell tabular-nums text-ink-2">
                  {row.recentPitches || "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.eligibleToday ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase tracking-widest">
                      Today
                    </span>
                  ) : row.daysUntil != null ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black uppercase tracking-widest">
                      +{row.daysUntil}d
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 border border-line text-ink-3 text-[10px] font-black uppercase tracking-widest">
                      Out
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
