// Optional feature modules a head coach can turn off in Settings. A rec team
// that never runs tryouts or doesn't track money shouldn't carry those tabs
// around all season.
//
// Model: the team doc stores only the DISABLED list (`disabledFeatures`) —
// an absent/empty list means everything is on, so existing teams are
// untouched and a new feature ships enabled by default. Core surfaces
// (Dashboard, Roster, Schedule, Evaluation, Settings) are deliberately not in
// this catalog and can never be turned off.
//
// Scope: a toggle hides the TAB and its routes — or, for module-scoped
// features like "tournaments", the panels/sections that make up the module
// on a core tab. Shared portal links (tryout signup, availability, player
// info) keep working — closing public intake is its own control (e.g.
// tryoutsOpen), not this switch.

export type TeamFeatureId =
  | "tournaments"
  | "practices"
  | "stats"
  | "depthChart"
  | "tryouts"
  | "interest"
  | "playerInfo"
  | "availability"
  | "finances";

export interface ToggleableFeature {
  id: TeamFeatureId;
  label: string;
  description: string;
}

// Declaration order = display order of the Settings toggles (mirrors the tab
// bar order so the list reads like the nav).
export const TOGGLEABLE_FEATURES: ToggleableFeature[] = [
  {
    id: "tournaments",
    label: "Tournament Ops",
    description:
      "Weekend game grouping and cross-game pitching plans on the Schedule tab. Off restores the plain auto-detected tournament chips.",
  },
  {
    id: "practices",
    label: "Practices",
    description: "Practice planner — schedule, drill library, plans.",
  },
  {
    id: "stats",
    label: "Stats",
    description: "Season stat lines, leaders, and GameChanger imports.",
  },
  {
    id: "depthChart",
    label: "Depth Chart",
    description: "Position depth board built from evals and reps.",
  },
  {
    id: "tryouts",
    label: "Tryouts",
    description:
      "Tryout dates, signups, showcase stations, and the ranking board. The public signup link keeps working — close intake with the tryouts-open switch.",
  },
  {
    id: "interest",
    label: "Player Interest",
    description: "Year-round interest leads from the public interest portal.",
  },
  {
    id: "playerInfo",
    label: "Player Info",
    description: "Parent-submitted sizing and logistics inbox.",
  },
  {
    id: "availability",
    label: "Availability",
    description: "Parent-submitted absence calendar.",
  },
  {
    id: "finances",
    label: "Finances",
    description: "Budget, team fees, ledger, and treasurer reports.",
  },
];

const TOGGLEABLE_IDS = new Set<string>(TOGGLEABLE_FEATURES.map((f) => f.id));

// Is this feature on for the team? Anything not in the toggleable catalog
// (core tabs, unknown ids) is always on — an unknown entry in the stored list
// can never brick a tab.
export const featureEnabled = (
  team: { disabledFeatures?: string[] } | null | undefined,
  id: string,
): boolean =>
  !TOGGLEABLE_IDS.has(id) ||
  !(team?.disabledFeatures || []).includes(id as TeamFeatureId);

// The next disabledFeatures list after flipping one switch. Keeps catalog
// order (stable writes), drops ids that are no longer toggleable.
export const toggleFeature = (
  disabled: string[] | null | undefined,
  id: TeamFeatureId,
  enabled: boolean,
): TeamFeatureId[] => {
  const off = new Set(
    (disabled || []).filter((d): d is TeamFeatureId => TOGGLEABLE_IDS.has(d)),
  );
  if (enabled) off.delete(id);
  else off.add(id);
  return TOGGLEABLE_FEATURES.map((f) => f.id).filter((f) => off.has(f));
};
