#!/usr/bin/env node
/**
 * Find — and optionally purge — Firestore documents stranded under DELETED
 * teams.
 *
 * ## Why this exists
 *
 * Firestore does not cascade-delete. Deleting
 * `artifacts/{appId}/public/data/teams/{teamId}` leaves every document in that
 * team's subcollections behind, and those documents become permanently
 * unreachable: every subcollection rule resolves membership with a `get()` on
 * the parent team doc, which now returns null, so reads AND deletes are denied
 * for every client forever. `deleteTeamCmd` sweeps the subcollections first to
 * avoid this, but that sweep is best-effort by construction — a client cannot
 * recursively delete a collection — so a rejected, partial, or (before the
 * await-to-completion fix) raced sweep leaves orphans.
 *
 * What is stranded is not trivia: the signup and submission lanes hold family
 * PII — children's names, dates of birth, parent emails and phone numbers —
 * for teams the coach believes they deleted. Only the Admin SDK, which bypasses
 * security rules, can reach it. Hence this script.
 *
 * ## Safety model
 *
 * This deletes production data that cannot be recovered. Every design choice
 * below is in service of never deleting a LIVE team's data:
 *
 *  1. DRY RUN BY DEFAULT. It reports and exits. Deleting needs both `--delete`
 *     and `--confirm <n>`, where n must equal the orphan-team count it just
 *     found — so a stale invocation against a changed database refuses to run.
 *  2. ONLY missing parents. A team is a purge candidate solely when
 *     `teams/{teamId}.get()` reports `exists === false`. `listDocuments()` is
 *     what makes this possible: it returns references for "missing" documents
 *     that still have subcollections, which is exactly the orphan signature.
 *  3. A READ ERROR IS NEVER "MISSING". Any failure while probing a parent skips
 *     that team and is reported as an error. Silence is not consent.
 *  4. RE-PROVEN AT DELETE TIME. The parent is re-fetched immediately before its
 *     data is destroyed; if it exists by then (a team recreated at the same id,
 *     a create that had not yet landed during the scan) the delete is aborted
 *     for that team.
 *  5. EXPORT FIRST. `--export <file>` writes every document this would delete
 *     to local JSON before anything is destroyed, so a purge is auditable and,
 *     if it was a mistake, reversible by hand.
 *
 * ## Usage
 *
 *   npm install --no-save firebase-admin      # not a repo dependency
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   node scripts/purge-orphaned-team-docs.mjs                     # dry run
 *   node scripts/purge-orphaned-team-docs.mjs --export orphans.json
 *   node scripts/purge-orphaned-team-docs.mjs --delete --confirm 3
 *
 * Flags:
 *   --app-id <id>     App namespace to scan (default: baseball_lineup_v1).
 *   --all-apps        Scan every appId under `artifacts/` instead of one.
 *   --project <id>    GCP project (default: lineupgenerator-79159, or
 *                     FIREBASE_PROJECT_ID).
 *   --export <file>   Write full contents of everything found to JSON first.
 *   --delete          Actually delete. Requires --confirm.
 *   --confirm <n>     Must equal the number of orphaned teams found.
 *   --include-mirrors Also purge stale teamPublic/teamInvites siblings.
 *   --quiet           Suppress per-team detail; print the summary only.
 *
 * The service account needs Cloud Datastore User (or Firebase Admin) on the
 * project. Against the emulator, set FIRESTORE_EMULATOR_HOST instead of
 * credentials — see scripts/test-purge-orphaned-team-docs.mjs.
 */

// Modular subpath entry points — the supported ESM surface of firebase-admin
// (the default export is CommonJS-shaped and has no .firestore() in v13+).
let initializeApp, deleteApp, applicationDefault, getFirestore;
try {
  ({ initializeApp, deleteApp, applicationDefault } =
    await import("firebase-admin/app"));
  ({ getFirestore } = await import("firebase-admin/firestore"));
} catch {
  console.error(
    "firebase-admin is not installed (it is deliberately not a repo dependency).\n" +
      "Run:  npm install --no-save firebase-admin",
  );
  process.exit(2);
}

const DEFAULT_APP_ID = "baseball_lineup_v1";
const DEFAULT_PROJECT = "lineupgenerator-79159";

