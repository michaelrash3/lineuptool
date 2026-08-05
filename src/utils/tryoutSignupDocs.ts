// Per-entry signup documents — Phase 1 of docs/firestore-data-migration.md.
// The public-write signup arrays (`tryoutSignups`, `interestSignups`) move off
// the 1 MiB root team doc into per-entry docs at
// `teams/{teamId}/{tryoutSignups|interestSignups}/{signupId}`, mirroring the
// shipped evalRounds migration (./evalRounds.ts). Coach reads assemble the
// UNION of subcollection docs and any not-yet-migrated legacy array entries;
// the deprecated array-append rules lanes (each kept one release for cached
// portal clients) are all REMOVED now, so the union + lazy backfill exist to
// drain teams whose legacy arrays haven't been dropped yet, not to absorb new
// array appends.
//
// Phase 1b extends the same machinery — unchanged — to the two remaining
// public portal lanes, `playerInfoSubmissions` and `availabilitySubmissions`.
// "Signup" in the names below therefore covers all four portal-written
// families; every helper is keyed by SignupCollectionKey and the behavior per
// key is identical.

import {
  arrayRemove,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { scrubUndefined } from "./helpers";
import type {
  AvailabilitySubmission,
  Game,
  InterestSignup,
  PlayerInfoSubmission,
  TryoutSignup,
} from "../types";

// The subcollections share every helper below — the key doubles as the
// subcollection name AND the legacy team-doc array field it replaces. Phase 3
// (docs/firestore-data-migration.md) widens this union with the coach-written
// `games` lane (and later `players`): same union-read + lazy-backfill +
// head-only-drop machinery, no public write lane, member-only rules.
export type SignupCollectionKey =
  | "tryoutSignups"
  | "interestSignups"
  | "playerInfoSubmissions"
  | "availabilitySubmissions"
  | "games";

// The four portal-written lanes (Phases 1 + 1b).
export const SIGNUP_COLLECTION_KEYS: readonly SignupCollectionKey[] = [
  "tryoutSignups",
  "interestSignups",
  "playerInfoSubmissions",
  "availabilitySubmissions",
] as const;

// Every migrating team-doc array lane, portal- and coach-written alike. Used
// for the SUBSCRIPTIONS (the union has to read both homes for every lane) and
// for the landed/server-confirmed gates.
export const ALL_LEGACY_ARRAY_KEYS: readonly SignupCollectionKey[] = [
  ...SIGNUP_COLLECTION_KEYS,
  "games",
] as const;

// The lanes whose legacy array a release is allowed to MIRROR and then DELETE.
// Currently ALL of them — nothing is being withheld.
//
// This constant is the soak lever, kept separate from ALL_LEGACY_ARRAY_KEYS
// even while the two agree, because those two operations are the only
// irreversible things in the migration and a future lane will want the same
// staging. Withholding a key makes its lane purely ADDITIVE: new and edited
// entries become subdocs, reads union both homes, nothing is mass-mirrored or
// deleted, so the release is revertible and a stale client's writes stay
// authoritative for any entry an upgraded client hasn't touched. `games` shipped
// that way for one release (Phase 3a) and has since been drained.
//
// Note the drop's coverage proof is ALL-OR-NOTHING across this set, which is
// why a soaking lane must be withheld HERE rather than merely skipped in the
// backfill — leaving it in the set while nothing mirrors it stalls every other
// lane's drop forever.
export const DRAINABLE_LEGACY_ARRAY_KEYS: readonly SignupCollectionKey[] =
  ALL_LEGACY_ARRAY_KEYS;

type SignupEntry =
  | TryoutSignup
  | InterestSignup
  | PlayerInfoSubmission
  | AvailabilitySubmission
  | Game;

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

// The parent team doc — the home of the two LEGACY signup arrays this
// migration is draining.
const teamDocRef = (
  db: Firestore,
  appId: string,
  teamId: string,
): DocumentReference<DocumentData> =>
  doc(db, "artifacts", appId, "public", "data", "teams", teamId);

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

// Firestore caps a write batch at 500 operations; stay under it with room to
// spare so a sweep of a big signup list still commits in whole batches.
const DELETE_BATCH_SIZE = 400;

// Delete EVERY doc in one signup subcollection, in batches. Two callers, both
// of which mean "this whole collection is over": team deletion (both lanes)
// and season advance (the tryout lane only — standing interest leads survive
// the rollover).
//
// Firestore has no cascading delete, and a recursive delete needs the Admin
// SDK — so this client-side sweep is the only thing standing between a
// deleted team and its families' PII (names, emails, phone numbers) sitting
// in the database forever. It is therefore BEST-EFFORT by construction:
//   - it must run while the team doc still EXISTS, because the subcollection
//     delete rule resolves membership by reading that parent doc; anything
//     left behind after the team doc is gone can never be deleted by a client
//     again (season advance satisfies this trivially — it never deletes the
//     team doc);
//   - a rejected or half-applied sweep leaves exactly those orphans.
// Queries the collection rather than trusting a caller-supplied id list: the
// coach's assembled view only holds docs its subscription actually delivered,
// so a denied/unlanded subscription — or a portal signup that arrived after
// the last snapshot — would otherwise be swept right past.
// REJECTS so the caller can tell the coach rather than claim a clean delete.
// Returns how many docs it deleted.
export const deleteAllSignupDocs = async (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
): Promise<number> => {
  const snap = await getDocs(signupCollectionRef(db, appId, teamId, key));
  const refs = snap.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += DELETE_BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + DELETE_BATCH_SIZE)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
};

