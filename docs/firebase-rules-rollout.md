# Firestore Rules Rollout

This guide makes `firestore.rules` reproducible from the repo and safe to roll out.

> **No Cloud Storage.** The app runs on the Firebase Spark plan and does not use Cloud Storage. The team logo is the only image the app stores — persisted inline on the team document as a downscaled/compressed data URL (see `downscaleImageToDataURL` in `src/components/shared.tsx`). Player photos are not stored at all: `photoUrl` is stripped from every players write (see the sanitizer in `src/utils/teamArrayUpdates.ts` and the Images section of `docs/ARCHITECTURE.md`).

## What this covers

- Auto-deploying `firestore.rules` via GitHub Actions on every push to `main`
- One-time service-account setup that powers that workflow
- Manual fallback for when the CLI/Console is the only available option
- Testing the key auth paths for this app
- Rolling back safely if a rule blocks coaches in the field

## Auto-deploy via GitHub Actions (default path)

`.github/workflows/deploy-firestore-rules.yml` runs on every push to `main` whose diff touches `firestore.rules`, `firebase.json`, or the workflow itself. The job:

1. Boots the Firestore emulator with a fake project id and parses `firestore.rules` — fails fast if the rules don't compile.
2. Authenticates to Google Cloud using the `FIREBASE_SERVICE_ACCOUNT_JSON` repo secret.
3. Runs `firebase deploy --only firestore:rules --project lineupgenerator-79159`.

GitHub Actions is free for this kind of usage (the public-repo allowance covers it many times over) and `firestore:rules` deploys are free on the Firebase Spark plan, so the workflow has no marginal cost.

### One-time setup: service-account secret

You do this once. It takes about five minutes.

1. **Create a service account** for the deploy.
   - Open the GCP console for the project: `https://console.cloud.google.com/iam-admin/serviceaccounts?project=lineupgenerator-79159`.
   - Click **Create service account**. Name it `github-actions-rules-deploy` (or similar). Skip the optional access steps.
2. **Grant it two roles.**
   - On the IAM page (`https://console.cloud.google.com/iam-admin/iam?project=lineupgenerator-79159`), find the new service account row, click **Edit principal**, then:
     - **Add another role** → **Firebase Rules Admin** — lets it publish `firestore.rules`.
     - **Add another role** → **Service Usage Consumer** — lets it pass the API-enablement precheck that `firebase deploy` does on every run (without this, the deploy fails with `serviceusage.googleapis.com ... 403, Permission denied to get service [firestore.googleapis.com]`).
   - Save.
   - If you'd rather avoid juggling two roles, **Firebase Admin** alone is a single-role superset that also works (broader privileges; pick whichever you prefer).
3. **Create a JSON key.**
   - Back on the service-accounts list, open the new account → **Keys** tab → **Add key** → **Create new key** → JSON. Download the file.
4. **Add it to GitHub repo secrets.**
   - In GitHub: `https://github.com/michaelrash3/lineuptool/settings/secrets/actions` → **New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT_JSON`. Value: paste the **entire JSON file contents**. Save.
5. **(Recommended) delete the local copy of the JSON file** so it doesn't sit on your machine. You can always download a new key later from the same Keys tab.

After that the workflow runs automatically on the next push to `main` that changes `firestore.rules`.

### Triggering the workflow manually

Open `https://github.com/michaelrash3/lineuptool/actions/workflows/deploy-firestore-rules.yml` → **Run workflow** → pick `main` → **Run workflow**. Useful for one-off republishes after editing rules in the Firebase Console by mistake.

### Watching a deploy

`https://github.com/michaelrash3/lineuptool/actions` lists every run. Click the latest **Deploy Firestore Rules** entry to see the validate + deploy logs.

## Manual fallback (Firebase Console paste)

If the Action is failing and you need to publish rules right now:

1. Open `https://console.firebase.google.com/project/lineupgenerator-79159/firestore/rules`.
2. Paste the **full contents of `firestore.rules`** from the repo.
3. Click **Publish**.

After the manual edit, open a follow-up commit/PR with anything you changed in the Console so the repo stays the source of truth — the next auto-deploy will otherwise overwrite the Console state.

