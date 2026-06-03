# Firestore data model — migration plan & known trade-offs

This document tracks the in-progress move of high-growth and public-write data
off the single root team document, plus the whole-array writes that remain by
design. It accompanies the security + reliability work in the
"Coach's Card hardening" change set.

## Background

The entire team lives in one Firestore document:

```
artifacts/{appId}/public/data/teams/{teamId}
```

It holds branding, roster (`players`), schedule (`games`), evaluations
(`evaluationEvents`), staff (`members`, `coachRoles`, `coaches`), and the
public-write signup arrays (`tryoutSignups`, `interestSignups`). Firestore caps
a single document at **1 MiB**. As a season accrues games, evals, and signups,
a busy team creeps toward that ceiling, at which point a write silently fails.
`estimateDocSizeBytes` + the one-shot "team data is getting large" toast
(`persistTeam` in `src/App.tsx`) warn at 90% as a stopgap.

Two sanitized sibling docs already exist and are **not** affected by this plan:

- `artifacts/{appId}/public/data/teamPublic/{teamId}` — the public mirror the
  anonymous Tryouts Portal reads (`buildPublicMirror`).
- `artifacts/{appId}/public/data/teamInvites/{joinCode}` — the sanitized
  join-code lookup (`{ teamId, teamName, updatedAt }`) that replaced the old
  "read the whole team doc if it has a join code" rule.

## What shipped now

- **Public signup write rules hardened.** `appendsExactlyOne()` in
  `firestore.rules` requires each anonymous write to grow the array by exactly
  one entry **and** preserve every prior entry (`toSet().hasAll(prev)`), so a
  public user can no longer remove, replace, or multi-add signups. Validated by
  the emulator tests in `firestore-tests/rules.test.ts`.
- **Join-code privacy.** Join resolution goes through the sanitized
  `teamInvites` doc; the full-team join-code read rule was removed.
- **Atomic membership writes.** The join flow (`useInviteFlows.joinTeamByCode`)
  and leave flow (`leaveTeamCmd`) use `arrayUnion` / `arrayRemove` + a dotted
  `coachRoles.<uid>` path instead of read-modify-write of the whole array, so a
  concurrent join/leave can't be lost. Public portal signups already used
  `arrayUnion`.

## Whole-array writes intentionally left in place (for now)

These still write a full replacement array built from local state. They are
**single-coach, low-concurrency** edit paths (one head coach editing their own
roster/schedule/evals in the app), so the lost-update risk is low and the
churn/risk of converting them is high. Documented here so the trade-off is
explicit rather than accidental:

| Field | Writer(s) | Why left as a whole-array write |
| --- | --- | --- |
| `players` | `usePlayerCrud`, `acceptTryout`, `advanceSeason` | Edited only by signed-in staff; many ops are inherently multi-element (reorder, bulk import, season advance). |
| `games` | `useGameCrud`, lineup/finalize flows | Same; games are also slimmed (`slimGame`) on write, which assumes a full array. |
| `evaluationEvents` | `useEvaluationCrud`, `saveTryoutEvaluation` | Upsert-by-key semantics over the whole list; concurrency is one evaluator at a time per round. |
| `coachRoles` (head-initiated `setCoachRole`) | `useTeamMembership` | Owner-only; the **self-join** path already uses the atomic dotted write. |
| `tryoutSignups` / `interestSignups` (coach-side edits) | `useTryoutFlows` (delete, bulk-delete, convert, accept) | Coach-side mutations; the **public append** path is `arrayUnion` and is the high-frequency, untrusted one. |

If/when these become contended (e.g. multiple assistants entering evals
simultaneously), prefer per-entry subcollection docs (below) over array
transactions.

## Deferred: move high-growth data to subcollections

Full subcollection migration was **deliberately not** attempted in this pass: the
signup arrays are read across many coach-side surfaces (TryoutsTab, InterestTab,
tryout evaluations keyed by `tryoutSignupId`, accept-to-roster, CSV export), and
moving them in one shot is a large, risky rewrite. The safest practical subset
(rule hardening + atomic appends) shipped instead.

Suggested phased plan, highest value first:

### Phase 1 — public signups → subcollections (highest growth + public-write)

```
artifacts/{appId}/public/data/teams/{teamId}/tryoutSignups/{signupId}
artifacts/{appId}/public/data/teams/{teamId}/interestSignups/{leadId}
```

- **Rules:** validate `create` of a single doc (field allowlist + length caps)
  instead of array diffs; deny public `update`/`delete`. This is simpler and
  stricter than the array-diff rules and removes the per-doc size pressure
  entirely.
- **Portal write:** `setDoc(doc(collection, signupId), payload)` instead of
  `arrayUnion`.
- **Coach read:** `onSnapshot(collection(...))` merged with any legacy
  root-array entries for back-compat (see below).
- **Back-compat:** keep reading legacy `team.tryoutSignups` /
  `team.interestSignups` and present the union; a one-time per-team migration
  can copy legacy array entries into the subcollection and then clear the array.

### Phase 2 — evaluations → subcollection

```
artifacts/{appId}/public/data/teams/{teamId}/evaluationEvents/{eventId}
```

Keyed by the existing upsert id; resolves the multi-evaluator concurrency note
above. Tryout grades (those carrying `tryoutSignupId`) move alongside roster
rounds.

### Phase 3 — games, then players → subcollections

Largest blast radius (lineup engine, stats aggregation, season advance, CSV
import/export all read the full arrays). Migrate last, behind a read-compat
shim that prefers the subcollection and falls back to the root array.

### Cross-cutting constraints

- **Back-compat is mandatory** at every phase: existing teams have data in the
  root arrays. Readers must union legacy-array + subcollection until a
  migration backfills and the arrays are cleared.
- **Offline cache:** the app relies on `persistentLocalCache`; subcollection
  reads must stay within the same offline-friendly snapshot patterns.
- **Public mirror stays sanitized:** none of these subcollections are mirrored
  into `teamPublic`; the portal only ever needs branding + tryout config + the
  slug→date map.
