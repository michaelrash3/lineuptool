// Lightweight shared types. Kept loose because the legacy App.jsx code
// constructs these shapes ad-hoc; tightening them would cascade through
// thousands of lines. Use `Partial<...>` or extend as needed.

// Category taxonomies live with the catalog they mirror (type-only import — no
// runtime cycle: the constants module imports only types from here).
import type {
  FinanceCategoryId,
  RevenueCategoryId,
} from "./constants/financeCategories";
import type { TeamFeatureId } from "./constants/features";

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
  // GameChanger advanced stats, section-namespaced to avoid the duplicate
  // column names GameChanger reuses across Batting/Pitching/Fielding.
  // Pitching (p*): control/efficiency, run prevention, bat-missing/weak contact,
  // and (when tracked or hand-entered) velocity.
  pIp?: number;
  pBf?: number;
  pStrikePct?: number; // S%
  pFps?: number; // first-pitch strike %
  pBbPerInn?: number;
  pKbb?: number; // K/BB
  pWhip?: number;
  pEra?: number;
  pBaa?: number; // batting avg against
  pKbf?: number; // K/BF
  pSwingMiss?: number; // SM%
  pWeak?: number; // WEAK%
  pHardPct?: number; // HHB% (hard-hit allowed)
  pGoAo?: number; // ground/air out ratio
  pTopMph?: number;
  pFbMph?: number;
  // Fielding (f*): reliability/range + catcher throwing/blocking.
  fFpct?: number;
  fErrors?: number;
  fTc?: number;
  fAssists?: number;
  fPutouts?: number;
  fCsPct?: number; // caught-stealing % (catcher)
  fPb?: number; // passed balls
  fSbAllowed?: number;
  fSbAtt?: number;
  // Defensive innings played, per position, from the GameChanger fielding
  // section's trailing innings block (C = innings caught; Total = total
  // defensive innings). These are the actual-innings source for defensive
  // innings, bench equity, and position variety — replacing the old
  // lineup-inferred counts. GameChanger's "SF" column is right-center field
  // (RCF) in coach parlance, so fInnSF maps to the RCF position label.
  fInnC?: number;
  fInnP?: number;
  fInn1B?: number;
  fInn2B?: number;
  fInn3B?: number;
  fInnSS?: number;
  fInnLF?: number;
  fInnCF?: number;
  fInnRF?: number;
  fInnSF?: number;
  fInnTotal?: number;
  // Internal computed fields injected by the blending / power-grade helpers.
  // Never persisted; only live during an engine run.
  __slg?: number;
  __xbh?: number;
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
  // Coach-designated primary and secondary positions (big-game pre-pin logic).
  primaryPosition?: string;
  secondaryPosition?: string;
  // Per-season historical stats for multi-season stat blending. Each entry
  // carries a season label and the stats for that year; the engine uses the
  // two most recent past seasons when current-year AB count is low.
  pastSeasons?: Array<{ season?: string; stats?: PlayerStats }>;
  // Legacy pitching log (pre-v5 schema). The canonical fields migrated to
  // PlayerStats (pTopMph, pTopMphDate); this sub-object still appears on
  // older player docs and is read by the pitching-plan engine.
  pitching?: {
    log?: Array<{ date?: string; pitches?: number }>;
    recentPitches?: number;
    // null (not just absent) is the stored "hasn't pitched" state — addPlayer
    // writes it as null explicitly.
    lastPitchDate?: string | null;
    topMph?: number;
  };
  // ISO yyyy-mm-dd dates the family already knows the kid is unavailable
  // (entered ahead of time on the profile). Games on these dates default
  // the kid to absent in Game Day Attendance; the coach can still toggle
  // them back per game.
  absences?: string[];
  availabilityBlocks?: AvailabilityBlock[];
  // ISO instant of the most recent parent Availability-form submission applied
  // to this player. Drives the Availability tab's completion tracker (who has /
  // hasn't filled out the form). Absent = no submission on file yet.
  availabilitySubmittedAt?: string;
  // ISO instant of the most recent Player Info form submission applied to this
  // player. Drives the Player Info tab's completion tracker. Absent = none yet.
  playerInfoSubmittedAt?: string;
  // Will this kid come back next season? Explicit boolean as of the
  // returning-Y/N change. For Advance Season, missing still means "yes"
  // for back-compat via isReturning(); Tryouts planning treats missing as
  // "unknown" via getReturningDecision().
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
  // null (not just absent) is the stored "no lineup yet" state — addGame
  // writes both as null explicitly.
  lineup?: Inning[] | null;
  battingLineup?: SlimPlayer[] | null;
  originalLineup?: Inning[];
  // Durable in-game manual position picks (field position → playerId). When the
  // coach moves a player to a spot during a game, that choice is remembered and
  // fed into every rest-of-game re-flow so it sticks (and later re-flows from
  // other changes don't undo it). See InGameView + the engine's
  // stickyOverridesById.
  manualLocks?: Record<string, string>;
  attendance?: Record<PlayerId, boolean>;
  gameType?: GameType;
  // Marks an exhibition/scrimmage: stays on the schedule and is playable, but
  // is excluded from the record, all stats, defensive innings, bench equity,
  // and engine seasonal fairness.
  isScrimmage?: boolean;
  // Imported from a GameChanger feed (see utils/gcSync). gcUid is the feed's
  // stable per-game id used to de-dupe on re-sync.
  gcUid?: string;
  // Per-game pitching-format override (e.g. one Machine Pitch tournament game
  // on a Kid Pitch team). Falls back to team.pitchingFormat everywhere.
  pitchingFormat?: string;
  // Per-game imported stat lines (the season CSV filtered to this game), keyed
  // by player id. When per-game lines exist for a player, their season stats
  // are DERIVED by summing these lines (counting stats sum, rates recompute /
  // weight) — with pitching only ever stored for Kid Pitch games, so a mixed
  // machine+kid schedule never pollutes kid-pitch pitching numbers.
  playerStats?: Record<PlayerId, PlayerStats>;
  // When the per-game stat line was last imported (ISO instant).
  statsImportedAt?: string;
  isHome?: boolean | null;
  location?: string;
  // ISO instant of first pitch; drives the displayed time. null for all-day
  // feed events (no clock time shown).
  startUtc?: string | null;
  [key: string]: unknown;
}