## Manual fallback (Firebase CLI)

If you have the CLI installed and authenticated:

```bash
firebase deploy --only firestore:rules --project lineupgenerator-79159
```

## Automated rule tests (`npm run test:rules`)

`firestore-tests/rules.test.ts` exercises the security rules against the
emulator with `@firebase/rules-unit-testing`. Run them with:

```bash
npm run test:rules
```

This wraps Vitest in `firebase emulators:exec --only firestore`, so it needs:

- **`firebase-tools`** on the PATH (e.g. `npm i -g firebase-tools`, or run the
  script via `npx firebase ...`). It is intentionally **not** a project
  dependency to keep `npm install` lean.
- A **Java runtime** (the Firestore emulator is a Java process).

The suite is excluded from the default `npm test` (a pure jsdom unit run) so the
unit suite stays emulator-free. Coverage includes: non-member vs member team
reads, the removed join-code full-doc read, assistant `ownerId`/member-removal
denials, owner delete, legacy sole-member auto-claim, sanitized invite read +
self-join (only the joining user, only `assistant`, only themselves into
`members`), the finances head-gate (owner/co-head allowed incl. dotted-path
appends; assistant denied incl. bundled writes), coachRoles escalation denials,
the REMOVED array-append lanes — all four of them, tryout/interest (Phase 1
exit) and player-info/availability (Phase 1b exit) — where a cached portal
client's `arrayUnion` append is denied even while tryouts are open / a share
link stands, public mirror read/write access, and the Phase 1 + 1b portal
subcollections (member-only read/list/update/delete; public create gated on
the parent team's tryout state with a payload allowlist + size caps).

## Local emulator test loop

Start emulators against `firestore.rules`:

```bash
firebase emulators:start --only firestore
```

Then verify each flow in the validation matrix below against the emulator before merging rule changes.

## Validation matrix

### 1) Head coach (owner/member)

Expected: full team read/write works.

- Open app as team owner.
- Update roster, schedule, evaluation, and settings fields.
- Confirm writes succeed.

### 2) Assistant coach (member)

Expected: read/write allowed on team doc, but only app-allowed actions should be visible in UI.

- Join via invite or team code.
- Confirm read access and assistant workflows succeed.
- Confirm assistant cannot reach head-only settings routes in UI.

### 3) Join by team code

Expected: signed-in caller resolves the code via the sanitized
`teamInvites/{code}` lookup (only `teamId`/`teamName`/`updatedAt`), then adds
self to `members` + own `coachRoles` entry only. A non-member can NOT read the
full team doc just because a code exists (that rule was removed).

- Use a valid 6-char code.
- Confirm the invite lookup exposes only sanitized fields.
- Confirm join succeeds (self only, role `assistant` only — the self-join path
  can no longer grant `head`; promotion to head is done by an existing head via
  Settings).
- Confirm a non-member cannot read the full team doc, add a different user
  (alone or alongside themselves), set a bogus role, or edit arbitrary fields.

### 4) Public Tryouts Portal

Expected: anonymous/signed-in parent can read the sanitized `teamPublic` mirror and submit a tryout signup only while tryouts are open — but can NOT read the full team doc. Portal submissions land as per-entry subcollection docs (Section 9); the legacy `tryoutSignups` / `interestSignups` array-append lanes are REMOVED, so ANY public write to the team doc's signup arrays is denied.

- Open `/tryouts-portal/:slug`.
- Confirm the page loads branding (name/colors/logo) from the `teamPublic` mirror.
- Submit valid signup — confirm a new `tryoutSignups/{signupId}` subcollection doc is created (no team-doc array growth).
- Confirm the per-date link pins the signup to ITS slug's date (not the first
  configured date) via the `tryoutDateBySlug` map in the mirror.
- Confirm a public team-doc write touching `tryoutSignups` or
  `interestSignups` is DENIED in every shape — including a perfectly-formed
  single `arrayUnion` append (the removed lane). A stale cached portal client
  hits this and shows its inline "Submission failed — please retry, or
  contact the team's head coach directly." error.
