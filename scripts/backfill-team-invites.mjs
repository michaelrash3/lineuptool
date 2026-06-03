#!/usr/bin/env node
// One-time backfill of the sanitized join-code invite lookup docs.
//
// Context: join-code resolution moved off a broad "read the full team doc if it
// has a joinCode" rule (which leaked private data) onto a sanitized lookup doc
// at artifacts/{appId}/public/data/teamInvites/{CODE} holding only
// { teamId, teamName, updatedAt }. The coach client backfills this lazily when a
// member opens a team, but teams whose coaches haven't reopened the app since
// the rules tightened would have a join code that no longer resolves for new
// members. This script populates every missing invite doc in one admin pass so
// existing codes keep working immediately.
//
// It uses the Firebase Admin SDK, which bypasses security rules, so it must run
// with service-account credentials — never shipped to the client.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   APP_ID=baseball_lineup_v1 \
//   node scripts/backfill-team-invites.mjs [--dry-run]
//
//   - GOOGLE_APPLICATION_CREDENTIALS: path to a service-account JSON key with
//     Firestore read/write on the project. (Alternatively, run in an environment
//     with application-default credentials, e.g. `gcloud auth application-default
//     login`.)
//   - APP_ID: the artifacts/{appId} segment. Defaults to "baseball_lineup_v1"
//     (matches src/firebase.ts).
//   - --dry-run: report what would be written without writing.
//
// Idempotent: re-running only refreshes existing invite docs. Safe to run
// repeatedly. Requires the `firebase-admin` devDependency (npm ci installs it).

import { cert, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";

const DRY_RUN = process.argv.includes("--dry-run");
const APP_ID = process.env.APP_ID || "baseball_lineup_v1";

// Prefer an explicit service-account file when provided; otherwise fall back to
// application-default credentials.
function buildCredential() {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    try {
      const json = JSON.parse(readFileSync(path, "utf8"));
      return cert(json);
    } catch (err) {
      console.error(`Failed to read service account at ${path}:`, err.message);
      process.exit(1);
    }
  }
  return applicationDefault();
}

async function main() {
  initializeApp({ credential: buildCredential() });
  const db = getFirestore();

  const teamsRef = db.collection(
    `artifacts/${APP_ID}/public/data/teams`
  );
  const invitesRef = db.collection(
    `artifacts/${APP_ID}/public/data/teamInvites`
  );

  console.log(
    `[backfill] appId=${APP_ID} dryRun=${DRY_RUN} — scanning teams…`
  );

  const snap = await teamsRef.get();
  let scanned = 0;
  let written = 0;
  let skipped = 0;
  const seenCodes = new Map(); // CODE -> teamId, to flag collisions

  for (const teamDoc of snap.docs) {
    scanned += 1;
    const data = teamDoc.data() || {};
    const code = String(data.joinCode || "").trim().toUpperCase();
    if (!code) {
      skipped += 1;
      continue;
    }

    if (seenCodes.has(code) && seenCodes.get(code) !== teamDoc.id) {
      console.warn(
        `[backfill] WARNING: join code ${code} is shared by teams ` +
          `${seenCodes.get(code)} and ${teamDoc.id}; the invite doc will point ` +
          `at the last one written. Rotate one of these codes.`
      );
    }
    seenCodes.set(code, teamDoc.id);

    // Numeric epoch ms to match the client's invite writes (App.tsx /
    // useInviteFlows both write `updatedAt: Date.now()`), so the field type
    // stays consistent however the doc was last written.
    const payload = {
      teamId: teamDoc.id,
      teamName: data.name || "",
      updatedAt: Date.now(),
    };

    if (DRY_RUN) {
      console.log(
        `[backfill] would write teamInvites/${code} -> ${teamDoc.id} (${payload.teamName})`
      );
      written += 1;
      continue;
    }

    await invitesRef.doc(code).set(payload);
    written += 1;
    console.log(
      `[backfill] wrote teamInvites/${code} -> ${teamDoc.id} (${payload.teamName})`
    );
  }

  console.log(
    `[backfill] done. scanned=${scanned} written=${written} skipped(no code)=${skipped}` +
      (DRY_RUN ? " (dry run — nothing persisted)" : "")
  );
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