// Skill bucket a drill works on. Mirrors the EvalGroup vocabulary
// (src/constants/ui.ts) plus "Conditioning" and "Team" for warm-ups and
// situational/scrimmage work that don't map onto a single eval group.
export type DrillCategory =
  | "Hitting"
  | "Fielding"
  | "Baserunning"
  | "Pitching"
  | "Catching"
  | "Conditioning"
  | "Team";

// A reusable drill definition in the team's drill library. The library is
// shared across practices (one small array on the team doc) so coaches build a
// plan by picking from it instead of re-typing the same drills every week.
export interface DrillDefinition {
  id: string;
  name: string;
  category: DrillCategory;
  // Default block length, dropped onto the practice agenda when picked.
  defaultMinutes?: number;
  // Which setting the drill suits; "both" shows in indoor and outdoor plans.
  environment?: "indoor" | "outdoor" | "both";
  equipment?: string;
  description?: string;
}

// A single drill on a practice — both the plan (added before practice) and the
// record (what was worked on). Lives on Practice.drills. libraryId/category are
// set when the entry was added from the drill library; free-typed drills leave
// them blank.
export interface DrillLogEntry {
  id: string;
  name: string;
  notes?: string;
  minutes?: number;
  category?: DrillCategory;
  libraryId?: string;
}

// A scheduled (or completed) team practice. Manually created or imported from
// a GameChanger calendar feed (source/gcUid mirror Game). attendance keys are
// player ids → present(true)/absent(false), defaulting to present when absent
// from the map. environment drives the indoor/outdoor practice-plan
// suggestions.
export interface Practice {
  id: string;
  date: string; // YYYY-MM-DD
  // ISO instants for timed feed events; null/absent for all-day or manual
  // practices with no clock time.
  startUtc?: string | null;
  endUtc?: string | null;
  location?: string;
  environment?: "indoor" | "outdoor";
  // playerId → status. Legacy values: true = present, false = absent. Current
  // values use the string union; "excused" does NOT count as a missed practice.
  attendance?: Record<string, boolean | "present" | "absent" | "excused">;
  drills?: DrillLogEntry[];
  planNotes?: string;
  source?: "manual" | "gamechanger";
  gcUid?: string;
  status?: "scheduled" | "cancelled";
}

