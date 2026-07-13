// lineupEngine/engineContext.ts
// Shared setup prologue for the lineup generators + the batting-only entry
// point: build the per-player profile bag (combined grades -> profiles -> id
// index) and resolve the pitch-rule / game-date / kid-pitch context. Extracted
// so generateLineup, generateTournamentLineup, and generateBattingOnly don't
// each re-implement the same boilerplate. Behavior-preserving.
import type { EvaluationEvent, Game, GradeMap, Player } from "../types";
import { getCombinedGrades } from "./grades";
import { buildPlayerProfile } from "./profile";
import { DEFAULT_PITCH_RULE_SET } from "./pitchRules";
import type { PitchRuleSet } from "./pitchRules";
import type { ProfiledPlayer } from "./types";

// Merge eval grades, attach a profile bag to each active player, and index by
// id. Mirrors the three call sites exactly (games defaults to []).
export function buildProfiledPlayers(input: {
  activePlayers: Player[];
  allPlayers?: Player[] | null;
  evaluationEvents?: EvaluationEvent[];
  games?: Game[];
  teamAge?: string;
}): {
  combinedGrades: Record<string, GradeMap>;
  profiled: ProfiledPlayer[];
  byId: Map<string, ProfiledPlayer>;
} {
  const {
    activePlayers,
    allPlayers,
    evaluationEvents = [],
    games = [],
    teamAge,
  } = input;
  const combinedGrades = getCombinedGrades(
    evaluationEvents,
    allPlayers || activePlayers,
    { teamAge, games },
  );
  const profiled: ProfiledPlayer[] = activePlayers.map((p) => ({
    ...p,
    profile: buildPlayerProfile(p, combinedGrades[p.id]),
  }));
  const byId = new Map(
    profiled.map((p): [string, ProfiledPlayer] => [p.id, p]),
  );
  return { combinedGrades, profiled, byId };
}

// Resolve the pitch-rule set, target game date (YYYY-MM-DD), and whether this
// is a Kid-Pitch format. Shared by both lineup generators.
export function resolveGameContext(input: {
  pitchRuleSet?: PitchRuleSet | null;
  currentGame?: { date?: string } | null;
  pitchingFormat?: string;
}): { ruleSet: PitchRuleSet; gameDate: string; kidPitch: boolean } {
  const ruleSet = input.pitchRuleSet || DEFAULT_PITCH_RULE_SET;
  const gameDate =
    input.currentGame?.date || new Date().toISOString().slice(0, 10);
  const kidPitch = /kid/i.test(String(input.pitchingFormat || ""));
  return { ruleSet, gameDate, kidPitch };
}
