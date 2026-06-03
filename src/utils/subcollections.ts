// Subcollection merge helpers for the high-growth team arrays migrated off the
// root team document (docs/firestore-data-migration.md). The coach client
// subscribes to each subcollection and merges its docs into the team object the
// rest of the app consumes, so legacy root-array data and new subcollection
// data present as one list during (and after) the rollout.

// The high-growth/public-write arrays that live (or are migrating to) per-team
// subcollections at artifacts/{appId}/public/data/teams/{teamId}/{name}/{id}.
export const SUBCOLLECTION_NAMES = [
  "tryoutSignups",
  "interestSignups",
  "evaluationEvents",
  "games",
  "players",
] as const;

export type SubcollectionName = (typeof SUBCOLLECTION_NAMES)[number];

export type SubData = Partial<Record<SubcollectionName, any[]>>;

// Merge subcollection docs (each tagged with `_sub === <collection name>`) into
// the team's legacy root arrays, de-duplicating by `id` with the subcollection
// copy winning. Only the collections listed in `activeKeys` are merged — a
// collection whose coach-side write routing hasn't been migrated yet must keep
// reading/writing its root array untouched, so it's left out until its phase
// ships. The same team reference is returned when there's nothing to merge, so
// downstream memo dependencies don't churn for teams with no subcollection data.
export const mergeSubcollections = <T extends Record<string, any>>(
  team: T,
  subData: SubData,
  activeKeys: readonly SubcollectionName[]
): T => {
  let changed = false;
  const out: Record<string, any> = { ...team };
  for (const key of activeKeys) {
    const sub = subData[key];
    if (!sub || sub.length === 0) continue;
    const legacy = Array.isArray(team[key]) ? team[key] : [];
    const subIds = new Set(sub.map((s: any) => s?.id));
    out[key] = [...legacy.filter((e: any) => !subIds.has(e?.id)), ...sub];
    changed = true;
  }
  return changed ? (out as T) : team;
};