// ---- Legacy team-doc array cleanup -----------------------------------------

// Pick the EXACT stored elements for `ids` out of a RAW legacy signup array
// (the untouched team-doc field, NOT the assembled union). Exactness is the
// entire point — see removeLegacySignupEntries. Returns [] when nothing
// matches, which callers read as "no legacy twin, nothing to clean up".
export const findLegacySignupEntries = <T extends { id?: string }>(
  rawEntries: T[] | null | undefined,
  ids: Iterable<string>,
): T[] => {
  const wanted = new Set(ids);
  return (Array.isArray(rawEntries) ? rawEntries : []).filter(
    (e) => e && e.id && wanted.has(e.id),
  );
};

// Remove entries from a legacy team-doc signup array by exact-value
// arrayRemove. This is the ONLY correct way to clear a legacy twin while the
// union read is live.
//
// Why not updateTeamArrays({op:'removeById'})? That op resolves the value to
// remove out of the provider's teamData — and for these two keys teamData is
// the assembled UNION, where the SUBCOLLECTION doc WINS the id. Every coach
// edit (status stamp, tryout numbers, measurements) is a subdoc-only write, so
// the moment one lands the union's copy stops byte-matching the element still
// stored in the array. arrayRemove matches by deep value, so it would then
// match NOTHING: the subdoc delete lands, the stale legacy twin survives, and
// the next assembly resurrects the family with their pre-edit data. Handing it
// the raw element straight off the team-doc snapshot is what makes the match
// reliable.
//
// One updateDoc for the whole set (arrayRemove is variadic), so a bulk delete
// is a single write. Value-level, never a whole-array rewrite — a portal
// signup that landed after this coach's snapshot is untouched, and nothing
// from the union can leak back INTO the array. Nothing to remove is a resolved
// no-op with no write at all; REJECTS on failure so callers can toast.
export const removeLegacySignupEntries = (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
  rawEntries: SignupEntry[] | null | undefined,
): Promise<void> => {
  const entries = (Array.isArray(rawEntries) ? rawEntries : []).filter(Boolean);
  if (entries.length === 0) return Promise.resolve();
  return updateDoc(teamDocRef(db, appId, teamId), {
    [key]: arrayRemove(...entries),
  });
};

// ---- Migration long tail (docs/firestore-data-migration.md, Phase 1) --------
// A team not opened since the cutover still carries the legacy arrays on its
// doc. The helpers below are the self-limiting cleanup: mirror legacy entries
// into the subcollections, then (head only, coverage proven — see
// TeamProvider) delete both array fields.

// What one backfill pass actually accomplished. `written` is the count
// backfillOwnEvalRounds returns; `failed` is the half that function gets from
// rejecting, folded into the same value so ONE resolved result carries both.
export type SignupBackfillResult = {
  /** Entries mirrored into the subcollection by this pass. */
  written: number;
  /** Entries this pass tried and the server refused. */
  failed: number;
  /**
   * The ids this pass actually mirrored. A retry unions these into its
   * existing-id guard, so the "never rewrite an already-mirrored id" promise
   * below holds on its own rather than depending on the local listener having
   * delivered a fresh snapshot first.
   */
  writtenIds: string[];
};

