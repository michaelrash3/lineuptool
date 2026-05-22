# Firebase Rules Rollout (Firestore + Storage)

This guide makes both `firestore.rules` and `storage.rules` reproducible from the repo and safe to roll out.

## What this covers

- Deploying `firestore.rules` and `storage.rules` from source control
- Testing the key auth paths for this app
- Rolling back safely if a rule blocks coaches in the field

## Required tooling

Install Firebase CLI (one-time):

```bash
npm install -g firebase-tools
```

Login:

```bash
firebase login
```

Select project:

```bash
firebase use <your-firebase-project-id>
```

## Deploy rules from repo

From repo root:

```bash
# Firestore (team docs, user settings, tryouts portal)
firebase deploy --only firestore:rules

# Cloud Storage (player photos at teams/{teamId}/players/*.jpg)
firebase deploy --only storage:rules

# Or both at once
firebase deploy --only firestore:rules,storage:rules
```

`storage.rules` lives at the repo root next to `firestore.rules`. The Storage rules allow unauthenticated reads of player photos (the download URLs are unguessable) and restrict writes to signed-in users with images under 5 MB. See the file for the full policy and the upgrade path to a strict-membership variant.

## Local rule test loop (recommended before deploy)

Start emulators:

```bash
# Both rule sets, against the local emulator suite
firebase emulators:start --only firestore,storage
```

Then verify these flows manually in-app against emulator config.

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
Expected: signed-in caller can discover team by `joinCode` and add self to `members` + `coachRoles` only.

- Use a valid 6-char code.
- Confirm join succeeds.
- Confirm arbitrary field edits by non-member do not succeed.

### 4) Public Tryouts Portal
Expected: anonymous/signed-in parent can submit `tryoutSignups` only while tryouts are open.

- Open `/tryouts-portal/:slug`.
- Submit valid signup.
- Confirm `tryoutSignups` append succeeds.
- Confirm unrelated field edits are denied.

### 5) Tryouts closed
Expected: portal submission blocked once `tryoutsOpen` is false.

- Toggle tryouts closed in Settings.
- Retry signup submit.
- Confirm denial/error path is shown.

### 6) Storage: player photo upload
Expected: signed-in user can upload an image under 5 MB to a team they belong to; signed-out users and oversized/non-image uploads are denied.

- Open AddPlayerModal or PlayerProfileModal, attach a JPG/PNG.
- Confirm upload succeeds and the resulting URL is recorded on the player.
- Sign out in the emulator UI and retry — expect denial.
- Try a >5 MB file or a non-image — expect denial.

## Rollback

If deployed rules break access:

1. In Firebase Console → Firestore Rules, open previous published version.
2. Re-publish previous known-good rules.
3. Create a follow-up commit in repo to match the rollback version.

## Operational tips

- Keep this file and `firestore.rules` updated in the same PR.
- Deploy rules in low-risk windows (not immediately before games).
- After deploy, smoke-test owner, assistant, and tryout portal immediately.
