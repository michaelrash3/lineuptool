// Per-author evaluation rounds — the read side of the finding-3.1 fix
// (docs/eval-authz-design.md, Option A). Rounds move off the shared
// `evaluationEvents` array into per-author documents at
// `teams/{teamId}/evalRounds/{roundId}`. This module builds the role-scoped
// subscription query and assembles the streamed docs back into the
// `evaluationEvents`-shaped array the rest of the app already consumes, so the
// switch is invisible to every downstream reader.

import {
  collection,
  doc,
  deleteDoc,
  deleteField,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Query,
  type DocumentData,
} from "firebase/firestore";
import { evalRoundRecency } from "./evaluations";
import { scrubUndefined } from "./helpers";
import type { EvaluationEvent } from "../types";

// The role-scoped query for a team's evalRounds subcollection.
//
// A head coach reads every round. An assistant may only read their OWN rounds —
// and the security rules (firestore.rules) DENY an unfiltered list from a
// non-head, so the `where evaluatorId == uid` filter is REQUIRED for the query
// to succeed at all, not merely an optimization. This mirrors the read scope
// proven by the emulator tests in firestore-tests/rules.test.ts.
export const buildEvalRoundsQuery = (
  db: Firestore,
  appId: string,
  teamId: string,
  role: "head" | "assistant",
  uid: string,
): Query<DocumentData> => {
  const col = collection(
    db,
    "artifacts",
    appId,
    "public",
    "data",
    "teams",
    teamId,
    "evalRounds",
  );
  return role === "head"
    ? query(col)
    : query(col, where("evaluatorId", "==", uid));
};

// Assemble streamed subcollection docs into the `evaluationEvents` array the app
// already consumes: each doc's id + data, newest first (same ordering the
// screens apply to the array today). Pure. The doc id is authoritative as the
// round id, overriding any stale `id` in the data.
export const assembleEvalRounds = (
  docs: Array<{ id: string; data: DocumentData }> | null | undefined,
): EvaluationEvent[] => {
  const rounds = Array.isArray(docs) ? docs : [];
  return rounds
    .map((d) => ({ ...(d.data as object), id: d.id }) as EvaluationEvent)
    .sort(evalRoundRecency);
};

// ---- Write side -------------------------------------------------------------

const evalRoundRef = (
  db: Firestore,
  appId: string,
  teamId: string,
  roundId: string,
) =>
  doc(
    db,
    "artifacts",
    appId,
    "public",
    "data",
    "teams",
    teamId,
    "evalRounds",
    roundId,
  );

// Best-effort mirror of ONE round into the subcollection — used only by the
// backfill below. The doc id IS the round id, and the round carries its own
// `evaluatorId` — the create/update rules require it to match the caller
// (self-stamped), so a coach only ever mirrors their own rounds. undefined
// fields are scrubbed (setDoc rejects them). Failures are swallowed: the
// backfill re-mirrors on next load.
const mirrorEvalRound = async (
  db: Firestore,
  appId: string,
  teamId: string,
  round: EvaluationEvent | null | undefined,
): Promise<void> => {
  if (!round?.id) return;
  try {
    await setDoc(
      evalRoundRef(db, appId, teamId, round.id),
      scrubUndefined(round) as DocumentData,
    );
  } catch {
    // Best-effort: re-attempted by the next session's backfill.
  }
};

// The PRIMARY (error-propagating) subcollection writes. These REJECT on
// failure so the caller can surface an error toast instead of silently losing
// the coach's grades.
export const saveEvalRound = (
  db: Firestore,
  appId: string,
  teamId: string,
  round: EvaluationEvent,
): Promise<void> =>
  setDoc(
    evalRoundRef(db, appId, teamId, round.id),
    scrubUndefined(round) as DocumentData,
  );

export const deleteEvalRound = (
  db: Firestore,
  appId: string,
  teamId: string,
  roundId: string,
): Promise<void> => deleteDoc(evalRoundRef(db, appId, teamId, roundId));

// ---- Migration long tail (docs/eval-authz-design.md) ------------------------
// The cutover is complete, but a team not opened since it shipped may still
// carry the legacy `evaluationEvents` ARRAY on its doc. The helpers below are
// the self-limiting cleanup: backfill the caller's own legacy rounds into the
// subcollection, then (head only, coverage proven) delete the array field.
// Deleting it is the one IRREVERSIBLE step, so it's gated on PROOF of
// coverage: the head's subscription streams every evalRounds doc, and only
// when every legacy round id is present there does the drop fire. The rules
// permit removing/rewriting the field while a doc still has it, but reject any
// write that would recreate it once gone.

// Is every legacy array round present in the subcollection? Pure coverage
// check. Deliberately conservative:
//   - no legacy rounds → false ("nothing to drop" — the field is already gone
//     or empty, and firing a delete write for an empty array is pointless);
//   - an empty/failed subcollection read can therefore never trigger a drop;
//   - any legacy round missing from the subcollection → false.
export const allLegacyRoundsMigrated = (
  legacyRounds: EvaluationEvent[] | null | undefined,
  subcollectionIds: Iterable<string> | null | undefined,
): boolean => {
  const legacy = (Array.isArray(legacyRounds) ? legacyRounds : []).filter(
    (r) => r && r.id,
  );
  if (legacy.length === 0) return false;
  const ids = new Set(subcollectionIds || []);
  return legacy.every((r) => ids.has(r.id));
};

// Delete the legacy `evaluationEvents` field from the team doc. REJECTS on
// failure so the caller can retry next session (the guard ref is cleared).
export const dropEvalEventsArray = (
  db: Firestore,
  appId: string,
  teamId: string,
): Promise<void> =>
  updateDoc(
    doc(db, "artifacts", appId, "public", "data", "teams", teamId),
    // deleteField removes the key outright — after this, snapshots carry no
    // evaluationEvents array and the drop condition can never re-arise.
    { evaluationEvents: deleteField() },
  );

// Lazily backfill the caller's OWN rounds from the legacy array into the
// subcollection. Only rounds authored by `uid` are touched — the create rule
// only permits self-stamped writes, so an assistant backfills their own and the
// head theirs. Idempotent: setDoc overwrites, so re-running is a safe no-op-ish
// refresh. Returns how many rounds were mirrored (0 when there's nothing of the
// caller's to move).
export const backfillOwnEvalRounds = async (
  db: Firestore,
  appId: string,
  teamId: string,
  rounds: EvaluationEvent[] | null | undefined,
  uid: string,
): Promise<number> => {
  const own = (Array.isArray(rounds) ? rounds : []).filter(
    (r) => r && r.id && r.evaluatorId === uid,
  );
  await Promise.all(own.map((r) => mirrorEvalRound(db, appId, teamId, r)));
  return own.length;
};
