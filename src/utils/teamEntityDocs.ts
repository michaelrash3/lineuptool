// Phase 3 of docs/firestore-data-migration.md — the coach-written team-doc
// arrays (`games` now; `players` next) move to per-entry subcollection docs.
//
// Unlike the portal lanes, these arrays are written by DOZENS of coach flows
// through two provider choke points (updateTeamArrays, persistTeam), almost
// all of which express their edit as "here is the next array". Rather than
// convert every caller, the provider keeps computing the next array against
// the assembled union and this module turns (previous union, next array) into
// the minimal set of per-doc writes: full-entry set()s for added/changed
// entries, delete()s for removed ones. Full-entry set (never updateDoc merge)
// is load-bearing — several writers clear fields by OMISSION (a mapEntries
// that drops `health`, advanceSeason resetting stats), which a merge write
// would silently resurrect.
//
// The diff is value-based, not reference-based: wholesale undo restores
// (map: () => prevGames) rebuild every entry object, and a reference diff
// would rewrite every doc. stableStringify (key-order-insensitive) bounds the
// writes to entries that actually changed; a false positive is only ever a
// redundant idempotent full-entry set.

import type { DocumentData } from "firebase/firestore";

export type EntityDiff = {
  /** Entries to write as their own full doc (added or value-changed). */
  sets: Array<{ id: string } & Record<string, unknown>>;
  /** Doc ids to delete (present before, absent in the next array). */
  deletes: string[];
};

// JSON.stringify with recursively sorted object keys, so two structurally
// equal entries compare equal regardless of key insertion order (a Firestore
// snapshot's data and a locally spread `{...g, ...patch}` need not agree on
// order). undefined-valued keys are dropped, matching what scrubUndefined
// does to the stored shape.
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
};

// Diff two id-keyed entry lists into per-doc writes. Entries without an id
// are ignored defensively (nothing addressable to write). Order changes alone
// produce NO writes — stored order is not authoritative post-migration; the
// union's deterministic sort is (see gameUnionOrder below).
export const diffEntityArrays = (
  prev: Array<{ id?: string }> | null | undefined,
  next: Array<{ id?: string }> | null | undefined,
): EntityDiff => {
  const prevById = new Map<string, Record<string, unknown>>();
  for (const e of Array.isArray(prev) ? prev : []) {
    if (e && e.id) prevById.set(e.id, e as Record<string, unknown>);
  }
  const sets: EntityDiff["sets"] = [];
  const nextIds = new Set<string>();
  for (const e of Array.isArray(next) ? next : []) {
    if (!e || !e.id) continue;
    nextIds.add(e.id);
    const before = prevById.get(e.id);
    if (!before || stableStringify(before) !== stableStringify(e)) {
      sets.push(e as EntityDiff["sets"][number]);
    }
  }
  const deletes = [...prevById.keys()].filter((id) => !nextIds.has(id));
  return { sets, deletes };
};

// Deterministic union order for games. Stored array order used to define
// same-date doubleheader order (every display sort is a stable date-only
// comparator); subcollection docs are unordered, so the union pins intra-day
// order by start time, then id — the tournamentPitching gameOrderKey
// precedent. Legacy games without startUtc tie-break by id: deterministic
// across devices, which is what the seeded-lineup engine needs.
export const gameUnionOrder = (
  a: { date?: string; startUtc?: string | null; id?: string },
  b: { date?: string; startUtc?: string | null; id?: string },
): number => {
  const ad = String(a?.date || "");
  const bd = String(b?.date || "");
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = String(a?.startUtc || "");
  const bt = String(b?.startUtc || "");
  if (at !== bt) {
    // A game WITH a start time sorts before one without on the same date —
    // scheduled-time order beats unknown-time order.
    if (!at) return 1;
    if (!bt) return -1;
    return at < bt ? -1 : 1;
  }
  const ai = String(a?.id || "");
  const bi = String(b?.id || "");
  return ai < bi ? -1 : ai > bi ? 1 : 0;
};

// Assemble the games union from streamed subcollection docs + the legacy
// team-doc array: doc wins id conflicts (a coach edit is a subdoc-only write,
// so the legacy twin goes stale the moment one lands), doc id authoritative
// over stale in-data ids, result sorted by gameUnionOrder.
export const assembleGames = <T extends { id?: string }>(
  docs: Array<{ id: string; data: DocumentData }> | null | undefined,
  legacyEntries: T[] | null | undefined,
): T[] => {
  const subDocs = Array.isArray(docs) ? docs : [];
  const subIds = new Set(subDocs.map((d) => d.id));
  const unmigrated = (Array.isArray(legacyEntries) ? legacyEntries : []).filter(
    (e) => e && !(e.id && subIds.has(e.id)),
  );
  return [
    ...subDocs.map((d) => ({ ...(d.data as object), id: d.id }) as T),
    ...unmigrated,
  ].sort(gameUnionOrder);
};
