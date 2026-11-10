#!/usr/bin/env node
/**
 * Backfill the owned parent-form link docs — portalLinks/{tryoutShareId} →
 * { teamId } — for EVERY team. The forms find a team ONLY through this doc
 * (phase 2 in docs/firebase-rules-rollout.md removed the fallback query), so
 * a team without one has dead form links. Run by the "Backfill parent-form
 * links" workflow; safe to re-run any time.
 *
 * The coach app creates a team's link doc on its own the next time a member
 * opens it; this script covers the teams whose coaches haven't, so phase 2
 * doesn't have to wait on every coach.
 *
 * Safety:
 *  - DRY RUN BY DEFAULT. It reports what it would create and exits. Writing
 *    needs --write.
 *  - Create-only. An existing link doc is never changed. One that points at a
 *    DIFFERENT team (a duplicate share id, or a hijack attempt) is reported
 *    for a human to look at.
 *  - Two teams sharing one share id are both skipped and reported — there is
 *    no safe automatic owner.
 *
 * Usage:
 *   npm install --no-save firebase-admin      # not a repo dependency
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   node scripts/backfill-portal-links.mjs            # dry run
 *   node scripts/backfill-portal-links.mjs --write    # create missing docs
 *   (--app-id <id> if the deployment doesn't use baseball_lineup_v1)
 */
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const appIdArg = args.indexOf("--app-id");
const APP_ID = appIdArg >= 0 ? args[appIdArg + 1] : "baseball_lineup_v1";

const { initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const base = db
  .collection("artifacts")
  .doc(APP_ID)
  .collection("public")
  .doc("data");

const teams = await base.collection("teams").get();
const bySlug = new Map();
for (const t of teams.docs) {
  const slug = String(t.get("tryoutShareId") || "").trim();
  if (!slug) continue;
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug).push(t.id);
}

const toCreate = [];
const conflicts = [];
const duplicates = [];
let alreadyOk = 0;
for (const [slug, teamIds] of bySlug) {
  if (teamIds.length > 1) {
    duplicates.push({ slug, teamIds });
    continue;
  }
  const teamId = teamIds[0];
  const link = await base.collection("portalLinks").doc(slug).get();
  if (!link.exists) toCreate.push({ slug, teamId });
  else if (link.get("teamId") === teamId) alreadyOk++;
  else conflicts.push({ slug, teamId, linkTeamId: link.get("teamId") });
}

console.log(
  `${teams.size} teams · ${bySlug.size} share links · ${alreadyOk} already have their link doc · ${toCreate.length} to create`,
);
for (const d of duplicates)
  console.log(
    `SKIPPED duplicate share id ${d.slug}: teams ${d.teamIds.join(", ")}`,
  );
for (const c of conflicts)
  console.log(
    `CONFLICT ${c.slug}: team ${c.teamId}, but its link doc points at ${c.linkTeamId} — not changed`,
  );

if (!WRITE) {
  for (const c of toCreate)
    console.log(`would create portalLinks/${c.slug} → ${c.teamId}`);
  console.log("Dry run. Re-run with --write to create them.");
  process.exit(0);
}

let created = 0;
for (const c of toCreate) {
  try {
    // create() fails if the doc appeared meanwhile — never an overwrite.
    await base
      .collection("portalLinks")
      .doc(c.slug)
      .create({ teamId: c.teamId, createdAt: Date.now() });
    created++;
  } catch (e) {
    console.log(`could not create portalLinks/${c.slug}: ${e.message}`);
  }
}
console.log(`Created ${created} of ${toCreate.length} link docs.`);
