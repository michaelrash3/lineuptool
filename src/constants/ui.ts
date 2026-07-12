// UI-only constants extracted from App.jsx Section 4.
import type { DrillDefinition } from "../types";

// Product brand name shown in the UI (browser title, login, cold-start
// loading screen, onboarding, the .ics calendar PRODID). The repository and
// npm package stay "lineuptool" for historical reasons. Keep this the single
// source of truth for the TSX/title spots so the next rebrand is one edit;
// index.html and public/manifest.json carry the literal string separately.
export const APP_NAME = "The Bench Coach";
export const APP_SHORT_NAME = "Bench Coach";

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
  // Most categories are a 1–5 grade. "mph" renders a numeric radar-reading
  // input instead and is excluded from the 1–5 composite math (weight 0); it
  // feeds the pitcher score via age-relative velocity grading instead.
  inputKind?: "mph";
  // NEVER hand-graded: the value comes from data (tryout showcase seed, then
  // GameChanger stats). Kept in the catalog so scoring/reports carry it, but
  // every grading UI must filter these out — a coach's manual rating list
  // must not grow when a measurable gets a data source.
  dataDriven?: boolean;
}

export const EVAL_CATEGORIES: EvalCategory[] = [
  // Hitting
  {
    id: "approach",
    label: "Approach",
    group: "Hitting",
    weight: 2.5,
    description: "Pitch selection, two-strike battles, situational hitting.",
  },
  // DATA-DRIVEN tangibles — never hand-graded (dataDriven filters them off
  // every grading card). Their values are seeded from tryout showcase
  // measurements and overridden by GameChanger stats as real samples
  // accumulate; they stay in this catalog only so scoring, reports, and the
  // grade schema keep carrying them.
  {
    id: "power",
    label: "Power",
    group: "Hitting",
    weight: 1.5,
    dataDriven: true,
    description:
      "Data-driven: showcase exit velo, then GameChanger hard-contact stats.",
  },
  {
    id: "glove",
    label: "Fielding",
    group: "Fielding",
    weight: 2.0,
    dataDriven: true,
    description:
      "Data-driven: showcase fielding stations, then GameChanger fielding %.",
  },
  {
    id: "armStrength",
    label: "Arm Strength",
    group: "Fielding",
    weight: 1.5,
    dataDriven: true,
    description:
      "Data-driven: showcase max throw velo, then GameChanger arm data.",
  },
  {
    id: "armAccuracy",
    label: "Accuracy",
    group: "Fielding",
    weight: 1.0,
    dataDriven: true,
    description:
      "Data-driven: showcase strikes-of-10, then GameChanger strike %.",
  },
  // Athleticism — Speed and Base Running are graded SEPARATELY: raw foot speed
  // is a different tool than reads/instincts on the bases.
  {
    id: "speed",
    label: "Speed",
    group: "Baserunning",
    weight: 1.0,
    description: "Raw foot speed and first-step quickness.",
  },
  {
    id: "baserunning",
    label: "Base Running",
    group: "Baserunning",
    weight: 1.5,
    description: "Reads, instincts, and smart aggression on the bases.",
  },
  // Intangibles
  {
    id: "baseballIQ",
    label: "Baseball IQ",
    group: "Intangibles",
    weight: 2.0,
    description: "Knows where the ball goes; situational awareness.",
  },
  {
    id: "coachability",
    label: "Coachability",
    group: "Intangibles",
    weight: 3.0,
    description: "Listens, adjusts, effort & attitude. Weighted heavily.",
  },
  // Composure is a universal intangible — every player is graded on it now,
  // not just kid-pitch pitchers.
  {
    id: "composure",
    label: "Composure",
    group: "Intangibles",
    weight: 2.0,
    description: "Stays calm under pressure; bounces back.",
  },
  // Kid-Pitch add-on: Pitching (pitchers only). Optional radar reading in mph,
  // scored against the age group's average (see AGE_VELOCITY_BENCHMARKS).
  {
    id: "pitchVelo",
    label: "Pitch Velocity",
    group: "Pitching",
    weight: 0,
    addOn: "kidPitch",
    inputKind: "mph",
    description:
      "Top fastball in mph. Optional — scored vs your age group's average.",
  },
  // Kid-Pitch add-ons: Catching. Game Calling isn't a thing at young ages —
  // grade the tangible catching skills instead.
  {
    id: "blocking",
    label: "Blocking",
    group: "Catching",
    weight: 1.5,
    addOn: "kidPitch",
    description: "Keeps balls in front; smothers pitches in the dirt.",
  },
  {
    id: "receiving",
    label: "Receiving",
    group: "Catching",
    weight: 1.0,
    addOn: "kidPitch",
    description: "Soft hands, clean glove work, presents a steady target.",
  },
];

