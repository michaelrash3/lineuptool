// UI-only constants extracted from App.jsx Section 4.

// Coach's Card v2 eval taxonomy.
// 11 universal categories grouped into 4 buckets; pitching + catching are
// Kid-Pitch add-ons (every player on Kid Pitch teams gets graded on them).
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
  addOn?: "kidPitch"; // gating: only shown when pitchingFormat === "Kid Pitch"
}

export const EVAL_CATEGORIES: EvalCategory[] = [
  // Hitting
  { id: "contact", label: "Contact", group: "Hitting", weight: 1.5 },
  { id: "power", label: "Power", group: "Hitting", weight: 1.0 },
  { id: "plateDiscipline", label: "Plate Discipline", group: "Hitting", weight: 1.0 },
  { id: "approach", label: "Approach", group: "Hitting", weight: 1.5 },
  // Fielding
  { id: "glove", label: "Glove", group: "Fielding", weight: 2.5 },
  { id: "range", label: "Range", group: "Fielding", weight: 2.0 },
  { id: "armStrength", label: "Arm Strength", group: "Fielding", weight: 1.5 },
  { id: "armAccuracy", label: "Arm Accuracy", group: "Fielding", weight: 1.5 },
  // Baserunning
  { id: "baserunning", label: "Baserunning", group: "Baserunning", weight: 1.5 },
  // Intangibles
  { id: "baseballIQ", label: "Baseball IQ", group: "Intangibles", weight: 2.0 },
  { id: "coachability", label: "Coachability", group: "Intangibles", weight: 1.0 },
  // Kid-Pitch add-ons: Pitching
  { id: "velocity", label: "Velocity", group: "Pitching", weight: 1.0, addOn: "kidPitch" },
  { id: "control", label: "Control", group: "Pitching", weight: 1.5, addOn: "kidPitch" },
  { id: "command", label: "Command", group: "Pitching", weight: 1.0, addOn: "kidPitch" },
  { id: "offSpeed", label: "Off-Speed", group: "Pitching", weight: 0.5, addOn: "kidPitch" },
  { id: "composure", label: "Composure", group: "Pitching", weight: 1.0, addOn: "kidPitch" },
  // Kid-Pitch add-ons: Catching
  { id: "receiving", label: "Receiving", group: "Catching", weight: 1.0, addOn: "kidPitch" },
  { id: "blocking", label: "Blocking", group: "Catching", weight: 1.0, addOn: "kidPitch" },
  { id: "popTime", label: "Pop Time", group: "Catching", weight: 1.0, addOn: "kidPitch" },
  { id: "gameCalling", label: "Game Calling", group: "Catching", weight: 1.0, addOn: "kidPitch" },
];

export const EVAL_GROUPS_UNIVERSAL: EvalGroup[] = [
  "Hitting",
  "Fielding",
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
export const EVAL_SCHEMA_VERSION = 5;

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

export const getLocalDateString = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split("T")[0];
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
});
