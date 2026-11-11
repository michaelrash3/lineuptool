// Player-development trend engine + the per-season summary archiver used by
// Advance Season. Pure aggregation (no React) over games, eval rounds, and
// practices; all stat math is delegated to the existing aggregation helpers
// in stats.ts / season.ts so the numbers here can never drift from the ones
// the Stats tab shows.

import {
  compareHittingForm,
  countedGameLines,
  runningFormSeries,
  type FormBasis,
} from "./hittingForm";
import { countsTowardStats } from "./gameStatus";
import { buildSeasonPositionVariety, POSITION_INNINGS_FIELDS } from "./season";
import { currentEvaluationScore100 } from "./evaluationScore";
import { isRosterPlayer } from "./subPlayers";
import { attIsPresent, attIsAbsent } from "./attendance";
import type {
  EvaluationEvent,
  Game,
  Player,
  PlayerPastSeasonSummary,
  PlayerStats,
  Practice,
} from "../types";

// ============================================================================
// Trend heuristics — the single source of truth for "is this kid trending up":
//
// Batting — on-base percentage, second half of the season's games against
//   the first half (an odd count gives the extra game to the first half, as
//   Positions does). Needs ≥ 4 imported game lines and ≥ 10 trips to the
//   plate in each half. A move counts only when it beats the usual luck swing
//   for that many trips (and is at least .050); utils/hittingForm.ts has the
//   math and the fallbacks (AVG, then QAB%) for lines without on-base, and
//   the Stats tab's Recent Form uses the same comparison.
//
// Evals — rounds selected exactly like PlayerDevelopmentReport's useEvalTrend:
//   skip tryout rounds, keep rounds that graded this player, chronological by
//   date then createdAt. Per-round score = currentEvaluationScore100. Needs
//   ≥ 2 scored rounds. delta = last - first; ≥ +4 improving, ≤ -4 declining,
//   else steady (scores are 0-100 integers, so ±4 is a real move).
//
// Positions — needs ≥ 4 game lines (≥ 2 per half; an odd count gives the
//   extra game to the FIRST half). Distinct positions = labels with > 0
//   innings via the fInn* actuals fields. More distinct positions in the
//   second half than the first = improving (the rotation is widening).
//
// Overall — one vote per non-insufficient signal (+1 improving, -1 declining);
//   net ≥ +1 improving, ≤ -1 declining, else steady. No usable signals at
//   all → insufficient.
// ============================================================================

export type TrendClass = "improving" | "steady" | "declining" | "insufficient";

export interface TrendSignal {
  class: TrendClass;
  delta?: number;
  series?: number[];
}

export interface BattingTrend extends TrendSignal {
  basis: FormBasis | null;
  // First-half and second-half rates, and the move that had to be beaten.
  earlier?: number;
  recent?: number;
  threshold?: number;
}

export interface EvalTrend extends TrendSignal {
  first?: number;
  last?: number;
  rounds: number;
}

export interface PositionTrend extends TrendSignal {
  firstHalfDistinct: number;
  secondHalfDistinct: number;
}

export interface PlayerDevelopmentTrend {
  playerId: string;
  name: string;
  batting: BattingTrend;
  evals: EvalTrend;
  positions: PositionTrend;
  overall: TrendClass;
  signalCount: number;
}

const BATTING_MIN_LINES = 4;
const BATTING_MIN_TRIPS_PER_HALF = 10;
const EVAL_MIN_ROUNDS = 2;
const EVAL_DELTA = 4;
const POSITION_MIN_LINES = 4;

// Finalized non-scrimmage games that carry an imported box-score line for the
// player, oldest first (same raw-date sort the stats.ts helpers use).
const countedGamesWithLine = (
  games: Game[] | null | undefined,
  playerId: string,
): Game[] =>
  (games || [])
    .filter((g) => countsTowardStats(g) && g?.playerStats?.[playerId])
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

const battingTrend = (
  games: Game[] | null | undefined,
  playerId: string,
): BattingTrend => {
  const insufficient: BattingTrend = { class: "insufficient", basis: null };
  const lines = countedGameLines(games, playerId).map((l) => l.line);
  if (lines.length < BATTING_MIN_LINES) return insufficient;
  const split = Math.ceil(lines.length / 2);
  const form = compareHittingForm(lines.slice(0, split), lines.slice(split), {
    minEarlier: BATTING_MIN_TRIPS_PER_HALF,
    minRecent: BATTING_MIN_TRIPS_PER_HALF,
  });
  if (form.class === "insufficient" || !form.basis) return insufficient;
  return {
    class: form.class,
    delta: form.delta,
    basis: form.basis,
    earlier: form.earlier,
    recent: form.recent,
    threshold: form.threshold,
    series: runningFormSeries(lines, form.basis),
  };
};

