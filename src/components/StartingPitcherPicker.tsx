import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import {
  checkPitchEligibility,
  getCombinedGrades,
  calcPitcherScore,
  resolvePitchRuleSet,
} from "../lineupEngine";
import {
  planForGame,
  priorPlannedOutingsForGame,
  withPlannedOutings,
} from "../utils/tournamentPitching";
import { opponentStrengthGuidance } from "../utils/tournamentStakes";
import { featureEnabled } from "../constants/features";

// Whether a present player is a pitching candidate: explicit "P" in their
// comfortable positions, else (legacy) not restricted from P, else allow —
// so an ungraded/unconfigured roster still surfaces options to pick from.
const canPitch = (p: any): boolean => {
  const list = Array.isArray(p?.comfortablePositions)
    ? p.comfortablePositions
    : null;
  if (list && list.length > 0) return list.includes("P");
  const restr = Array.isArray(p?.restrictions) ? p.restrictions : [];
  if (restr.length > 0) return !restr.includes("P");
  return true;
};

// Strategy copy per game type. Pool/League spread the staff so the aces stay
// rested for bracket weekends; bracket is win-now.
const CONTEXT: Record<string, { label: string; tip: string; spread: boolean }> =
  {
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
  // Any Kid Pitch game has a starting pitcher to choose — including 8U Kid
  // Pitch (USSSA), so this is not gated on age.
  const isKidPitch = /kid/i.test(fmt);
  const gameType = game?.gameType || "league";
  const ctx = CONTEXT[gameType] || CONTEXT.league;

  const pitchRules = useMemo(() => resolvePitchRuleSet(team), [team]);
  const combinedGrades = useMemo(
    () =>
      isKidPitch
        ? getCombinedGrades(evaluationEvents || [], players || [], {
            teamAge,
            games: team.games || [],
          })
        : null,
    [isKidPitch, evaluationEvents, players, teamAge, team],
  );

  // Plan context: this game's planned starter and the planned outings from
  // EARLIER games — folded into eligibility below so a Saturday game 2 picker
  // already discounts the arm penciled in for game 1. Both resolve through
  // planForGame, so a standalone game's week-planner plan (game.pitchPlan)
  // counts exactly like a stored tournament's plan. The tournaments module
  // toggle only hides the stored-tournament layer; the week planner (and its
  // standalone plans) is always available, so the fold always runs.
  const tournamentsEnabled = featureEnabled(team, "tournaments");
  const tournaments = useMemo(
    () => (tournamentsEnabled ? team.tournaments || [] : []),
    [tournamentsEnabled, team.tournaments],
  );
  const gameTournament = game
    ? tournaments.find((t: any) => (t.gameIds || []).includes(game.id))
    : null;
  const plannedStartId =
    (game &&
      planForGame(game, tournaments).find((e: any) => e.role === "start")
        ?.playerId) ||
    null;
  const priorPlanned = useMemo(
    () =>
      game
        ? priorPlannedOutingsForGame(
            tournaments,
            team.games || [],
            players || [],
            game.id,
            teamAge,
            pitchRules,
          )
        : null,
    [game, tournaments, team.games, players, teamAge, pitchRules],
  );

  const ranked = useMemo(() => {
    if (!isKidPitch || !combinedGrades || !game) return [];
    const dateStr = game.date;
    const att = currentGameAttendance || {};
    const present = ((players || []) as any[]).filter(
      (p) => p && p.present !== false && att[p.id] !== false,
    );
    // Pitching candidates among present players; if nobody is marked as a
    // pitcher, fall back to everyone present so the coach is never stuck.
    let pool = present.filter(canPitch);
    if (pool.length === 0) pool = present;
    return pool
      .map((p) => {
        const g = combinedGrades[p.id] || {};
        const score = calcPitcherScore(g, p.stats, {
          topMph: p.stats?.pTopMph ?? p.pitching?.topMph,
          teamAge,
        });
        // Eligibility sees earlier games' planned outings — tournament or
        // standalone — as if already thrown (hypothetical fold; nothing is
        // persisted).
        const eligibilityPlayer = priorPlanned?.size
          ? withPlannedOutings(p, priorPlanned.get(p.id) || [])
          : p;
        return {
          p,
          score,
          eligible: checkPitchEligibility(
            eligibilityPlayer,
            dateStr,
            teamAge,
            pitchRules,
          ),
          recent: p.pitching?.recentPitches || 0,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [
    isKidPitch,
    combinedGrades,
    players,
    currentGameAttendance,
    game,
    teamAge,
    pitchRules,
    priorPlanned,
  ]);

  if (!isKidPitch || !game || ranked.length === 0) return null;

  const eligibleRanked = ranked.filter((r) => r.eligible);
  // Recommended starter: the pitch plan's starter (tournament or week-planner)
  // wins when he's still eligible; otherwise bracket → the top eligible arm;
  // pool/league → the next arm down (rest the ace) when there's depth, else
  // the top eligible.
  const plannedIsEligible =
    !!plannedStartId && eligibleRanked.some((r) => r.p.id === plannedStartId);
  const recommendedId = plannedIsEligible
    ? plannedStartId
    : eligibleRanked.length
      ? ctx.spread
        ? (eligibleRanked[1] || eligibleRanked[0]).p.id
        : eligibleRanked[0].p.id
      : null;
  const selectedId = firstInningLineup?.P || "";
  const plannedPlayer = plannedStartId
    ? (players || []).find((p: any) => p.id === plannedStartId)
    : null;

  const pick = (id: string) => {
    setFirstInningLineup({ ...(firstInningLineup || {}), P: id });
    // Pass the chosen pitcher straight into the re-run so the lineup is rolled
    // around the new starter immediately — no dependency on the state update
    // above landing first (which could otherwise drop the change).
    generateLineup({ firstInningOverrides: { P: id } });
  };

  // Strategy line: the coach's opponent-strength read (aware of the
  // tournament's tiebreaker ladder) sharpens the generic game-type tip.
  const stakesTip =
    opponentStrengthGuidance(
      game.opponentStrength,
      gameTournament?.tiebreakers,
    ) || ctx.tip;

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
            color: "var(--team-ink)",
          }}
        >
          {ctx.label}
        </span>
      </div>
      <p className="text-[11px] font-bold text-ink-2 leading-snug">
        {stakesTip}
      </p>
      {/* One-way flow: picking a different starter never rewrites the
          stored pitch plan — it just flags the drift. */}
      {plannedPlayer && selectedId && selectedId !== plannedStartId && (
        <p className="text-[11px] font-bold text-warnfg mt-1">
          The pitch plan has {plannedPlayer.name} starting this game — your pick
          here doesn't change that plan.
        </p>
      )}

      <div className="mt-3 flex flex-col">
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
                r.eligible
                  ? "hover:bg-surface-2 cursor-pointer"
                  : "opacity-50 cursor-not-allowed"
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
              {isRec &&
                r.eligible &&
                (plannedIsEligible && r.p.id === plannedStartId ? (
                  <span
                    className="t-chip px-2 py-0.5 rounded-sm border border-line shrink-0"
                    style={{
                      backgroundColor: "var(--team-primary-15)",
                      color: "var(--team-ink)",
                    }}
                    title="The pitch plan has this arm starting this game."
                  >
                    Planned
                  </span>
                ) : (
                  <span className="t-chip px-2 py-0.5 rounded-sm bg-win-bg text-win border border-line shrink-0">
                    Suggested
                  </span>
                ))}
              <span className="t-stat-num-sm text-ink tabular-nums shrink-0 w-10 text-right">
                {r.score.toFixed(1)}
              </span>
              {r.eligible ? (
                isSel ? (
                  <Icons.Check
                    className="w-4 h-4 shrink-0"
                    style={{ color: "var(--team-ink)" }}
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
