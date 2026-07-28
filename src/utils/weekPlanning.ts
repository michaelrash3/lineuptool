// Weekly rotation planning — the week-wide widening of the tournament
// cross-game pitching fold. Groups the schedule into calendar weeks (Mon–Sun)
// and assesses each week's games with utils/tournamentPitching.assessGamesPlan,
// so planning an arm for Wednesday's rec game visibly burns him for Saturday's
// bracket game: identical math to the tournament panel and to game day,
// widened beyond Tournament.gameIds. Everything here is pure.

import type { PitchRuleSet } from "../lineupEngine";
import type { Game, Player, Tournament } from "../types";
import {
  assessGamesPlan,
  orderGamesChronologically,
  planForGame,
  type GamePlanAssessment,
} from "./tournamentPitching";

// The plan resolver ("tournament pitchPlan wins, else game.pitchPlan") lives
// in utils/tournamentPitching so the cross-game folds there can share it
// without an import cycle; re-exported here for this module's callers.
export { planForGame, tournamentForGame } from "./tournamentPitching";

const DAY_MS = 86_400_000;

const addDaysIso = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

// Monday of the week containing an ISO date. Weeks run Mon–Sun so a weekend
// tournament (Sat+Sun) never straddles a boundary. UTC math on the literal
// date string keeps this timezone-proof.
export const mondayOf = (isoDate: string): string => {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return addDaysIso(isoDate, -((dow + 6) % 7));
};

export interface WeekGroup {
  weekStart: string; // Monday, ISO yyyy-mm-dd
  weekEnd: string; // Sunday, ISO yyyy-mm-dd
  games: Game[]; // chronological within the week
}

// Group ALL plannable games — dated, non-scrimmage, rec AND tournament — into
// calendar weeks. Scrimmages carry no stakes and no pitch-count stats, so
// they stay out of rotation planning; undated games can't be placed.
export const groupGamesByWeek = (
  games: Game[] | null | undefined,
): WeekGroup[] => {
  const dated = orderGamesChronologically(
    (games || []).filter((g) => g && !g.isScrimmage),
  );
  const byWeek = new Map<string, Game[]>();
  for (const g of dated) {
    const key = mondayOf(g.date as string);
    const list = byWeek.get(key);
    if (list) list.push(g);
    else byWeek.set(key, [g]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, weekGames]) => ({
      weekStart,
      weekEnd: addDaysIso(weekStart, 6),
      games: weekGames,
    }));
};

interface AssessWeekArgs {
  weekGames: Game[];
  tournaments: Tournament[] | null | undefined;
  players: Player[] | null | undefined;
  teamAge: string;
  ruleSet: PitchRuleSet;
}

// Assess one week's games with every earlier game's planned outings folded
// forward — the same walk assessTournamentPlan runs, widened to the whole
// week regardless of tournament membership. A Wednesday plan therefore shows
// up in Saturday's arms list as rest debt, and violations (dailyMax /
// insufficientRest / notEligibleToday) surface per game exactly as the
// tournament panel surfaces them.
export const assessWeekPlan = ({
  weekGames,
  tournaments,
  players,
  teamAge,
  ruleSet,
}: AssessWeekArgs): GamePlanAssessment[] => {
  const ordered = orderGamesChronologically(weekGames);
  const byId = new Map(ordered.map((g) => [g.id, g]));
  return assessGamesPlan({
    orderedGames: ordered,
    planFor: (gameId) => {
      const g = byId.get(gameId);
      return g ? planForGame(g, tournaments) : [];
    },
    players,
    teamAge,
    ruleSet,
  });
};
