// Team-doc saves go out as setDoc(..., { merge: true }), and a merge write
// DEEP-MERGES nested maps: a key the caller dropped by omission is kept on the
// server, so the change reverts on the next snapshot. Finances already handles
// this (withFinanceKeyDeletes); these are the other team-doc maps whose writers
// always send the WHOLE map, so a missing key there really means "remove it":
//
//   depthChart             { [pos]: playerId[] }        — Depth Chart "Reset"
//   seasonAwards           { [awardId]: playerId }      — award "Back to auto"
//   evalCategoryOverrides  { [id]: { label?, hidden? } } — unhide / clear rename
//
// A field must only be listed here if EVERY writer sends the full map — a
// writer that sends a partial patch would have its other keys deleted.
export const WHOLE_MAP_FIELDS: Record<string, number> = {
  depthChart: 1,
  seasonAwards: 1,
  evalCategoryOverrides: 2,
  // Every team-save writer sends the whole roles map (setCoachRole spreads
  // it, removeMember drops one uid; a self-join is its own field-path write
  // and a backup restore strips access keys). Removing a coach must really
  // delete their role, or a stale "head" would outlive their membership.
  coachRoles: 1,
  // Tryout grades are written leaf-by-leaf with field paths (never through
  // the team save); the only team-save writers are the season roll ({} —
  // clear them) and a backup restore (the whole map).
  tryoutGradeEntries: 1,
  // The Letters editor always writes the whole map; "Use the standard
  // letter" drops a kind's entry, which must really delete it.
  letterTemplates: 1,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

// Turn every key present in `prev` but missing from `next` into a delete
// sentinel, descending `depth` levels into nested maps. Returns `next`
// unchanged (same reference) when nothing vanished. Pure.
export const withMapKeyDeletes = (
  prev: unknown,
  next: unknown,
  deleteField: () => unknown,
  depth = 1,
): unknown => {
  if (depth < 1 || !isPlainObject(prev) || !isPlainObject(next)) return next;
  let out: Record<string, unknown> | null = null;
  for (const k of Object.keys(prev)) {
    if (!(k in next)) {
      out = out || { ...next };
      out[k] = deleteField();
    } else if (depth > 1) {
      const inner = withMapKeyDeletes(prev[k], next[k], deleteField, depth - 1);
      if (inner !== next[k]) {
        out = out || { ...next };
        out[k] = inner;
      }
    }
  }
  return out || next;
};
