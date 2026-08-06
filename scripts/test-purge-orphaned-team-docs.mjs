#!/usr/bin/env node
/**
 * Emulator test for scripts/purge-orphaned-team-docs.mjs.
 *
 * That script deletes production data that cannot be recovered, so the claims
 * it makes have to be demonstrated rather than asserted in a comment. This
 * seeds the Firestore emulator with a database that contains both shapes the
 * script must tell apart — a LIVE team (document present, subcollections
 * populated) and an ORPHAN (document absent, subcollections populated) — and
 * then checks each safety property end to end.
 *
 * Run:
 *   npm install --no-save firebase-admin
 *   firebase emulators:exec --only firestore --project demo-purge-test \
 *     "node scripts/test-purge-orphaned-team-docs.mjs"
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, rm } from "node:fs/promises";

const { initializeApp, deleteApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "purge-orphaned-team-docs.mjs");
const PROJECT = process.env.GCLOUD_PROJECT || "demo-purge-test";
const APP_ID = "baseball_lineup_v1";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "FIRESTORE_EMULATOR_HOST is not set — refusing to run against real Firestore.\n" +
      "Use: firebase emulators:exec --only firestore --project demo-purge-test " +
      '"node scripts/test-purge-orphaned-team-docs.mjs"',
  );
  process.exit(2);
}

const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const teams = db.collection(`artifacts/${APP_ID}/public/data/teams`);

// ---- tiny assertion harness ------------------------------------------------

let passed = 0;
const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const runScript = (extraArgs = []) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [SCRIPT, "--project", PROJECT, "--app-id", APP_ID, ...extraArgs],
      { env: process.env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

// ---- fixtures --------------------------------------------------------------

const LANES_WITH_PII = [
  "tryoutSignups",
  "interestSignups",
  "playerInfoSubmissions",
  "availabilitySubmissions",
  "players",
];

/** A team whose parent document EXISTS. Must never be touched. */
const seedLiveTeam = async (teamId) => {
  await teams.doc(teamId).set({
    name: `Live ${teamId}`,
    ownerId: "u-owner",
    members: ["u-owner"],
  });
  for (const lane of [...LANES_WITH_PII, "games", "evalRounds"]) {
    for (let i = 0; i < 3; i++) {
      await teams
        .doc(teamId)
        .collection(lane)
        .doc(`${lane}-${i}`)
        .set({ id: `${lane}-${i}`, firstName: "Live", lane });
    }
  }
};

/**
 * A team whose parent document does NOT exist but whose subcollections are
 * populated — exactly what deleteTeamCmd leaves behind when its sweep loses
 * the race. Written by creating the doc, populating, then deleting the doc,
 * because that is literally how the bug produces them.
 */
const seedOrphan = async (teamId, perLane = 4) => {
  await teams.doc(teamId).set({ name: `Doomed ${teamId}`, ownerId: "u-owner" });
  for (const lane of [...LANES_WITH_PII, "games", "evalRounds"]) {
    for (let i = 0; i < perLane; i++) {
      await teams
        .doc(teamId)
        .collection(lane)
        .doc(`${lane}-${i}`)
        .set({
          id: `${lane}-${i}`,
          firstName: "Orphaned",
          email: "parent@example.com",
          lane,
        });
    }
  }
  await teams.doc(teamId).delete(); // subcollections survive — that is the bug
};

const countUnder = async (teamId) => {
  const cols = await teams.doc(teamId).listCollections();
  let n = 0;
  for (const c of cols) n += (await c.listDocuments()).length;
  return n;
};

const reset = async () => {
  const refs = await teams.listDocuments();
  for (const r of refs) await db.recursiveDelete(r);
};

// ---- tests -----------------------------------------------------------------

console.log("\nSeeding emulator…");
await reset();
await seedLiveTeam("team-live-1");
await seedLiveTeam("team-live-2");
await seedOrphan("team-orphan-1");
await seedOrphan("team-orphan-2", 2);

const liveBefore = await countUnder("team-live-1");
const orphan1Before = await countUnder("team-orphan-1");
const orphan2Before = await countUnder("team-orphan-2");
console.log(
  `  live team-live-1: ${liveBefore} docs; orphans: ${orphan1Before} + ${orphan2Before}\n`,
);

