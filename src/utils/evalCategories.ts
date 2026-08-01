// Per-team evaluation categories — the config layer over the default catalog
// (docs/EVALUATIONS-AUDIT.md §4, "Per-team custom categories"). Pure: no React,
// no Firestore. The team doc carries two optional fields (types.ts):
//
//   evalCategoryOverrides — { [categoryId]: { label?, hidden? } }
//   evalCustomCategories  — [{ id, label, group, description? }]
//
// ============================================================================
// THE BACK-COMPAT CONTRACT — read this before changing anything here
// ============================================================================
// Eval rounds are permanent records of how a coach scored a real kid on a real
// day. A config edit must never restate them. Four rules, each pinned by a test
// in evalCategories.test.ts / evalScoring.test.ts / lineupEngine.eval.test.ts:
//
// 1. UNCONFIGURED TEAMS ARE BYTE-IDENTICAL. With no config (both fields absent,
//    or empty, or containing only no-op entries) every resolver here returns
//    the SAME ARRAY REFERENCE it was handed, and every scoring path that takes
//    an `extra` list gets an empty one — so the numbers are bit-for-bit what
//    they were before this feature existed. `resolveEvalCategories(base) === base`
//    is not an optimization, it is the contract.
//
// 2. IDS ARE FOREVER; RENAMES ARE DISPLAY-ONLY. A rename writes
//    `overrides[id].label` and never touches the id, so a round graded under
//    the old name keeps rendering, aggregating and exporting under the new one.
//    There is no rename migration because there is nothing to migrate.
//
// 3. HIDING IS FORWARD-ONLY. A hidden category drops out of the grading UI and
//    out of the seed for NEW rounds. It stays in the scoring catalog, stays in
//    history views (which resolve with `includeHidden`), and no stored grade is
//    ever deleted. Because every scorer already treats a missing category as
//    the neutral 3, hiding is score-neutral by construction.
//
// 4. CUSTOM CATEGORIES SCORE PER-ROUND, NOT RETROACTIVELY. A custom category
//    contributes to the 0–100 composite only for rounds that actually carry a
//    grade for it (see totalScoreParts in lineupEngine/totalScore.ts): it is
//    added to the numerator AND the denominator together. A round saved before
//    the category existed has no value for it, so its score is unchanged — and
//    stays unchanged forever. Hidden customs are still SCORED (rule 3) so the
//    rounds that carry them keep their original numbers.
//
// Cut, deliberately (recorded in docs/EVALUATIONS-AUDIT.md): per-category
// weights are not editable. Every custom category scores at the fixed
// CUSTOM_EVAL_CATEGORY_WEIGHT below.

import type { EvalCategory, EvalGroup } from "../constants/ui";
import type {
  EvalCategoryOverride,
  EvalCustomCategory,
  EvaluationEvent,
} from "../types";

// Custom ids are namespaced so they can never collide with a built-in id —
// not today's, and not one added in a later schema version. Anything stored
// without this prefix is rejected on read.
export const CUSTOM_EVAL_CATEGORY_PREFIX = "custom_";

// Groups a coach may file a custom category under. Deliberately NOT the full
// EvalGroup union: "Fielding" has no grading tab (every built-in Fielding
// category is data-driven), so a custom filed there would be invisible.
// Pitching / Catching are Kid-Pitch add-on groups — a custom filed there is
// gated exactly like the built-in add-ons (kid-pitch teams only, and only for
// kids comfortable at P / C).
export const CUSTOM_EVAL_CATEGORY_GROUPS = [
  "Hitting",
  "Baserunning",
  "Intangibles",
  "Pitching",
  "Catching",
] as const;

export type CustomEvalCategoryGroup =
  (typeof CUSTOM_EVAL_CATEGORY_GROUPS)[number];

const ADD_ON_GROUPS = new Set<string>(["Pitching", "Catching"]);

// Scoring weight every custom category carries. Sized between the built-in
// Speed (1.0) and Approach (2.5) — a real but not dominant voice. Fixed on
// purpose: editable per-category weights are the documented cut.
export const CUSTOM_EVAL_CATEGORY_WEIGHT = 1.5;

// Guard rails on a field any team member can technically write.
export const MAX_CUSTOM_EVAL_CATEGORIES = 8;
export const MAX_EVAL_CATEGORY_LABEL = 28;
export const MAX_EVAL_CATEGORY_DESCRIPTION = 120;

export interface EvalCategoryConfig {
  overrides?: Record<string, EvalCategoryOverride>;
  custom?: EvalCustomCategory[];
}

// A category as the scorers see it: an id and a weight, nothing else.
export interface ScoredEvalCategory {
  id: string;
  weight: number;
}