// The TRYOUT card's hand-graded categories. Deliberately tiny: at a showcase
// tryout every measurable tool (speed, power, arm strength, accuracy, pitch
// velo, fielding GB/FB) is recorded at the measured stations — shared and
// definitive — so the only eye-test judgment a coach records here is hitting.
// Intangibles (base running, IQ, coachability, composure) belong to
// regular-season eval rounds, not a one-day look. The id stays `approach` so
// existing tryout grade maps and the preseason seed keep working unchanged.
export const TRYOUT_GRADE_CATEGORIES: EvalCategory[] = [
  {
    id: "approach",
    label: "Hitting",
    group: "Hitting",
    weight: 2.5,
    description:
      "Contact, approach, quality of at-bats — the eye test. Every measurable tool comes from the showcase stations above.",
  },
];

// Youth pitch-velocity benchmarks by age (mph), based on the coach-provided
// chart: recreational low end, competitive/travel high end, and the lower edge
// of the elite-outlier band. The engine uses avgLow -> elite as the scoring
// range so a player in the competitive/travel band receives meaningful credit
// without requiring an outlier reading. Ages outside the chart clamp to the
// nearest listed fallback row.
export interface VeloBenchmark {
  avgLow: number;
  avgHigh: number;
  elite: number;
}
export const AGE_VELOCITY_BENCHMARKS: Record<number, VeloBenchmark> = {
  7: { avgLow: 30, avgHigh: 45, elite: 50 },
  8: { avgLow: 30, avgHigh: 45, elite: 50 },
  9: { avgLow: 35, avgHigh: 48, elite: 55 },
  10: { avgLow: 40, avgHigh: 53, elite: 58 },
  11: { avgLow: 43, avgHigh: 55, elite: 60 },
  12: { avgLow: 45, avgHigh: 58, elite: 65 },
  13: { avgLow: 50, avgHigh: 65, elite: 70 },
  14: { avgLow: 55, avgHigh: 72, elite: 75 },
  15: { avgLow: 55, avgHigh: 72, elite: 75 },
};
// Pull the numeric age out of a teamAge label ("8U", "13U to 14U" → 8 / 14),
// clamped to the benchmark table's range.
export const ageFromTeamAge = (teamAge?: string): number => {
  const m = String(teamAge || "").match(/(\d+)/g);
  const n = m ? parseInt(m[m.length - 1], 10) : 10;
  return Math.min(15, Math.max(7, n));
};
export const velocityBenchmarkForAge = (teamAge?: string): VeloBenchmark =>
  AGE_VELOCITY_BENCHMARKS[ageFromTeamAge(teamAge)];

// Grading-UI tab groups. "Fielding" is deliberately absent: every Fielding
// category is dataDriven (showcase/GameChanger fed), so there is nothing for
// a coach to hand-grade under it.
export const EVAL_GROUPS_UNIVERSAL: EvalGroup[] = [
  "Hitting",
  "Baserunning",
  "Intangibles",
];

export const EVAL_GROUPS_KID_PITCH_ADDONS: EvalGroup[] = [
  "Pitching",
  "Catching",
];

export const isKidPitchFormat = (pitchingFormat?: string): boolean =>
  (pitchingFormat || "").toLowerCase().includes("kid");

export const getEvalCategoriesForTeam = (
  pitchingFormat?: string,
): EvalCategory[] => {
  const includeAddOns = isKidPitchFormat(pitchingFormat);
  return EVAL_CATEGORIES.filter((c) => !c.addOn || includeAddOns);
};

