#!/usr/bin/env node
/**
 * Emulator test for scripts/backfill-portal-links.mjs.
 *
 * Run:
 *   npm install --no-save firebase-admin
 *   firebase emulators:exec --only firestore --project demo-portal-links \
 *     "node scripts/test-backfill-portal-links.mjs"
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const { initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "FIRESTORE_EMULATOR_HOST is not set — refusing to run against real Firestore.",
  );
  process.exit(1);
}
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "backfill-portal-links.mjs",
);
initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-portal-links" });
const db = getFirestore();
const base = db
  .collection("artifacts")
  .doc("baseball_lineup_v1")
  .collection("public")
  .doc("data");

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures++;
};
const run = (...extra) =>
  spawnSync(process.execPath, [SCRIPT, ...extra], {
    env: process.env,
    encoding: "utf8",
  });

// Seed: a team needing its link, one already linked, a conflict, a duplicate pair.
await base.collection("teams").doc("needs").set({ tryoutShareId: "s-needs" });
await base.collection("teams").doc("linked").set({ tryoutShareId: "s-linked" });
await base.collection("portalLinks").doc("s-linked").set({ teamId: "linked" });
await base
  .collection("teams")
  .doc("victim")
  .set({ tryoutShareId: "s-hijacked" });
await base
  .collection("portalLinks")
  .doc("s-hijacked")
  .set({ teamId: "attacker" });
await base.collection("teams").doc("dup-a").set({ tryoutShareId: "s-dup" });
await base.collection("teams").doc("dup-b").set({ tryoutShareId: "s-dup" });
await base.collection("teams").doc("no-link").set({ name: "never shared" });

const dry = run();
check(dry.status === 0, "dry run exits cleanly");
check(/1 to create/.test(dry.stdout), "dry run counts the one missing link");
check(
  !(await base.collection("portalLinks").doc("s-needs").get()).exists,
  "dry run writes nothing",
);

const wet = run("--write");
check(wet.status === 0, "--write exits cleanly");
const made = await base.collection("portalLinks").doc("s-needs").get();
check(
  made.exists && made.get("teamId") === "needs",
  "--write creates the missing link for its team",
);
check(
  (await base.collection("portalLinks").doc("s-hijacked").get()).get(
    "teamId",
  ) === "attacker" && /CONFLICT s-hijacked/.test(wet.stdout),
  "a conflicting link doc is reported, never overwritten",
);
check(
  !(await base.collection("portalLinks").doc("s-dup").get()).exists &&
    /SKIPPED duplicate share id s-dup/.test(wet.stdout),
  "a share id two teams claim is skipped and reported",
);
check(
  (await base.collection("portalLinks").count().get()).data().count === 3,
  "nothing else was created",
);

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All checks passed.");
