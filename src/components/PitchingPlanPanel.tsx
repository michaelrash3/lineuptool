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

  // The next few upcoming games, soonest first, so a coach can plan a rotation
  // across the weekend rather than one game at a time.
  const upcoming = useMemo(() => {
    if (!eligible) return [] as any[];
    const today = getLocalDateString();
    return (games || [])
      .filter((g: any) => (g.status || "scheduled") !== "postponed")
      .filter((g: any) => !isGameFinalized(g))
      .filter((g: any) => g.date && g.date >= today)
      .sort((a: any, b: any) => a.date.localeCompare(b.date))
      .slice(0, 4);
  }, [eligible, games]);

  // Each upcoming game's availability snapshot, based on every pitcher's CURRENT
  // recorded rest state (last outing + pitch count vs the age rest rules).
  const rotation = useMemo(
    () =>
      upcoming.map((g: any) => ({
        game: g,
        plan: buildPitchingPlan(players || [], g.date, teamAge),
      })),
    [upcoming, players, teamAge]
  );

  if (!eligible || rotation.length === 0 || rotation[0].plan.length === 0)
    return null;

  return (
    <div className="glass-card mb-6">
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
      <div className="p-5 border-b border-line bg-surface flex items-center gap-3">
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
          <h2 className="t-h2">Pitching Rotation</h2>
          <p className="t-eyebrow text-ink-3 mt-0.5">
            Who's rested for each upcoming game
          </p>
        </div>
      </div>

      <div className="divide-y divide-line">
        {rotation.map(({ game, plan }: any) => {
          const ready = plan.filter((p: any) => p.status === "ready");
          const resting = plan.filter((p: any) => p.status === "resting");
          const maxed = plan.filter((p: any) => p.status === "maxed");
          return (
            <div key={game.id} className="p-4 sm:px-5">
              <div className="flex items-center justify-between gap-3 mb-2">
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
              {ready.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {ready.map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openPlayerProfile(p.id)}
                      className="t-chip px-2 py-0.5 rounded-md border bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap"
                      title={`Up to ${p.maxPitches} pitches`}
                    >
                      {p.number ? `#${p.number} ` : ""}
                      {p.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] font-bold text-rose-600">
                  No rested arms — everyone needs more rest by this date.
                </div>
              )}
              {resting.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {resting.map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openPlayerProfile(p.id)}
                      className="t-chip px-2 py-0.5 rounded-md border bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 transition-colors whitespace-nowrap"
                      title="Resting"
                    >
                      {p.number ? `#${p.number} ` : ""}
                      {p.name}
                      {p.daysUntilReady ? ` · ${p.daysUntilReady}d` : ""}
                    </button>
                  ))}
                </div>
              )}
              {maxed.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {maxed.map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openPlayerProfile(p.id)}
                      className="t-chip px-2 py-0.5 rounded-md border bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors whitespace-nowrap"
                      title="At pitch limit until their next recorded outing"
                    >
                      {p.number ? `#${p.number} ` : ""}
                      {p.name} · at limit
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