// Objective showcase measurements recorded at a tryout station. SHARED and
// DEFINITIVE: they live on the signup itself (not inside any coach's grade
// map), so whichever coach runs the radar gun / stopwatch, every evaluator
// sees the same numbers and they are exempt from head-vs-assistant grade
// weighting. All optional — an unrecorded station never penalizes a player.
export interface TryoutMeasurements {
  pitchMph?: number; // top fastball, radar
  runToFirstSec?: number; // home-to-first over the age's basepath
  maxThrowVeloMph?: number; // hardest throw, any position (not pitch velo)
  exitVeloMph?: number; // hardest batted ball off the tee/toss
  pitchStrikes?: number; // strikes thrown out of pitchAttempts
  pitchAttempts?: number; // default 10
  fieldingGround?: number; // coach 1–5 eyeball grade
  fieldingFly?: number; // coach 1–5 eyeball grade
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
  primaryPosition?: string;
  secondaryPosition?: string;
  comfortablePositions?: string[];
  canPitch?: boolean;
  canCatch?: boolean;
  isCatcher?: boolean;
  parentName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  status?: "tryout" | "offered" | "accepted" | "declined";
  tryoutDate?: string;
  // Deposit commitment captured during Advance Season for accepted tryouts.
  // The Tryouts tab does not collect deposits during the current season; when
  // promoted, these fields can seed the new season finances ledger as that
  // player's first club-fee payment.
  depositPaid?: boolean;
  depositPaidAt?: string;
  // Attendance + check-in fields (set by the HC at tryouts).
  // present === true → showed up; false → no-show (eligible for bulk
  // delete via the End Tryout flow). Missing → not yet marked.
  present?: boolean;
  tryoutNumber?: string;
  // Objective showcase-station numbers (see TryoutMeasurements) — shared
  // across all evaluators, definitive over subjective grade blending.
  measurements?: TryoutMeasurements;
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
  tryoutDate?: string;
  primaryPosition?: string;
  secondaryPosition?: string;
  comfortablePositions?: string[];
  canPitch?: boolean;
  canCatch?: boolean;
  notes?: string;
}

// Parent-submitted player info (uniform/equipment sizing + logistics) for a
// rostered kid, collected via the public Player Info Portal on the standing
// share link. The coach reviews each submission and applies it onto a matching
// roster Player. Append-only on the team doc, mirroring TryoutSignup.
export interface PlayerInfoSubmission {
  id: string;
  submittedAt: string;
  firstName: string;
  lastName: string;
  // ISO yyyy-mm-dd. Collected so the coach can disambiguate same-name kids
  // when matching a submission to a roster player.
  dob?: string;
  // Preferred jersey number.
  number?: string;
  // Uniform / equipment sizing.
  hatSize?: string;
  shirtSize?: string;
  pantsSize?: string;
  height?: string;
  weight?: string;
  // School logistics.
  school?: string;
  grade?: string;
  // Parent / guardian 1 contact (parentName/email/phone are the legacy names,
  // kept as Parent 1 so existing data and matching keep working).
  parentName?: string;
  email?: string;
  phone?: string;
  // Parent / guardian 2 contact.
  parent2Name?: string;
  parent2Phone?: string;
  parent2Email?: string;
  // Legacy emergency contact — superseded by Parent 2. Still read for back-compat
  // and migrated into parent2Name/parent2Phone.
  emergencyName?: string;
  emergencyPhone?: string;
  notes?: string;
  // Set once the coach matches + applies this submission onto a roster player,
  // so the inbox can mark it handled instead of re-prompting.
  appliedToPlayerId?: string;
  appliedAt?: string;
}