check(
  "fixture: orphan parent really is absent",
  !(await teams.doc("team-orphan-1").get()).exists,
);
check(
  "fixture: orphan subcollection docs really survived the parent delete",
  orphan1Before === 28,
  `expected 28, got ${orphan1Before}`,
);

// --- 1. dry run finds exactly the orphans, and deletes nothing --------------

console.log("\n[1] dry run");
{
  const { code, stdout } = await runScript();
  check("exits 0", code === 0, `code ${code}`);
  check(
    "reports both orphaned teams",
    /2 orphaned teams/.test(stdout),
    stdout.slice(-400),
  );
  check("names team-orphan-1", stdout.includes("team-orphan-1"));
  check("names team-orphan-2", stdout.includes("team-orphan-2"));
  check(
    "does NOT name a live team as orphaned",
    !/team team-live-1\s+\(parent document does not exist\)/.test(stdout),
  );
  check(
    "counts live teams separately",
    /2 live/.test(stdout),
    stdout.slice(-400),
  );
  check("says it is a dry run", /DRY RUN/.test(stdout));
  check(
    "flags the personal-data lanes",
    /lanes that hold personal data/.test(stdout),
  );
  check(
    "deleted nothing (orphan intact)",
    (await countUnder("team-orphan-1")) === orphan1Before,
  );
  check(
    "deleted nothing (live intact)",
    (await countUnder("team-live-1")) === liveBefore,
  );
}

// --- 2. --delete without a matching --confirm refuses ----------------------

console.log("\n[2] --delete with wrong/absent --confirm");
{
  const noConfirm = await runScript(["--delete"]);
  check(
    "refuses without --confirm",
    noConfirm.code === 2,
    `code ${noConfirm.code}`,
  );
  check(
    "explains the refusal",
    /REFUSING TO DELETE/.test(noConfirm.stdout + noConfirm.stderr),
  );

  const wrong = await runScript(["--delete", "--confirm", "99"]);
  check(
    "refuses on a mismatched count",
    wrong.code === 2,
    `code ${wrong.code}`,
  );
  check(
    "still deleted nothing",
    (await countUnder("team-orphan-1")) === orphan1Before &&
      (await countUnder("team-live-1")) === liveBefore,
  );
}

// --- 3. --export writes the contents before any deletion -------------------

console.log("\n[3] --export");
{
  const out = join(HERE, "..", ".orphan-export-test.json");
  await rm(out, { force: true });
  const { code } = await runScript(["--export", out]);
  check("exits 0", code === 0, `code ${code}`);
  const parsed = JSON.parse(await readFile(out, "utf8"));
  check("export contains both orphan teams", parsed.teams.length === 2);
  const t1 = parsed.teams.find((t) => t.teamId === "team-orphan-1");
  check("export carries lane contents", !!t1 && !!t1.lanes.tryoutSignups);
  check(
    "export carries the actual PII, so the purge is auditable",
    !!t1 &&
      t1.lanes.tryoutSignups.some((d) => d.data.email === "parent@example.com"),
  );
  check(
    "export did not delete anything",
    (await countUnder("team-orphan-1")) === orphan1Before,
  );
  await rm(out, { force: true });
}

// --- 4. the live-team re-check aborts a purge whose parent came back --------

console.log(
  "\n[4] live-team re-check (parent recreated between scan and delete)",
);
{
  // Recreate team-orphan-2's parent document. The script's scan already ran
  // above and saw it as an orphan; the re-check immediately before deletion is
  // the only thing standing between this team and losing its data.
  await teams
    .doc("team-orphan-2")
    .set({ name: "Came back", ownerId: "u-owner" });
  const before = await countUnder("team-orphan-2");
  // Now only ONE orphan remains, so confirm 1.
  const { code, stdout } = await runScript(["--delete", "--confirm", "1"]);
  check("exits 0", code === 0, `code ${code}`);
  check(
    "team-orphan-2 was not reported as an orphan any more",
    !/team team-orphan-2\s+\(parent document does not exist\)/.test(stdout),
  );
  check(
    "team-orphan-2's data is untouched",
    (await countUnder("team-orphan-2")) === before,
    `expected ${before}, got ${await countUnder("team-orphan-2")}`,
  );
  check("team-orphan-1 WAS purged", (await countUnder("team-orphan-1")) === 0);
  check(
    "live teams untouched",
    (await countUnder("team-live-1")) === liveBefore &&
      (await countUnder("team-live-2")) === liveBefore,
  );
  check(
    "the live parent documents still exist",
    (await teams.doc("team-live-1").get()).exists &&
      (await teams.doc("team-live-2").get()).exists,
  );
}

