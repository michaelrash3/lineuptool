import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import {
  checkPitchEligibility,
  getCombinedGrades,
  calcPitcherScore,
  resolvePitchRuleSet,
  getPitcherPoolSize,
} from "../lineupEngine";

const ageNumOf = (age: string | undefined): number => {
  const nums = (age || "").match(/\d+/g);
  if (!nums || nums.length === 0) return 8;
  return parseInt(nums[nums.length - 1], 10);
};

// Strategy copy per game type. Pool/League spread the staff so the aces stay
// rested for bracket weekends; bracket is win-now.
const CONTEXT: Record<string, { label: string; tip: string; spread: boolean }> = {
  bracket: {
    label: "Bracket play",
    tip: "Win-now — start your best available arm.",
    spread: false,
  },
  pool: {
    label: "Pool play",
    tip: "Spread the staff — save your aces for bracket.",
    spread: true,
  },
  league: {
    label: "Rec / League",
    tip: "Spread innings — work through the staff.",
    spread: true,
  },
};

// Kid-Pitch-only "select your starting pitcher" step. Shows the present roster's
// eligible pitchers ranked by the same eval-weighted score as the Pitcher
// Ranking panel, recommends a starter based on the game type (league/pool vs
// bracket), and — on selection — locks that pitcher into the first inning and
// rolls the projected lineup for confirmation.
export const StartingPitcherPicker = memo(({ game }: { game: any }) => {
  const { team, generateLineup } = useTeam() as any;
  const { currentGameAttendance, firstInningLineup, setFirstInningLineup } =
    useUI() as any;
  const { players, evaluationEvents, teamAge } = team;

  const fmt = game?.pitchingFormat || team.pitchingFormat || "";
  const isKidPitch = /kid/i.test(fmt) && ageNumOf(teamAge) >= 9;
  const gameType = game?.gameType || "league";
  const ctx = CONTEXT[gameType] || CONTEXT.league;
  const poolSize = getPitcherPoolSize(gameType);

  const pitchRules = useMemo(() => resolvePitchRuleSet(team), [team]);
  const combinedGrades = useMemo(
    () =>
      isKidPitch
        ? getCombinedGrades(evaluationEvents || [], players || [], {
            teamAge,
            games: team.games || [],
          })
        : null,
    [isKidPitch, evaluationEvents, players, teamAge, team]
  );

  const ranked = useMemo(() => {
    if (!isKidPitch || !combinedGrades || !game) return [];
    const dateStr = game.date;
    const att = currentGameAttendance || {};
    return ((players || []) as any[])
      .filter((p) => p && p.present !== false && att[p.id] !== false)
      .map((p) => {
        const g = combinedGrades[p.id] || {};
        const score = calcPitcherScore(g, p.stats, {
          topMph: p.stats?.pTopMph ?? p.pitching?.topMph,
          teamAge,
        });
        return {
          p,
          score,
          eligible: checkPitchEligibility(p, dateStr, teamAge, pitchRules),
          recent: p.pitching?.recentPitches || 0,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [isKidPitch, combinedGrades, players, currentGameAttendance, game, teamAge, pitchRules]);

  if (!isKidPitch || !game || ranked.length === 0) return null;

  const eligibleRanked = ranked.filter((r) => r.eligible);
  // Recommended starter: bracket → the top eligible arm; pool/league → the next
  // arm down (rest the ace) when there's depth, else the top eligible.
  const recommendedId = eligibleRanked.length
    ? ctx.spread
      ? (eligibleRanked[1] || eligibleRanked[0]).p.id
      : eligibleRanked[0].p.id
    : null;
  const selectedId = firstInningLineup?.P || "";

  const pick = (id: string) => {
    setFirstInningLineup({ ...(firstInningLineup || {}), P: id });
    // Defer so the override is in state before the engine reads it, then roll
    // the projected lineup for confirmation.
    setTimeout(() => generateLineup(), 0);
  };

  return (
    <div className="mb-6 pb-5 border-b border-line">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Icons.Pitch className="w-4 h-4 text-team-primary" />
          <h3 className="t-h3">Starting Pitcher</h3>
        </div>
        <span
          className="t-chip px-2 py-0.5 rounded-sm border border-line"
          style={{
            backgroundColor: "var(--team-primary-15)",
            color: "var(--team-primary)",
          }}
        >
          {ctx.label}
        </span>
      </div>
      <p className="t-body text-ink-3 mb-3">
        {ctx.tip} Pick a pitcher to roll the projected lineup around them
        {poolSize ? ` (staff pool: top ${poolSize}).` : "."}
      </p>

      <div className="flex flex-col">
        {ranked.map((r, idx) => {
          const isSel = selectedId === r.p.id;
          const isRec = recommendedId === r.p.id;
          return (
            <button
              key={r.p.id}
              type="button"
              disabled={!r.eligible}
              onClick={() => pick(r.p.id)}
              aria-pressed={isSel}
              className={`flex items-center gap-3 px-2 py-2.5 border-b border-line text-left transition-colors ${
                r.eligible ? "hover:bg-surface-2 cursor-pointer" : "opacity-50 cursor-not-allowed"
              } ${isSel ? "bg-surface-2" : ""}`}
              style={
                isSel
                  ? { boxShadow: "inset 3px 0 0 0 var(--team-primary)" }
                  : undefined
              }
            >
              <span className="w-5 text-center font-black tabular-nums text-ink-3 shrink-0">
                {idx + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-black uppercase tracking-tight text-ink truncate">
                  {r.p.name}
                  {r.p.number != null && r.p.number !== "" && (
                    <span className="ml-1.5 text-ink-3 font-bold text-[10px] tabular-nums">
                      #{r.p.number}
                    </span>
                  )}
                </span>
                {r.recent > 0 && (
                  <span className="block text-[10px] font-bold text-ink-3 tabular-nums">
                    {r.recent} recent pitches
                  </span>
                )}
              </span>
              {isRec && r.eligible && (
                <span className="t-chip px-2 py-0.5 rounded-sm bg-win-bg text-win border border-line shrink-0">
                  Suggested
                </span>
              )}
              <span className="t-stat-num-sm text-ink tabular-nums shrink-0 w-10 text-right">
                {r.score.toFixed(1)}
              </span>
              {r.eligible ? (
                isSel ? (
                  <Icons.Check
                    className="w-4 h-4 shrink-0"
                    style={{ color: "var(--team-primary)" }}
                  />
                ) : (
                  <span className="w-4 shrink-0" />
                )
              ) : (
                <span className="t-chip px-2 py-0.5 rounded-sm bg-warn-bg text-warnfg border border-line shrink-0">
                  Rest
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});