- As an anonymous user, attempt a direct read of `artifacts/{appId}/public/data/teams/{teamId}` — confirm it is DENIED (no more full-doc leak of evals/PII/joinCode).
- Confirm unrelated field edits are denied.

### 5) Tryouts closed

Expected: portal submission blocked once `tryoutsOpen` is false.

- Toggle tryouts closed in Settings.
- Retry signup submit.
- Confirm denial/error path is shown.

### 7) Public mirror isolation (added with the tryout-portal privacy fix)

Expected: the `teamPublic` mirror is readable by any signed-in (incl. anonymous) caller, but writable only by a member of the underlying team.

- As an anonymous portal user, read `artifacts/{appId}/public/data/teamPublic/{teamId}` — confirm success.
- As an anonymous (non-member) user, attempt to write that mirror doc — confirm denial (`isTeamMember` `get()` on the real team fails).
- As a team member, change a branding field in the app and confirm the mirror updates (the client effect upserts it).
- Confirm the mirror never contains `players`, `games`, `evaluationEvents`, `tryoutSignups`, `interestSignups`, `members`, `ownerId`, `coachRoles`, or `joinCode`.

### 6) Ownership protection (added with the takeover-race fix)

Expected: non-owners cannot rewrite `ownerId` or remove other members. The current owner can. A team with no existing `ownerId` AND no other members can still be claimed by its sole member (legacy auto-claim).

- As an assistant on a team with a different head coach, attempt a direct Firestore write that sets `ownerId` to the assistant's UID. Confirm the write is denied (`isCurrentOwner` / `isLegitimateAutoClaim` both fail).
- As an assistant, attempt to write `members` with a different coach removed. Confirm denial unless the only removed UID is the caller's own (leave-team).
- As the owner, change `ownerId` to a different existing member's UID — confirm success (legitimate ownership transfer).
- As the owner, remove an assistant from `members[]` — confirm success.
- As an assistant, remove only themselves from `members[]` — confirm success (leave-team).
- On a freshly created team with no `ownerId` and only the caller in `members`, write `{ownerId: caller.uid}` — confirm success (legitimate auto-claim path; covers legacy unclaimed teams).
- On a team with `ownerId` already set, attempt a delete as a non-owner member — confirm denial. As the owner — confirm success.

### 8) Finances head-gate (added with the finances-audit fix, finding 3.1)

Expected: writes touching the `finances` key succeed only for a head coach —
the owner, or a member whose `coachRoles` entry is `head` (promoted via
Settings). Assistants are denied server-side, matching the head-only UI.
`coachRoles` itself is equally head-gated (otherwise a member could
self-promote and pass the finances gate), and the join-code self-join can only
set `assistant`.

- As the owner, record a payment / edit the ledger in Finances — confirm success.
- As a promoted co-head (non-owner with `coachRoles: head`), do the same — confirm success.
- As an assistant, attempt a direct Firestore write to `finances` (whole-object
  or dotted-path `finances.payments` append) — confirm denial. A write bundling
  `finances` with allowed fields is denied whole.
- As an assistant, attempt `coachRoles.{self} = 'head'` (plain write, and the
  members+coachRoles join-clause shape) — confirm denial.
- As the owner or a co-head, toggle a member's role in Settings — confirm success.
- **Accepted residual:** assistants can still **read** `finances` (Firestore
  cannot field-gate reads on a single document; full read privacy would require
  splitting finances into its own doc). The gate protects integrity, not
  confidentiality.
- **Accepted edge:** on a legacy unclaimed team (no `ownerId`), the sole member
  is head in the UI but passes `isHeadCoach` only after the auto-claim write
  lands (it fires on team load); a finances write racing it recovers via the
  optimistic revert + Retry toast.

### 9) Signup subcollections (Phase 1 of docs/firestore-data-migration.md)

Expected: portal submissions land as per-entry docs under
`teams/{teamId}/tryoutSignups` and `teams/{teamId}/interestSignups`. Reads
are member-only (signups are family PII). The legacy array-append lanes have
been REMOVED (they were retained exactly one release for cached portal
clients — Phase 1 exit). The coach client's union read + lazy backfill stays
until every team's per-team array drop has drained; it absorbs any array
entries that landed before the lanes closed.

