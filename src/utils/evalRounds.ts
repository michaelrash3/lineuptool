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
  query,
  setDoc,
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

// ---- Write side (step 3 — dual-write / backfill) ---------------------------
// The subcollection is POPULATED here while the legacy `evaluationEvents` array
// stays authoritative. Every mirror is best-effort: the array write already
// succeeded, so a subcollection failure must never throw or surface to the
// coach. Failures are swallowed (the lazy backfill re-mirrors on next load).

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

// Mirror ONE round into the subcollection. The doc id IS the round id, and the
// round carries its own `evaluatorId` — the create/update rules require it to
// match the caller (self-stamped), so a coach only ever mirrors their own
// rounds. undefined fields are scrubbed (setDoc rejects them).
export const mirrorEvalRound = async (
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
    // Best-effort: the array write is authoritative.
  }
};

// Delete a round's subcollection doc alongside its removeById array write.
export const removeEvalRoundDoc = async (
  db: Firestore,
  appId: string,
  teamId: string,
  roundId: string | null | undefined,
): Promise<void> => {
  if (!roundId) return;
  try {
    await deleteDoc(evalRoundRef(db, appId, teamId, roundId));
  } catch {
    // Best-effort.
  }
};

// PRIMARY (error-propagating) subcollection writes for once reads AND writes
// have cut over to the subcollection (finding-3.1 phase 3). Unlike the
// best-effort mirror/remove above — which existed as a backup while the array
// was authoritative — these REJECT on failure so the caller can surface an
// error toast instead of silently losing the coach's grades.
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
