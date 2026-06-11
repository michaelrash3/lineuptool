// UI-only constants extracted from App.jsx Section 4.

// League rule sets keep their stored values ("NKB" / "USSSA") so all rules
// logic and existing data are unchanged, but they're SHOWN to coaches as
// "Rec" and "Tournament" — which is also the play-style switch (Rec games use
// the fairness/play-everyone engine; Tournament games run competitive).
export const leagueRuleSetLabel = (rs?: string | null): string =>
  rs === "USSSA" ? "Tournament" : rs === "NKB" ? "Rec" : rs || "";

// Coach's Card v3 eval taxonomy (schema v9): coaches grade ONLY the
// intangibles — the things standard and advanced stats can't measure. Every
// tangible skill (contact, power, fielding, arm, velocity, strikes, off-speed,
// catcher throwing/blocking) is graded automatically from imported stats; see
// the stat-derived grade helpers in src/lineupEngine.ts.
// The lineup engine has its own labelless internal copy that mirrors this.

export type EvalGroup =
  | "Hitting"
  | "Fielding"
  | "Baserunning"
  | "Intangibles"
  | "Pitching"
  | "Catching";

export interface EvalCategory {
  id: string;
  label: string;
  group: EvalGroup;
  weight: number;
  // Plain-English meaning shown in the grading UI so the rating is obvious.
  description?: string;
  addOn?: "kidPitch"; // gating: only shown when pitchingFormat === "Kid Pitch"
}

export const EVAL_CATEGORIES: EvalCategory[] = [
  // Hitting
  { id: "approach", label: "Approach", group: "Hitting", weight: 2.5,
    description: "Pitch selection, two-strike battles, situational hitting." },
  // Athleticism — Speed and Base Running are graded SEPARATELY: raw foot speed
  // is a different tool than reads/instincts on the bases.
  { id: "speed", label: "Speed", group: "Baserunning", weight: 1.0,
    description: "Raw foot speed and first-step quickness." },
  { id: "baserunning", label: "Base Running", group: "Baserunning", weight: 1.5,
    description: "Reads, instincts, and smart aggression on the bases." },
  // Intangibles
  { id: "baseballIQ", label: "Baseball IQ", group: "Intangibles", weight: 2.0,
    description: "Knows where the ball goes; situational awareness." },
  { id: "coachability", label: "Coachability", group: "Intangibles", weight: 3.0,
    description: "Listens, adjusts, effort & attitude. Weighted heavily." },
  // Kid-Pitch add-ons: Pitching
  { id: "composure", label: "Composure", group: "Pitching", weight: 1.0, addOn: "kidPitch",
    description: "Stays calm under pressure; bounces back." },
  // Kid-Pitch add-ons: Catching
  { id: "gameCalling", label: "Game Calling", group: "Catching", weight: 1.0, addOn: "kidPitch",
    description: "Manages pitches, counts, and the defense." },
];

export const EVAL_GROUPS_UNIVERSAL: EvalGroup[] = [
  "Hitting",
  "Baserunning",
  "Intangibles",
];

export const EVAL_GROUPS_KID_PITCH_ADDONS: EvalGroup[] = ["Pitching", "Catching"];

export const isKidPitchFormat = (pitchingFormat?: string): boolean =>
  (pitchingFormat || "").toLowerCase().includes("kid");

export const getEvalCategoriesForTeam = (pitchingFormat?: string): EvalCategory[] => {
  const includeAddOns = isKidPitchFormat(pitchingFormat);
  return EVAL_CATEGORIES.filter((c) => !c.addOn || includeAddOns);
};

// Position membership for eval gating. Catcher is opt-in ("C" in the list);
// pitcher is "P" in the list — same positive position model the Roster uses.
export const playerIsPitcher = (player?: {
  comfortablePositions?: string[];
}): boolean =>
  Array.isArray(player?.comfortablePositions) &&
  player!.comfortablePositions!.includes("P");

export const playerIsCatcher = (player?: {
  comfortablePositions?: string[];
}): boolean =>
  Array.isArray(player?.comfortablePositions) &&
  player!.comfortablePositions!.includes("C");

// Per-PLAYER eval categories. Universal categories always apply; on Kid-Pitch
// teams the Pitching add-ons show only for pitchers and the Catching add-ons
// only for catchers. So a kid is graded — and scored — only on the specialties
// that actually apply to them (no penalty for missing the others).
export const getEvalCategoriesForPlayer = (
  pitchingFormat: string | undefined,
  player: { comfortablePositions?: string[] } | undefined
): EvalCategory[] => {
  const kidPitch = isKidPitchFormat(pitchingFormat);
  return EVAL_CATEGORIES.filter((c) => {
    if (!c.addOn) return true;
    if (!kidPitch) return false;
    if (c.group === "Pitching") return playerIsPitcher(player);
    if (c.group === "Catching") return playerIsCatcher(player);
    return true;
  });
};

