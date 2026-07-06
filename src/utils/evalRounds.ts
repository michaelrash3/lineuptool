// Per-author evaluation rounds — the read side of the finding-3.1 fix
// (docs/eval-authz-design.md, Option A). Rounds move off the shared
// `evaluationEvents` array into per-author documents at
// `teams/{teamId}/evalRounds/{roundId}`. This module builds the role-scoped
// subscription query and assembles the streamed docs back into the
// `evaluationEvents`-shaped array the rest of the app already consumes, so the
// switch is invisible to every downstream reader.

import {
  collection,
  query,
  where,
  type Firestore,
  type Query,
  type DocumentData,
} from "firebase/firestore";
import { evalRoundRecency } from "./evaluations";
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