// The subcollections this app creates under a team document, per
// firestore.rules. Used ONLY to flag anything unexpected in the report — the
// scan itself uses listCollections(), so a lane added later is still found and
// still purged without editing this list.
const KNOWN_LANES = new Set([
  "evalRounds",
  "tryoutSignups",
  "interestSignups",
  "playerInfoSubmissions",
  "availabilitySubmissions",
  "games",
  "players",
]);

// ---- argv ------------------------------------------------------------------

const parseArgs = (argv) => {
  const out = {
    appId: DEFAULT_APP_ID,
    allApps: false,
    project: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT,
    exportPath: null,
    doDelete: false,
    confirm: null,
    includeMirrors: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`Missing value for ${a}`);
        process.exit(2);
      }
      return v;
    };
    switch (a) {
      case "--app-id":
        out.appId = next();
        break;
      case "--all-apps":
        out.allApps = true;
        break;
      case "--project":
        out.project = next();
        break;
      case "--export":
        out.exportPath = next();
        break;
      case "--delete":
        out.doDelete = true;
        break;
      case "--confirm":
        out.confirm = Number(next());
        break;
      case "--include-mirrors":
        out.includeMirrors = true;
        break;
      case "--quiet":
        out.quiet = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "See the header of this file for full usage.\n" +
            "  node scripts/purge-orphaned-team-docs.mjs [--app-id X | --all-apps]\n" +
            "      [--project P] [--export FILE] [--include-mirrors] [--quiet]\n" +
            "      [--delete --confirm N]",
        );
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return out;
};

const args = parseArgs(process.argv.slice(2));

// The scope flags THIS run used, echoed into the remediation command the dry
// run prints. Without them the hint was a bare basename with no --app-id or
// --project: pasting it either failed to resolve the script or, worse, quietly
// re-scanned the DEFAULT namespace and project and deleted from a tree the
// operator never surveyed.
const scopeFlags = () =>
  [
    args.allApps ? "--all-apps" : `--app-id ${args.appId}`,
    `--project ${args.project}`,
    ...(args.includeMirrors ? ["--include-mirrors"] : []),
  ].join(" ");

// ---- init ------------------------------------------------------------------

const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!usingEmulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "No credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account\n" +
      "key with Cloud Datastore User on the project (or FIRESTORE_EMULATOR_HOST\n" +
      "to run against the emulator).",
  );
  process.exit(2);
}

const app = initializeApp({
  projectId: args.project,
  ...(usingEmulator ? {} : { credential: applicationDefault() }),
});
const db = getFirestore(app);

const teamsCol = (appId) =>
  db.collection(`artifacts/${appId}/public/data/teams`);

// ---- scan ------------------------------------------------------------------

/** Every appId namespace present under `artifacts/`. */
const listAppIds = async () => {
  const refs = await db.collection("artifacts").listDocuments();
  return refs.map((r) => r.id);
};

/**
 * Orphans in one app namespace.
 *
 * listDocuments() is the load-bearing call: unlike a query, it returns
 * references for documents that do not exist but still have subcollections —
 * which is precisely what a deleted-but-not-swept team looks like. A team with
 * neither a document nor subcollections is not referenced by anything and
 * simply never appears, so this cannot invent orphans.
 */
