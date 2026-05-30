# Firestore Rules Rollout

This guide makes `firestore.rules` reproducible from the repo and safe to roll out.

> **No Cloud Storage.** The app runs on the Firebase Spark plan and does not use Cloud Storage. Player photos are persisted inline as 256×256 JPEG data URLs on the team document — see `cropImageTo256DataURL` in `src/components/shared.jsx`.

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

### 6) Ownership protection (added with the takeover-race fix)
Expected: non-owners cannot rewrite `ownerId` or remove other members. The current owner can. A team with no existing `ownerId` AND no other members can still be claimed by its sole member (legacy auto-claim).

- As an assistant on a team with a different head coach, attempt a direct Firestore write that sets `ownerId` to the assistant's UID. Confirm the write is denied (`isCurrentOwner` / `isLegitimateAutoClaim` both fail).
- As an assistant, attempt to write `members` with a different coach removed. Confirm denial unless the only removed UID is the caller's own (leave-team).
- As the owner, change `ownerId` to a different existing member's UID — confirm success (legitimate ownership transfer).
- As the owner, remove an assistant from `members[]` — confirm success.
- As an assistant, remove only themselves from `members[]` — confirm success (leave-team).
- On a freshly created team with no `ownerId` and only the caller in `members`, write `{ownerId: caller.uid}` — confirm success (legitimate auto-claim path; covers legacy unclaimed teams).
- On a team with `ownerId` already set, attempt a delete as a non-owner member — confirm denial. As the owner — confirm success.

## Rollback

If deployed rules break access:

1. In Firebase Console → Firestore Rules, open previous published version.
2. Re-publish previous known-good rules.
3. Create a follow-up commit in repo to match the rollback version.

## Operational tips

- Keep this file and `firestore.rules` updated in the same PR.
- Deploy rules in low-risk windows (not immediately before games).
- After deploy, smoke-test owner, assistant, and tryout portal immediately.