// The categories a coach actually HAND-GRADES — the full catalog minus the
// dataDriven tangibles. Grading UIs (EvaluationTab, AssistantEvalTab) use
// these; scoring/aggregation keeps the full lists above so the data-driven
// values still count.
export const handGradedCategoriesForTeam = (
  pitchingFormat?: string,
): EvalCategory[] =>
  getEvalCategoriesForTeam(pitchingFormat).filter((c) => !c.dataDriven);

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
  player: { comfortablePositions?: string[] } | undefined,
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

// Per-player HAND-GRADED categories (see handGradedCategoriesForTeam).
export const handGradedCategoriesForPlayer = (
  pitchingFormat: string | undefined,
  player: { comfortablePositions?: string[] } | undefined,
): EvalCategory[] =>
  getEvalCategoriesForPlayer(pitchingFormat, player).filter(
    (c) => !c.dataDriven,
  );

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
// v9 (2026-06) — stats-graded tangibles. Coaches grade what stats can't
// measure: Approach, Speed, Base Running, Baseball IQ, Coachability, Composure
// (now universal), the catching skills Blocking + Receiving, and an optional
// Pitch Velocity radar reading (mph). Game Calling was dropped (not a thing at
// young ages). Contact/Power/Fielding/Arm/Velocity/Strikes/Off-Speed/Throwing
// are derived from imported stats — the v9 migration strips those saved grade
// keys from prior rounds (notes are preserved).
// v10 (2026-06) — roster-status simplification. The "Inactive" status is
// retired: a player is now either active or Departed. The v10 migration folds
// every non-departed player back to active (present: true, no stale
// rosterStatus), so legacy "inactive" kids rejoin lineups/stats/attendance.
// v11 (2026-07) — legacy tryout-grade cleanup (EVALUATIONS-AUDIT.md finding
// 3.2). Tryout grades stored as evaluationEvents (tryoutSignupId + grades.signup)
// are folded into tryoutSessions once and dropped from evaluationEvents, so
// they stop living in two places and re-normalizing on every read.
export const EVAL_SCHEMA_VERSION = 11;

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

export const velocityGradeFromMph = (
  mph: number | null | undefined,
  teamAge?: string,
): number | null => {
  if (typeof mph !== "number" || !Number.isFinite(mph) || mph <= 0) return null;
  const b = velocityBenchmarkForAge(teamAge);
  const span = b.elite - b.avgLow;
  if (span <= 0) return null;
  const quality = Math.min(1, Math.max(0, (mph - b.avgLow) / span));
  return Math.max(
    1,
    Math.min(EVAL_SCALE_MAX, Math.round(1 + quality * (EVAL_SCALE_MAX - 1))),
  );
};

// Roster-decision premium for pitching well. Pure: takes a player's
// eval-weighted pitcher score and the sum of those weights, and rewards only
// pitching ABOVE the neutral grade — so default/ungraded pitching (every cat at
// EVAL_SCALE_DEFAULT) adds nothing, weak pitching never subtracts, and an elite
// pitcher (all max) earns the full bonus. Returns 0..PITCHER_ROSTER_PREMIUM_MAX.
export const PITCHER_ROSTER_PREMIUM_MAX = 15;
export const LEFT_HANDED_PITCHER_ROSTER_PREMIUM = 4;

export const isLeftHandedThrower = (player?: {
  throws?: string | null;
}): boolean =>
  String(player?.throws || "")
    .trim()
    .toUpperCase()
    .startsWith("L");

export const leftHandedPitcherRosterPremium = (player?: {
  comfortablePositions?: string[];
  throws?: string | null;
}): number =>
  playerIsPitcher(player) && isLeftHandedThrower(player)
    ? LEFT_HANDED_PITCHER_ROSTER_PREMIUM
    : 0;