const scanApp = async (appId) => {
  const teams = [];
  const errors = [];
  const liveIds = new Set();
  let liveCount = 0;

  let refs;
  try {
    refs = await teamsCol(appId).listDocuments();
  } catch (e) {
    errors.push({ scope: `app:${appId}`, message: String(e?.message || e) });
    return { appId, teams, errors, liveCount, liveIds, scannedCount: 0 };
  }

  for (const ref of refs) {
    let snap;
    try {
      snap = await ref.get();
    } catch (e) {
      // Guard 3: a failed probe is NOT evidence of absence. Skip it.
      errors.push({
        scope: `team:${ref.id}`,
        message: `could not read parent doc (skipped, not purged): ${String(e?.message || e)}`,
      });
      continue;
    }
    if (snap.exists) {
      liveCount++;
      liveIds.add(ref.id);
      continue;
    }

    // Parent is missing. Enumerate what is stranded beneath it.
    let cols;
    try {
      cols = await ref.listCollections();
    } catch (e) {
      errors.push({
        scope: `team:${ref.id}`,
        message: `could not list subcollections (skipped): ${String(e?.message || e)}`,
      });
      continue;
    }
    if (cols.length === 0) continue; // nothing stranded

    const lanes = [];
    // Lanes whose contents this scan could NOT enumerate. Load-bearing: the
    // delete is a recursiveDelete of the whole subtree, so it destroys lanes
    // this survey never saw — including from --export. A team with any
    // unsurveyed lane is therefore reported but never purged.
    const unsurveyed = [];
    for (const col of cols) {
      // listDocuments() returns references only — it never transfers document
      // CONTENTS, so a survey stays cheap in bandwidth and cannot spill PII
      // into this process. It is NOT free: Firestore bills one document read
      // per reference returned, same as a query. Budget roughly one read per
      // stranded document for a survey, and a second one for --export.
      let docRefs;
      try {
        docRefs = await col.listDocuments();
      } catch (e) {
        unsurveyed.push(col.id);
        errors.push({
          scope: `team:${ref.id}/${col.id}`,
          message:
            `could not list documents — this team will NOT be purged ` +
            `(a recursive delete would destroy this lane unsurveyed and ` +
            `unexported); re-run: ${String(e?.message || e)}`,
        });
        continue;
      }
      lanes.push({
        lane: col.id,
        count: docRefs.length,
        known: KNOWN_LANES.has(col.id),
        docIds: docRefs.map((d) => d.id),
      });
    }
    const total = lanes.reduce((n, l) => n + l.count, 0);
    if (total === 0) continue; // subcollections existed but are already empty

    teams.push({ appId, teamId: ref.id, ref, lanes, total, unsurveyed });
  }

  // liveIds is returned so --include-mirrors can decide staleness from THIS
  // scan instead of re-listing and re-getting every team document a second
  // time (which doubled the read bill and, if it threw, discarded a completed
  // scan before the report ever printed).
  return {
    appId,
    teams,
    errors,
    liveCount,
    liveIds,
    scannedCount: refs.length,
  };
};

/**
 * Sibling documents that belong to a team that no longer exists. Unlike the
 * subcollection orphans these ARE still client-reachable, which makes a stale
 * teamPublic mirror a small live exposure (a deleted team's branding and tryout
 * config stay publicly readable) rather than unreachable debris.
 */
const scanMirrors = async (appId, liveTeamIds) => {
  const stale = { teamPublic: [], teamInvites: [] };
  const errors = [];

  try {
    const mirrors = await db
      .collection(`artifacts/${appId}/public/data/teamPublic`)
      .listDocuments();
    for (const m of mirrors) {
      // The mirror doc id IS the team id.
      if (!liveTeamIds.has(m.id)) {
        stale.teamPublic.push({ ref: m, teamId: m.id, appId });
      }
    }
  } catch (e) {
    errors.push({
      scope: `app:${appId}/teamPublic`,
      message: String(e?.message || e),
    });
  }

  try {
    // Invites are keyed by join CODE, so the owning team is a field.
    const invites = await db
      .collection(`artifacts/${appId}/public/data/teamInvites`)
      .get();
    for (const inv of invites.docs) {
      const teamId = inv.get("teamId");
      if (typeof teamId === "string" && teamId && !liveTeamIds.has(teamId)) {
        stale.teamInvites.push({ ref: inv.ref, teamId, appId });
      }
    }
  } catch (e) {
    errors.push({
      scope: `app:${appId}/teamInvites`,
      message: String(e?.message || e),
    });
  }

  return { stale, errors };
};

