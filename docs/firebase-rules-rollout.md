# Firestore Rules Rollout

This guide makes `firestore.rules` reproducible from the repo and safe to roll out.

> **No Cloud Storage.** The app runs on the Firebase Spark plan and does not use Cloud Storage. Player photos are persisted inline as 256×256 JPEG data URLs on the team document — see `cropImageTo256DataURL` in `src/components/shared.jsx`.

## What this covers

- Deploying `firestore.rules` from source control
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
firebase deploy --only firestore:rules
```

If you don't have the Firebase CLI installed, paste the contents of `firestore.rules` into the Firebase Console → Firestore Database → Rules tab and click *Publish*. The repo file remains the source of truth — any console edit should be mirrored back into the repo in a follow-up commit.

## Local rule test loop (recommended before deploy)

Start emulators:

```bash
firebase emulators:start --only firestore
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

## Rollback

If deployed rules break access:

1. In Firebase Console → Firestore Rules, open previous published version.
2. Re-publish previous known-good rules.
3. Create a follow-up commit in repo to match the rollback version.

## Operational tips

- Keep this file and `firestore.rules` updated in the same PR.
- Deploy rules in low-risk windows (not immediately before games).
- After deploy, smoke-test owner, assistant, and tryout portal immediately.
