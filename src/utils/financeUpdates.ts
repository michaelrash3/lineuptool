// Concurrency-safe finance mutations (docs/FINANCES-AUDIT.md finding 3.2).
// Every Finances edit used to re-write the WHOLE finances object from
// screen-captured state (`updateTeam({ finances: { ...finances, ...patch } })`)
// — two coaches recording money near-simultaneously silently dropped one
// side's entry. These ops narrow each mutation to the smallest Firestore
// write instead:
//   - append    → arrayUnion on one dotted path (fully concurrency-safe; two
//                 simultaneous appends both land)
//   - removeById→ arrayRemove of the exact entry (a concurrent edit of that
//                 entry makes the remove a no-op — the conservative outcome)
//   - mapEntries→ replaces ONE array, computed from the LATEST provider state
//                 (residual last-write-wins is confined to that array)
//   - set       → one dotted path per scalar field (null clears the field)
// Transactions were rejected deliberately: they fail offline, while
// updateDoc/arrayUnion queue in the SDK's offline buffer — matching this
// offline-first PWA (same pattern as the anonymous portal appends).
//
// This module is Firebase-free and pure. The provider injects the SDK
// sentinels (arrayUnion/arrayRemove/deleteField) via FinanceFieldOps so the
// payload shapes are unit-testable without an emulator.

import type {
  BudgetItem,
  ExpenseEntry,
  IncomeEntry,
  PaymentEntry,
  SponsorshipEntry,
  TeamFinances,
} from "../types";

// key → element type of that finances array, so ops are fully typed at the
// call site (a budgetItems map sees BudgetItem, not a generic bag).
export interface FinanceArrayTypes {
  payments: PaymentEntry;
  incomes: IncomeEntry;
  expenses: ExpenseEntry;
  sponsorships: SponsorshipEntry;
  budgetItems: BudgetItem;
}

export type FinanceArrayKey = keyof FinanceArrayTypes;

export type FinanceScalarKey =
  | "clubFee"
  | "depositAmount"
  | "depositDueDate"
  | "feeDueDate"
  | "nextClubFee"
  | "nextDepositAmount"
  | "nextDepositDueDate"
  | "feeExemptIds"
  | "salesTaxPct"
  | "feeBufferIncrement"
  | "plannedPlayerCount";

export type FinanceSetFields = Partial<
  Record<FinanceScalarKey, number | string | string[] | null>
>;

export type FinanceUpdate =
  | {
      [K in FinanceArrayKey]: {
        op: "append";
        key: K;
        entry: FinanceArrayTypes[K];
      };
    }[FinanceArrayKey]
  | { op: "removeById"; key: FinanceArrayKey; id: string }
  | {
      [K in FinanceArrayKey]: {
        op: "mapEntries";
        key: K;
        map: (items: FinanceArrayTypes[K][]) => FinanceArrayTypes[K][];
      };
    }[FinanceArrayKey]
  | { op: "set"; fields: FinanceSetFields };

type AnyEntry = { id: string } & Record<string, unknown>;

const entriesOf = (
  finances: TeamFinances | null | undefined,
  key: FinanceArrayKey,
): AnyEntry[] =>
  ((finances as Record<string, unknown> | null | undefined)?.[key] as
    | AnyEntry[]
    | undefined) || [];

// Apply an update to an in-memory finances object — drives the optimistic
// local state and mirrors exactly what the server-side payload does.
export const applyFinanceUpdate = (
  finances: TeamFinances,
  update: FinanceUpdate,
): TeamFinances => {
  if (update.op === "append") {
    return {
      ...finances,
      [update.key]: [...entriesOf(finances, update.key), update.entry],
    };
  }
  if (update.op === "removeById") {
    return {
      ...finances,
      [update.key]: entriesOf(finances, update.key).filter(
        (x) => x?.id !== update.id,
      ),
    };
  }
  if (update.op === "mapEntries") {
    const map = update.map as unknown as (items: AnyEntry[]) => AnyEntry[];
    return { ...finances, [update.key]: map(entriesOf(finances, update.key)) };
  }
  const next: Record<string, unknown> = { ...finances };
  for (const [k, v] of Object.entries(update.fields)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next as TeamFinances;
};

// The Firestore mutation sentinels, injected by the provider so this module
// stays SDK-free. `scrub` removes undefined values (Firestore rejects them).
export interface FinanceFieldOps {
  arrayUnion: (value: unknown) => unknown;
  arrayRemove: (value: unknown) => unknown;
  deleteField: () => unknown;
  scrub: (value: unknown) => unknown;
}

// Build the narrow updateDoc payload for an update, resolved against the
// LATEST committed finances (`prev`). Returns null when the write is a
// successful no-op (removing an id that's already gone, an empty `set`).
// Dotted paths put only the top-level `finances` key in the rules diff's
// affectedKeys — exactly what the head-coach gate expects.
export const buildFinancePayload = (
  prev: TeamFinances,
  update: FinanceUpdate,
  ops: FinanceFieldOps,
): Record<string, unknown> | null => {
  if (update.op === "append") {
    return {
      [`finances.${update.key}`]: ops.arrayUnion(ops.scrub(update.entry)),
    };
  }
  if (update.op === "removeById") {
    // arrayRemove needs the exact stored entry; resolve by id against the
    // latest snapshot state. If a concurrent edit changed the entry the
    // remove matches nothing and the next snapshot resurrects the row —
    // conservative for a genuine edit/delete race.
    const existing = entriesOf(prev, update.key).find(
      (x) => x?.id === update.id,
    );
    if (!existing) return null;
    return { [`finances.${update.key}`]: ops.arrayRemove(existing) };
  }
  if (update.op === "mapEntries") {
    const map = update.map as unknown as (items: AnyEntry[]) => AnyEntry[];
    return {
      [`finances.${update.key}`]: ops.scrub(map(entriesOf(prev, update.key))),
    };
  }
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(update.fields)) {
    payload[`finances.${k}`] = v === null ? ops.deleteField() : v;
  }
  return Object.keys(payload).length > 0 ? payload : null;
};

// Fix for a latent merge-vs-delete bug: persistTeam writes with
// setDoc(..., { merge: true }), which DEEP-MERGES nested maps — a finances
// write that drops a key by omission (rollFinancesForNewSeason destructures
// away nextClubFee / feeExemptIds / sponsorships / ...) never deleted it
// server-side, so waivers and pledges silently survived the season roll and
// resurrected on the next snapshot. This turns every vanished top-level
// finance key into an explicit delete sentinel. Returns `next` unchanged
// when nothing vanished.
export const withFinanceKeyDeletes = (
  prev: unknown,
  next: unknown,
  deleteField: () => unknown,
): unknown => {
  if (
    !prev ||
    typeof prev !== "object" ||
    !next ||
    typeof next !== "object" ||
    Array.isArray(prev) ||
    Array.isArray(next)
  ) {
    return next;
  }
  const nextObj = next as Record<string, unknown>;
  const gone = Object.keys(prev as Record<string, unknown>).filter(
    (k) => !(k in nextObj),
  );
  if (gone.length === 0) return next;
  return {
    ...nextObj,
    ...Object.fromEntries(gone.map((k) => [k, deleteField()])),
  };
};
