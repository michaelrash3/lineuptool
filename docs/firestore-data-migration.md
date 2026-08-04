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
  the emulator tests in `firestore-tests/rules.test.ts`. _(All four array
  lanes — and `appendsExactlyOne` itself — have since been REMOVED from the
  rules: every portal writes per-entry subcollection docs now; see Phases 1
  and 1b below.)_
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

| Field                                               | Writer(s)                                        | Why left as a whole-array write                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `players`                                           | `usePlayerCrud`, `acceptTryout`, `advanceSeason` | Edited only by signed-in staff; many ops are inherently multi-element (reorder, bulk import, season advance).                                  |
| `games`                                             | _(since moved)_                                  | **No longer a team array** — per-entry docs in the games subcollection (Phase 3a below); writers diff-translated at the provider choke points. |
| `evaluationEvents`                                  | _(since moved)_                                  | **No longer a team array** — eval rounds live per-doc in the `evalRounds` subcollection (Phase 2 below).                                       |
| `coachRoles` (head-initiated `setCoachRole`)        | `useTeamMembership`                              | Owner-only; the **self-join** path already uses the atomic dotted write.                                                                       |
| `tryoutSignups` / `interestSignups`                 | _(since moved)_                                  | **No longer team arrays** — per-entry docs in the signup subcollections (Phase 1 below); legacy arrays union-read + backfilled until dropped.  |
| `playerInfoSubmissions` / `availabilitySubmissions` | _(since moved)_                                  | **No longer team arrays** — per-entry docs in the submission subcollections (Phase 1b below); same union-read + backfill + drop machinery.     |

If/when these become contended (e.g. multiple assistants entering evals
simultaneously), prefer per-entry subcollection docs (below) over array
transactions.

## Phased move of high-growth data to subcollections

Full subcollection migration was deliberately not attempted in one shot: the
signup arrays are read across many coach-side surfaces (TryoutsTab, InterestTab,
tryout evaluations keyed by `tryoutSignupId`, accept-to-roster, CSV export), so
the plan lands one family at a time behind union reads. Phases 1, 1b, 2 and
3a have shipped; Phase 3b (players) is the one remaining family.

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
  removing that client code is the last, separate step. The remaining
  follow-up — migrating `playerInfoSubmissions` / `availabilitySubmissions`
  the same way — has since shipped as Phase 1b below.

### Phase 1b — player-info + availability submissions → subcollections (SHIPPED)

```
artifacts/{appId}/public/data/teams/{teamId}/playerInfoSubmissions/{subId}
artifacts/{appId}/public/data/teams/{teamId}/availabilitySubmissions/{subId}
```

The last two public-write array lanes, moved with the SAME machinery as
Phase 1 — `SignupCollectionKey` in `src/utils/tryoutSignupDocs.ts` now spans
all four lanes and every helper (union assembly, lazy backfill, coverage
check, the drop) iterates `SIGNUP_COLLECTION_KEYS`:

