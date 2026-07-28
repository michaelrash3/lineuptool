import React, { memo, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { maxPitchesForAge, resolvePitchRuleSet } from "../../lineupEngine";
import { pitchLimitsApply } from "../../utils/tournamentPitching";
import {
  assessWeekPlan,
  groupGamesByWeek,
  planForGame,
  tournamentForGame,
  type WeekGroup,
} from "../../utils/weekPlanning";
import {
  dateToIsoLocal,
  effectiveGameType,
  formatGameDateDisplay,
  gameTypeLabel,
} from "../../utils/helpers";
import { featureEnabled } from "../../constants/features";
import { PitchPlanGameBody } from "../../components/tournament/PitchPlanGameBody";
import type { Game, PlannedOuting, Player, Tournament } from "../../types";
import type { GamePlanAssessment } from "../../utils/tournamentPitching";

// Short "Jun 5" label for the week-header range (UTC on the literal ISO date,
// same convention as formatGameDateDisplay).
const shortDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

// /schedule/week — the weekly rotation planner. Every non-scrimmage game (rec
// AND tournament) grouped by calendar week (Mon–Sun), each with its
// classification chip and its pitching plan, where planned outings fold
// forward chronologically ACROSS THE WHOLE WEEK: plan an arm for Wednesday's
// rec game and Saturday's card immediately shows him resting — the same
// engine math the tournament panel and game day run (assessGamesPlan).
export const WeekPlannerPage = memo(() => {
  const { team, currentRole, setPlannedOutings, updateGame } = useTeam();
  const back = useBackOrFallback("/schedule");
  const { players, games, teamAge, pitchingFormat, leagueRuleSet } = team;
  const storedTournaments = team.tournaments;
  const tournamentsOn = featureEnabled(team, "tournaments");
  const tournaments: Tournament[] = useMemo(
    () => (tournamentsOn ? storedTournaments || [] : []),
    [tournamentsOn, storedTournaments],
  );
  const canEdit = currentRole === "head";

  const applies = pitchLimitsApply(pitchingFormat, teamAge);
  const ruleSet = useMemo(() => resolvePitchRuleSet(team), [team]);

  const weeks = useMemo(() => groupGamesByWeek(games), [games]);

  // Past weeks fold away by default — the coach plans forward. The toggle
  // keeps the whole season reachable.
  const [showPast, setShowPast] = useState(false);
  const todayIso = dateToIsoLocal(new Date());
  const pastWeeks = weeks.filter((w) => w.weekEnd < todayIso);
  const visibleWeeks =
    showPast || pastWeeks.length === weeks.length
      ? weeks
      : weeks.filter((w) => w.weekEnd >= todayIso);

  // Per-week fold: gameId → assessment, computed once per data change.
  const assessmentByGameId = useMemo(() => {
    const map = new Map<string, GamePlanAssessment>();
    if (!applies) return map;
    for (const w of weeks) {
      for (const a of assessWeekPlan({
        weekGames: w.games,
        tournaments,
        players: players || [],
        teamAge,
        ruleSet,
      })) {
        map.set(a.gameId, a);
      }
    }
    return map;
  }, [applies, weeks, tournaments, players, teamAge, ruleSet]);

  const dailyMax = maxPitchesForAge(teamAge, ruleSet);
  const playerById = useMemo(
    () =>
      new Map<string, Player>((players || []).map((p: Player) => [p.id, p])),
    [players],
  );
  const pitchers: Player[] = (players || []).filter(
    (p: Player) =>
      Array.isArray(p.comfortablePositions) &&
      p.comfortablePositions.includes("P"),
  );

  // Route the write to wherever this game's plan lives: the stored
  // tournament's pitchPlan when the game is claimed (so the tournament panel
  // sees the same entries), else the game's own pitchPlan field.
  const setEntriesFor = (game: Game, next: PlannedOuting[]) => {
    const t = tournamentForGame(tournaments, game.id);
    if (t) setPlannedOutings(t.id, game.id, next);
    else updateGame(game.id, { pitchPlan: next.length > 0 ? next : null });
  };

  const typeChip = (game: Game) => {
    const t = effectiveGameType(game, leagueRuleSet);
    const styles =
      t === "bracket"
        ? "bg-loss-bg text-loss"
        : t === "pool"
          ? "bg-warn-bg text-warnfg"
          : "bg-surface-2 text-ink-2";
    return (
      <span
        className={`t-chip px-1.5 py-0.5 rounded border border-line ${styles}`}
        title="Game classification (set per game in the game editor)"
      >
        {gameTypeLabel(t)}
      </span>
    );
  };

  const renderWeek = (w: WeekGroup) => {
    const isThisWeek = w.weekStart <= todayIso && todayIso <= w.weekEnd;
    return (
      <section
        key={w.weekStart}
        className="border border-line rounded-2xl overflow-hidden"
      >
        <div className="px-4 py-3 bg-surface flex items-center gap-2 border-b border-line">
          <h3 className="t-eyebrow text-ink-2">
            Week of {shortDate(w.weekStart)} – {shortDate(w.weekEnd)}
          </h3>
          {isThisWeek && (
            <span
              className="t-chip px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: "var(--team-primary-15)",
                color: "var(--team-ink)",
              }}
            >
              this week
            </span>
          )}
          <span className="ml-auto t-eyebrow text-ink-3">
            {w.games.length} {w.games.length === 1 ? "game" : "games"}
          </span>
        </div>
        <div className="divide-y divide-line">
          {w.games.map((game) => {
            const a = assessmentByGameId.get(game.id);
            const tournament = tournamentForGame(tournaments, game.id);
            return (
              <div key={game.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-bold text-ink text-sm">
                    {game.opponent ? `vs ${game.opponent}` : "Game"}
                    <span className="text-ink-3 font-medium">
                      {" · "}
                      {formatGameDateDisplay(game.date)}
                    </span>
                  </div>
                  {typeChip(game)}
                  {tournament && (
                    <Link
                      to={`/schedule/tournaments/${tournament.id}`}
                      className="t-chip px-1.5 py-0.5 rounded border border-line bg-surface text-ink-2 hover:bg-surface-2"
                      title="Part of this tournament — its weekend plan and this page edit the same entries."
                    >
                      {tournament.name}
                    </Link>
                  )}
                </div>
                {applies && a && (
                  <PitchPlanGameBody
                    game={game}
                    entries={planForGame(game, tournaments)}
                    arms={a.arms}
                    violations={a.violations}
                    teamAge={teamAge}
                    ruleSet={ruleSet}
                    dailyMax={dailyMax}
                    pitchers={pitchers}
                    playerById={playerById}
                    canEdit={canEdit}
                    onSetEntries={(next) => setEntriesFor(game, next)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <PageShell eyebrow="Schedule" title="Week Planner" onBack={back}>
      <p className="text-xs font-bold text-ink-3 -mt-2 mb-4">
        {applies
          ? "Every game, rec and tournament, week by week. Planned pitches in any game count against daily max and rest rules for every later game that week — plan Wednesday and Saturday shows the cost."
          : "Every game, rec and tournament, week by week. Pitch-count planning turns on for Kid Pitch, 9U and up."}
      </p>
      {weeks.length === 0 ? (
        <div className="p-6 border border-line rounded-2xl text-center text-sm font-bold text-ink-3">
          No games on the schedule yet.
        </div>
      ) : (
        <div className="space-y-4">
          {pastWeeks.length > 0 && pastWeeks.length < weeks.length && (
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="t-chip px-3 py-1.5 rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2 font-black uppercase tracking-widest"
            >
              {showPast
                ? "Hide past weeks"
                : `Show ${pastWeeks.length} past ${
                    pastWeeks.length === 1 ? "week" : "weeks"
                  }`}
            </button>
          )}
          {visibleWeeks.map(renderWeek)}
        </div>
      )}
    </PageShell>
  );
});
