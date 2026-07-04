// Concurrency-safe team-array mutations — the finance granular-write pattern
// (docs/FINANCES-AUDIT.md finding 3.2) generalized to the top-level team-doc
// arrays. Roster/schedule/eval/practice edits used to re-write a WHOLE array
// from screen-captured state (`updateTeam({ players: next })`) — two coaches
// editing near-simultaneously silently dropped one side's change (e.g. two
// assistants submitting eval scores during a live session). These ops narrow
// each mutation to the smallest Firestore write instead:
//   - append    → arrayUnion on one path (fully concurrency-safe; two
//                 simultaneous appends both land). Takes a LIST of entries so
//                 bulk imports are one safe write.
//   - removeById→ arrayRemove of the exact entry (a concurrent edit of that
//                 entry makes the remove a no-op — the conservative outcome)
//   - mapEntries→ replaces ONE array, computed from the LATEST provider state
//                 (residual last-write-wins is confined to that array)
// Transactions were rejected deliberately: they fail offline, while
// updateDoc/arrayUnion queue in the SDK's offline buffer — matching this
// offline-first PWA (same reasoning as src/utils/financeUpdates.ts, whose
// array ops delegate to the generic core below).
//
// This module is Firebase-free and pure. The provider injects the SDK
// sentinels (arrayUnion/arrayRemove) via ArrayFieldOps so the payload shapes
// are unit-testable without an emulator.

import type { EvaluationEvent, Game, Player, Practice } from "../types";
import { scrubUndefined, slimGame } from "./helpers";

/* ============================================================================
   Generic core — shared by the team facade below and financeUpdates.ts
   ============================================================================ */

// The Firestore mutation sentinels, injected by the provider so this module
// stays SDK-free. `scrub` removes undefined values (Firestore rejects them).
// arrayUnion is variadic to match the SDK — bulk appends land in one sentinel.
export interface ArrayFieldOps {
  arrayUnion: (...values: unknown[]) => unknown;
  arrayRemove: (value: unknown) => unknown;
  scrub: (value: unknown) => unknown;
}

type AnyEntry = { id: string } & Record<string, unknown>;

export type ArrayOp =
  | { op: "append"; key: string; entries: AnyEntry[] }
  | { op: "removeById"; key: string; id: string }
  | { op: "mapEntries"; key: string; map: (items: AnyEntry[]) => AnyEntry[] };

// Normalizes an entry before it is stored (and before it lands in optimistic
// state) — see SANITIZERS below for why apply and payload must agree.
export type EntrySanitizer = (entry: AnyEntry) => AnyEntry;

const entriesOf = (bag: unknown, key: string): AnyEntry[] =>
  ((bag as Record<string, unknown> | null | undefined)?.[key] as
    | AnyEntry[]
    | undefined) || [];

// Apply an op to an in-memory bag — drives the optimistic local state and
// mirrors exactly what the server-side payload does.
export const applyArrayOp = <T extends object>(
  bag: T,
  op: ArrayOp,
  sanitize?: EntrySanitizer,
): T => {
  const clean = (e: AnyEntry) => (sanitize ? sanitize(e) : e);
  if (op.op === "append") {
    return {
      ...bag,
      [op.key]: [...entriesOf(bag, op.key), ...op.entries.map(clean)],
    } as T;
  }
  if (op.op === "removeById") {
    return {
      ...bag,
      [op.key]: entriesOf(bag, op.key).filter((x) => x?.id !== op.id),
    } as T;
  }
  return { ...bag, [op.key]: op.map(entriesOf(bag, op.key)).map(clean) } as T;
};

// Build the narrow updateDoc payload for an op, resolved against the LATEST
// committed state (`prev`). Returns null when the write is a successful no-op
// (removing an id that's already gone). `prefix` is the dotted-path prefix —
// "" for top-level team arrays, "finances." for the finance facade.
export const buildArrayOpPayload = (
  prev: unknown,
  op: ArrayOp,
  prefix: string,
  ops: ArrayFieldOps,
  sanitize?: EntrySanitizer,
): Record<string, unknown> | null => {
  const path = prefix + op.key;
  if (op.op === "append") {
    const clean = (e: AnyEntry) =>
      ops.scrub(sanitize ? sanitize(e) : e) as AnyEntry;
    return { [path]: ops.arrayUnion(...op.entries.map(clean)) };
  }
  if (op.op === "removeById") {
    // arrayRemove needs the exact stored entry; resolve by id against the
    // latest snapshot state and do NOT re-sanitize — a legacy stored entry
    // (e.g. a player still carrying photoUrl) must round-trip byte-for-byte
    // or the remove silently matches nothing. If a concurrent edit changed
    // the entry the remove matches nothing and the next snapshot resurrects
    // the row — conservative for a genuine edit/delete race.
    const existing = entriesOf(prev, op.key).find((x) => x?.id === op.id);
    if (!existing) return null;
    return { [path]: ops.arrayRemove(existing) };
  }
  const mapped = op.map(entriesOf(prev, op.key));
  return { [path]: ops.scrub(sanitize ? mapped.map(sanitize) : mapped) };
};