- **Rules:** member-only READ (family PII); public CREATE gated on the
  standing share link (`tryoutShareId`, the same gate the array lanes use)
  plus a per-collection field allowlist and size caps, the 20-char auto-id
  floor (legacy-id shadowing guard), and — deliberately — NO public
  `appliedToPlayerId`/`appliedAt`: the handled stamp is coach-only, so a
  hostile submission can't hide itself from the inbox. Public UPDATE/DELETE
  denied; members create/update/delete freely (backfill copies legacy
  entries verbatim, including `emergencyName`/`emergencyPhone`-era shapes).
  `availabilitySubmissions.dates`/`blocks` are bounded in length only (400,
  portal caps at 366) — rules can't inspect list elements, and an oversized
  element now bloats its own per-entry doc (Firestore's 1 MiB per-doc cap),
  never the shared team doc.
- **Portal writes:** both portals `setDoc` one per-entry doc with a
  Firestore auto-id (`newSignupId` / `upsertSignupDoc`) — no more
  `arrayUnion` against the team doc.
- **Coach reads:** `TeamProvider` subscribes to all four lanes in the one
  signup-subscription effect and publishes the union; the backfill and the
  irreversible drop gate on all four lanes landing + server-confirming, and
  `dropLegacySignupArrays` deletes all four legacy fields in one write
  (deleteField on an already-missing key is a no-op, so teams the Phase 1
  two-key drop already reached are fine).
- **Coach writes:** deletes clear BOTH homes (subdoc + exact-entry legacy
  arrayRemove); the apply flows stamp `appliedToPlayerId`/`appliedAt` via a
  full-entry subdoc upsert (doubling as lazy per-entry migration), with the
  roster-side merge still riding `updateTeamArrays`. The player-info
  replace-on-resubmit reconcile now deletes superseded duplicates per-doc
  instead of rewriting the array.
- **Ratchet (now total):** the base update rule ratchets both new keys and
  team CREATE can't seed them. The DEPRECATED public append-exactly-one
  lanes were kept exactly one release for cached portal clients (the Phase 1
  courtesy) and have since been REMOVED — while they were open, a
  single-entry append could recreate a dropped field (self-healing: the
  union surfaced it, the backfill mirrored it, the head's client
  re-dropped); with them gone the per-team `deleteField` drop is genuinely
  irreversible for every one of the four fields, and `appendsExactlyOne` +
  its helper functions left `firestore.rules` with them (no remaining
  callers).
- **Lifecycle:** `deleteTeamCmd` sweeps all four subcollections before the
  team doc goes; backup restore strips the two new keys like the other
  retired arrays (`backupSanitizer`). Season advance touches NEITHER new
  lane — sizing and standing availability survive the rollover, exactly as
  the arrays did.

**Phase 1b exit status: COMPLETE.** The two deprecated append lanes are
deleted from `firestore.rules`, their emulator tests are flipped to DENIED
probes (mirroring the Phase 1 flip), and the network-first service worker
(in place since the Phase 1 releases) keeps portal bundles fresh, so no
supported client appends to the arrays. A straggler's array append now
fails LOUDLY with `permission-denied` and the portal's submit catch shows
its retry-or-contact-the-coach error. As with Phase 1, the coach client's
union read + lazy backfill deliberately stays until every team's per-team
array drop has drained; removing that client code is the last, separate
step for both phases together.

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

### Phase 3a — games → subcollection (SHIPPED)

```
artifacts/{appId}/public/data/teams/{teamId}/games/{gameId}
```

The first COACH-written array off the team doc. Readers are untouched — the
provider publishes the assembled union under `teamData.games`, so the lineup
engine, stats aggregation, schedule surfaces and exports keep consuming the
same key. Writers are converted at the two choke points instead of per
caller:

- **Translation layer** (`updateTeamArrays` + `persistTeam` in
  `TeamProvider`): a games op still computes "the next array" against the
  union — through the same `applyTeamArrayUpdate`, so the `slimGame` +
  `scrubUndefined` gates keep applying — and `diffEntityArrays`
  (`src/utils/teamEntityDocs.ts`, id-keyed + value-based via a
  key-order-insensitive stableStringify) turns it into full-entry `set()`s
  for added/changed entries and `delete()`s for removed ones. Full-entry
  set, never a merge: several writers clear game fields by omission. All ops
  in a call ride ONE `writeBatch` together with the team-doc payload, so
  multi-shape cascades (remove player → strip from games; delete game →
  unlink tournaments) keep their atomicity. A deleted game's legacy twin
  leaves the team-doc array via exact-entry `arrayRemove` in the same batch.
- **Ordering:** subcollection docs are unordered; the union sorts by
  `(date, startUtc, id)` (`gameUnionOrder`) — deterministic across devices
  (a seeded-lineup engine input) and preserving same-date doubleheader
  order by scheduled time. Stored array order is no longer authoritative.
- **Rules:** member-only read/create/update/delete (no public lane ever
  existed); member create deliberately unconstrained so the lazy backfill
  copies legacy entries verbatim at their short genId ids. The `games` key
  joins the update-rule ratchet AND the create-rule deny — total from day
  one, since there is no public lane to except — and `NEW_TEAM_DOC` stopped
  seeding `games: []` in the same change (`DEFAULT_TEAM_DATA` keeps it for
  local placeholder reads).
- **Read machinery:** the games lane rides the same subscription + lazy
  backfill + head-only, settle-windowed, server-confirmed drop as the
  portal lanes (`ALL_LEGACY_ARRAY_KEYS`); the drop now deletes all five
  legacy fields in one write.
- **Lifecycle:** `advanceSeason` no longer writes `games: []` — it clears
  both homes after the season patch (query-based `deleteAllSignupDocs`
  sweep + `dropLegacySignupArray` deleteField), mirroring the tryout lane;
  head-to-head history survives as the `opponentArchive` aggregates.
  `deleteTeamCmd` sweeps the games subcollection before the team doc goes.
  Backup restore routes the file's games through the persistTeam diff (its
  deletes are bounded by what the union has seen — the same best-effort
  boundary as every client-side sweep). The doc-size warning estimates
  games via the RAW doc-resident array, never the union, so per-doc games
  can't fire false 1 MiB warnings.

### Phase 3b — players → subcollection

The last array, sharing Phase 3a's entire mechanism (the translation layer
is key-generic). Its extra work items, mapped by the Phase 3 write-path
inventory: a deterministic union order for players (display always sorts;
the engine needs any stable order), moving the roster-wipe guard's server
confirmation onto the players lane snapshot, converting the photo-strip
effect and CSV roster import off whole-array `updateTeam` writes (both
already flow through persistTeam's routing), RosterRecoveryCard/rebuild, and
`NEW_TEAM_DOC` + rules ratchet for `players`. Deliberately sequenced AFTER
games soaks, per the original plan.

### Cross-cutting constraints

- **Back-compat is mandatory** at every phase: existing teams have data in the
  root arrays. Readers must union legacy-array + subcollection until a
  migration backfills and the arrays are cleared.
- **Offline cache:** the app relies on `persistentLocalCache`; subcollection
  reads must stay within the same offline-friendly snapshot patterns.
- **Public mirror stays sanitized:** none of these subcollections are mirrored
  into `teamPublic`; the portal only ever needs branding + tryout config + the
  slug→date map.
