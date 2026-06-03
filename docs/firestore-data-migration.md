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

## Whole-array writes — current state

The high-growth arrays (`tryoutSignups`, `interestSignups`, `evaluationEvents`,
`games`) have been migrated to per-entry subcollection writes (Phases 1–3
below); coach-side edits route per-doc, so concurrent edits to different
entries no longer clobber each other.

Two whole-array writes remain by design:

| Field | Writer(s) | Why left as a whole-array write |
| --- | --- | --- |
| `players` | `usePlayerCrud`, `acceptTryout`, `advanceSeason`, pitch-count commits, stats import, `usePastSeasonCrud` | **Bounded** (~roster size) so no doc-size pressure, and edited only by signed-in staff at low concurrency. Migrating it is all risk, no benefit — see Phase 4 below. |
| `coachRoles` (head-initiated `setCoachRole`) | `useTeamMembership` | Owner-only; the **self-join** path already uses the atomic dotted write. |

## Migrating high-growth data to subcollections

### Phase 1 — public signups → subcollections ✅ SHIPPED

```
artifacts/{appId}/public/data/teams/{teamId}/tryoutSignups/{signupId}
artifacts/{appId}/public/data/teams/{teamId}/interestSignups/{leadId}
```

Done in this change set:

- **Rules:** the subcollection blocks in `firestore.rules` validate a single
  `create` (key allowlist + per-field length caps, mirroring `SIGNUP_LIMITS`),
  gate tryout creates on `tryoutsOpen` and interest creates on a `tryoutShareId`,
  and restrict read/update/delete to team members. One doc per write removes the
  array-replace/multi-add surface entirely. The legacy root-array
  `appendsExactlyOne` rules are **kept** for rollout back-compat (a cached old
  client still arrayUnion-ing onto the root doc keeps working).
- **Portal write:** `TryoutsPortal` `setDoc`s a single signup doc into the
  subcollection instead of `arrayUnion` onto the root team doc.
- **Coach read:** `App.tsx` subscribes to both subcollections, tags each entry
  with `_sub` (its collection name), and merges them with the legacy root arrays
  into `effectiveTeam.tryoutSignups` / `interestSignups` (the value the rest of
  the app consumes).
- **Coach mutations:** `useTryoutFlows` routes every mutation by `_sub` — a
  subcollection entry is edited/deleted as its own doc; a legacy root-array entry
  is rewritten from the non-`_sub` slice only (so subcollection items are never
  folded back into the root doc). `advanceSeason` clears the legacy array and
  deletes the subcollection signup docs.
- **Back-compat:** legacy root-array signups still render and remain editable;
  no data move is forced.
- **Tests:** `firestore-tests/rules.test.ts` (emulator) covers public
  create-while-open, closed-denied, disallowed-field/oversized-field denials, and
  member-only read/update/delete. `useTryoutFlows.test.tsx` and
  `TryoutsPortal.test.tsx` cover the client routing.

**Legacy-array drain — SHIPPED.** A one-time, member-only effect in `App.tsx`
(`drainedSignupsRef`) copies any pre-migration root-array tryout/interest
signups into their subcollections and clears the root arrays, so existing teams
fully retire their root signup arrays on next load.

### Phase 2 — evaluations → subcollection ✅ SHIPPED

```
artifacts/{appId}/public/data/teams/{teamId}/evaluationEvents/{eventId}
```

Done in this change set:

- **Rules:** member-only `evaluationEvents/{id}` (coach data, not public-write).
- **`useEvaluationCrud`** routes by `_sub`: new rounds create a subcollection
  doc; edits/deletes hit the doc or rebuild the legacy root slice.
- **`useTryoutFlows.saveTryoutEvaluation`** writes tryout grades to the
  subcollection (they're `evaluationEvents` carrying `tryoutSignupId`).
- **`usePlayerCrud.removePlayer`** strips a deleted player's grades from both
  the legacy array and each affected subcollection round (per-doc), with Undo
  restoring both.
- **`advanceSeason`** clears evaluations (root array + subcollection docs).
- The load-time eval schema migration stays root-only — it upgrades legacy
  root-array rounds; new subcollection rounds are born at the current schema.
- New rounds are created in the subcollection; legacy root-array rounds keep
  working via the merge (no forced bulk drain of eval data).

### Phase 3 — games → subcollection ✅ SHIPPED

```
artifacts/{appId}/public/data/teams/{teamId}/games/{gameId}
```

Done in this change set:

- **Rules:** member-only `games/{id}`.
- **`useGameCrud`** routes by `_sub`: new games create a slimmed subcollection
  doc; `updateGame`/`finalize`/`postpone`/`delete` patch or delete the game's
  own doc, or rebuild the legacy root slice. Pitch-count commits write players
  separately. All lineup-save paths flow through `updateGame`, so they route
  automatically.
- **`usePlayerCrud.removePlayer`** strips a deleted player out of affected
  subcollection game docs (per-doc), with Undo restoring them.
- **`useImportExportFlows`:** schedule import writes game docs to the
  subcollection; stats reconciliation reads the merged game list; backup export
  captures the full team (subcollections included) with `_sub` tags stripped.
- **`advanceSeason`** clears games (root array + subcollection docs).
- Games are still slimmed (`slimGame`) on every write — per-doc now, matching
  the prior whole-array slimming.

### Phase 4 — players → subcollection (DEFERRED, by design)

The `players/{id}` rule and the App-side subscription are in place, but players
are intentionally **not** merged/migrated (`players` is absent from
`MERGED_SUBCOLLECTIONS`), so the roster still lives on the root team document.

Rationale — this is the one array where the migration is **all risk, no
benefit**:

- **No size benefit.** Unlike signups/games/evals, the roster is *bounded*
  (~15–25 players/team) and doesn't grow over a season. It contributes a small,
  fixed slice of the team doc, so moving it does nothing for the 1 MiB cap (the
  whole point of this migration).
- **Widest, most dangerous write surface.** ~12 distinct whole-array player
  writes would each need source-routing, several in game-day/season-critical
  paths: `usePlayerCrud` (add/update/updateNested/remove), `acceptTryout`,
  `advanceSeason` (full roster rebuild: archive stats, drop released, promote
  tryouts), `useGameCrud` pitch-count commits (finalize + postpone),
  `useImportExportFlows` stats import, and `usePastSeasonCrud` (3 writers).
- **No end-to-end safety net** in CI (unit + emulator rules only), so a subtle
  reconciliation bug in `advanceSeason` (e.g. a surviving player not re-written,
  or a dropped player's doc left behind) would corrupt a roster with no test to
  catch it.

If players are ever migrated, do it as its own dedicated, staging-tested effort:
introduce a single `reconcilePlayers(next, prevSub)` helper (upsert sub docs,
delete removed sub docs, write the legacy slice to the root array) and route
*every* writer above through it; new players (`addPlayer`, `acceptTryout`,
promotions) `setDoc` straight to the subcollection. Roster order is display-
sorted (RosterTab) and batting order is separate (`battingLineup`), so no
explicit `order` field is required.

### Cross-cutting constraints

- **Back-compat is mandatory** at every phase: existing teams have data in the
  root arrays. Readers must union legacy-array + subcollection until a
  migration backfills and the arrays are cleared.
- **Offline cache:** the app relies on `persistentLocalCache`; subcollection
  reads must stay within the same offline-friendly snapshot patterns.
- **Public mirror stays sanitized:** none of these subcollections are mirrored
  into `teamPublic`; the portal only ever needs branding + tryout config + the
  slug→date map.