// Parent-submitted availability: the dates a family marked their kid as
// unavailable, collected via the public Availability Portal. When the name +
// DOB uniquely identify a roster player the coach client auto-merges `dates`
// into that player's `absences`; ambiguous ones wait in a match queue.
export interface AvailabilityBlock {
  date: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export interface AvailabilitySubmission {
  id: string;
  submittedAt: string;
  firstName: string;
  lastName: string;
  // ISO yyyy-mm-dd — required by the form so submissions can auto-match.
  dob?: string;
  parentName?: string;
  email?: string;
  phone?: string;
  // ISO yyyy-mm-dd dates the kid is unavailable. Legacy entries are all-day.
  dates: string[];
  blocks?: AvailabilityBlock[];
  // Stamped once merged onto a roster player's absences.
  appliedToPlayerId?: string;
  appliedAt?: string;
}

export interface TryoutSessionEvaluatorGrades {
  coachRole?: "Head" | "Assistant";
  evaluatorId?: string;
  evaluatorName?: string;
  grades?: Record<string, GradeMap>;
  updatedAt?: number;
}

export interface TryoutSession {
  id: string;
  date: string;
  label?: string;
  createdAt?: number;
  updatedAt?: number;
  signupIds?: string[];
  gradesByEvaluator?: Record<string, TryoutSessionEvaluatorGrades>;
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
  practices?: Practice[];
  // Reusable team drill library — coaches pick from this to plan a practice
  // agenda. Seeded from DEFAULT_DRILL_LIBRARY for new teams; older teams fall
  // back to the seed for display until they edit it.
  drillLibrary?: DrillDefinition[];
  // Optional feature modules the head turned OFF in Settings (absent/empty =
  // everything on). See src/constants/features.ts for the toggleable catalog.
  disabledFeatures?: TeamFeatureId[];
  // Tryouts (PR M)
  tryoutShareId?: string;
  tryoutsOpen?: boolean;
  tryoutsPhase?: "open" | "intake_closed" | "completed";
  rosterCap?: number;
  tryoutSignups?: TryoutSignup[];
  tryoutSessions?: TryoutSession[];
  // Year-round interest survey leads (PR 2). Lives outside tryoutsOpen
  // gate — the public form is always available at the standing share
  // URL so flyers stay useful between tryout cycles.
  interestSignups?: InterestSignup[];
  // Parent-submitted uniform/equipment sizing + logistics (PR: Player Info
  // Portal). Collected year-round on the standing share link; the coach
  // applies each onto a matching roster player from the Player Info tab.
  playerInfoSubmissions?: PlayerInfoSubmission[];
  // Parent-submitted availability (unavailable dates). Collected year-round on
  // the standing share link; the coach client auto-merges confident matches
  // onto player.absences from the Availability tab.
  availabilitySubmissions?: AvailabilitySubmission[];
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
  // Pitch-count rule set: a preset id ("littleLeague", …) or "custom". Custom
  // reads customPitchLimit (one daily max for the team's age) + optional
  // customRestTiers. Absent = Little League / Pitch Smart default.
  pitchRuleSet?: string;
  customPitchLimit?: number;
  customRestTiers?: Array<{ min: number; days: number }>;

  // Depth Chart manual overrides: position -> ordered player ids. When a
  // position has an entry, it defines the coach's chosen order; comfortable
  // players not listed are appended in auto-ranked order. Absent = pure
  // auto-ranking from evals. Drives the Depth Chart tab.
  depthChart?: Record<string, string[]>;

  // ----- Evaluations -----
  evaluationEvents?: EvaluationEvent[];
  evalSchemaVersion?: number;
  lastEvalEmailedAt?: string;
  emailEvalRemindersDisabled?: boolean;

  // Stat-surface density: "rich" (full charts/tiles/cards) or "stripped"
  // (compact, glanceable rows). One global toggle in Settings flips every
  // stat surface. Defaults to "rich".
  statDisplay?: "rich" | "stripped";

  // ----- Membership / ownership (mirrors firestore.rules) -----
  ownerId?: string;
  members?: string[];
  coachRoles?: Record<string, string>;
  coachContacts?: Array<{ id?: string; name?: string; email?: string }>;

  // ----- Tryouts config -----
  tryoutDates?: string[];
  // Head coach's phone, captured in Settings purely so recruiting/offer
  // letters can fill in "call me at …". Never shown publicly.
  headCoachPhone?: string;
  // Coach's Venmo for deposit collection on offer letters. Account name (e.g.
  // "@CoachVenmo") + an explicit deep link. Settings → Tryouts; never public.
  coachVenmoAccountName?: string;
  coachVenmoLink?: string;
  // Optional public-facing head-coach contact shown on the tryouts portal so
  // prospective families can reach out. Opt-in; mirrored into the public doc.
  headCoachName?: string;
  headCoachPublicEmail?: string;

  // ----- Finances (head-coach-only tab) -----
  finances?: TeamFinances;