// Lazily mirror legacy array entries into the subcollection. Idempotent, and —
// deliberately unlike backfillOwnEvalRounds — it NEVER rewrites an id that
// already has a subcollection doc: a coach may have edited that doc since it
// was mirrored (status, tryout numbers, measurements), and re-running setDoc
// with the stale legacy copy would clobber the edit. Callers pass the CURRENT
// subcollection id set as that guard — and, on a retry, union in the ids
// earlier passes already wrote (see writtenIds): a retry fires 5s after a
// partial failure, and resting that promise on the listener having caught up
// by then is timing, not a guard.
//
// REPORTS per-entry failures instead of swallowing them: this used to resolve
// `void` whether it mirrored forty docs or attempted forty and had every one
// denied, which made a wholly failed migration indistinguishable from a
// finished one — and since the caller consumes a once-per-session guard, an
// undetectable failure was also an unretried one.
//
// Resolves with a summary rather than rejecting, which is the one place this
// diverges from backfillOwnEvalRounds. Rejecting answers only "did something
// go wrong", and Promise.all surfaces just the FIRST error, discarding how
// much landed — but the caller's decision is not binary. It has to bound its
// own retries, and "39 of 40 written, 1 denied" (a per-entry problem that a
// retry converges on) and "0 of 40 written" (a wall: rules, or the connection
// gone) deserve different treatment and different diagnostics. A summary also
// keeps this a total function, so the fire-and-forget call site can never
// become an unhandled rejection. Every entry is attempted regardless of its
// siblings' outcomes.
export const backfillSignupDocs = async (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
  legacyEntries: SignupEntry[] | null | undefined,
  existingSubIds: Set<string>,
): Promise<SignupBackfillResult> => {
  const pending = (Array.isArray(legacyEntries) ? legacyEntries : []).filter(
    (e) => e && e.id && !existingSubIds.has(e.id),
  );
  const outcomes: Array<{ id: string; ok: boolean }> = await Promise.all(
    // The whole per-entry attempt sits inside an async IIFE so a SYNCHRONOUS
    // throw counts as a failure like any other. Firestore validates eagerly:
    // signupDocRef throws on a malformed id (an id containing "/" is an
    // invalid path segment) and setDoc throws on invalid data — neither
    // rejects. Building the ref outside a catch would let that escape as an
    // unhandled rejection AND skip the tally, so the caller would consume no
    // attempt, schedule no retry and log no give-up: a silent single-attempt
    // stall, which is the exact failure this function was rewritten to end.
    pending.map(async (entry) => {
      try {
        await setDoc(
          signupDocRef(db, appId, teamId, key, entry.id),
          scrubUndefined(entry) as DocumentData,
        );
        return { id: entry.id as string, ok: true };
      } catch {
        return { id: entry.id as string, ok: false };
      }
    }),
  );
  const writtenIds = outcomes.filter((o) => o.ok).map((o) => o.id);
  return {
    written: writtenIds.length,
    failed: outcomes.length - writtenIds.length,
    writtenIds,
  };
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

// Delete EVERY legacy signup/submission array from the team doc in one write —
// the one irreversible step. REJECTS on failure so the caller can clear its
// once-guard and retry next session. deleteField on an already-missing key is
// a no-op, so one collection being long gone (or a team the two-key Phase 1
// drop already reached) never blocks dropping the others.
export const dropLegacySignupArrays = (
  db: Firestore,
  appId: string,
  teamId: string,
): Promise<void> =>
  updateDoc(
    teamDocRef(db, appId, teamId),
    Object.fromEntries(
      DRAINABLE_LEGACY_ARRAY_KEYS.map((key) => [key, deleteField()]),
    ),
  );

// Delete ONE legacy signup array from the team doc. Same deleteField as the
// two-key drop above and the same irreversibility, but scoped to the lane the
// caller is actually clearing — season advance wipes the tryout lane and must
// leave standing interest leads alone.
//
// This is how a "clear every signup" flow clears the legacy home WITHOUT
// recreating the field: writing `tryoutSignups: []` would leave the key
// PRESENT on the doc, which is exactly what the migration exists to remove
// and exactly what a rules ratchet of the evaluationEvents shape
// (`!(k in request.resource.data) || (k in resource.data)`) rejects.
// deleteField leaves the key absent from the written document, so it passes
// that ratchet and is a documented no-op on a team whose array is long gone.
//
// Not removeLegacySignupEntries: that clears a SUBSET by exact-value
// arrayRemove and needs the raw team-doc elements to match against. Clearing
// the whole lane needs no matching, and the caller (useTeamLifecycle) only
// holds the assembled union anyway, whose elements may no longer byte-match
// what is stored.
//
// Unconditional, like the two-key drop: a deprecated-array-lane portal append
// that commits between the caller's snapshot and this write is destroyed.
// That is not new — the `tryoutSignups: []` overwrite this replaced had the
// identical race — and the season patch closes `tryoutsOpen`, which is the
// rules gate that lane is allowed through.
//
// REJECTS on failure so the caller can tell the coach the reset was partial.
export const dropLegacySignupArray = (
  db: Firestore,
  appId: string,
  teamId: string,
  key: SignupCollectionKey,
): Promise<void> =>
  updateDoc(teamDocRef(db, appId, teamId), { [key]: deleteField() });
