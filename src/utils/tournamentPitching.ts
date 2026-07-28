// Cross-game pitching math — the layer that makes a PLANNED outing in
// Saturday's opener count against the daily-max and rest-day rules when
// looking at Saturday's nightcap or Sunday's bracket game. The core walk
// (assessGamesPlan) takes any ordered span of games — stored Tournaments
// wrap it here, and utils/weekPlanning widens it to whole calendar weeks.
// Everything here is pure and wraps the engine's existing single-date
// machinery (checkPitchEligibility / buildPitchingPlan) by folding planned
// outings into a hypothetical copy of each player's pitching log — zero
// engine changes, so tournament/week math can never disagree with game-day
// math.
//
// The wrapper inherits the engine's semantics deliberately, including its
// "most recent day only" reading of the log and its one-mound-appearance-
// per-day rule (a same-day prior outing always fails checkPitchEligibility).

import {
  buildPitchingPlan,
  checkPitchEligibility,
  maxPitchesForAge,
  mostRecentDayPitches,
  type PitcherAvailability,
  type PitchRuleSet,
} from "../lineupEngine";
import type {
  Game,
  PlannedOuting,
  Player,
  PlayerId,
  Tournament,
} from "../types";
import { deriveTournaments, type TournamentGroup } from "./helpers";
import { isGameFinalized } from "./gameStatus";

// A planned outing rendered as if it were a logged one.
export interface HypotheticalOuting {
  date: string;
  pitches: number;
}

// Whether pitch-count planning applies at all: Kid Pitch, 9U and up —
// younger divisions and machine/coach pitch have no pitch limits. Shared by
// the tournament surfaces and the Home dashboard row.
export const pitchLimitsApply = (
  pitchingFormat: string | null | undefined,
  teamAge: string | null | undefined,
): boolean => {
  const nums = (teamAge || "").match(/\d+/g);
  const age = nums && nums.length ? parseInt(nums[nums.length - 1], 10) : 8;
  return /kid/i.test(pitchingFormat || "") && age >= 9;
};

export interface PlanViolation {
  gameId: string;
  playerId: string;
  playerName: string;
  kind: "dailyMax" | "insufficientRest" | "notEligibleToday";
  message: string;
}

export interface GamePlanAssessment {
  gameId: string;
  date: string;
  // Every cleared pitcher's availability for THIS game with all earlier
  // planned outings in the assessed span folded in — the "arms remaining"
  // view.
  arms: PitcherAvailability[];
  // This game's own planned assignments that break the rules.
  violations: PlanViolation[];
}

// Back-compat alias from when the fold only ran inside a stored Tournament.
export type TournamentGameAssessment = GamePlanAssessment;

// Effective pitch budget of a plan entry: the coach's explicit number, else
// the age group's full daily max — conservative on purpose, so later-game
// availability never over-promises when the coach hasn't set a budget.
export const plannedPitchesOf = (
  entry: PlannedOuting | null | undefined,
  teamAge: string,
  ruleSet: PitchRuleSet,
): number => {
  const n = Number(entry?.plannedPitches);
  return Number.isFinite(n) && n > 0 ? n : maxPitchesForAge(teamAge, ruleSet);
};

// Shallow-clone a player with hypothetical outings appended to pitching.log.
// The clone never escapes to persistence — it exists only so the engine's
// eligibility functions see the planned load as if it were real.
//
// A legacy player (recentPitches/lastPitchDate but no log) gets that day
// materialized as a log entry first: mostRecentDayPitches ignores the legacy
// fields the moment a log exists, so appending without materializing would
// silently hide their real last outing.
export const withPlannedOutings = (
  player: Player,
  outings: HypotheticalOuting[],
): Player => {
  if (!outings.length) return player;
  const pitching = player.pitching || {};
  const realLog =
    Array.isArray(pitching.log) && pitching.log.length
      ? pitching.log
      : pitching.lastPitchDate && Number(pitching.recentPitches) > 0
        ? [
            {
              date: pitching.lastPitchDate,
              pitches: Number(pitching.recentPitches),
            },
          ]
        : [];
  return {
    ...player,
    pitching: { ...pitching, log: [...realLog, ...outings] },
  };
};