  // Season awards: per-award coach override of the auto-nominated winner.
  // awardId → playerId, or "__none__" for "no winner". Absent = use auto pick.
  seasonAwards?: Record<string, string>;

  // The long tail of dynamic/rarely-typed fields (templates, past seasons,
  // mid-game removals, catcher limits, etc.) stays permissive and is promoted
  // to explicit fields incrementally. Note: typing the full bag onto
  // TeamContextValue.team (replacing the `any` index signature there) cascades
  // ~160 type errors across consumers, so that tightening is intentionally a
  // separate, incremental effort — this just makes the known fields accurate.
  [key: string]: unknown;
}

// ---- Team finances --------------------------------------------------------
// All amounts are dollars (floats; the UI rounds to cents on display). The
// whole structure lives on the single team doc like everything else.

// A planned season cost in the Budget Planner (tournament entry, balls, …).
// Two shapes: a flat `amount`, or quantity mode — when BOTH `qty` and
// `unitAmount` are present the effective amount is qty × unitAmount (e.g.
// 8 tournaments × $450 entry). budgetItemAmount() in utils/helpers.ts is the
// single reader; `amount` remains the fallback so legacy items keep working.
export interface BudgetItem {
  id: string;
  label: string;
  amount: number;
  qty?: number;
  unitAmount?: number;
  // When true, finances.salesTaxPct is added on top of this item's cost in
  // all planner math (tournament entries are often pre-tax quotes).
  taxable?: boolean;
  // Spending area for by-category reporting (docs/finance-categories.md PR2).
  // Optional and non-breaking: when absent it's inferred from the label at read
  // time (see budgetItemCategory in utils/finances.ts), so legacy items and
  // items typed without a category still roll up.
  category?: FinanceCategoryId;
}

// Who entered a money record and when (audit finding 3.7). Stamped at
// creation only; edits preserve the original stamps. Absent on rows that
// predate the feature.
export interface FinanceAttribution {
  recordedBy?: string; // auth uid of the coach who entered it
  recordedAt?: string; // ISO instant of entry
}

// Money actually spent, shown in the ledger with a running balance.
export interface ExpenseEntry extends FinanceAttribution {
  id: string;
  date: string; // ISO yyyy-mm-dd
  label: string;
  amount: number;
  // Links this expense to a Budget Planner category for budget-vs-actual
  // meters. Unlinked expenses count as "unplanned" spending.
  budgetItemId?: string;
}

// Money received that ISN'T a club-fee payment — sponsorships, fundraising,
// donations. Counts toward the club balance and offsets the suggested
// per-player fee (sponsors covering costs means families owe less).
export interface IncomeEntry extends FinanceAttribution {
  id: string;
  date: string; // ISO yyyy-mm-dd
  label: string;
  amount: number;
  // Revenue source for by-source accounting (docs/finance-categories.md PR3).
  // Optional and non-breaking: absent entries infer from the label at read
  // time (see incomeCategory in utils/finances.ts). Club-fee payments are
  // implicitly "Registration & dues" and never carry this field.
  category?: RevenueCategoryId;
  // Fundraising entries reduce what families still owe on THIS season's club
  // fee. Unattributed, they split evenly across paying players (a car wash that
  // nets $300 on a 12-payer roster knocks $25 off everyone's dues). Attributed
  // to a `playerId`, the money credits that child's fee first; any surplus over
  // their fee rolls into the even split for everyone else.
  fundraising?: boolean;
  // Optional child this fundraising entry is credited to (raffle/sponsor a kid
  // brought in). Only meaningful when `fundraising` is true.
  playerId?: PlayerId;
  // Set when the coach answers "No" to applying a carried-over surplus as a
  // dues discount. The money stays in the bank as plain income; this flag just
  // stops the "apply it?" prompt from ever returning. Only set on carryover
  // entries.
  dismissed?: boolean;
  // A named CURRENT-season sponsor (business/family) recorded in the Budget
  // Planner rather than the ledger's generic income form. Whether it lowers
  // what families owe is that entry's own choice: paired with
  // `fundraising: true` it credits this season's dues; without it the money is
  // plain club income. The next-season equivalent is SponsorshipEntry (whose
  // per-entry switch is `reducesFees`).
  sponsor?: boolean;
}

// A sponsorship pledged toward NEXT season's budget, entered in the Budget
// Planner with the sponsor's name. Unlike IncomeEntry (this year's ledger),
// these reduce the suggested next-season fee; when the season advances they
// convert into income entries in the new year's ledger.
export interface SponsorshipEntry {
  id: string;
  sponsor: string;
  amount: number;
  date?: string; // ISO yyyy-mm-dd, when pledged
  // Per-pledge switch: whether this money offsets the suggested next-season
  // fee. Default (unset/true) = it does; false = the pledge is planned as
  // plain club income and families split the full budget.
  reducesFees?: boolean;
}

// Money collected from a family toward the club fee. Multiple entries per
// player = partial payments.
export interface PaymentEntry extends FinanceAttribution {
  id: string;
  playerId: PlayerId;
  date: string; // ISO yyyy-mm-dd
  amount: number;
  // Money returned to this family (drop-out, overpayment, returned deposit).
  // The amount stays POSITIVE — all math treats a refund as negative, so a
  // refunded family's paid total shrinks and their owed balance grows back.
  // Faking refunds as expenses corrupted category spend (audit §3.5/§4).
  refund?: boolean;
}

// Compact per-season money summary kept when the season is advanced — the
// row-level ledger resets each season (the closing balance carries over as an
// opening entry), but the season's totals stay reviewable.
export interface FinancePastSeason {
  season: string;
  collected: number;
  otherIncome: number;
  spent: number;
  closingBalance: number;
  // Snapshot of unpaid dues at year-close: the rollover wipes the collection
  // cycle (unpaid fees die with the year), so who-still-owed is preserved
  // here. Names are resolved at roll time — those players may leave the
  // roster afterwards.
  outstanding?: Array<{ playerId: string; name: string; owed: number }>;
}

export interface TeamFinances {
  // THIS season's per-player club fee in dollars — what Collections tracks.
  // Fees are an annual (Spring) cycle; Fall pickups are typically waived.
  clubFee?: number;
  // Optional up-front deposit each family pays toward the team fee, with its
  // own earlier due date; the remaining balance is due by feeDueDate. Payments
  // count toward the single fee total — the deposit is just the first slice a
  // family is expected to cover by depositDueDate. All dates are ISO
  // yyyy-mm-dd. Unset = no deposit / no scheduled due dates.
  depositAmount?: number;
  depositDueDate?: string;
  feeDueDate?: string;
  // NEXT season's fee, set from the Budget Planner's suggestion. The season
  // year runs Fall → Spring, so this is promoted to clubFee when the season
  // advances into a new Fall — planning never disturbs the in-progress
  // collection cycle.
  nextClubFee?: number;
  // NEXT season's planned up-front deposit and due date, captured with the
  // Budget Planner so offer letters can quote the incoming year without
  // disturbing this season's collection schedule. Promoted to depositAmount /
  // depositDueDate when the season advances.
  nextDepositAmount?: number;
  nextDepositDueDate?: string;
  // Players exempt from the club fee (fall-only pickups, scholarships).
  // They never count toward "still owed" or the suggested-fee split.
  feeExemptIds?: PlayerId[];
  // Sales tax % (e.g. 8.25) applied to budget items flagged `taxable` in all
  // planner math, so pre-tax quotes project as real costs.
  salesTaxPct?: number;
  // Round the suggested fee UP to this increment (25 or 50) so incidentals
  // are buffered and the fee lands on a clean number. 0/unset = exact dollar.
  feeBufferIncrement?: number;
  // How many paying players the coach anticipates NEXT season — the divisor
  // for the suggested-fee split. Unset = this season's paying roster size.
  plannedPlayerCount?: number;
  budgetItems?: BudgetItem[];
  // Sponsorships pledged toward NEXT season's budget (Budget Planner).
  // The only money that offsets the suggested next-season fee — this
  // year's ledger never leaks into next year's planning.
  sponsorships?: SponsorshipEntry[];
  expenses?: ExpenseEntry[];
  incomes?: IncomeEntry[];
  payments?: PaymentEntry[];
  pastSeasons?: FinancePastSeason[];
}

export interface Toast {
  push: (t: {
    kind: "success" | "error" | "info";
    title: string;
    message?: string;
  }) => void;
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
  push: (t: ToastInput) => number;
  dismiss: (id: number | string) => void;
}

// In-app replacements for window.confirm / window.prompt. Resolved by the
// ConfirmProvider dialog (src/components/ConfirmDialog.tsx); the promise
// settles when the coach picks a button (or dismisses via Escape/scrim).
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get the danger accent + button. */
  danger?: boolean;
}

