// Lightweight shared types. Kept loose because the legacy App.jsx code
// constructs these shapes ad-hoc; tightening them would cascade through
// thousands of lines. Use `Partial<...>` or extend as needed.

export type PlayerId = string;

export interface PlayerStats {
  ops?: number;
  obp?: number;
  avg?: number;
  contact?: number;
  totalPitches?: number;
  ip?: number;
  era?: number;
  ab?: number;
  h?: number;
  doubles?: number;
  triples?: number;
  hr?: number;
  rbi?: number;
  sb?: number;
  k?: number;
  fpct?: number;
  tc?: number;
  a?: number;
  po?: number;
  ld?: number;
  fb?: number;
  gb?: number;
  hard?: number;
  qab?: number;
  babip?: number;
  [key: string]: number | undefined;
}

export interface Player {
  id: PlayerId;
  name: string;
  number?: string | number;
  dob?: string;
  stats?: PlayerStats;
  // Positive position model (v4+): positions the coach is comfortable with
  // this player playing. Empty/missing = "any". Replaces the v3 negative
  // `restrictions` field, which the engine still falls back to.
  comfortablePositions?: string[];
  // Whether this player is in the catching rotation. Pulled out of the
  // position list because C is special (equipment, continuity, smaller
  // group of trained kids).
  isCatcher?: boolean;
  // Will this kid come back next season? Explicit boolean as of the
  // returning-Y/N change. Default-undefined means "yes" — back-compat
  // with rounds saved before this field existed. AdvanceSeasonModal
  // explicitly sets false when the HC toggles a kid off.
  returning?: boolean;
  // Workflow status — slimmed to tryout-flow states only as of the
  // returning-Y/N change. The legacy "returning" / "released" values
  // still appear on existing player docs; isReturning() resolves them
  // transparently via the helper in src/utils/helpers.ts.
  playerStatus?:
    | "returning"
    | "released"
    | "tryout"
    | "offered"
    | "accepted"
    | "declined";
  [key: string]: unknown;
}

export type SlimPlayer =
  | (Pick<Player, "id" | "name" | "number"> & { photoUrl?: string })
  | null;

// An inning maps position labels to a single player, except BENCH which is
// an array of players sitting that inning.
export interface Inning {
  BENCH?: SlimPlayer[];
  [position: string]: SlimPlayer | SlimPlayer[] | undefined;
}

export type GameStatus = "draft" | "final" | "in_progress" | string;

// Tournament classification — drives engine pitcher pool sizes for 9U+
// Kid Pitch. Pool = spread across the staff (top 5); Bracket = your aces
// (top 3); League = regular season default (top 3). Independent of
// `isBigGame` (a Bracket game is often also a Big Game).
export type GameType = "league" | "pool" | "bracket";

export interface Game {
  id: string;
  date?: string;
  time?: string;
  opponent?: string;
  status?: GameStatus;
  lineup?: Inning[];
  battingLineup?: SlimPlayer[];
  originalLineup?: Inning[];
  attendance?: Record<PlayerId, boolean>;
  gameType?: GameType;
  [key: string]: unknown;
}

export interface TryoutSignup {
  id: string;
  submittedAt: string;
  firstName: string;
  lastName: string;
  dob?: string;
  number?: string;
  bats?: string;
  throws?: string;
  comfortablePositions?: string[];
  isCatcher?: boolean;
  parentName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  status?: "tryout" | "offered" | "accepted" | "declined";
  // Attendance + check-in fields (set by the HC at tryouts).
  // present === true → showed up; false → no-show (eligible for bulk
  // delete via the End Tryout flow). Missing → not yet marked.
  present?: boolean;
  tryoutNumber?: string;
}

// Year-round "I might want to try out" interest. Separate collection
// from TryoutSignup so a coach can collect interest leads without
// tryouts being open. The HC can later convert one of these into a
// real TryoutSignup when tryouts open.
export interface InterestSignup {
  id: string;
  submittedAt: string;
  firstName: string;
  lastName: string;
  dob?: string;
  parentName?: string;
  email: string;
  phone: string;
  currentTeam?: string;
  comfortablePositions?: string[];
  notes?: string;
}

