// Per-entry signup documents — Phase 1 of docs/firestore-data-migration.md.
// The public-write signup arrays (`tryoutSignups`, `interestSignups`) move off
// the 1 MiB root team doc into per-entry docs at
// `teams/{teamId}/{tryoutSignups|interestSignups}/{signupId}`, mirroring the
// shipped evalRounds migration (./evalRounds.ts). Coach reads assemble the
// UNION of subcollection docs and any not-yet-migrated legacy array entries,
// so cached portal clients still appending to the arrays keep working for one
// release while the lazy backfill absorbs their stragglers.

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { scrubUndefined } from "./helpers";
import type { InterestSignup, TryoutSignup } from "../types";

// The two signup subcollections share every helper below — the key doubles as
// the subcollection name AND the legacy team-doc array field it replaces.
export type SignupCollectionKey = "tryoutSignups" | "interestSignups";

type SignupEntry = TryoutSignup | InterestSignup;

export const signupCollectionRef = (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
): CollectionReference<DocumentData> =>
  collection(db, "artifacts", appId, "public", "data", "teams", teamId, key);

export const signupDocRef = (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
  id: string,
): DocumentReference<DocumentData> =>
  doc(db, "artifacts", appId, "public", "data", "teams", teamId, key, id);

// A fresh Firestore auto-id for a NEW signup — the doc id IS the entry id.
// Replaces genId on this path: the portal writes from anonymous devices the
// coach never sees, so ids must be collision-SAFE (Firestore auto-id), not
// merely collision-unlikely (genId's timestamp+random stamp).
export const newSignupId = (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
): string => doc(signupCollectionRef(db, appId, teamId, key)).id;

// Descending recency comparator: submittedAt is an ISO-8601 stamp, so plain
// string comparison IS chronological; entries without a stamp sink to the
// end. The id tie-break keeps same-instant entries in a stable order across
// re-assembly, so lists don't shuffle between snapshots.
const signupRecency = (
  a: { submittedAt?: string; id?: string } | null | undefined,
  b: { submittedAt?: string; id?: string } | null | undefined,
): number => {
  const at = String(a?.submittedAt || "");
  const bt = String(b?.submittedAt || "");
  if (at !== bt) return at < bt ? 1 : -1;
  const ai = String(a?.id || "");
  const bi = String(b?.id || "");
  return ai < bi ? -1 : ai > bi ? 1 : 0;
};

// Assemble streamed subcollection docs + the legacy team-doc array into the
// single array the coach screens already consume. Pure. Subcollection docs win
// id conflicts: the backfill mirrors legacy entries into docs, and a doc may
// since have been EDITED by a coach — its stale legacy twin must not resurface.
// The doc id is likewise authoritative over any stale `id` in the doc data.
export const assembleSignups = <
  T extends { id?: string; submittedAt?: string },
>(
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
  ].sort(signupRecency);
};

// ---- Write side -------------------------------------------------------------

// The PRIMARY (error-propagating) subcollection writes. These REJECT on
// failure so the caller can surface an error toast (portal submit, coach
// edits) instead of silently losing a parent's signup. setDoc of the FULL
// entry; undefined fields are scrubbed (setDoc rejects them).
export const upsertSignupDoc = (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
  entry: SignupEntry,
): Promise<void> =>
  setDoc(
    signupDocRef(db, appId, teamId, key, entry.id),
    scrubUndefined(entry) as DocumentData,
  );

export const deleteSignupDoc = (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
  id: string,
): Promise<void> => deleteDoc(signupDocRef(db, appId, teamId, key, id));

// ---- Migration long tail (docs/firestore-data-migration.md, Phase 1) --------
// A team not opened since the cutover still carries the legacy arrays on its
// doc. The helpers below are the self-limiting cleanup: mirror legacy entries
// into the subcollections, then (head only, coverage proven — see
// TeamProvider) delete both array fields.

// Lazily mirror legacy array entries into the subcollection. Idempotent, and —
// deliberately unlike backfillOwnEvalRounds — it NEVER rewrites an id that
// already has a subcollection doc: a coach may have edited that doc since it
// was mirrored (status, tryout numbers, measurements), and re-running setDoc
// with the stale legacy copy would clobber the edit. Callers pass the CURRENT
// subcollection id set as that guard. Per-entry failures are swallowed: the
// next session's backfill re-attempts.
export const backfillSignupDocs = async (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
  legacyEntries: SignupEntry[] | null | undefined,
  existingSubIds: Set<string>,
): Promise<void> => {
  const pending = (Array.isArray(legacyEntries) ? legacyEntries : []).filter(
    (e) => e && e.id && !existingSubIds.has(e.id),
  );
  await Promise.all(
    pending.map(async (entry) => {
      try {
        await setDoc(
          signupDocRef(db, appId, teamId, key, entry.id),
          scrubUndefined(entry) as DocumentData,
        );
      } catch {
        // Best-effort: re-attempted by the next session's backfill.
      }
    }),
  );
};

// Is every legacy array entry present in the subcollection? Pure coverage
// check for the irreversible array drop. Same deliberately conservative
// semantics as allLegacyRoundsMigrated (evalRounds):
//   - no legacy entries → false ("nothing to drop" — the field is already
//     gone or empty), so a failed/empty subscription read can never trigger
//     a drop;
//   - any legacy entry missing from the subcollection → false.
export const allLegacyMigrated = (
  legacyEntries: SignupEntry[] | null | undefined,
  subIds: Iterable<string> | null | undefined,
): boolean => {
  const legacy = (Array.isArray(legacyEntries) ? legacyEntries : []).filter(
    (e) => e && e.id,
  );
  if (legacy.length === 0) return false;
  const ids = new Set(subIds || []);
  return legacy.every((e) => ids.has(e.id));
};

// Delete BOTH legacy signup arrays from the team doc in one write — the one
// irreversible step. REJECTS on failure so the caller can clear its
// once-guard and retry next session. deleteField on an already-missing key is
// a no-op, so one collection being long gone never blocks dropping the other.
export const dropLegacySignupArrays = (
  db: Firestore,
  appId: string,
  teamId: string,
): Promise<void> =>
  updateDoc(doc(db, "artifacts", appId, "public", "data", "teams", teamId), {
    tryoutSignups: deleteField(),
    interestSignups: deleteField(),
  });
