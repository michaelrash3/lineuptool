import React, { memo, useMemo } from "react";
import { useTeam } from "../../contexts";
import { maxPitchesForAge, resolvePitchRuleSet } from "../../lineupEngine";
import { assessTournamentPlan } from "../../utils/tournamentPitching";
import { formatGameDateDisplay } from "../../utils/helpers";
import { PitchPlanGameBody } from "./PitchPlanGameBody";
import type { Game, Player, Tournament } from "../../types";

const ageNumOf = (age: string | undefined): number => {
  const nums = (age || "").match(/\d+/g);
  if (!nums || nums.length === 0) return 8;
  return parseInt(nums[nums.length - 1], 10);
};

// The cross-game pitching plan for one stored tournament: per game, the
// planned outings (greyed once reality logs them), rule violations, and the
// arms-remaining view where every EARLIER game's plan is already deducted —
// the fix for "the ace shows ready for all three weekend games". Only
// rendered for Kid-Pitch 9U+ teams (pitch limits don't exist elsewhere).
// Heads edit; assistants read. The per-game body is shared with the week
// planner (PitchPlanGameBody) so both surfaces render plans identically.
export const TournamentPitchPlanPanel = memo(
  ({ tournament }: { tournament: Tournament }) => {
    const { team, currentRole, setPlannedOutings } = useTeam();
    const { players, games, teamAge, pitchingFormat } = team;
    const canEdit = currentRole === "head";

    const applies = /kid/i.test(pitchingFormat || "") && ageNumOf(teamAge) >= 9;
    const ruleSet = useMemo(() => resolvePitchRuleSet(team), [team]);

    const assessments = useMemo(
      () =>
        applies
          ? assessTournamentPlan({
              tournament,
              games: games || [],
              players: players || [],
              teamAge,
              ruleSet,
            })
          : [],
      [applies, tournament, games, players, teamAge, ruleSet],
    );

    if (!applies || assessments.length === 0) return null;

    const dailyMax = maxPitchesForAge(teamAge, ruleSet);
    const playerById = new Map<string, Player>(
      (players || []).map((p: Player) => [p.id, p]),
    );
    const gameById = new Map<string, Game>(
      (games || []).map((g: Game) => [g.id, g]),
    );
    const pitchers = (players || []).filter(
      (p: Player) =>
        Array.isArray(p.comfortablePositions) &&
        p.comfortablePositions.includes("P"),
    );

    return (
      <div className="border-t border-line">
        <div className="px-4 pt-3 flex items-center gap-2">
          <h4 className="t-eyebrow text-ink-2">Weekend Pitching Plan</h4>
          <span
            className="t-chip px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "var(--team-primary-15)",
              color: "var(--team-ink)",
            }}
            title="Planned pitches in earlier games count against daily max and rest rules for every later game."
          >
            cross-game
          </span>
        </div>
        <div className="divide-y divide-line">
          {assessments.map(({ gameId, arms, violations }) => {
            const game = gameById.get(gameId);
            if (!game) return null;
            const entries = tournament.pitchPlan?.[gameId] || [];
            const ready = arms.filter((a) => a.status === "ready");

            return (
              <div key={gameId} className="p-4">
                <div className="flex items-center justify-between gap-3">
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
                <PitchPlanGameBody
                  game={game}
                  entries={entries}
                  arms={arms}
                  violations={violations}
                  teamAge={teamAge}
                  ruleSet={ruleSet}
                  dailyMax={dailyMax}
                  pitchers={pitchers}
                  playerById={playerById}
                  canEdit={canEdit}
                  onSetEntries={(next) =>
                    setPlannedOutings(tournament.id, gameId, next)
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