const clampText = (v: unknown, max: number): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// Does this config actually say anything? An all-empty config must behave
// exactly like no config at all (contract rule 1) — a team that added a
// category and then removed it is indistinguishable from one that never did.
export const isEmptyEvalCategoryConfig = (
  config: EvalCategoryConfig | null | undefined,
): boolean => {
  if (!config) return true;
  const customCount = Array.isArray(config.custom) ? config.custom.length : 0;
  if (customCount > 0) return false;
  const overrides = config.overrides;
  if (!overrides || typeof overrides !== "object") return true;
  return !Object.values(overrides).some(
    (o) => o && (typeof o.label === "string" || o.hidden === true),
  );
};

// Normalize whatever is on the team doc into a trustworthy config. Everything
// malformed is dropped rather than repaired: a broken write must never take
// the grading screen down, and dropping falls back to the stock catalog, which
// is always safe. Returns undefined when nothing is configured, so callers get
// the identity fast path (contract rule 1).
export const readEvalCategoryConfig = (
  // Takes the whole team doc (index signature and all) rather than a narrow
  // pair of fields, so every caller can pass `team` straight through.
  team:
    | {
        evalCategoryOverrides?: unknown;
        evalCustomCategories?: unknown;
        [key: string]: unknown;
      }
    | null
    | undefined,
): EvalCategoryConfig | undefined => {
  if (!team) return undefined;

  const overrides: Record<string, EvalCategoryOverride> = {};
  const rawOverrides = team.evalCategoryOverrides;
  if (rawOverrides && typeof rawOverrides === "object") {
    for (const [id, raw] of Object.entries(
      rawOverrides as Record<string, unknown>,
    )) {
      if (!id || typeof raw !== "object" || raw == null) continue;
      const o = raw as EvalCategoryOverride;
      const next: EvalCategoryOverride = {};
      const label = clampText(o.label, MAX_EVAL_CATEGORY_LABEL);
      if (typeof o.label === "string" && label) next.label = label;
      if (o.hidden === true) next.hidden = true;
      if (next.label != null || next.hidden) overrides[id] = next;
    }
  }

  const custom: EvalCustomCategory[] = [];
  const rawCustom = team.evalCustomCategories;
  if (Array.isArray(rawCustom)) {
    const seen = new Set<string>();
    for (const raw of rawCustom) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as EvalCustomCategory;
      const id = String(c.id ?? "");
      // The namespace guard: an unprefixed id could shadow a built-in
      // category and silently rewrite its meaning. Drop it.
      if (!id.startsWith(CUSTOM_EVAL_CATEGORY_PREFIX) || seen.has(id)) continue;
      const label = clampText(c.label, MAX_EVAL_CATEGORY_LABEL);
      if (!label) continue;
      const group = (CUSTOM_EVAL_CATEGORY_GROUPS as readonly string[]).includes(
        String(c.group),
      )
        ? (String(c.group) as CustomEvalCategoryGroup)
        : "Intangibles";
      const description = clampText(
        c.description,
        MAX_EVAL_CATEGORY_DESCRIPTION,
      );
      seen.add(id);
      custom.push({
        id,
        label,
        group,
        ...(description ? { description } : {}),
      });
      if (custom.length >= MAX_CUSTOM_EVAL_CATEGORIES) break;
    }
  }

  const config: EvalCategoryConfig = { overrides, custom };
  return isEmptyEvalCategoryConfig(config) ? undefined : config;
};

// The custom categories as full catalog entries. Hidden ones are included —
// callers filter, so the scorers can keep them (contract rules 3 + 4).
const customCatalogEntries = (
  config: EvalCategoryConfig | null | undefined,
): EvalCategory[] =>
  (config?.custom || []).map((c) => ({
    id: c.id,
    label: c.label,
    group: c.group as EvalGroup,
    weight: CUSTOM_EVAL_CATEGORY_WEIGHT,
    ...(c.description ? { description: c.description } : {}),
    ...(ADD_ON_GROUPS.has(c.group) ? { addOn: "kidPitch" as const } : {}),
    custom: true,
  }));

export interface ResolveEvalCategoriesOptions {
  // Keep categories the team hid. HISTORY surfaces (past-round views, trends,
  // comparisons, exports) must pass this: hiding is forward-only and a round
  // graded before the hide still has real grades to show.
  includeHidden?: boolean;
}