/* ============================================================================
   Team facade — typed ops for the top-level team-doc arrays
   ============================================================================ */

// key → element type of that team array, so ops are fully typed at the call
// site (a players map sees Player, not a generic bag).
export interface TeamArrayTypes {
  players: Player;
  games: Game;
  evaluationEvents: EvaluationEvent;
  practices: Practice;
}

export type TeamArrayKey = keyof TeamArrayTypes;

export type TeamArrayUpdate =
  | {
      [K in TeamArrayKey]: {
        op: "append";
        key: K;
        entries: TeamArrayTypes[K][];
      };
    }[TeamArrayKey]
  | { op: "removeById"; key: TeamArrayKey; id: string }
  | {
      [K in TeamArrayKey]: {
        op: "mapEntries";
        key: K;
        // Must be pure — the provider re-runs it against the LATEST committed
        // state, which may differ from what the screen rendered.
        map: (items: TeamArrayTypes[K][]) => TeamArrayTypes[K][];
      };
    }[TeamArrayKey];

// persistTeam enforces two gates on every whole-array write that the granular
// path must preserve: players never store photoUrl (removed feature; leftover
// base64 pushed the doc toward the 1 MiB cap) and games are slimmed (embedded
// lineup players reduced to {id, name, number}). Sanitizing at APPLY time too
// keeps optimistic state byte-identical to stored state, which is what makes
// a later removeById's exact-entry resolution reliable. scrubUndefined is
// folded in for the same reason (Firestore drops undefined keys on write).
const stripPlayerPhoto: EntrySanitizer = (p) => {
  if (!p || !("photoUrl" in p)) return p;
  const { photoUrl: _dropped, ...rest } = p;
  return rest as AnyEntry;
};

const SANITIZERS: Partial<Record<TeamArrayKey, EntrySanitizer>> = {
  players: stripPlayerPhoto,
  games: (g) => (slimGame(g as Partial<Game>) as AnyEntry) || g,
};

const sanitizerFor = (key: TeamArrayKey): EntrySanitizer => {
  const sanitize = SANITIZERS[key];
  return (entry) =>
    scrubUndefined(sanitize ? sanitize(entry) : entry) as AnyEntry;
};

// Evaluate a mapEntries op's map exactly ONCE against `prev`, returning an op
// whose map is a constant. The provider consumes every op twice (optimistic
// apply + payload build); a caller's map that isn't fully deterministic —
// minting ids, stamping Date.now() — would otherwise leave the optimistic
// state disagreeing with what was stored until the next snapshot.
export const resolveTeamArrayUpdate = (
  prev: unknown,
  update: TeamArrayUpdate,
): TeamArrayUpdate => {
  if (update.op !== "mapEntries") return update;
  const mapped = (update.map as (items: AnyEntry[]) => AnyEntry[])(
    entriesOf(prev, update.key),
  );
  return {
    op: "mapEntries",
    key: update.key,
    map: () => mapped,
  } as unknown as TeamArrayUpdate;
};

// Apply an update to an in-memory team bag (the provider's teamData). Kept
// permissive on the bag type — teamData carries more fields at runtime than
// the strict Team interface models.
export const applyTeamArrayUpdate = <T extends object>(
  team: T,
  update: TeamArrayUpdate,
): T =>
  applyArrayOp(team, update as unknown as ArrayOp, sanitizerFor(update.key));

export const buildTeamArrayPayload = (
  prevTeam: unknown,
  update: TeamArrayUpdate,
  ops: ArrayFieldOps,
): Record<string, unknown> | null =>
  buildArrayOpPayload(
    prevTeam,
    update as unknown as ArrayOp,
    "",
    ops,
    sanitizerFor(update.key),
  );