// Current eval schema version. Used to migrate teams off older shapes.
//   v1: 6-category grades (legacy, wiped)
//   v2: 11-category 1–10 scale (Coach's Card v2)
//   v3: 11-category 1–5 labeled scale (current)
// Teams stored at v2 get auto-converted to v3 by halving each grade value.
// v4 (2026-05) — positive position model: players gain
// `comfortablePositions: string[]` (positions the coach is happy with).
// v5 (2026-05) — catcher unification: catcher is just "C" in
// comfortablePositions (the separate `isCatcher` flag is dropped). The v5
// migration undoes the v4 pollution that had put "C" in every roster's
// comfortable list, re-deriving real catchers from the legacy
// primaryPosition / explicit isCatcher choice.
// v6 (2026-05) — eval rounds are dated by the calendar due date they satisfy
// (see evalRoundDateForSave) instead of the literal save day. The v6 migration
// re-stamps existing roster rounds onto their nearest due date and drops the
// older of any two rounds that collapse onto the same date.
// v7 (2026-06) — leaner, youth-appropriate eval categories: Plate Discipline
// folds into Approach; Glove+Range merge to Fielding; Arm Strength+Accuracy
// merge to Arm; Baserunning → Speed & Baserunning; Control+Command → Strikes;
// Pop Time → Throwing. The v7 migration averages merged grades and renames the
// rest so prior eval history carries over. Coachability is weighted up.
// v8 splits "Speed & Baserunning" back into separate Speed + Base Running
// grades (the old merged value seeds both so history carries over).
// v9 (2026-06) — stats-graded tangibles. Coaches now grade only what stats
// can't measure (Approach, Speed, Base Running, Baseball IQ, Coachability,
// Composure, Game Calling). Contact/Power/Fielding/Arm/Velocity/Strikes/
// Off-Speed/Receiving/Blocking/Throwing are dropped from the eval form — the
// engine derives them from imported stats — and the v9 migration strips their
// saved grade keys from prior rounds (notes are preserved).
export const EVAL_SCHEMA_VERSION = 9;

// Display labels for the 1–5 grading scale (index 0 maps to 1).
export const EVAL_SCALE_LABELS = [
  "Needs Work",
  "Below Avg",
  "Avg",
  "Above Avg",
  "Strong",
];
export const EVAL_SCALE_MAX = 5;
export const EVAL_SCALE_DEFAULT = 3;

// Roster-decision premium for pitching well. Pure: takes a player's
// eval-weighted pitcher score and the sum of those weights, and rewards only
// pitching ABOVE the neutral grade — so default/ungraded pitching (every cat at
// EVAL_SCALE_DEFAULT) adds nothing, weak pitching never subtracts, and an elite
// pitcher (all max) earns the full bonus. Returns 0..PITCHER_ROSTER_PREMIUM_MAX.
export const PITCHER_ROSTER_PREMIUM_MAX = 15;
export const pitcherRosterPremium = (
  pitcherScore: number,
  weightSum: number
): number => {
  const neutral = weightSum * EVAL_SCALE_DEFAULT;
  const span = weightSum * (EVAL_SCALE_MAX - EVAL_SCALE_DEFAULT);
  const above = pitcherScore - neutral;
  if (above <= 0 || span <= 0) return 0;
  return Math.round(Math.min(1, above / span) * PITCHER_ROSTER_PREMIUM_MAX);
};

export const getLocalDateString = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Age tier progression. Spring → Spring or Spring → Fall bumps up one tier;
// Fall → Spring keeps the same tier (Fall is "playing up" for next Spring).
export const AGE_TIERS = [
  "6U",
  "7U",
  "8U",
  "9U",
  "10U",
  "11U to 12U",
  "13U to 14U",
  "15U to 18U",
];

export const bumpAgeTier = (current: string): string => {
  const i = AGE_TIERS.indexOf(current);
  if (i === -1 || i === AGE_TIERS.length - 1) return current;
  return AGE_TIERS[i + 1];
};

export interface NextSeason {
  nextSeason: string;
  shouldBump: boolean;
}

// Compute the "next" season label and whether the age tier should bump.
export const computeNextSeason = (currentSeasonStr: string): NextSeason | null => {
  const parts = (currentSeasonStr || "").split(" ");
  if (parts.length < 2) return null;
  const season = parts[0].toLowerCase();
  const year = parseInt(parts[parts.length - 1], 10);
  if (Number.isNaN(year)) return null;
  if (season === "spring") {
    return { nextSeason: `Fall ${year}`, shouldBump: true };
  } else if (season === "fall") {
    return { nextSeason: `Spring ${year + 1}`, shouldBump: false };
  }
  return null;
};

export const DEFAULT_TEAM_DATA = Object.freeze({
  players: [],
  coaches: [],
  games: [],
  evaluationEvents: [],
  evalSchemaVersion: EVAL_SCHEMA_VERSION,
  leagueRuleSet: "USSSA",
  currentSeason: "Spring 2026",
  pitchingFormat: "Kid Pitch",
  defenseSize: "10",
  battingSize: "roster",
  inningsCount: "6",
  logoUrl: "",
  primaryColor: "#2563eb",
  secondaryColor: "#f8fafc",
  tertiaryColor: "#ffffff",
  teamAge: "8U",
  positionLock: "1",
  // Catcher playing time. "auto" preserves the legacy behavior (10-fielder
  // back-to-back pairs, 9-fielder cap of 3). Coaches can set an explicit cap
  // ("1".."6" or "none"); `catcherConsecutive` keeps those innings
  // back-to-back and is only consulted once an explicit cap is chosen.
  catcherMaxInnings: "auto",
  catcherConsecutive: true,
});