// The team's category list = the default catalog with labels overridden and
// hidden entries dropped, plus the team's own categories appended.
//
// With no config this returns `base` ITSELF — same reference, same order, same
// objects (contract rule 1). Every caller passes a `base` it already filtered
// for pitching format / player position, so this layer never re-implements
// that gating.
export const resolveEvalCategories = (
  base: EvalCategory[],
  config?: EvalCategoryConfig | null,
  opts?: ResolveEvalCategoriesOptions,
): EvalCategory[] => {
  if (isEmptyEvalCategoryConfig(config)) return base;
  const overrides = config?.overrides || {};
  const includeHidden = opts?.includeHidden === true;
  const visible = (c: { id: string }) =>
    includeHidden || overrides[c.id]?.hidden !== true;
  const renamed = (c: EvalCategory): EvalCategory => {
    const label = overrides[c.id]?.label;
    return label ? { ...c, label } : c;
  };
  // Add-on customs are gated by the same rules their group implies, which
  // `base` already encodes: a Pitching custom rides along only where the
  // built-in Pitching add-ons did (kid-pitch team, and a kid comfortable at P).
  // Per-GROUP, not a blanket flag — a pitcher who doesn't catch must not
  // inherit the team's Catching categories.
  const addOnGroups = new Set(
    base.filter((c) => c.addOn).map((c) => String(c.group)),
  );
  const customs = customCatalogEntries(config).filter(
    (c) => (!c.addOn || addOnGroups.has(String(c.group))) && visible(c),
  );
  return [...base.filter(visible).map(renamed), ...customs];
};

// The custom categories the SCORERS use: id + weight, hidden ones included so
// a round graded before a hide keeps its exact score (contract rules 3 + 4).
// Returns a shared frozen empty array for unconfigured teams so callers can
// pass it unconditionally at zero cost.
const NO_EXTRA_CATEGORIES: ReadonlyArray<ScoredEvalCategory> = Object.freeze(
  [],
);

export const scoredCustomCategories = (
  config: EvalCategoryConfig | null | undefined,
): ReadonlyArray<ScoredEvalCategory> => {
  const custom = config?.custom;
  if (!custom || custom.length === 0) return NO_EXTRA_CATEGORIES;
  return custom.map((c) => ({
    id: c.id,
    weight: CUSTOM_EVAL_CATEGORY_WEIGHT,
  }));
};

// Display label for ANY category id, including one whose category has since
// been hidden or whose team never defined it (legacy ids from an older schema
// resolve to their raw id rather than vanishing).
export const evalCategoryLabel = (
  id: string,
  catalog: ReadonlyArray<EvalCategory>,
  config?: EvalCategoryConfig | null,
): string =>
  config?.overrides?.[id]?.label ||
  catalog.find((c) => c.id === id)?.label ||
  config?.custom?.find((c) => c.id === id)?.label ||
  id;

// ---- Config edits (pure; the Settings panel writes the returned patch) ------

// A collision-proof id for a new category: the namespace prefix, a slug of the
// coach's label for readability in exports, and a short suffix so re-adding a
// deleted name never reuses the old id (and so its old grades stay orphaned to
// the old id rather than silently reappearing under the new one).
export const newCustomEvalCategoryId = (
  label: string,
  existingIds: Iterable<string> = [],
): string => {
  const slug =
    clampText(label, MAX_EVAL_CATEGORY_LABEL)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "category";
  const taken = new Set(existingIds);
  let id = `${CUSTOM_EVAL_CATEGORY_PREFIX}${slug}`;
  let n = 2;
  while (taken.has(id)) id = `${CUSTOM_EVAL_CATEGORY_PREFIX}${slug}-${n++}`;
  return id;
};

// Append a category. Returns the config unchanged when the label is blank or
// the cap is reached, so the caller can compare references to detect a no-op.
export const addCustomEvalCategory = (
  config: EvalCategoryConfig | null | undefined,
  input: { label: string; group?: string; description?: string },
): EvalCategoryConfig => {
  const label = clampText(input.label, MAX_EVAL_CATEGORY_LABEL);
  const current = config?.custom || [];
  if (!label || current.length >= MAX_CUSTOM_EVAL_CATEGORIES) {
    return config || {};
  }
  const group = (CUSTOM_EVAL_CATEGORY_GROUPS as readonly string[]).includes(
    String(input.group),
  )
    ? String(input.group)
    : "Intangibles";
  const description = clampText(
    input.description,
    MAX_EVAL_CATEGORY_DESCRIPTION,
  );
  return {
    ...config,
    custom: [
      ...current,
      {
        id: newCustomEvalCategoryId(
          label,
          current.map((c) => c.id),
        ),
        label,
        group,
        ...(description ? { description } : {}),
      },
    ],
  };
};

