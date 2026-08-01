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
  the emulator tests in `firestore-tests/rules.test.ts`. _(The signup array
  lanes have since been REMOVED — portal clients write per-entry subcollection
  docs; see Phase 1 below. `appendsExactlyOne` still guards the
  `playerInfoSubmissions` / `availabilitySubmissions` lanes.)_
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

| Field                                        | Writer(s)                                        | Why left as a whole-array write                                                                                                               |
| -------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `players`                                    | `usePlayerCrud`, `acceptTryout`, `advanceSeason` | Edited only by signed-in staff; many ops are inherently multi-element (reorder, bulk import, season advance).                                 |
| `games`                                      | `useGameCrud`, lineup/finalize flows             | Same; games are also slimmed (`slimGame`) on write, which assumes a full array.                                                               |
| `evaluationEvents`                           | _(since moved)_                                  | **No longer a team array** — eval rounds live per-doc in the `evalRounds` subcollection (Phase 2 below).                                      |
| `coachRoles` (head-initiated `setCoachRole`) | `useTeamMembership`                              | Owner-only; the **self-join** path already uses the atomic dotted write.                                                                      |
| `tryoutSignups` / `interestSignups`          | _(since moved)_                                  | **No longer team arrays** — per-entry docs in the signup subcollections (Phase 1 below); legacy arrays union-read + backfilled until dropped. |

If/when these become contended (e.g. multiple assistants entering evals
simultaneously), prefer per-entry subcollection docs (below) over array
transactions.

## Phased move of high-growth data to subcollections

Full subcollection migration was deliberately not attempted in one shot: the
signup arrays are read across many coach-side surfaces (TryoutsTab, InterestTab,
tryout evaluations keyed by `tryoutSignupId`, accept-to-roster, CSV export), so
the plan lands one family at a time behind union reads. Phases 1 and 2 have
shipped; Phase 3 remains deferred.

### Phase 1 — public signups → subcollections (SHIPPED)

```
artifacts/{appId}/public/data/teams/{teamId}/tryoutSignups/{signupId}
artifacts/{appId}/public/data/teams/{teamId}/interestSignups/{leadId}
```

Shipped mirroring the evalRounds pattern (Phase 2 below), via the shared
helpers in `src/utils/tryoutSignupDocs.ts`:

- **Rules:** subcollection READ is member-only (signups are family PII —
  there is deliberately no public read). CREATE stays open to any signed-in
  caller (anonymous portal auth counts) under the same team-state gates as
  the old array lanes — `tryoutsOpen` for tryout signups, `tryoutShareId`
  for interest leads, checked via a `get()` on the parent team doc — plus a
  field allowlist and per-field size caps (`SIGNUP_LIMITS` with headroom)
  the array diff could never express. Public UPDATE/DELETE are denied;
  members create/update/delete freely (member create is unconstrained so
  backfill can copy legacy entries verbatim). Emulator-tested in
  `firestore-tests/rules.test.ts`.
- **Portal write:** `setDoc` of one per-entry doc (`upsertSignupDoc`), with
  the id minted by a Firestore auto-id (`newSignupId`) instead of `genId`.
- **Coach read:** `TeamProvider` subscribes to both subcollections and
  presents the UNION of subcollection docs + any legacy root-array entries
  (`assembleSignups`; the subcollection wins id conflicts, doc id
  authoritative).
- **Lazy backfill:** on load, legacy array entries whose ids are not yet
  subcollection docs are copied in (`backfillSignupDocs` — idempotent, and
  it never overwrites an already-edited subdoc with its stale legacy copy).
  Once every legacy id is covered (`allLegacyMigrated`, which refuses to
  fire on an empty legacy array so a failed/empty subscription can never
  trigger it), the client drops both arrays from the team doc in one
  `deleteField()` write (`dropLegacySignupArrays`).
- **Season advance clears BOTH homes.** Advancing a season ends the tryout
  cycle, so `advanceSeason` sweeps the whole `tryoutSignups` subcollection
  (`deleteAllSignupDocs`, the same best-effort client sweep `deleteTeamCmd`
  uses — a client cannot recursively delete a collection) and removes the
  legacy array with a single-key `deleteField` (`dropLegacySignupArray`). It
  deliberately does NOT write `tryoutSignups: []`: an empty array leaves the
  key present, recreating the field this phase removes and breaking the
  ratchet planned below. Interest leads are untouched in both homes — standing
  leads survive the rollover. Both writes are unconditional (never gated on
  the client's assembled list, which reads empty when the subscription hasn't
  landed) and both are issued AFTER the season patch, so a rejected team-doc
  write doesn't find the signups already destroyed.
- **Legacy public lanes REMOVED (the follow-up landed):** the two deprecated
  array-append rules were retained exactly one release for cached portal
  clients still running the `arrayUnion` code, and have now been deleted
  from `firestore.rules`. The portal has written subcollections-only since
  #582 (which also shipped the network-first service worker, so portal
  bundles no longer go stale). A straggler client's array append now fails
  LOUDLY with `permission-denied`; its submit catch shows the inline
  "Submission failed — please retry, or contact the team's head coach
  directly." error rather than silently landing data in a doomed array.
  Emulator-tested in `firestore-tests/rules.test.ts` ("public signup append
  constraints" — the former allow expectations are flipped to DENIED
  probes). **Rules ratchet (IN):** `tryoutSignups` / `interestSignups` stay
  ratcheted like `evaluationEvents` — a team-doc write may carry either key
  only while the doc still has it (`!(k in request.resource.data) || (k in
resource.data)` on the base update rule) and team CREATE may never seed
  them, so the per-team `deleteField` drop remains genuinely irreversible
  while member cleanup shapes keep working on teams whose arrays haven't
  been dropped yet ("signup-array legacy-field ratchet" tests).
  **Phase 1 exit status: COMPLETE on the rules side.** The coach client's
  union read + lazy backfill (`assembleSignups` / `backfillSignupDocs`)
  deliberately stays until every team's per-team array drop has drained —
  removing that client code is the last, separate step. Remaining
  follow-up: migrate `playerInfoSubmissions` / `availabilitySubmissions`
  the same way (their array lanes are still active, not deprecated).

### Phase 2 — evaluations → subcollection (SHIPPED)

```
artifacts/{appId}/public/data/teams/{teamId}/evalRounds/{roundId}
```

Shipped, with a different final shape than originally sketched here
(`evaluationEvents/{eventId}`): per-author round docs, authorization-scoped in
`firestore.rules` (an assistant reads/writes only their own rounds) and
assembled client-side by a role-scoped subscription in `TeamProvider`, with
the legacy `evaluationEvents` array dropped from the team doc and ratcheted by
the rules. See `docs/eval-authz-design.md` (status COMPLETE) and
`src/utils/evalRounds.ts`. This resolves the multi-evaluator concurrency note
above. Tryout grades (those carrying `tryoutSignupId`) did not move alongside
roster rounds — the v11 `migrateLegacyTryoutGrades` step folded them into
`tryoutSessions` instead.

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
