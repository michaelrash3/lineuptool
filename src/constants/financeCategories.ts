// Youth-baseball finance category catalog — the quick-pick vocabulary behind
// the Finances tab. This is a NON-BREAKING convenience layer: budget items and
// ledger entries still store a free-text `label`, so nothing here changes the
// schema. It just gives a coach a ready-made set of the line items a travel/rec
// baseball team actually budgets for, so they tap instead of type.
//
// Two consumers (src/screens/FinancesTab.tsx):
//   - BUDGET_PRESETS → grouped quick-add chips in the Budget Planner. A preset
//     with a `unitNoun` opens the add form in quantity mode (count × per-unit,
//     e.g. 8 tournaments × $450); without one it's a flat dollar amount.
//   - the *_SUGGESTIONS arrays → <datalist> autocomplete on the ledger's
//     free-text money-out / money-in boxes, and DEPOSIT_QUICK_PICKS → chips on
//     the next-season deposit field.
//
// A future PR (docs/finance-categories.md) may promote these into a structured
// `category` field for by-category reporting; until then they are suggestions,
// never a constraint.

// The seven spending areas a youth-baseball budget divides into. Kept as a
// string union (the labels double as the on-screen group headers).
export type BudgetPresetGroup =
  | "Tournaments & games"
  | "Facilities & field"
  | "Gear & equipment"
  | "Uniforms & apparel"
  | "League & admin"
  | "Travel & lodging"
  | "Team & events";

// Declaration order = display order of the group headers.
export const BUDGET_PRESET_GROUPS: BudgetPresetGroup[] = [
  "Tournaments & games",
  "Facilities & field",
  "Gear & equipment",
  "Uniforms & apparel",
  "League & admin",
  "Travel & lodging",
  "Team & events",
];

export interface BudgetPreset {
  // The budget-item label this chip fills in.
  label: string;
  group: BudgetPresetGroup;
  // Present ⇒ the add form opens in quantity mode (count × per-unit) and this
  // is the per-unit noun shown next to the cost field ("per tournament").
  // Absent ⇒ a single flat dollar amount.
  unitNoun?: string;
  // Seed the count from the current roster size (per-player gear: a jersey for
  // every kid). Only meaningful alongside a `unitNoun` (quantity mode).
  qtyFromRoster?: boolean;
  // Default the item's `taxable` flag on — physical goods and tournament
  // entries are usually quoted pre-tax. The coach can still toggle it per item.
  taxable?: boolean;
}

// The catalog. ~40 items — the line items a travel/rec baseball team routinely
// budgets. Labels are unique (they double as the money-out autocomplete list).
export const BUDGET_PRESETS: BudgetPreset[] = [
  // ---- Tournaments & games ----
  {
    label: "Tournament entry",
    group: "Tournaments & games",
    unitNoun: "per tournament",
    taxable: true,
  },
  { label: "Umpire fees", group: "Tournaments & games", unitNoun: "per game" },
  {
    label: "League game fees",
    group: "Tournaments & games",
    unitNoun: "per game",
  },
  { label: "Guest-player fee", group: "Tournaments & games" },

  // ---- Facilities & field ----
  {
    label: "Field rental",
    group: "Facilities & field",
    unitNoun: "per session",
  },
  {
    label: "Indoor facility",
    group: "Facilities & field",
    unitNoun: "per session",
  },
  {
    label: "Batting cage time",
    group: "Facilities & field",
    unitNoun: "per session",
  },
  { label: "Field prep & chalk", group: "Facilities & field", taxable: true },
  { label: "Mound clay & dirt", group: "Facilities & field", taxable: true },
  { label: "Lights & utility fee", group: "Facilities & field" },

  // ---- Gear & equipment ----
  {
    label: "Baseballs",
    group: "Gear & equipment",
    unitNoun: "per dozen",
    taxable: true,
  },
  { label: "Bats", group: "Gear & equipment", taxable: true },
  { label: "Catcher's gear", group: "Gear & equipment", taxable: true },
  { label: "Batting helmets", group: "Gear & equipment", taxable: true },
  { label: "Protective screens", group: "Gear & equipment", taxable: true },
  { label: "Tees & nets", group: "Gear & equipment", taxable: true },
  { label: "Equipment bag & bucket", group: "Gear & equipment", taxable: true },
  { label: "First-aid kit", group: "Gear & equipment", taxable: true },
  { label: "Pitching machine", group: "Gear & equipment", taxable: true },

  // ---- Uniforms & apparel ----
  {
    label: "Game jerseys",
    group: "Uniforms & apparel",
    unitNoun: "per jersey",
    qtyFromRoster: true,
    taxable: true,
  },
  {
    label: "Game pants",
    group: "Uniforms & apparel",
    unitNoun: "per player",
    qtyFromRoster: true,
    taxable: true,
  },
  {
    label: "Hats",
    group: "Uniforms & apparel",
    unitNoun: "per hat",
    qtyFromRoster: true,
    taxable: true,
  },
  {
    label: "Belts & socks",
    group: "Uniforms & apparel",
    unitNoun: "per player",
    qtyFromRoster: true,
    taxable: true,
  },
  {
    label: "Practice & warm-up tees",
    group: "Uniforms & apparel",
    unitNoun: "per player",
    qtyFromRoster: true,
    taxable: true,
  },
  { label: "Coach apparel", group: "Uniforms & apparel", taxable: true },

  // ---- League & admin ----
  { label: "League registration", group: "League & admin" },
  { label: "Sanctioning fee (USSSA/AAU)", group: "League & admin" },
  { label: "Team insurance", group: "League & admin" },
  {
    label: "Background checks",
    group: "League & admin",
    unitNoun: "per coach",
  },
  { label: "Coaching stipend", group: "League & admin" },
  { label: "Website & roster software", group: "League & admin" },
  { label: "Banking & processing fees", group: "League & admin" },

  // ---- Travel & lodging ----
  { label: "Hotel", group: "Travel & lodging", unitNoun: "per night" },
  { label: "Team transportation", group: "Travel & lodging" },
  { label: "Fuel & tolls", group: "Travel & lodging" },
  { label: "Meals & per-diem", group: "Travel & lodging" },

  // ---- Team & events ----
  { label: "Trophies & awards", group: "Team & events", taxable: true },
  { label: "Team banquet", group: "Team & events" },
  { label: "End-of-season party", group: "Team & events" },
  { label: "Team photos", group: "Team & events" },
  { label: "Senior night & gifts", group: "Team & events" },
  { label: "Contingency & misc.", group: "Team & events" },
];

// Autocomplete for the ledger's money-OUT box: every budget-preset label. The
// coach can still type anything; these are just one-tap common spends.
export const EXPENSE_LABEL_SUGGESTIONS: string[] = BUDGET_PRESETS.map(
  (p) => p.label,
);

// Autocomplete for the ledger's money-IN box: the ways a youth team actually
// brings in money outside club-fee payments (sponsorships, fundraisers,
// donations). Independent of the spend catalog above.
export const INCOME_LABEL_SUGGESTIONS: string[] = [
  "Sponsorship",
  "Team banner sponsor",
  "Car wash",
  "Raffle",
  "Concessions & snack bar",
  "Spirit wear sale",
  "Bottle & can drive",
  "Restaurant fundraiser night",
  "Donation",
  "Grant",
  "50/50 draw",
  "Bake sale",
  "Coupon-book sale",
];

// One-tap amounts for the next-season deposit field — the deposit slices a
// travel team typically asks families to put down to hold a roster spot.
export const DEPOSIT_QUICK_PICKS: number[] = [50, 75, 100, 150, 200];