export interface PromptTextOptions {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  inputType?: "text" | "email";
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  promptText: (opts: PromptTextOptions) => Promise<string | null>;
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
  // Concurrency-safe finance mutations (narrow per-op Firestore writes
  // instead of whole-object merges) — see src/utils/financeUpdates.ts.
  updateFinances: (
    update: import("./utils/financeUpdates").FinanceUpdate,
  ) => void;
  // Concurrency-safe mutations for the top-level team arrays (players /
  // games / evaluationEvents / practices) — see src/utils/teamArrayUpdates.ts.
  // A list of ops becomes one merged updateDoc (atomic multi-array cascade).
  updateTeamArrays: (
    input:
      | import("./utils/teamArrayUpdates").TeamArrayUpdate
      | import("./utils/teamArrayUpdates").TeamArrayUpdate[],
  ) => void;
  switchTeam: (id: string) => void | Promise<void>;
  createTeam: (
    name?: string,
    leagueRuleSet?: "NKB" | "USSSA",
  ) => void | Promise<any>;
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
  | "speed"
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
  // Wall-clock creation stamp (ms). Tiebreaker for "latest round" sorts when
  // two rounds share a date; absent on rounds saved before it existed.
  createdAt?: number;
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
  // Durable in-game manual position picks (position → playerId). Unlike
  // firstInningOverridesById (a single-inning pin), these are held for the rest
  // of the game: the engine seats the player at the spot in every inning from
  // the rebuild point on (best-effort, field positions only). See InGameView's
  // manualLocks.
  stickyOverridesById?: Record<string, string>;
  totalInnings?: number;
  leagueRuleSet?: string;
  teamAge?: string;
  defenseSize?: string;
  positionLock?: string;
  battingSize?: string;
  seed?: number;
  isBigGame?: boolean;
  // Competitive (Tournament) mode: best-XI defense + a per-game minimum-play
  // floor instead of seasonal fairness, and no fairness ledger. The app sets
  // this for Tournament (USSSA) games; Rec games leave it false. Reuses all the
  // shared safety rotation (catcher caps, pitcher rest/pitch limits).
  competitive?: boolean;
  // Depth Chart (position -> ordered player ids). Consumed ONLY in competitive
  // (Tournament) mode, where it makes the coach's per-position order
  // authoritative over skill among otherwise-legal candidates. Ignored in Rec.
  depthChart?: Record<string, string[]>;
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
// One planned tournament substitution: `in` enters at `inning` replacing
// `out` at `position`; the starter returns at `returnInning` (null when the
// game is too short for a return stint).
export interface TournamentSubstitution {
  inning: number; // 1-based
  returnInning: number | null; // 1-based
  position: string;
  in: SlimPlayer;
  out: SlimPlayer;
}

// The tournament-mode plan layered on top of the innings grid: the starting
// nine at their best spots, the scripted sub windows, and the ranked relief
// options (pitch-count eligibility included) for mid-game pitching changes.
export interface TournamentPlan {
  starters: Record<string, SlimPlayer>;
  substitutions: TournamentSubstitution[];
  reliefOptions: Array<{
    id: PlayerId;
    name: string;
    number?: string | number;
    status: "ready" | "resting" | "maxed";
    recentPitches?: number;
    daysUntilReady?: number | null;
  }>;
}

export interface EngineResult {
  lineup?: Inning[];
  battingLineup?: SlimPlayer[];
  error?: string;
  details?: string[];
  // Present only when generateTournamentLineup built the result.
  tournament?: TournamentPlan;
  // True when the engine couldn't schedule strict season-fairness and fell
  // back to one-game balance. `fairnessRelaxedReason` is the human-readable
  // blocker that defeated the strict pass; `fairnessRelaxedType` is the raw
  // dominant failure type (e.g. "bench-schedule-impossible") for logging.
  fairnessRelaxed?: boolean;
  fairnessRelaxedReason?: string;
  fairnessRelaxedType?: string | null;
  [key: string]: unknown;
}