// ---- report ----------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const report = (results, mirrors, opts) => {
  const allTeams = results.flatMap((r) => r.teams);
  const allErrors = [
    ...results.flatMap((r) => r.errors),
    ...(mirrors?.errors || []),
  ];

  console.log("");
  console.log("═".repeat(72));
  console.log("  ORPHANED TEAM DOCUMENTS");
  console.log("═".repeat(72));

  for (const r of results) {
    console.log(
      `\napp "${r.appId}": ${plural(r.scannedCount, "team reference", "team references")} scanned, ` +
        `${r.liveCount} live, ${r.teams.length} orphaned`,
    );
  }

  if (allTeams.length === 0) {
    console.log("\n  No orphaned documents found. Nothing to purge.\n");
  } else if (!opts.quiet) {
    for (const t of allTeams) {
      console.log(`\n  team ${t.teamId}  (parent document does not exist)`);
      for (const l of t.lanes) {
        const flag = l.known
          ? ""
          : "   ⚠ not a lane this app is known to create";
        console.log(
          `      ${l.lane.padEnd(24)} ${String(l.count).padStart(5)} docs${flag}`,
        );
      }
      console.log(
        `      ${"".padEnd(24)} ${String(t.total).padStart(5)} total`,
      );
    }
  }

  const grandTotal = allTeams.reduce((n, t) => n + t.total, 0);
  const piiLanes = new Set([
    "tryoutSignups",
    "interestSignups",
    "playerInfoSubmissions",
    "availabilitySubmissions",
    "players",
  ]);
  const piiTotal = allTeams.reduce(
    (n, t) =>
      n +
      t.lanes
        .filter((l) => piiLanes.has(l.lane))
        .reduce((m, l) => m + l.count, 0),
    0,
  );

  console.log("");
  console.log("─".repeat(72));
  console.log(
    `  ${plural(allTeams.length, "orphaned team", "orphaned teams")}, ` +
      `${plural(grandTotal, "stranded document", "stranded documents")}`,
  );
  if (piiTotal > 0) {
    console.log(
      `  ${piiTotal} of those are in lanes that hold personal data ` +
        `(names, DOBs, parent contact details).`,
    );
  }

  if (mirrors) {
    const { teamPublic, teamInvites } = mirrors.stale;
    if (teamPublic.length || teamInvites.length) {
      console.log(
        `  Stale siblings: ${teamPublic.length} teamPublic mirror(s), ` +
          `${teamInvites.length} teamInvite(s) — still client-readable.`,
      );
      // Teams get a per-lane table; siblings used to get only this count, so
      // there was no way to audit which ones the confirm number covered.
      if (!opts.quiet) {
        for (const { ref, teamId } of [...teamPublic, ...teamInvites]) {
          console.log(`      ${ref.path}   (team ${teamId})`);
        }
      }
    }
  }

  if (allErrors.length) {
    console.log("");
    console.log(
      `  ⚠ ${allErrors.length} error(s); those targets were SKIPPED:`,
    );
    for (const e of allErrors) console.log(`      ${e.scope}: ${e.message}`);
  }
  console.log("─".repeat(72));

  return { allTeams, grandTotal, allErrors };
};

// ---- export ----------------------------------------------------------------