export interface Team {
  name?: string;
  primaryColor?: string;
  secondaryColor?: string;
  tertiaryColor?: string;
  // Inline team logo as a data URL (Spark-plan: no Cloud Storage). Rendered on
  // the lineup card and the public Tryouts Portal.
  logoUrl?: string;
  players?: Player[];
  games?: Game[];
  // Tryouts (PR M)
  tryoutShareId?: string;
  tryoutsOpen?: boolean;
  tryoutsPhase?: "open" | "intake_closed" | "completed";
  rosterCap?: number;
  tryoutSignups?: TryoutSignup[];
  // Year-round interest survey leads (PR 2). Lives outside tryoutsOpen
  // gate — the public form is always available at the standing share
  // URL so flyers stay useful between tryout cycles.
  interestSignups?: InterestSignup[];
  // Persistent team join code. 6-char uppercase alphanumeric. Anyone
  // who has the code can join the team as an assistant coach. The HC
  // can regenerate it (rotating all existing codes) from Settings.
  joinCode?: string;

  // ----- Season / game configuration (mirrors DEFAULT_TEAM_DATA) -----
  currentSeason?: string;
  teamAge?: string;
  leagueRuleSet?: string;
  pitchingFormat?: string;
  defenseSize?: string;
  battingSize?: string;
  inningsCount?: string;

  // ----- Evaluations -----
  evaluationEvents?: EvaluationEvent[];
  evalSchemaVersion?: number;
  lastEvalEmailedAt?: string;
  emailEvalRemindersDisabled?: boolean;

  // ----- Membership / ownership (mirrors firestore.rules) -----
  ownerId?: string;
  members?: string[];
  coachRoles?: Record<string, string>;
  coachContacts?: Array<{ id?: string; name?: string; email?: string }>;

  // ----- Tryouts config -----
  tryoutDates?: string[];

  // The long tail of dynamic/rarely-typed fields (templates, past seasons,
  // mid-game removals, catcher limits, etc.) stays permissive and is promoted
  // to explicit fields incrementally. Note: typing the full bag onto
  // TeamContextValue.team (replacing the `any` index signature there) cascades
  // ~160 type errors across consumers, so that tightening is intentionally a
  // separate, incremental effort — this just makes the known fields accurate.
  [key: string]: unknown;
}

export interface Toast {
  push: (t: { kind: "success" | "error" | "info"; title: string; message?: string }) => void;
  dismiss?: (id: string) => void;
}

// ---- React context value shapes ------------------------------------------
// A toast notification request. `kind` defaults to "info"; "warn" is used for
// soft fallbacks (e.g. one-game-balance lineups).
export interface ToastInput {
  kind?: "success" | "error" | "info" | "warn";
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface ToastContextValue {
  push: (t: ToastInput) => void;
  dismiss: (id: number | string) => void;
}

export type CoachRole = "head" | "assistant";

// The Team/UI providers expose large bags of state, setters, and command
// functions (see App.tsx). The most-used fields are typed here; the long tail
// of command functions / setters stays permissive via the `any` index
// signature and is promoted to real signatures incrementally.
export interface TeamContextValue {
  // `team` (the full team-data bag) stays `any` for now via the index
  // signature — promoting it to `Team` is a dedicated follow-up because the
  // optional/unknown fields ripple into every consumer. The API surface
  // below is the high-value, low-cascade tightening.
  currentRole: CoachRole;
  realRole: CoachRole;
  updateTeam: (patch: Partial<Team>) => void;
  switchTeam: (id: string) => void | Promise<void>;
  createTeam: (name?: string) => void | Promise<any>;
  [key: string]: any;
}

export interface UIContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedGameId: string | null;
  setSelectedGameId: (id: string | null) => void;
  openPlayerProfile: (id: string) => void;
  [key: string]: any;
}

export interface CsvImportRow {
  csvName: string;
  number: string;
  stats: PlayerStats;
}

export interface CsvImportResult {
  rows: CsvImportRow[];
  error?: string;
}

/* ============================================================================
   Lineup engine — typed surface (Phase 8 TS conversion).
   The engine emits these shapes and consumers (App.jsx, ScheduleTab,
   EvaluationTab) read them. Kept intentionally permissive in places where
   the engine's runtime accepts looser shapes than strict TS would prefer.
   ============================================================================ */