- As an anonymous portal user, submit a tryout signup while tryouts are open —
  confirm a new `tryoutSignups/{signupId}` doc is created.
- Toggle tryouts closed — confirm the subcollection create is DENIED (same
  gate as the legacy array lane, via `get()` on the parent team doc).
- Submit an interest lead via the standing share link — confirm the
  `interestSignups/{leadId}` create succeeds; with `tryoutShareId` cleared,
  confirm denial.
- As an anonymous user, attempt a create carrying a field outside the portal
  allowlist (e.g. `status` on an interest lead) or an oversized `notes` —
  confirm denial.
- As an anonymous user, attempt to read or list either subcollection, or to
  update/delete an existing signup doc — confirm denial (a visitor can add a
  signup but never see or touch anyone else's).
- As a team member, read/list both subcollections and update/delete an entry —
  confirm success. A member create is NOT payload-constrained (the lazy
  backfill copies legacy array entries verbatim) — confirm an off-allowlist
  member write succeeds.
- Confirm the removed array-append lane rejects an `arrayUnion` append
  (Section 4) — and that legacy array entries appended BEFORE the removal
  still appear in the coach UI via the union read and are backfilled into the
  subcollection.
- As an anonymous user, attempt a create at a short legacy-style id
  (`ts-abc123`) — confirm denial. Public creates are pinned to Firestore
  auto-id length (20) so a portal writer can never plant a doc that shadows a
  real family's not-yet-migrated legacy entry; a member create at that id must
  still succeed (that is how the backfill preserves legacy ids).
- As an anonymous user, attempt a tryout create declaring
  `status: "accepted"` — confirm denial (curation drives roster projection and
  the advance-season deposit filters, so it is not self-declarable).

**Accepted residuals (Phase 1).**

- **No collection-size ceiling.** The removed array lanes capped growth at
  `MAX_SIGNUPS()` = 2000 because the whole array was in `request.resource`;
  rules cannot cheaply count a collection, so the subcollection create lanes
  have no equivalent. The bound is now per-document (the payload allowlist +
  per-field caps, with `comfortablePositions` constrained to the two declared
  positions so its elements can't smuggle bulk). The interest gate is
  effectively always open, so a determined anonymous writer can create many
  small docs; App Check is the real answer if that ever becomes a problem.
- **(Resolved) the array lanes no longer bypass the allowlist.** For the one
  compatibility release, an anonymous caller could still append an array
  entry of arbitrary shape through the deprecated lanes, which the backfill
  copies verbatim into a subcollection doc. Those lanes are now removed and
  the arrays are ratcheted (never recreatable after a team's drop), so the
  subcollection allowlist + caps are the only public write surface.

## Sequencing the tryout-portal privacy fix

The portal now reads a sanitized `teamPublic` mirror instead of the full team
doc, and the rules drop the old broad public read. Because the rules
auto-deploy on merge to `main`, **the mirror-writing client must reach
production before (or with) the rules tightening**, or existing share links
will 404 until each team's mirror exists.

The coach client writes/backfills a team's mirror automatically the moment any
member loads that team (the `buildPublicMirror` effect in `App.tsx`). To roll
out safely:

1. Ship the client (mirror write + portal read switch) and let coaches open the
   app so mirrors backfill. The old rules still allow the portal to work in the
   meantime.
2. Once mirrors are populated, allow the `firestore.rules` change to deploy
   (the removal of the broad public read + the new `teamPublic` block).
3. Smoke-test an existing share link end-to-end after the rules land.

If you must land both at once, expect a short window where a share link for a
team whose mirror hasn't been written yet shows "Link not found" until a coach
opens the app.

## Rollback

If deployed rules break access:

1. In Firebase Console → Firestore Rules, open previous published version.
2. Re-publish previous known-good rules.
3. Create a follow-up commit in repo to match the rollback version.

## Operational tips

- Keep this file and `firestore.rules` updated in the same PR.
- Deploy rules in low-risk windows (not immediately before games).
- After deploy, smoke-test owner, assistant, and tryout portal immediately.