// A plan entry is "planned" until reality catches up with it: the game is
// finalized, or the player's real pitching log already carries an outing for
// that game (written by the box-score stats import). Consumed entries are
// excluded from folding — the real log carries the load — and greyed in UI.
export const planEntryStatus = (
  entry: PlannedOuting | null | undefined,
  game: Game | null | undefined,
  player: Player | null | undefined,
): "planned" | "consumed" => {
  if (!entry || !game) return "planned";
  if (isGameFinalized(game)) return "consumed";
  const log = player?.pitching?.log;
  if (
    Array.isArray(log) &&
    log.some((o) => (o as { gameId?: string })?.gameId === game.id)
  )
    return "consumed";
  return "planned";
};

// Chronological order key: date, then first pitch (ISO startUtc — free-text
// `time` is unreliable), then id for a stable tiebreak.
const gameOrderKey = (g: Game): string =>
  `${g.date || "9999-99-99"}|${g.startUtc || ""}|${g.id}`;

// Undated games drop out; the rest sort chronologically. Shared by the
// tournament fold and the week planner so both walk games in the same order.
export const orderGamesChronologically = (
  games: Game[] | null | undefined,
): Game[] =>
  (games || [])
    .filter((g): g is Game => Boolean(g && g.date))
    .slice()
    .sort((a, b) => gameOrderKey(a).localeCompare(gameOrderKey(b)));

// The stored tournament (if any) that claims a game. A game belongs to at
// most one tournament (TournamentDetailPage enforces it at link time).
export const tournamentForGame = (
  tournaments: Tournament[] | null | undefined,
  gameId: string,
): Tournament | undefined =>
  (tournaments || []).find((t) => (t.gameIds || []).includes(gameId));

// One resolver for "where does this game's plan live": a stored tournament's
// pitchPlan wins for its games (the tournament panel writes there), and a
// standalone game carries its own game.pitchPlan (the week planner writes
// there). EVERY surface that reads planned outings goes through this — the
// week planner, the tournament panel, and the cross-game folds below — so no
// reader can miss a standalone game's plan. (Re-exported by utils/weekPlanning
// for its callers; defined here so this module can use it without a cycle.)
export const planForGame = (
  game: Game,
  tournaments: Tournament[] | null | undefined,
): PlannedOuting[] => {
  const t = tournamentForGame(tournaments, game.id);
  if (t) return t.pitchPlan?.[game.id] || [];
  return Array.isArray(game.pitchPlan) ? game.pitchPlan : [];
};

// Resolve a tournament's gameIds against the schedule: dangling ids (deleted
// games) and undated games drop out; the rest sort chronologically.
export const orderedTournamentGames = (
  tournament: Tournament | null | undefined,
  games: Game[] | null | undefined,
): Game[] => {
  const byId = new Map((games || []).map((g) => [g.id, g]));
  return orderGamesChronologically(
    (tournament?.gameIds || [])
      .map((id) => byId.get(id))
      .filter((g): g is Game => Boolean(g)),
  );
};

// Total pitches a hypothetical player carries on one date (real log entries
// plus any folded planned outings) — the doubleheader daily-max input.
const pitchesOnDate = (player: Player, date: string): number => {
  const log = player.pitching?.log;
  if (!Array.isArray(log)) return 0;
  return log.reduce(
    (s, o) => (o?.date === date ? s + (Number(o.pitches) || 0) : s),
    0,
  );
};

// First date (within 14 days after `fromDate`) the player becomes eligible —
// mirrors buildPitchingPlan's probe so violation copy can say "ready Tue 6/9".
const firstEligibleDate = (
  player: Player,
  fromDate: string,
  teamAge: string,
  ruleSet: PitchRuleSet,
): string | null => {
  const base = new Date(fromDate).getTime();
  for (let d = 1; d <= 14; d++) {
    const probe = new Date(base + d * 86_400_000).toISOString().slice(0, 10);
    if (checkPitchEligibility(player, probe, teamAge, ruleSet)) return probe;
  }
  return null;
};