// 11 standard youth-baseball positions. The engine accepts unknown strings as
// keys on `Inning` so this stays a literal union for places that need it.
export type Position =
  | "P"
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "LF"
  | "LCF"
  | "CF"
  | "RCF"
  | "RF";

// 11 universal eval-category IDs from constants/ui.ts (Coach's Card v2).
// Kid-Pitch pitching + catching add-on IDs ride on the same Record because the
// engine's GradeMap is treated as `Record<string, number>` internally.
export type EvalCategoryId =
  | "contact"
  | "power"
  | "plateDiscipline"
  | "approach"
  | "glove"
  | "range"
  | "armStrength"
  | "armAccuracy"
  | "baserunning"
  | "baseballIQ"
  | "coachability";

// Grade record per player per round. Numeric 1–10 on every category, plus an
// optional free-form notes string (added in the Phase 5a workflow PR).
export type GradeMap = Partial<Record<EvalCategoryId | string, number>> & {
  notes?: string;
};

// Eval round payload as persisted in team.evaluationEvents.
export interface EvaluationEvent {
  id: string;
  date: string;
  coachRole?: "Head" | "Assistant";
  evaluatorId?: string;
  label?: string;
  grades?: Record<string, GradeMap>;
  [key: string]: unknown;
}

// Computed player profile — the engine builds one per active player as part
// of generateLineup. Score components feed batting-order strategies and
// position picking.
export interface PlayerProfile {
  grades: GradeMap;
  leadoffScore: number;
  powerScore: number;
  contactScore: number;
  overallScore: number;
  defensiveScore: number;
}

// Output of precomputeBenchSchedule(): a per-inning set of who's sitting plus
// any diagnostic notes about roster-size deficits.
export interface BenchScheduleResult {
  benchByInning: Array<Set<string>>;
  deficitNotes: string[];
}

// Top-level argument bundle for generateLineup / generateBattingOnly. Stays
// permissive (lots of optionals) — call sites in App.jsx pass a slightly
// different shape on each path. Tightening individual fields is an iterative
// follow-up, not part of this conversion PR.
export interface EngineInput {
  activePlayers: Player[];
  allPlayers?: Player[];
  games?: Game[];
  evaluationEvents?: EvaluationEvent[];
  currentGame?: Partial<Game> & { id?: string };
  firstInningOverridesById?: Record<string, string>;
  totalInnings?: number;
  leagueRuleSet?: string;
  teamAge?: string;
  defenseSize?: string;
  positionLock?: string;
  battingSize?: string;
  seed?: number;
  isBigGame?: boolean;
  pitchingFormat?: string;
  // Catcher playing-time policy. "auto" (default) preserves the legacy
  // defense-size-driven behavior; "1".."6" sets a hard per-kid innings cap;
  // "none" removes the cap. `catcherConsecutive` (only consulted for an
  // explicit cap) forces a catcher's innings to be back-to-back.
  catcherMaxInnings?: string;
  catcherConsecutive?: boolean;
  // Mid-game removal regeneration. When `fromInning > 0`, the engine pre-fills
  // innings `0..fromInning-1` from `currentLineup` and seeds its per-player
  // state from those placements, so the catcher 2-inning cap / P-cap / OF
  // rotation / fairness carry across the rebuild.
  fromInning?: number;
  currentLineup?: Inning[];
  [key: string]: unknown;
}

// Top-level engine return type. Most fields are optional because failure
// paths populate `error` only.
export interface EngineResult {
  lineup?: Inning[];
  battingLineup?: SlimPlayer[];
  error?: string;
  details?: string[];
  // True when the engine couldn't schedule strict season-fairness and fell
  // back to one-game balance. `fairnessRelaxedReason` is the human-readable
  // blocker that defeated the strict pass; `fairnessRelaxedType` is the raw
  // dominant failure type (e.g. "bench-schedule-impossible") for logging.
  fairnessRelaxed?: boolean;
  fairnessRelaxedReason?: string;
  fairnessRelaxedType?: string | null;
  [key: string]: unknown;
}

// Per-player extra-sit history derived from past games' BENCH usage. Used by
// the engine's fairness scheduler.
export interface ExtraSitHistory {
  defInn: number;
  benchInn: number;
  expectedDef: number;
  gamesAttended: number;
}