// Rename ANY category — built-in or custom — by writing a display override.
// The id is untouched (contract rule 2). A blank label, or one equal to the
// category's own label, CLEARS the override instead of storing a duplicate.
export const renameEvalCategory = (
  config: EvalCategoryConfig | null | undefined,
  id: string,
  label: string,
  defaultLabel?: string,
): EvalCategoryConfig => {
  const next = clampText(label, MAX_EVAL_CATEGORY_LABEL);
  const overrides = { ...(config?.overrides || {}) };
  const existing = overrides[id];
  if (!next || (defaultLabel && next === defaultLabel)) {
    if (!existing) return config || {};
    if (existing.hidden) overrides[id] = { hidden: true };
    else delete overrides[id];
  } else {
    overrides[id] = { ...existing, label: next };
  }
  return { ...config, overrides };
};

// Hide / unhide a category. Unhiding drops the flag entirely (and the whole
// override when nothing else is set) so an untouched team's config stays
// empty — the identity fast path in rule 1 depends on it.
export const setEvalCategoryHidden = (
  config: EvalCategoryConfig | null | undefined,
  id: string,
  hidden: boolean,
): EvalCategoryConfig => {
  const overrides = { ...(config?.overrides || {}) };
  const existing = overrides[id];
  if (hidden) {
    overrides[id] = { ...existing, hidden: true };
  } else {
    if (!existing) return config || {};
    if (existing.label) overrides[id] = { label: existing.label };
    else delete overrides[id];
  }
  return { ...config, overrides };
};

// Drop a custom category outright. ONLY safe for a category no round has ever
// graded — the caller gates on evalCategoryIdsInUse; everything else hides.
// Its overrides go with it so a later category can't inherit a stale rename.
export const removeCustomEvalCategory = (
  config: EvalCategoryConfig | null | undefined,
  id: string,
): EvalCategoryConfig => {
  const custom = (config?.custom || []).filter((c) => c.id !== id);
  const overrides = { ...(config?.overrides || {}) };
  delete overrides[id];
  return { ...config, custom, overrides };
};

// Every category id that any round has a grade for. The Settings panel uses
// this to decide whether a custom category may be deleted (no data) or must be
// hidden (has data) — the mechanical enforcement of "history is never
// destroyed". Non-numeric entries (notes, suggestedPositions) are skipped.
export const evalCategoryIdsInUse = (
  rounds: EvaluationEvent[] | null | undefined,
): Set<string> => {
  const out = new Set<string>();
  for (const round of rounds || []) {
    const byPlayer = round?.grades;
    if (!byPlayer || typeof byPlayer !== "object") continue;
    for (const record of Object.values(byPlayer)) {
      if (!record || typeof record !== "object") continue;
      for (const [key, value] of Object.entries(
        record as Record<string, unknown>,
      )) {
        if (typeof value === "number" && Number.isFinite(value)) out.add(key);
      }
    }
  }
  return out;
};

// The team-doc patch for a config edit. Always writes BOTH fields so a removal
// actually lands (a partial patch would leave the old array in place).
export const evalCategoryConfigPatch = (
  config: EvalCategoryConfig | null | undefined,
): {
  evalCategoryOverrides: Record<string, EvalCategoryOverride>;
  evalCustomCategories: EvalCustomCategory[];
} => ({
  evalCategoryOverrides: config?.overrides || {},
  evalCustomCategories: config?.custom || [],
});

// ---- Opt-in presets ---------------------------------------------------------
// NOT defaults. The stock catalog is unchanged for every team (contract rule
// 1); these are one-click starting points a coach can add and then rename or
// hide like any other custom category.
//
// Kid-pitch preset: the two pitching intangibles a box score cannot see at
// 8U–10U. Velocity, strikes and off-speed are already graded from imported
// stats, and Composure is already universal — so this preset deliberately adds
// only what is genuinely missing.
export const KID_PITCH_CATEGORY_PRESET: Array<{
  label: string;
  group: CustomEvalCategoryGroup;
  description: string;
}> = [
  {
    label: "Mechanics",
    group: "Pitching",
    description:
      "Repeatable delivery — balance, direction, finishes out front.",
  },
  {
    label: "Fields the Position",
    group: "Pitching",
    description: "Comebackers, covers first, backs up bases after the pitch.",
  },
];

// Add every preset entry the team doesn't already have (matched on label, so
// re-applying is a no-op rather than a duplicate).
export const applyEvalCategoryPreset = (
  config: EvalCategoryConfig | null | undefined,
  preset: Array<{
    label: string;
    group: CustomEvalCategoryGroup;
    description?: string;
  }>,
): EvalCategoryConfig => {
  let next: EvalCategoryConfig = config || {};
  for (const entry of preset) {
    const already = (next.custom || []).some(
      (c) => c.label.toLowerCase() === entry.label.toLowerCase(),
    );
    if (already) continue;
    next = addCustomEvalCategory(next, entry);
  }
  return next;
};