interface AssessGamesArgs {
  // Chronologically ordered, dated games (orderGamesChronologically them).
  orderedGames: Game[];
  // Where each game's planned outings live — tournament.pitchPlan for a
  // stored tournament, game.pitchPlan for standalone games (see planForGame
  // above).
  planFor: (gameId: string) => PlannedOuting[];
  players: Player[] | null | undefined;
  teamAge: string;
  ruleSet: PitchRuleSet;
}

// The heart of the cross-game math: walk the given games in order, and for
// each one assess every arm AS IF all earlier games' planned outings had
// already been thrown. Violations are computed for the game's own entries
// (and a violating entry still folds forward — the coach should see both the
// violation AND its downstream effect, not have the plan silently ignored).
// Both the tournament panel and the week planner run THIS function, so a
// weekend and a whole week can never disagree on the same plan.
export function assessGamesPlan({
  orderedGames,
  planFor,
  players,
  teamAge,
  ruleSet,
}: AssessGamesArgs): GamePlanAssessment[] {
  const ordered = orderedGames;
  const roster = players || [];
  const realById = new Map(roster.map((p) => [p.id, p]));
  const maxP = maxPitchesForAge(teamAge, ruleSet);
  // Planned load accumulated from earlier games, per player.
  const acc = new Map<PlayerId, HypotheticalOuting[]>();
  const out: GamePlanAssessment[] = [];

  for (const game of ordered) {
    const date = game.date as string;
    const hypPlayers = roster.map((p) =>
      withPlannedOutings(p, acc.get(p.id) || []),
    );
    const hypById = new Map(hypPlayers.map((p) => [p.id, p]));
    const arms = buildPitchingPlan(hypPlayers, date, teamAge, ruleSet);

    const violations: PlanViolation[] = [];
    for (const entry of planFor(game.id)) {
      const real = realById.get(entry.playerId);
      if (!real) continue;
      // Reality already recorded this outing — the real log speaks for it.
      if (planEntryStatus(entry, game, real) === "consumed") continue;

      const hyp = hypById.get(entry.playerId) || real;
      const planned = plannedPitchesOf(entry, teamAge, ruleSet);
      const name = real.name || "This pitcher";
      const sameDay = pitchesOnDate(hyp, date);

      if (sameDay + planned > maxP) {
        violations.push({
          gameId: game.id,
          playerId: entry.playerId,
          playerName: name,
          kind: "dailyMax",
          message: `${name}: ${sameDay} same-day + ${planned} planned pitches passes the ${maxP}-pitch daily max.`,
        });
      } else if (!checkPitchEligibility(hyp, date, teamAge, ruleSet)) {
        const { pitches: recent, date: lastDate } = mostRecentDayPitches(
          hyp.pitching,
        );
        if (lastDate === date) {
          violations.push({
            gameId: game.id,
            playerId: entry.playerId,
            playerName: name,
            kind: "notEligibleToday",
            message: `${name} already has a mound appearance that day — one per day.`,
          });
        } else {
          const ready = firstEligibleDate(hyp, date, teamAge, ruleSet);
          violations.push({
            gameId: game.id,
            playerId: entry.playerId,
            playerName: name,
            kind: recent >= maxP ? "notEligibleToday" : "insufficientRest",
            message: `${name} threw ${recent} on ${lastDate} and isn't rested by ${date}${
              ready ? ` (ready ${ready})` : ""
            }.`,
          });
        }
      }

      // Fold this entry forward for the games after this one.
      const list = acc.get(entry.playerId) || [];
      acc.set(entry.playerId, [...list, { date, pitches: planned }]);
    }

    out.push({ gameId: game.id, date, arms, violations });
  }
  return out;
}

interface AssessArgs {
  tournament: Tournament;
  games: Game[] | null | undefined; // full schedule; ids resolve against it
  players: Player[] | null | undefined;
  teamAge: string;
  ruleSet: PitchRuleSet;
}