// --- 5. a clean database reports nothing and stays clean -------------------

console.log("\n[5] no orphans left");
{
  await teams.doc("team-orphan-2").delete(); // make it an orphan again
  await db.recursiveDelete(teams.doc("team-orphan-2"));
  const { code, stdout } = await runScript();
  check("exits 0", code === 0, `code ${code}`);
  check("reports nothing to purge", /No orphaned documents found/.test(stdout));
  check(
    "live data survived the whole run",
    (await countUnder("team-live-1")) === liveBefore &&
      (await countUnder("team-live-2")) === liveBefore,
  );
}

// --- 6. --include-mirrors is covered by --confirm --------------------------

console.log("\n[6] --include-mirrors confirmation covers stale siblings");
{
  await reset();
  await seedLiveTeam("team-live-1");
  // No orphaned TEAMS at all — only stale siblings. Before the confirm count
  // included siblings, `--include-mirrors --delete --confirm 0` matched the
  // zero orphan-team count and destroyed every one of these unannounced.
  const mirrorsCol = db.collection(
    `artifacts/${APP_ID}/public/data/teamPublic`,
  );
  const invitesCol = db.collection(
    `artifacts/${APP_ID}/public/data/teamInvites`,
  );
  await mirrorsCol.doc("team-live-1").set({ name: "Live mirror" });
  await mirrorsCol.doc("team-long-gone").set({ name: "Stale mirror" });
  await invitesCol
    .doc("CODE01")
    .set({ teamId: "team-live-1", teamName: "Live" });
  await invitesCol
    .doc("CODE02")
    .set({ teamId: "team-long-gone", teamName: "Gone" });

  const dry = await runScript(["--include-mirrors"]);
  check("dry run exits 0", dry.code === 0, `code ${dry.code}`);
  check(
    "reports the stale siblings",
    /1 teamPublic mirror\(s\), 1 teamInvite\(s\)/.test(dry.stdout),
    dry.stdout.slice(-500),
  );
  check(
    "tells the operator to confirm 2, not 0",
    /--delete --confirm 2/.test(dry.stdout),
    dry.stdout.slice(-500),
  );

  const zero = await runScript([
    "--include-mirrors",
    "--delete",
    "--confirm",
    "0",
  ]);
  check("refuses --confirm 0", zero.code === 2, `code ${zero.code}`);
  check(
    "stale siblings still present after the refusal",
    (await mirrorsCol.doc("team-long-gone").get()).exists &&
      (await invitesCol.doc("CODE02").get()).exists,
  );

  const ok = await runScript([
    "--include-mirrors",
    "--delete",
    "--confirm",
    "2",
  ]);
  check("accepts the correct count", ok.code === 0, `code ${ok.code}`);
  check(
    "stale mirror and invite are gone",
    !(await mirrorsCol.doc("team-long-gone").get()).exists &&
      !(await invitesCol.doc("CODE02").get()).exists,
  );
  check(
    "the LIVE team's mirror and invite are untouched",
    (await mirrorsCol.doc("team-live-1").get()).exists &&
      (await invitesCol.doc("CODE01").get()).exists,
  );
  check(
    "the live team's own data is untouched",
    (await countUnder("team-live-1")) === liveBefore,
  );
}

// ---- summary ---------------------------------------------------------------

console.log("\n" + "─".repeat(60));
if (failures.length) {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  await deleteApp(app);
  process.exit(1);
}
console.log(`PASSED — all ${passed} checks.`);
await deleteApp(app);
process.exit(0);