// The player's per-round eval scores, chronological. Round selection mirrors
// PlayerDevelopmentReport's useEvalTrend exactly: tryout rounds are skipped,
// rounds that didn't grade this player are skipped, and rounds sort by date
// with createdAt as the same-day tiebreaker. Rounds whose grades don't yield
// a score are dropped (they can't anchor a first/last comparison).
const evalScoresForPlayer = (
  evaluationEvents: EvaluationEvent[] | null | undefined,
  player: Player,
  teamAge?: string,
  // The team's own eval categories (utils/evalCategories.ts). Each round is
  // scored against ITS OWN contents, so a round saved before a category
  // existed keeps the score it always had.
  extraCategories?: ReadonlyArray<{ id: string; weight: number }>,
  pitchingFormat?: string,
): number[] => {
  const rounds = (evaluationEvents || [])
    .filter((e) => !e?.tryoutSignupId && e?.grades?.[player.id])
    .slice()
    .sort(
      (a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        (a.createdAt || 0) - (b.createdAt || 0),
    );
  const scores: number[] = [];
  for (const round of rounds) {
    const score = currentEvaluationScore100(
      round.grades?.[player.id],
      player,
      teamAge,
      null,
      extraCategories,
      pitchingFormat,
    );
    if (score !== null) scores.push(score);
  }
  return scores;
};

const evalTrend = (scores: number[]): EvalTrend => {
  if (scores.length < EVAL_MIN_ROUNDS) {
    return { class: "insufficient", rounds: scores.length };
  }
  const first = scores[0];
  const last = scores[scores.length - 1];
  const delta = last - first;
  return {
    class:
      delta >= EVAL_DELTA
        ? "improving"
        : delta <= -EVAL_DELTA
          ? "declining"
          : "steady",
    delta,
    first,
    last,
    rounds: scores.length,
    series: scores.slice(),
  };
};

const distinctPositionCount = (lines: PlayerStats[]): number => {
  const seen = new Set<string>();
  for (const line of lines) {
    for (const [field, pos] of POSITION_INNINGS_FIELDS) {
      const innings = Number(line?.[field]);
      if (Number.isFinite(innings) && innings > 0) seen.add(pos);
    }
  }
  return seen.size;
};

const positionTrend = (
  games: Game[] | null | undefined,
  playerId: string,
): PositionTrend => {
  const lines = countedGamesWithLine(games, playerId).map(
    (g) => g.playerStats![playerId],
  );
  if (lines.length < POSITION_MIN_LINES) {
    return {
      class: "insufficient",
      firstHalfDistinct: 0,
      secondHalfDistinct: 0,
    };
  }
  // Odd counts give the extra game to the first half.
  const splitAt = Math.ceil(lines.length / 2);
  const firstHalfDistinct = distinctPositionCount(lines.slice(0, splitAt));
  const secondHalfDistinct = distinctPositionCount(lines.slice(splitAt));
  return {
    class:
      secondHalfDistinct > firstHalfDistinct
        ? "improving"
        : secondHalfDistinct < firstHalfDistinct
          ? "declining"
          : "steady",
    delta: secondHalfDistinct - firstHalfDistinct,
    firstHalfDistinct,
    secondHalfDistinct,
  };
};

const overallOf = (
  signals: TrendSignal[],
): { overall: TrendClass; signalCount: number } => {
  let votes = 0;
  let signalCount = 0;
  for (const s of signals) {
    if (s.class === "insufficient") continue;
    signalCount++;
    if (s.class === "improving") votes += 1;
    else if (s.class === "declining") votes -= 1;
  }
  if (signalCount === 0) return { overall: "insufficient", signalCount: 0 };
  return {
    overall: votes >= 1 ? "improving" : votes <= -1 ? "declining" : "steady",
    signalCount,
  };
};

const CLASS_ORDER: Record<TrendClass, number> = {
  improving: 0,
  steady: 1,
  declining: 2,
  insufficient: 3,
};

export const computeDevelopmentTrends = (args: {
  players: Player[];
  games: Game[];
  evaluationEvents: EvaluationEvent[];
  // currentEvaluationScore100 sizes pitcher velocity against the age group;
  // optional so callers without the team doc handy still get scores.
  teamAge?: string;
  // See evalScoresForPlayer — omitted ⇒ stock catalog, unchanged numbers.
  extraCategories?: ReadonlyArray<{ id: string; weight: number }>;
  // With teamAge, picks the hitting tier for the eval scores.
  pitchingFormat?: string;
}): PlayerDevelopmentTrend[] => {
  const {
    players,
    games,
    evaluationEvents,
    teamAge,
    extraCategories,
    pitchingFormat,
  } = args;
  return (players || [])
    .filter((p) => p && isRosterPlayer(p))
    .map((p): PlayerDevelopmentTrend => {
      const batting = battingTrend(games, p.id);
      const evals = evalTrend(
        evalScoresForPlayer(
          evaluationEvents,
          p,
          teamAge,
          extraCategories,
          pitchingFormat,
        ),
      );
      const positions = positionTrend(games, p.id);
      const { overall, signalCount } = overallOf([batting, evals, positions]);
      return {
        playerId: p.id,
        name: p.name,
        batting,
        evals,
        positions,
        overall,
        signalCount,
      };
    })
    .sort(
      (a, b) =>
        CLASS_ORDER[a.overall] - CLASS_ORDER[b.overall] ||
        Math.abs(b.evals.delta ?? 0) - Math.abs(a.evals.delta ?? 0) ||
        a.name.localeCompare(b.name),
    );
};

// Compact per-player development summary for Advance Season — the game-level
// inputs (game lines, attendance maps, eval rounds) are cleared at rollover,
// so this is what survives into pastSeasons. Includes departed players (the
// caller decides who gets archived). Fields are only set when they have real
// content: Firestore rejects undefined, and an empty summary is omitted from
// the map entirely.
export const buildPlayerSeasonSummaries = (args: {
  players: Player[];
  games: Game[];
  practices: Practice[];
  evaluationEvents: EvaluationEvent[];
  // Same optional pitcher-velocity / hitting-tier context as
  // computeDevelopmentTrends.
  teamAge?: string;
  extraCategories?: ReadonlyArray<{ id: string; weight: number }>;
  pitchingFormat?: string;
}): Map<string, PlayerPastSeasonSummary> => {
  const {
    players,
    games,
    practices,
    evaluationEvents,
    teamAge,
    extraCategories,
    pitchingFormat,
  } = args;
  const out = new Map<string, PlayerPastSeasonSummary>();
  const variety = buildSeasonPositionVariety(games);
  // Every recorded attendance map — games AND practices, regardless of game
  // status, exactly like the development report's attendance figure.
  const attendanceMaps: Array<Record<string, unknown>> = [
    ...(games || []).filter((g) => g.attendance).map((g) => g.attendance!),
    ...(practices || []).filter((p) => p.attendance).map((p) => p.attendance!),
  ];

  for (const player of players || []) {
    if (!player?.id) continue;
    const summary: PlayerPastSeasonSummary = {};

    const gamesWithLines = countedGamesWithLine(games, player.id).length;
    if (gamesWithLines > 0) summary.gamesWithLines = gamesWithLines;

    let present = 0;
    let marked = 0;
    for (const m of attendanceMaps) {
      const v = m[player.id];
      if (attIsPresent(v)) {
        present++;
        marked++;
      } else if (attIsAbsent(v)) {
        marked++;
      }
    }
    if (marked > 0) summary.attendanceRate = present / marked;

    const scores = evalScoresForPlayer(
      evaluationEvents,
      player,
      teamAge,
      extraCategories,
      pitchingFormat,
    );
    if (scores.length > 0) {
      summary.evalRounds = scores.length;
      summary.evalFirst100 = scores[0];
      summary.evalLast100 = scores[scores.length - 1];
    }

    const entry = variety.get(player.id);
    if (entry && entry.totalDefense > 0) {
      summary.positionInnings = { ...entry.byPosition };
      summary.distinctPositions = entry.distinctPositions;
    }

    // Development-plan outcomes. Goals resolve at rollover (achieved/dropped
    // don't carry forward — see rolloverDevPlan), so the counts land here.
    const plan = player.devPlan;
    if (plan) {
      const goals = plan.goals || [];
      if (goals.length > 0) {
        summary.goalsSet = goals.length;
        const achieved = goals.filter((g) => g.status === "achieved").length;
        if (achieved > 0) summary.goalsAchieved = achieved;
      }
      if (plan.focusAreas?.length) summary.focusAreas = [...plan.focusAreas];
    }

    if (Object.keys(summary).length > 0) out.set(player.id, summary);
  }
  return out;
};