// The tournament-scoped fold: the core walk over the tournament's own games,
// reading plans from tournament.pitchPlan.
export function assessTournamentPlan({
  tournament,
  games,
  players,
  teamAge,
  ruleSet,
}: AssessArgs): TournamentGameAssessment[] {
  return assessGamesPlan({
    orderedGames: orderedTournamentGames(tournament, games),
    planFor: (gameId) => tournament.pitchPlan?.[gameId] || [],
    players,
    teamAge,
    ruleSet,
  });
}

// The not-yet-consumed planned outings that land strictly BEFORE `gameId`
// anywhere on the schedule, per player — ready to feed withPlannedOutings.
// This is what lets surfaces OUTSIDE the planning cards (StartingPitcherPicker)
// see what's already penciled in. Plans resolve through planForGame, so
// tournament-stored entries AND standalone game.pitchPlan entries (the week
// planner's write target) both fold in — a Wednesday rec-game plan discounts
// the same arm on Saturday whether or not either game sits in a stored
// tournament. Old planned entries beyond the rest window are harmless: rest
// math only reads the most recent throwing day, and consumed entries (game
// finalized / outing imported) are skipped because the real log carries them.
// Empty map when the game is unknown or undated (nothing to order against).
export function priorPlannedOutingsForGame(
  tournaments: Tournament[] | null | undefined,
  games: Game[] | null | undefined,
  players: Player[] | null | undefined,
  gameId: string,
  teamAge: string,
  ruleSet: PitchRuleSet,
): Map<PlayerId, HypotheticalOuting[]> {
  const acc = new Map<PlayerId, HypotheticalOuting[]>();
  const ordered = orderGamesChronologically(games);
  const idx = ordered.findIndex((g) => g.id === gameId);
  if (idx < 0) return acc;
  const realById = new Map((players || []).map((p) => [p.id, p]));
  for (const game of ordered.slice(0, idx)) {
    for (const entry of planForGame(game, tournaments)) {
      const real = realById.get(entry.playerId);
      if (!real) continue;
      if (planEntryStatus(entry, game, real) === "consumed") continue;
      const list = acc.get(entry.playerId) || [];
      acc.set(entry.playerId, [
        ...list,
        {
          date: game.date as string,
          pitches: plannedPitchesOf(entry, teamAge, ruleSet),
        },
      ]);
    }
  }
  return acc;
}

// The games strictly AFTER `gameId` anywhere on the schedule where this
// player carries a planned outing — the in-game "you planned this arm for
// tomorrow" advisory. Plans resolve through planForGame, so a standalone
// game's week-planner plan flags the arm just like a tournament plan does.
// Later games are future-dated, so their entries are still live (a consumed
// entry needs a finalized game or an imported outing); no consumption filter.
// Empty when the game is unknown or undated.
export function laterPlannedGamesForPlayer(
  tournaments: Tournament[] | null | undefined,
  games: Game[] | null | undefined,
  playerId: string,
  gameId: string,
): Game[] {
  const ordered = orderGamesChronologically(games);
  const idx = ordered.findIndex((g) => g.id === gameId);
  if (idx < 0) return [];
  return ordered
    .slice(idx + 1)
    .filter((g) =>
      planForGame(g, tournaments).some((e) => e.playerId === playerId),
    );
}

// Derived weekend clusters that no stored tournament has claimed — the
// "Name this tournament" suggestion chips. A cluster is claimed by seedKey
// (it was explicitly promoted, even if games were later unlinked) or by any
// gameId overlap with a stored tournament.
export function unclaimedTournamentSuggestions(
  games: Game[] | null | undefined,
  teamLeagueRuleSet: string | undefined,
  tournaments: Tournament[] | null | undefined,
): TournamentGroup[] {
  const stored = tournaments || [];
  const claimedIds = new Set(stored.flatMap((t) => t.gameIds || []));
  const claimedSeeds = new Set(
    stored.map((t) => t.seedKey).filter(Boolean) as string[],
  );
  return deriveTournaments(games, teamLeagueRuleSet).filter(
    (c) =>
      !claimedSeeds.has(c.id) && !c.gameIds.some((id) => claimedIds.has(id)),
  );
}