export const pitcherRosterPremium = (
  pitcherScore: number,
  weightSum: number,
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
export const computeNextSeason = (
  currentSeasonStr: string,
): NextSeason | null => {
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

// Starter drill library seeded onto every new team (and used as the display
// fallback for teams created before the library existed). Derived from the
// old hardcoded indoor/outdoor PLAN_SUGGESTIONS that used to live in
// PracticesTab, now first-class, categorized, reusable definitions. Stable
// "seed-*" ids keep them dedupe-able.
// A full coaching library: recognized youth-baseball drills across every
// category, each with a short explanation of what it is and why you run it, so
// a new coach can build a real practice (and the Smart Planner has enough per
// category to vary the agenda week to week). Several "both"/"indoor" options in
// each category keep indoor/rainy-day plans from coming up empty. Stable
// "seed-*" ids keep them dedupe-able with any existing saved libraries.
export const DEFAULT_DRILL_LIBRARY: DrillDefinition[] = [
  // ── Conditioning / warm-up ───────────────────────────────────────────────
  {
    id: "seed-dynamic-warmup",
    name: "Dynamic warm-up",
    category: "Conditioning",
    defaultMinutes: 10,
    environment: "both",
    description:
      "A light jog into leg swings, walking lunges, arm circles, and high knees. Raises heart rate and loosens hips, shoulders, and hamstrings so nobody throws or sprints cold.",
  },
  {
    id: "seed-agility-ladder",
    name: "Agility ladder footwork",
    category: "Conditioning",
    defaultMinutes: 10,
    environment: "both",
    equipment: "Agility ladder",
    description:
      "Quick-feet patterns (one-in, two-in, lateral shuffle) through a ground ladder. Builds foot speed, body control, and the short first step fielders and baserunners live on.",
  },
  {
    id: "seed-reaction-ball",
    name: "Reaction ball drill",
    category: "Conditioning",
    defaultMinutes: 8,
    environment: "both",
    equipment: "Reaction balls",
    description:
      "Players field a six-sided reaction ball that bounces unpredictably. Sharpens hand-eye coordination, reflexes, and the instinct to stay low and adjust.",
  },
  {
    id: "seed-pepper",
    name: "Pepper",
    category: "Conditioning",
    defaultMinutes: 10,
    environment: "both",
    description:
      "A hitter taps controlled grounders and liners to a tight line of fielders 15–20 ft away, who field and toss it right back. Classic warm-up for soft hands, quick exchanges, and bat control.",
  },
  {
    id: "seed-conditioning-sprints",
    name: "Conditioning sprints",
    category: "Conditioning",
    defaultMinutes: 10,
    environment: "both",
    description:
      "Short max-effort sprints (home-to-first, foul pole runs) with full recovery between. Builds explosive speed and the late-game legs to beat out a throw in the last inning.",
  },

  // ── Pitching / throwing / arm care ───────────────────────────────────────
  {
    id: "seed-long-toss",
    name: "Long toss / arm care",
    category: "Pitching",
    defaultMinutes: 10,
    environment: "outdoor",
    description:
      "Partners throw at gradually increasing distance, then work back in on a line. Builds arm strength and durability while grooving a clean, full-arm throwing motion.",
  },
  {
    id: "seed-throwing-progression",
    name: "Throwing progression (band + partner)",
    category: "Pitching",
    defaultMinutes: 10,
    environment: "indoor",
    equipment: "Resistance bands",
    description:
      "Resistance-band shoulder activation (external rotation, scarecrows) then short partner throws stepping back. Indoor arm prep that warms the rotator cuff before any hard throwing.",
  },
  {
    id: "seed-bullpen-target",
    name: "Bullpen to spots",
    category: "Pitching",
    defaultMinutes: 15,
    environment: "outdoor",
    description:
      "Pitchers throw a controlled pen to a catcher, aiming at corners and the bottom of the zone rather than just throwing hard. Builds command and a repeatable delivery.",
  },
  {
    id: "seed-towel-drill",
    name: "Towel drill",
    category: "Pitching",
    defaultMinutes: 10,
    environment: "both",
    equipment: "Hand towels",
    description:
      "Dry mechanics: the pitcher snaps a towel at a partner's glove out front, repping arm path, stride, and release with zero stress on the arm. Great indoors or on rain days.",
  },
  {
    id: "seed-flat-ground",
    name: "Flat-ground mechanics",
    category: "Pitching",
    defaultMinutes: 12,
    environment: "both",
    description:
      "Controlled throws on flat ground keying balance over the rubber, a directional stride, and finishing out front. Lets pitchers feel mechanics without the mound's added effort.",
  },
  {
    id: "seed-pickoffs",
    name: "Pickoffs & holding runners",
    category: "Pitching",
    defaultMinutes: 10,
    environment: "outdoor",
    description:
      "Pitchers rep the set position, varied looks, slide step, and a quick pickoff move to first. Slows the running game and keeps the defense in control with runners on.",
  },

  // ── Catching ─────────────────────────────────────────────────────────────
  {
    id: "seed-catcher-receiving",
    name: "Receiving & framing",
    category: "Catching",
    defaultMinutes: 12,
    environment: "both",
    description:
      "Catchers receive pitches with a relaxed, quiet glove, 'sticking' borderline pitches and beating them back to the zone. Steals strikes and gives pitchers a confident target.",
  },
  {
    id: "seed-catcher-blocking",
    name: "Blocking in the dirt",
    category: "Catching",
    defaultMinutes: 12,
    environment: "both",
    description:
      "Catchers drop to their knees, chest over the ball, chin down, to smother balls in the dirt and keep them in front. Keeps runners from advancing on a bouncing pitch.",
  },
  {
    id: "seed-catcher-throwdowns",
    name: "Pop time & throw-downs",
    category: "Catching",
    defaultMinutes: 12,
    environment: "outdoor",
    description:
      "Receive, quick transfer, and throw to second focusing on clean footwork and a fast release over raw arm strength. Builds the pop time that shuts down base stealers.",
  },
  {
    id: "seed-catcher-bunts-popups",
    name: "Bunts & pop-ups (catcher)",
    category: "Catching",
    defaultMinutes: 10,
    environment: "outdoor",
    description:
      "Catchers explode from the crouch to field bunts and clear the mask to track foul pop-ups (which curve back toward the field). Owns the area in front of the plate.",
  },

  // ── Fielding / defense ───────────────────────────────────────────────────
  {
    id: "seed-infield-outfield",
    name: "Infield / outfield defense reps",
    category: "Fielding",
    defaultMinutes: 20,
    environment: "outdoor",
    description:
      "Full-field fungo work: infielders take grounders and feeds while outfielders track flies and crow-hop throws to bases. The bread-and-butter defensive block.",
  },
  {
    id: "seed-footwork-transfers",
    name: "Fielding footwork & transfers",
    category: "Fielding",
    defaultMinutes: 15,
    environment: "indoor",
    description:
      "Glove-to-hand transfer reps and the approach-and-field footwork (round the ball, field through it). Clean exchanges turn into quicker, more accurate throws.",
  },
  {
    id: "seed-short-hops",
    name: "Short hops & backhands",
    category: "Fielding",
    defaultMinutes: 12,
    environment: "both",
    description:
      "Partners roll/throw short hops and balls to the backhand side. Trains soft hands, a confident glove-side pick, and trusting the in-between hop instead of backing up.",
  },
  {
    id: "seed-double-play",
    name: "Double-play turns",
    category: "Fielding",
    defaultMinutes: 15,
    environment: "outdoor",
    description:
      "Middle infielders rep the feed, footwork around the bag, and the relay throw. Turning two is the biggest momentum swing a youth defense can make.",
  },
  {
    id: "seed-of-communication",
    name: "Fly-ball communication (OF)",
    category: "Fielding",
    defaultMinutes: 10,
    environment: "outdoor",
    description:
      "Outfielders take overlapping fly balls, loudly calling 'ball, ball, ball' and the priority caller takes it. Prevents the dropped-between-everyone collision.",
  },
  {
    id: "seed-rundown",
    name: "Rundown (pickle) drill",
    category: "Fielding",
    defaultMinutes: 10,
    environment: "both",
    description:
      "Defenders trap a runner between bases and run him down with few throws — run hard at the runner, no pump fakes, throw early, follow your throw. Turns chaos into easy outs.",
  },
  {
    id: "seed-bucket-grounders",
    name: "Rapid-fire grounders",
    category: "Fielding",
    defaultMinutes: 10,
    environment: "both",
    description:
      "Coach rapid-fires grounders from a ball bucket so a player gets many reps fast. Builds range, footwork, and conditioning in a short, high-energy burst.",
  },

  // ── Hitting ──────────────────────────────────────────────────────────────
  {
    id: "seed-live-bp",
    name: "Live batting practice",
    category: "Hitting",
    defaultMinutes: 25,
    environment: "outdoor",
    description:
      "Game-speed pitches from a coach or machine so hitters time real pitching, work counts, and drive the ball. The closest thing to in-game at-bats.",
  },
  {
    id: "seed-tee-soft-toss",
    name: "Tee work / soft toss",
    category: "Hitting",
    defaultMinutes: 20,
    environment: "both",
    equipment: "Batting tee, net",
    description:
      "Controlled swings off a tee and partner soft toss to groove the swing path and contact point with high reps. The foundation every other hitting drill builds on.",
  },
  {
    id: "seed-front-toss",
    name: "Front toss / short box",
    category: "Hitting",
    defaultMinutes: 15,
    environment: "both",
    equipment: "L-screen",
    description:
      "Underhand tosses from behind a short screen ~15 ft away for high-rep, game-like contact with accurate, repeatable location. Bridges tee work and live BP.",
  },
  {
    id: "seed-two-strike",
    name: "Two-strike / situational hitting",
    category: "Hitting",
    defaultMinutes: 15,
    environment: "both",
    description:
      "Hitters choke up, widen the stance, and battle — shorten up to protect with two strikes and hit the ball where it's pitched. Trades the homer swing for tough outs and moving runners.",
  },
  {
    id: "seed-bunting",
    name: "Bunting fundamentals",
    category: "Hitting",
    defaultMinutes: 12,
    environment: "both",
    description:
      "Square early, get on top of the ball, and 'catch' it with the bat to deaden it down a line. Covers sacrifice and drag bunts — a free 90 feet when you need it.",
  },
  {
    id: "seed-one-hand-vision",
    name: "One-hand & vision drills",
    category: "Hitting",
    defaultMinutes: 12,
    environment: "both",
    equipment: "Batting tee, small balls",
    description:
      "Top-hand/bottom-hand swings and tracking small balls (or numbers) to isolate barrel control and sharpen pitch recognition. Fixes casting and pulling off the ball.",
  },
  {
    id: "seed-oppo-hit-run",
    name: "Opposite-field & hit-and-run",
    category: "Hitting",
    defaultMinutes: 12,
    environment: "outdoor",
    description:
      "Stay back and drive the outside pitch the other way, and put the ball in play on the move to protect a runner. Teaches situational, contact-first hitting.",
  },

  // ── Baserunning ──────────────────────────────────────────────────────────
  {
    id: "seed-baserunning",
    name: "Home-to-first & rounding",
    category: "Baserunning",
    defaultMinutes: 10,
    environment: "both",
    description:
      "Run hard through first on a ground ball, and on a base hit make the 'banana' turn to round the bag aggressively. Reading the ball out of the box turns singles into doubles.",
  },
  {
    id: "seed-leads",
    name: "Lead-offs & secondary leads",
    category: "Baserunning",
    defaultMinutes: 10,
    environment: "outdoor",
    description:
      "Take a controlled primary lead, shuffle into a secondary lead as the pitch crosses, and read the pitcher for a jump. Where extra bases and steals begin.",
  },
  {
    id: "seed-sliding",
    name: "Sliding technique",
    category: "Baserunning",
    defaultMinutes: 12,
    environment: "both",
    equipment: "Slip-n-slide or sliding mats (indoor)",
    description:
      "Bent-leg and pop-up slides into a bag, leading with the correct leg and staying on the base. Done on mats indoors — teaches safe sliding so nobody learns it the hard way in a game.",
  },
  {
    id: "seed-first-to-third",
    name: "First-to-third reads",
    category: "Baserunning",
    defaultMinutes: 10,
    environment: "outdoor",
    description:
      "Round second hard and read the outfielder — ball in front, in the gap, or a bobble — to decide whether to take third. Aggressive, smart baserunning that pressures the defense.",
  },
  {
    id: "seed-steals-jumps",
    name: "Steals & first-step jumps",
    category: "Baserunning",
    defaultMinutes: 10,
    environment: "both",
    description:
      "Explosive crossover first step and reading the pitcher's first move to steal second. Reps the jump and footwork that beat the catcher's throw.",
  },
  {
    id: "seed-tag-ups",
    name: "Tag-ups & scoring from third",
    category: "Baserunning",
    defaultMinutes: 8,
    environment: "outdoor",
    description:
      "Read fly-ball depth, get back to tag, and break on the catch — and from third, score on a fly or a ball in the dirt. Wins the run that decides close games.",
  },

  // ── Team / baseball IQ ───────────────────────────────────────────────────
  {
    id: "seed-situational-scrimmage",
    name: "Situational scrimmage",
    category: "Team",
    defaultMinutes: 20,
    environment: "outdoor",
    description:
      "Set the runners, count, and outs, then play it live so players rep real in-game decisions at game speed. The fastest way to turn skills into instincts.",
  },
  {
    id: "seed-baseball-iq",
    name: "Baseball IQ / chalk talk",
    category: "Team",
    defaultMinutes: 15,
    environment: "indoor",
    description:
      "Whiteboard the 'where's the ball going and what's my job' situations: cutoffs, force vs. tag, who covers on a steal. Builds the mental game without needing a field.",
  },
  {
    id: "seed-cutoffs-relays",
    name: "Cutoffs & relays",
    category: "Team",
    defaultMinutes: 15,
    environment: "outdoor",
    description:
      "Outfield-to-infield relay alignment, lining up the throw, and communicating where it goes. Keeps runners from taking the extra base on balls to the gaps.",
  },
  {
    id: "seed-first-third-defense",
    name: "First-and-third defense",
    category: "Team",
    defaultMinutes: 15,
    environment: "outdoor",
    description:
      "Rep the coverages and reads when runners are on the corners and one breaks — who takes the throw, who watches the runner at third. Defuses a play that wrecks youth defenses.",
  },
  {
    id: "seed-inter-squad",
    name: "Inter-squad scrimmage",
    category: "Team",
    defaultMinutes: 25,
    environment: "outdoor",
    description:
      "A full controlled game, splitting the roster, to apply every skill under real pressure with umpire-style calls. Great season-opening evaluator and team builder.",
  },
  {
    id: "seed-late-game-situations",
    name: "Late-game pressure situations",
    category: "Team",
    defaultMinutes: 12,
    environment: "outdoor",
    description:
      "Stage the tense spots — squeeze bunt, infield in, runner on third with two outs, walk-off — and play them out. Teaches composure so the moment isn't new in the game.",
  },
];

// DEFAULT_TEAM_DATA seeds LOCAL team state (so screens can safely read
// teamData.evaluationEvents et al. before a snapshot lands). It is NOT the
// shape createTeam writes — see NEW_TEAM_DOC below.
export const DEFAULT_TEAM_DATA = Object.freeze({
  players: [],
  coaches: [],
  games: [],
  practices: [],
  tournaments: [],
  opponentArchive: [],
  drillLibrary: DEFAULT_DRILL_LIBRARY,
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
  // Stat-surface density across Home/Stats/Roster: "rich" or "stripped".
  statDisplay: "rich",
});

// The shape createTeam writes to a NEW team doc: DEFAULT_TEAM_DATA minus the
// legacy `evaluationEvents` array. Rounds live in the evalRounds subcollection
// (finding 3.1) and the rules reject any team-doc write that would (re)create
// the dropped field — seeding it at create would plant a member-writable
// leftover on every new team.
export const NEW_TEAM_DOC = Object.freeze(
  (({ evaluationEvents: _legacy, ...rest }) => rest)(DEFAULT_TEAM_DATA),
);
