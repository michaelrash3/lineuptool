// UI-only constants extracted from App.jsx Section 4.

// EVAL_CATEGORIES is duplicated here with labels for the Evaluation table UI.
// The engine has its own labelless internal copy.
export const EVAL_CATEGORIES = [
  { id: "fielding", label: "Fielding", weight: 2.5 },
  { id: "baseballIQ", label: "Baseball IQ", weight: 2.0 },
  { id: "armStrength", label: "Arm Strength", weight: 1.5 },
  { id: "armAccuracy", label: "Arm Accuracy", weight: 1.5 },
  { id: "speedAgility", label: "Speed & Agility", weight: 1.5 },
  { id: "coachability", label: "Coachability", weight: 1.0 },
];

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

export const bumpAgeTier = (current) => {
  const i = AGE_TIERS.indexOf(current);
  if (i === -1 || i === AGE_TIERS.length - 1) return current;
  return AGE_TIERS[i + 1];
};

// Compute the "next" season label and whether the age tier should bump.
// Returns { nextSeason, shouldBump }.
export const computeNextSeason = (currentSeasonStr) => {
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