const exportAll = async (teams, mirrors, file) => {
  const { writeFile } = await import("node:fs/promises");
  const payload = {
    exportedAt: new Date().toISOString(),
    teams: [],
    siblings: {},
  };

  for (const t of teams) {
    const laneData = {};
    for (const l of t.lanes) {
      const col = t.ref.collection(l.lane);
      const snap = await col.get(); // charges reads — the price of an audit trail
      laneData[l.lane] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    }
    payload.teams.push({ appId: t.appId, teamId: t.teamId, lanes: laneData });
  }

  if (mirrors) {
    const dump = async (entries) => {
      const out = [];
      for (const { ref, teamId } of entries) {
        const s = await ref.get();
        if (s.exists)
          out.push({ id: ref.id, path: ref.path, teamId, data: s.data() });
      }
      return out;
    };
    payload.siblings = {
      teamPublic: await dump(mirrors.stale.teamPublic),
      teamInvites: await dump(mirrors.stale.teamInvites),
    };
  }

  await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n  Exported full contents to ${file}`);
};

// ---- delete ----------------------------------------------------------------

const purge = async (teams, mirrors) => {
  let deletedDocs = 0;
  let deletedTeams = 0;
  let abortedTeams = 0;
  let abortedSiblings = 0;

  for (const t of teams) {
    // Guard 4: re-prove the parent is still missing, immediately before
    // destroying anything. A team recreated at this id between the scan and now
    // — or a create whose document write had not yet landed during the scan —
    // is LIVE data, and must not be touched.
    let snap;
    try {
      snap = await t.ref.get();
    } catch (e) {
      console.log(
        `  ! ${t.teamId}: re-check failed (${String(e?.message || e)}) — SKIPPED`,
      );
      abortedTeams++;
      continue;
    }
    if (snap.exists) {
      console.log(
        `  ! ${t.teamId}: parent document EXISTS on re-check — live team, SKIPPED`,
      );
      abortedTeams++;
      continue;
    }

    // Belt and braces: main filters unsurveyed teams out of the purge set, but
    // recursiveDelete is a whole-subtree operation and this is the last place
    // that can stop it, so re-assert the invariant at the point of no return.
    if (t.unsurveyed && t.unsurveyed.length) {
      console.log(
        `  ! ${t.teamId}: lane(s) ${t.unsurveyed.join(", ")} could not be surveyed — SKIPPED`,
      );
      abortedTeams++;
      continue;
    }

    // recursiveDelete handles batching, throttling and retries, and reaches any
    // nesting this script did not anticipate. The parent doc itself does not
    // exist, so deleting it is a no-op.
    await db.recursiveDelete(t.ref);
    deletedDocs += t.total;
    deletedTeams++;
    console.log(`  ✓ ${t.teamId}: purged ${t.total} document(s)`);
  }

  if (mirrors) {
    const all = [...mirrors.stale.teamPublic, ...mirrors.stale.teamInvites];
    for (const { ref, teamId, appId } of all) {
      // Guard 4 for SIBLINGS. This loop used to delete unconditionally, which
      // made a live outage reachable in a single run: the staleness verdict is
      // frozen during the scan, but --export can then read every document of
      // every orphan lane and run for minutes. A team created in that window
      // is correctly skipped by the subtree re-check above — and then had its
      // public mirror deleted three lines later anyway.
      //
      // That is not inert debris. teamPublic/{teamId} is what the anonymous
      // Tryouts, Availability and PlayerInfo portals read, and it does not
      // heal on its own: writePublicMirror only runs for the coach's ACTIVE
      // team and short-circuits on an unchanged projection, so the coach has
      // to hit Resync. Deleting the invite likewise breaks that join code.
      let owner;
      try {
        owner = await db
          .doc(`artifacts/${appId}/public/data/teams/${teamId}`)
          .get();
      } catch (e) {
        console.log(
          `  ! ${ref.path}: owner re-check failed (${String(e?.message || e)}) — SKIPPED`,
        );
        abortedSiblings++;
        continue;
      }
      if (owner.exists) {
        console.log(
          `  ! ${ref.path}: team ${teamId} EXISTS on re-check — live team, SKIPPED`,
        );
        abortedSiblings++;
        continue;
      }
      await ref.delete();
      deletedDocs++;
      console.log(`  ✓ ${ref.path}: deleted stale sibling`);
    }
  }

  return { deletedDocs, deletedTeams, abortedTeams, abortedSiblings };
};

// ---- main ------------------------------------------------------------------

const main = async () => {
  const appIds = args.allApps ? await listAppIds() : [args.appId];
  console.log(
    `Scanning project "${args.project}"${usingEmulator ? " (EMULATOR)" : ""}, ` +
      `app namespace(s): ${appIds.join(", ")}`,
  );

  const results = [];
  for (const appId of appIds) results.push(await scanApp(appId));

  let mirrors = null;
  if (args.includeMirrors) {
    // Reuse the liveIds the scan above already established. The previous
    // version re-listed and re-got every team document here — a second full
    // pass that doubled the read bill and, being unguarded, could throw away a
    // completed scan before the report ever printed. It also disagreed with
    // itself: a team created between the two passes would be "orphaned" by one
    // and "live" by the other.
    const merged = { stale: { teamPublic: [], teamInvites: [] }, errors: [] };
    for (const appId of appIds) {
      const scanned = results.find((r) => r.appId === appId);
      if (!scanned) continue;
      try {
        const m = await scanMirrors(appId, scanned.liveIds);
        merged.stale.teamPublic.push(...m.stale.teamPublic);
        merged.stale.teamInvites.push(...m.stale.teamInvites);
        merged.errors.push(...m.errors);
      } catch (e) {
        // Optional extra: never let it destroy the orphan report we already
        // paid for.
        merged.errors.push({
          scope: `app:${appId}/mirrors`,
          message: `sibling scan failed (siblings NOT purged): ${String(e?.message || e)}`,
        });
      }
    }
    mirrors = merged;
  }

  const { allTeams, grandTotal, allErrors } = report(results, mirrors, args);

  // Teams this run may DELETE — a strict subset of what it reports. A team
  // whose survey was incomplete is excluded: the delete is a whole-subtree
  // recursiveDelete, so purging one would destroy the lane the scan could not
  // enumerate, which is also the lane --export never captured. Reporting it and
  // refusing to purge it is the only honest option.
  //
  // destructiveTargets is then computed ONCE, so the number the dry run tells
  // the operator to pass is exactly what the confirmation gate below demands.
  const purgeable = allTeams.filter(
    (t) => !t.unsurveyed || t.unsurveyed.length === 0,
  );
  const withheld = allTeams.length - purgeable.length;
  if (withheld > 0) {
    console.log(
      `\n  ${withheld} orphaned team(s) are reported but WITHHELD from purge:\n` +
        `  a subcollection could not be enumerated, and a recursive delete\n` +
        `  would destroy it unsurveyed and unexported. Re-run to retry.`,
    );
  }

  const staleSiblingCount = mirrors
    ? mirrors.stale.teamPublic.length + mirrors.stale.teamInvites.length
    : 0;
  const destructiveTargets = purgeable.length + staleSiblingCount;

  if (args.exportPath && destructiveTargets > 0) {
    await exportAll(purgeable, mirrors, args.exportPath);
  }

  if (!args.doDelete) {
    if (destructiveTargets > 0 || grandTotal) {
      console.log(
        `\n  DRY RUN — nothing was deleted.\n` +
          `  To purge:  node ${process.argv[1]} ${scopeFlags()} --delete --confirm ${destructiveTargets}` +
          (args.exportPath
            ? ""
            : `\n  Consider --export <file> first; this is not recoverable.`),
      );
    }
    console.log("");
    await deleteApp(app);
    return allErrors.length ? 1 : 0;
  }

  // Guard 1: the confirmation must match what this run actually found, so a
  // command copied from an older report cannot execute against a database that
  // has changed underneath it.
  //
  // It counts orphaned teams PLUS stale siblings, because --include-mirrors
  // widens what gets destroyed: gating on the team count alone would let
  // `--include-mirrors --delete --confirm 0` sail through on a database with
  // no orphaned teams and silently delete every stale mirror and invite. The
  // number the operator types has to cover everything the run will destroy.
  if (args.confirm !== destructiveTargets) {
    console.error(
      `\n  REFUSING TO DELETE: --confirm ${args.confirm ?? "(absent)"} does not match ` +
        `the ${destructiveTargets} target(s) found in this scan` +
        (staleSiblingCount
          ? ` (${allTeams.length} orphaned team(s) + ${staleSiblingCount} stale sibling(s))`
          : "") +
        `.\n  Re-run the dry run and pass the number it reports.\n`,
    );
    await deleteApp(app);
    return 2;
  }
  if (destructiveTargets === 0) {
    console.log("\n  Nothing to delete.\n");
    await deleteApp(app);
    return 0;
  }

  console.log(`\n  DELETING — this cannot be undone.\n`);
  const { deletedDocs, deletedTeams, abortedTeams, abortedSiblings } =
    await purge(purgeable, mirrors);
  const aborted = abortedTeams + abortedSiblings;
  console.log(
    `\n  Purged ${deletedDocs} document(s) across ${deletedTeams} team(s).` +
      (aborted ? `  ${aborted} target(s) skipped by the live re-check.` : ""),
  );
  console.log("");
  await deleteApp(app);
  // A run that intended to delete and deleted NOTHING because every target was
  // withdrawn is not a success — exiting 0 there tells a wrapper or a cron the
  // cleanup happened. Report it, and keep reporting scan errors.
  if (aborted > 0 && deletedDocs === 0) return 1;
  return allErrors.length ? 1 : 0;
};

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("\nFAILED:", e?.stack || e);
    process.exit(1);
  });
