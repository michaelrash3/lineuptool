// lineupEngine/types.ts
// Internal engine types shared across the split modules (NOT part of the public
// API). Kept separate so the generator / bench-schedule modules and the public
// barrel can all reference the same shapes without duplication.
import type { GradeMap, Inning, Player, PlayerProfile } from "../types";
import type { CatcherPolicy } from "./eligibility";
import type { PitchRuleSet } from "./pitchRules";

export type BattingReason = {
  role: string;
  note: string;
};

// Local alias: a Player with a pre-computed profile bag attached by the engine.
export type ProfiledPlayer = Player & {
  profile: PlayerProfile;
  battingReason?: BattingReason;
};

// Per-player seasonal bench/defense accumulator built by buildExtraSitHistory.
export type ExtraSitEntry = {
  extraSits: number;
  benchInn: number;
  defInn: number;
  expectedDef: number;
};

// Per-player state tracked across innings inside tryBuildLineup.
export type PlayerState = {
  bench: number;
  positions: Record<string, number>;
  history: string[];
};

// Failure record emitted per attempt by tryBuildLineup.
export type BenchFailure = {
  type: string;
  position?: string;
  inning?: number;
  playerName?: string;
};

// Options bag for the inner position-scoring function.
export type PickBestOpts = {
  pos: string;
  inn: number;
  profiled: ProfiledPlayer[];
  used: Set<string | unknown>;
  benchedSet: Set<string | unknown>;
  state: Map<string, PlayerState>;
  positionHistory: Map<string, Map<string, { total: number; bigGame: number }>>;
  headGrades: Record<string, GradeMap>;
  defenseSize?: string;
  positionLock?: string;
  leagueRuleSet?: string;
  teamAge?: string;
  targetDateStr?: string;
  leftyPenalty?: number;
  isLockInning?: boolean;
  isBigGame?: boolean;
  competitive?: boolean;
  pitcherPoolIds?: Set<string> | null;
  depthChartRank?: Map<string, Map<string, number>>;
  chartedPlayerIds?: Set<string>;
  isKidPitch?: boolean;
  pitchRules?: PitchRuleSet;
  sameDayRoles?: { pitched?: Set<string>; caught?: Set<string> } | null;
  catcherCap?: number;
  // Kid-Pitch game-long pitcher pin (see generator.ts): when set, P is not a
  // rotating slot — only this player may take the mound.
  fixedPitcherId?: string | null;
  rand: () => number;
  premiumPositions: Set<string>;
  positionFlexibility: Map<string, number>;
};

// Inning-block representation for catcher rotation (back-to-back stints).
export type CatcherBlock = number[];

// Options for the internal bench-schedule pre-computation pass.
export type BenchScheduleOpts = {
  profiled: ProfiledPlayer[];
  totalInnings: number;
  numToBench: number;
  competitive?: boolean;
  priorExtraSits: Map<string, ExtraSitEntry>;
  firstInningBenchHx: Map<string, number>;
  topHalfIds: Set<string>;
  catcherInningBlocks: CatcherBlock[] | null;
  catcherCap: number;
  enforceCatcherCap: boolean;
  positionsToFill: string[];
  rand: () => number;
  forcedBenchInning0: Set<string> | null;
  firstInningOverridesById: Record<string, string>;
  // Kid-Pitch game-long pitcher pin: this player is on the mound every inning,
  // so the bench pre-schedule must never sit him (his sit share is
  // redistributed to the rest of the roster) and never reserve him at catcher.
  fixedPitcherId?: string | null;
  // The inning the position overrides apply to. 0 for a normal from-scratch
  // build; on a mid-game rebuild (fromInning > 0 + currentLineup) it's the
  // first RE-SOLVED inning, so a coach's in-game pin lands where they made it.
  overrideInning?: number;
};

// Context passed to each tryBuildLineup attempt.
export type TryBuildCtx = {
  profiled: ProfiledPlayer[];
  positionsToFill: string[];
  numToBench: number;
  totalInnings: number;
  isStarter: Set<string>;
  firstInningOverridesById: Record<string, string>;
  stickyOverridesById?: Record<string, string>;
  positionHistory: Map<string, Map<string, { total: number; bigGame: number }>>;
  firstInningBenchHx: Map<string, number>;
  benchHistory: Map<string, ExtraSitEntry>;
  headGrades: Record<string, GradeMap>;
  defenseSize: string;
  positionLock?: string;
  leagueRuleSet?: string;
  teamAge?: string;
  targetDateStr: string;
  leftyPenalty?: number;
  isBigGame?: boolean;
  competitive?: boolean;
  pitcherPoolIds?: Set<string> | null;
  depthChartRank?: Map<string, Map<string, number>>;
  chartedPlayerIds?: Set<string>;
  isKidPitch?: boolean;
  pitchRules?: PitchRuleSet;
  sameDayRoles?: { pitched?: Set<string>; caught?: Set<string> };
  catcherPolicy?: CatcherPolicy;
  // Kid-Pitch game-long pitcher pin resolved by the generator (null for
  // machine/coach pitch, or when no valid arm could be resolved).
  fixedPitcherId?: string | null;
  rand: () => number;
  fromInning?: number;
  currentLineup?: Inning[] | null;
};
