import { readFileSync } from "fs";
import { resolve } from "path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
// The REAL payload createTeam writes (minus name/owner/members) — imported so
// the "a fresh team can be created" ratchet test proves the actual client
// shape, not a hand-maintained copy of it.
import { NEW_TEAM_DOC } from "../src/constants/ui";

// Firestore security-rule tests. Run with `npm run test:rules`, which wraps
// these in `firebase emulators:exec --only firestore` so the emulator is up
// (FIRESTORE_EMULATOR_HOST set) for the duration. Requires firebase-tools and
// a Java runtime (the Firestore emulator dependency).

const APP_ID = "baseball_lineup_v1";
const PROJECT_ID = "coachs-card-rules-test";

const OWNER = "owner-uid";
const ASSISTANT = "assistant-uid";
// A non-owner member the owner promoted to 'head' via setCoachRole — has full
// head privileges (incl. finances) without being ownerId.
const COHEAD = "cohead-uid";
const OUTSIDER = "outsider-uid";
const JOINER = "joiner-uid";
// Sole member of a legacy unclaimed team (no ownerId) — the auto-claim path.
const SOLO = "solo-uid";

let testEnv: RulesTestEnvironment;

const teamPath = (teamId: string) =>
  ["artifacts", APP_ID, "public", "data", "teams", teamId] as const;
const evalRoundPath = (teamId: string, roundId: string) =>
  [
    "artifacts",
    APP_ID,
    "public",
    "data",
    "teams",
    teamId,
    "evalRounds",
    roundId,
  ] as const;
// Firestore auto-ids are exactly 20 chars; the public create lane requires
// that length so a portal writer can never plant a doc at a short legacy
// genId ("ts-xxxxxxxx") and shadow a real family's not-yet-migrated entry.
const AUTO_ID = "aAbBcCdDeEfFgGhHiIjJ";
const AUTO_ID_2 = "kKlLmMnNoOpPqQrRsStT";

const tryoutSignupPath = (teamId: string, signupId: string) =>
  [
    "artifacts",
    APP_ID,
    "public",
    "data",
    "teams",
    teamId,
    "tryoutSignups",
    signupId,
  ] as const;
const interestSignupPath = (teamId: string, leadId: string) =>
  [
    "artifacts",
    APP_ID,
    "public",
    "data",
    "teams",
    teamId,
    "interestSignups",
    leadId,
  ] as const;
const playerInfoSubPath = (teamId: string, subId: string) =>
  [
    "artifacts",
    APP_ID,
    "public",
    "data",
    "teams",
    teamId,
    "playerInfoSubmissions",
    subId,
  ] as const;
const availabilitySubPath = (teamId: string, subId: string) =>
  [
    "artifacts",
    APP_ID,
    "public",
    "data",
    "teams",
    teamId,
    "availabilitySubmissions",
    subId,
  ] as const;
const mirrorPath = (teamId: string) =>
  ["artifacts", APP_ID, "public", "data", "teamPublic", teamId] as const;
const invitePath = (code: string) =>
  ["artifacts", APP_ID, "public", "data", "teamInvites", code] as const;
const settingsPath = (uid: string, docId = "teams") =>
  ["artifacts", APP_ID, "users", uid, "settings", docId] as const;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed a team with an owner + one assistant, a sanitized mirror, and an
  // invite-lookup doc, all with security rules disabled.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, ...teamPath("team-1")), {
      name: "Hawks",
      ownerId: OWNER,
      members: [OWNER, ASSISTANT, COHEAD],
      coachRoles: {
        [OWNER]: "head",
        [ASSISTANT]: "assistant",
        [COHEAD]: "head",
      },
      joinCode: "ABC234",
      tryoutsOpen: true,
      tryoutShareId: "share-1",
      tryoutSignups: [{ id: "s1", firstName: "Existing" }],
      interestSignups: [{ id: "i1", firstName: "Lead" }],
      // Legacy Phase 1b arrays, still on the doc: the deprecated public
      // append lanes and the member cleanup shapes are exercised against
      // these, and the ratchet tests drop them.
      playerInfoSubmissions: [{ id: "pi0", firstName: "Old" }],
      availabilitySubmissions: [{ id: "av0", firstName: "Old" }],
      // A head-coach eval round, so finding-3.1 tests can target the head's
      // private grades from an assistant context.
      evaluationEvents: [
        {
          id: "ev-head",
          date: "2026-06-01",
          coachRole: "Head",
          evaluatorId: OWNER,
          grades: { p1: { contact: 5 } },
        },
      ],
      finances: {
        clubFee: 500,
        payments: [
          { id: "pay-1", playerId: "p1", date: "2026-03-01", amount: 250 },
        ],
      },
    });
    // Per-author eval rounds in the evalRounds subcollection (finding 3.1,
    // Option A). One authored by the head/owner, one by the assistant, so the
    // scoping tests can target each from the other's context.
    await setDoc(doc(db, ...evalRoundPath("team-1", "round-head")), {
      evaluatorId: OWNER,
      coachRole: "Head",
      date: "2026-06-01",
      grades: { p1: { contact: 5 } },
    });
    await setDoc(doc(db, ...evalRoundPath("team-1", "round-asst")), {
      evaluatorId: ASSISTANT,
      coachRole: "Assistant",
      date: "2026-06-02",
      grades: { p1: { contact: 3 } },
    });
    // Per-entry signup docs (Phase 1 of docs/firestore-data-migration.md) —
    // one in each subcollection so the member/anonymous read + update/delete
    // scoping tests have an existing doc to target.
    await setDoc(doc(db, ...tryoutSignupPath("team-1", "ts-doc-1")), {
      id: "ts-doc-1",
      submittedAt: "2026-07-01T00:00:00.000Z",
      firstName: "Sub",
      lastName: "Collection",
      status: "tryout",
    });
    await setDoc(doc(db, ...interestSignupPath("team-1", "il-doc-1")), {
      id: "il-doc-1",
      submittedAt: "2026-07-02T00:00:00.000Z",
      firstName: "Lead",
      lastName: "Doc",
    });
    // Per-entry portal submissions (Phase 1b) — one in each subcollection so
    // the member/anonymous read + update/delete scoping tests have an
    // existing doc to target.
    await setDoc(doc(db, ...playerInfoSubPath("team-1", "pi-doc-1")), {
      id: "pi-doc-1",
      submittedAt: "2026-07-03T00:00:00.000Z",
      firstName: "Sizing",
      lastName: "Doc",
      shirtSize: "YM",
    });
    await setDoc(doc(db, ...availabilitySubPath("team-1", "av-doc-1")), {
      id: "av-doc-1",
      submittedAt: "2026-07-04T00:00:00.000Z",
      firstName: "Away",
      lastName: "Doc",
      dates: ["2026-07-10"],
    });
    // Legacy unclaimed team (no ownerId, no coachRoles): the sole member's
    // auto-claim write must keep working under the new guards.
    await setDoc(doc(db, ...teamPath("team-legacy")), {
      name: "Legacy",
      members: [SOLO],
    });
    await setDoc(doc(db, ...mirrorPath("team-1")), {
      name: "Hawks",
      tryoutsOpen: true,
      tryoutShareId: "share-1",
      tryoutDateSlugs: [],
    });
    await setDoc(doc(db, ...invitePath("ABC234")), {
      teamId: "team-1",
      teamName: "Hawks",
      updatedAt: 1,
    });
  });
});

const dbFor = (uid?: string) =>
  uid
    ? testEnv.authenticatedContext(uid).firestore()
    : testEnv.unauthenticatedContext().firestore();

describe("private team doc reads", () => {
  it("denies a non-member reading the full team doc", async () => {
    await assertFails(getDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1"))));
  });

  it("allows a member to read the team doc", async () => {
    await assertSucceeds(getDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1"))));
  });

  it("does NOT expose the full team doc via a join code (no code-read rule)", async () => {
    // Regression: the old `allow read if joinCode != null` leaked the whole doc.
    await assertFails(getDoc(doc(dbFor(JOINER), ...teamPath("team-1"))));
  });

  // The orphaned-team recovery in App.tsx (restores a settings doc whose
  // teams list was clobbered) depends on this query being provable under the
  // member-read rule.
  it("allows a member to query teams by their own membership", async () => {
    const db = dbFor(ASSISTANT);
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "artifacts", APP_ID, "public", "data", "teams"),
          where("members", "array-contains", ASSISTANT),
        ),
      ),
    );
  });

  it("denies querying teams by someone ELSE's membership", async () => {
    const db = dbFor(OUTSIDER);
    await assertFails(
      getDocs(
        query(
          collection(db, "artifacts", APP_ID, "public", "data", "teams"),
          where("members", "array-contains", ASSISTANT),
        ),
      ),
    );
  });
});

describe("owner / assistant constraints", () => {
  it("denies an assistant changing ownerId", async () => {
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        ownerId: ASSISTANT,
      }),
    );
  });

  it("denies an assistant removing another member", async () => {
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        members: [ASSISTANT], // dropped the owner
      }),
    );
  });

  it("lets an assistant remove only themselves (leave team)", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        members: arrayRemove(ASSISTANT),
      }),
    );
  });

  it("lets the owner delete the team", async () => {
    await assertSucceeds(deleteDoc(doc(dbFor(OWNER), ...teamPath("team-1"))));
  });

  it("denies a non-owner deleting the team", async () => {
    await assertFails(deleteDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1"))));
  });

  it("lets the sole member of a legacy unclaimed team auto-claim it", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(SOLO), ...teamPath("team-legacy")), {
        ownerId: SOLO,
      }),
    );
  });
});

// docs/FINANCES-AUDIT.md finding 3.1: writes touching `finances` are
// head-coach-only (owner or a coachRoles-promoted 'head'). Reads cannot be
// field-gated on a single doc, so assistant READ access remains — accepted.
describe("finances head-gate", () => {
  const financesPatch = {
    finances: { clubFee: 750, payments: [] },
  };

  it("lets the owner rewrite finances", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), financesPatch),
    );
  });

  it("lets the owner write finances via setDoc merge (persistTeam shape)", async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(OWNER), ...teamPath("team-1")), financesPatch, {
        merge: true,
      }),
    );
  });

  it("lets a promoted co-head rewrite finances", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(COHEAD), ...teamPath("team-1")), financesPatch),
    );
  });

  it("lets a co-head append a payment via dotted-path arrayUnion", async () => {
    // The concurrency-safe write shape (updateFinances): only `finances`
    // lands in affectedKeys, exactly what the gate expects.
    await assertSucceeds(
      updateDoc(doc(dbFor(COHEAD), ...teamPath("team-1")), {
        "finances.payments": arrayUnion({
          id: "pay-2",
          playerId: "p2",
          date: "2026-03-02",
          amount: 100,
        }),
      }),
    );
  });

  it("denies an assistant rewriting finances", async () => {
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), financesPatch),
    );
  });

  it("denies an assistant dotted-path finances append", async () => {
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        "finances.expenses": arrayUnion({
          id: "exp-1",
          date: "2026-03-02",
          label: "Sneaky",
          amount: 1,
        }),
      }),
    );
  });

  it("denies an assistant bundling finances with an allowed field", async () => {
    // The whole write is denied — matching the client's optimistic-revert UX.
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        name: "Hawks Renamed",
        ...financesPatch,
      }),
    );
  });

  it("still lets an assistant write non-finance fields", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        name: "Hawks Renamed",
      }),
    );
  });
});

// The concurrency-safe team-array writes (updateTeamArrays) use bare-key
// dotted updateDoc paths — players/games/practices are deliberately
// member-writable, so these payload shapes must pass the base member-update
// rule for any member and stay closed to outsiders. (Eval rounds are NOT in
// this facade — they live per-doc in the evalRounds subcollection.)
describe("team-array granular writes (updateTeamArrays shapes)", () => {
  it("lets an assistant append a player via arrayUnion", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        players: arrayUnion({ id: "p-new", name: "Cai" }),
      }),
    );
  });

  it("lets an assistant remove a game via arrayRemove and rewrite games", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        games: arrayRemove({ id: "g-gone" }),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        practices: [{ id: "pr-1", date: "2026-07-02" }],
      }),
    );
  });

  it("lets a member merge a multi-array cascade in one updateDoc (remove-player shape)", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        players: arrayRemove({ id: "p1" }),
        games: [],
      }),
    );
  });

  it("denies an outsider the same append", async () => {
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        players: arrayUnion({ id: "p-evil", name: "Nope" }),
      }),
    );
  });

  it("still denies an assistant smuggling finances into an array write", async () => {
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        players: arrayUnion({ id: "p-new", name: "Cai" }),
        "finances.payments": arrayUnion({ id: "pay-x", amount: 1 }),
      }),
    );
  });

  // Tryout-season arrays: the anonymous portal append lanes are REMOVED (see
  // "public signup append constraints"), while members keep the full granular
  // shapes — append, exact-entry arrayRemove, and whole-array rewrite —
  // until each team's array is dropped.
  it("lets a member use the granular shapes on tryoutSignups", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        tryoutSignups: arrayUnion({ id: "ts-new", firstName: "Coach-added" }),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        tryoutSignups: arrayRemove({ id: "s1", firstName: "Existing" }),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        availabilitySubmissions: [],
      }),
    );
  });

  it("lets a member convert an interest lead in one updateDoc (append + arrayRemove)", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        tryoutSignups: arrayUnion({ id: "ts-conv", firstName: "Lead" }),
        interestSignups: arrayRemove({ id: "i1", firstName: "Lead" }),
      }),
    );
  });

  it("denies a non-member the coach-side tryout shapes (arrayRemove)", async () => {
    // With the public array lanes removed, NO non-member array shape gets
    // through — this pins the removal/rewrite case specifically.
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        tryoutSignups: arrayRemove({ id: "s1", firstName: "Existing" }),
      }),
    );
  });
});

// docs/eval-authz-design.md step 5 — the finding-3.1 close-out. Eval rounds
// live in the per-author evalRounds subcollection (next describe); the legacy
// `evaluationEvents` array is DROPPED from the team doc. The base rules now
// RATCHET the field: a straggler doc that still carries it may rewrite or
// remove it (schema-ladder migration, the head's deleteField drop), but once
// gone — or on a brand-new doc — no write may (re)create it, so scoped eval
// data can never land back on the shared, member-readable doc. This block
// replaces the old "pinned, not endorsed" exposure tests.
describe("evaluationEvents legacy-field ratchet (finding 3.1 close-out)", () => {
  it("a member may still rewrite the array while the doc carries it (schema-ladder migration)", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        evaluationEvents: [
          {
            id: "ev-head",
            date: "2026-06-01",
            coachRole: "Head",
            evaluatorId: OWNER,
            grades: { p1: { power: 5 } },
          },
        ],
      }),
    );
  });

  it("the head can drop the leftover field, and NOBODY can recreate it after", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        evaluationEvents: deleteField(),
      }),
    );
    // Once gone, recreation is denied for every member — assistant AND head.
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        evaluationEvents: [{ id: "ev-sneak", coachRole: "Assistant" }],
      }),
    );
    await assertFails(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        evaluationEvents: arrayUnion({ id: "ev-head-cannot-either" }),
      }),
    );
  });

  it("ordinary writes keep working on a doc without the legacy field", async () => {
    // The ratchet must not collaterally block post-drop team-doc writes.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        evaluationEvents: deleteField(),
      });
    });
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        players: arrayUnion({ id: "p-post-drop", name: "Cai" }),
      }),
    );
  });

  it("a new team doc cannot be born with the legacy field", async () => {
    await assertFails(
      setDoc(doc(dbFor(OWNER), ...teamPath("team-fresh")), {
        name: "Fresh",
        ownerId: OWNER,
        members: [OWNER],
        evaluationEvents: [],
      }),
    );
    await assertSucceeds(
      setDoc(doc(dbFor(OWNER), ...teamPath("team-fresh")), {
        name: "Fresh",
        ownerId: OWNER,
        members: [OWNER],
      }),
    );
  });

  it("an outsider still cannot touch the team doc at all", async () => {
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        evaluationEvents: arrayUnion({ id: "ev-evil" }),
      }),
    );
    await assertFails(getDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1"))));
  });
});

// Phase 1 close-out (docs/firestore-data-migration.md): the legacy
// `tryoutSignups` / `interestSignups` arrays get the same ratchet as
// evaluationEvents. While a team doc still carries an array, every MEMBER
// write keeps working — coach-side arrayRemove cleanup, a stale pre-#587
// client's `tryoutSignups: []` season overwrite, and the deleteField drop
// itself. (The deprecated PUBLIC append lanes are now REMOVED outright —
// see "public signup append constraints".) Once a team's array is dropped
// (the irreversible migration step), NO write may recreate the key: not the
// base member rule, not team creation.
describe("signup-array legacy-field ratchet (Phase 1 drop irreversibility)", () => {
  it("a member may still overwrite / clean the arrays while the doc carries them", async () => {
    // The stale pre-#587 advanceSeason shape: a merge patch carrying
    // `tryoutSignups: []` alongside the season fields. Allowed while the
    // array exists — a cached coach client keeps working until THIS team's
    // drop lands (and the drop is issued by the head's own up-to-date app).
    await assertSucceeds(
      setDoc(
        doc(dbFor(OWNER), ...teamPath("team-1")),
        { currentSeason: "Fall 2026", tryoutsOpen: false, tryoutSignups: [] },
        { merge: true },
      ),
    );
    // Exact-entry arrayRemove cleanup (removeLegacySignupEntries shape).
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        interestSignups: arrayRemove({ id: "i1", firstName: "Lead" }),
      }),
    );
  });

  it("the head can drop both arrays in one write, and NOBODY can recreate them after", async () => {
    // dropLegacySignupArrays shape — the one irreversible step.
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        tryoutSignups: deleteField(),
        interestSignups: deleteField(),
      }),
    );
    // The stale-client `[]` resurrection (merge and update shapes) is denied
    // for every member — assistant AND head.
    await assertFails(
      setDoc(
        doc(dbFor(OWNER), ...teamPath("team-1")),
        { tryoutSignups: [] },
        { merge: true },
      ),
    );
    await assertFails(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        interestSignups: [],
      }),
    );
    // A member arrayUnion append can't recreate it either (the base-rule
    // ratchet).
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        tryoutSignups: arrayUnion({ id: "ts-sneak", firstName: "Nope" }),
      }),
    );
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        interestSignups: arrayUnion({ id: "il-sneak", firstName: "Nope" }),
      }),
    );
    // Nor can a cached anonymous portal client (whose lane no longer exists).
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        tryoutSignups: arrayUnion({ id: "s2", firstName: "New" }),
      }),
    );
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        interestSignups: arrayUnion({ id: "i2", firstName: "New" }),
      }),
    );
  });

  it("the single-key season-advance drop works and leaves the interest ARRAY alone", async () => {
    // dropLegacySignupArray("tryoutSignups") — season advance clears the
    // tryout array only; standing interest leads survive the rollover.
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        tryoutSignups: deleteField(),
      }),
    );
    // Interest array still exists → MEMBER cleanup shapes still work on it.
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        interestSignups: arrayRemove({ id: "i1", firstName: "Lead" }),
      }),
    );
    // But the public append lane is REMOVED — denied whether the array
    // survives (interest) or was dropped (tryout, even while tryoutsOpen).
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        interestSignups: arrayUnion({ id: "i2", firstName: "New" }),
      }),
    );
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        tryoutSignups: arrayUnion({ id: "s2", firstName: "New" }),
      }),
    );
  });

  it("ordinary writes keep working on a doc without the arrays", async () => {
    // The ratchet must not collaterally block post-drop team-doc writes —
    // request.resource.data is the POST-write doc, so a write that never
    // touches the dropped keys doesn't carry them either.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        tryoutSignups: deleteField(),
        interestSignups: deleteField(),
      });
    });
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        players: arrayUnion({ id: "p-post-drop", name: "Cai" }),
      }),
    );
    await assertSucceeds(
      setDoc(
        doc(dbFor(OWNER), ...teamPath("team-1")),
        { tryoutsOpen: false },
        { merge: true },
      ),
    );
  });

  it("a new team doc cannot be born with the arrays — and the REAL createTeam payload passes", async () => {
    await assertFails(
      setDoc(doc(dbFor(OWNER), ...teamPath("team-fresh")), {
        name: "Fresh",
        ownerId: OWNER,
        members: [OWNER],
        tryoutSignups: [],
      }),
    );
    await assertFails(
      setDoc(doc(dbFor(OWNER), ...teamPath("team-fresh")), {
        name: "Fresh",
        ownerId: OWNER,
        members: [OWNER],
        interestSignups: [],
      }),
    );
    // The exact shape createTeam writes (useTeamLifecycle): NEW_TEAM_DOC
    // (which seeds NONE of the ratcheted legacy fields) + league choice,
    // name, ownerId, members.
    await assertSucceeds(
      setDoc(doc(dbFor(OWNER), ...teamPath("team-fresh")), {
        ...NEW_TEAM_DOC,
        leagueRuleSet: "USSSA",
        name: "Fresh",
        ownerId: OWNER,
        members: [OWNER],
      }),
    );
  });

  it("the evaluationEvents ratchet is untouched by the new clauses", async () => {
    // Belt-and-braces regression for the neighbouring ratchet: rewrite while
    // present still works, recreation after a drop is still denied.
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        evaluationEvents: [],
      }),
    );
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        evaluationEvents: deleteField(),
      }),
    );
    await assertFails(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        evaluationEvents: [],
      }),
    );
  });
});

// Phase 1b: the same ratchet, extended to the last two portal-written arrays.
// With the deprecated PUBLIC append lanes now REMOVED (the Phase 1b exit,
// after their one compatibility release), the ratchet is total: member
// cleanup shapes still work while a doc carries an array, and once dropped
// NOBODY — member, head, or cached portal client — can recreate it.
describe("submission-array legacy-field ratchet (Phase 1b)", () => {
  it("member cleanup shapes still work while the doc carries the arrays", async () => {
    // Exact-entry arrayRemove (removeLegacySignupEntries shape).
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        playerInfoSubmissions: arrayRemove({ id: "pi0", firstName: "Old" }),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        availabilitySubmissions: arrayRemove({ id: "av0", firstName: "Old" }),
      }),
    );
  });

  it("the head can drop ALL FOUR arrays in one write, and no member recreates the new pair", async () => {
    // dropLegacySignupArrays' Phase 1b shape.
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        tryoutSignups: deleteField(),
        interestSignups: deleteField(),
        playerInfoSubmissions: deleteField(),
        availabilitySubmissions: deleteField(),
      }),
    );
    // A stale coach bundle's whole-array rewrite (the old apply/dedupe
    // shapes) must fail LOUDLY rather than resurrect the field.
    await assertFails(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        playerInfoSubmissions: [],
      }),
    );
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        availabilitySubmissions: [{ id: "av-sneak" }, { id: "av-sneak-2" }],
      }),
    );
    // Under the deprecated lane a single-entry append could still recreate a
    // dropped field (any one-entry array IS a first append on an absent key).
    // With the lane REMOVED, even that shape is denied — the drop is
    // genuinely irreversible from every caller.
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        availabilitySubmissions: arrayUnion({ id: "av-lane" }),
      }),
    );
  });

  it("DENIES a cached portal client's append post-drop — the self-healing window is closed", async () => {
    // During the lanes' one compatibility release an anonymous arrayUnion
    // could recreate a dropped field (self-healing: union surfaces it,
    // backfill mirrors it, head re-drops). The lanes are now gone, so the
    // former allow expectations flip to DENIED — the straggler's submit
    // catch shows its retry-or-contact-the-coach error instead.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        playerInfoSubmissions: deleteField(),
        availabilitySubmissions: deleteField(),
      });
    });
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        playerInfoSubmissions: arrayUnion({ id: "pi-cached", firstName: "N" }),
      }),
    );
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        availabilitySubmissions: arrayUnion({ id: "av-cached", dates: [] }),
      }),
    );
  });

  it("a new team doc cannot be born with the submission arrays", async () => {
    await assertFails(
      setDoc(doc(dbFor(OWNER), ...teamPath("team-fresh")), {
        name: "Fresh",
        ownerId: OWNER,
        members: [OWNER],
        playerInfoSubmissions: [],
      }),
    );
    await assertFails(
      setDoc(doc(dbFor(OWNER), ...teamPath("team-fresh")), {
        name: "Fresh",
        ownerId: OWNER,
        members: [OWNER],
        availabilitySubmissions: [],
      }),
    );
  });
});

// docs/eval-authz-design.md, Option A — the REAL fix for finding 3.1. Rounds
// move off the shared `evaluationEvents` array into per-author documents so
// reads AND writes are authorization-scoped: a head coach manages every round,
// an assistant only their own. These tests prove the scoping the array can't
// express (contrast the "pinned, not endorsed" block above). Rules-only step —
// no client writes here yet.
const roundsCol = (uid: string) =>
  collection(
    dbFor(uid),
    "artifacts",
    APP_ID,
    "public",
    "data",
    "teams",
    "team-1",
    "evalRounds",
  );

describe("evalRounds subcollection scoping (audit finding 3.1 — Option A)", () => {
  it("lets a head coach (owner) read any author's round", async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(OWNER), ...evalRoundPath("team-1", "round-asst"))),
    );
  });

  it("lets a promoted co-head read any author's round", async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(COHEAD), ...evalRoundPath("team-1", "round-asst"))),
    );
  });

  it("lets an assistant read their OWN round", async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-asst"))),
    );
  });

  it("DENIES an assistant reading the head's private round (the core fix)", async () => {
    await assertFails(
      getDoc(doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-head"))),
    );
  });

  it("denies an outsider reading any round", async () => {
    await assertFails(
      getDoc(doc(dbFor(OUTSIDER), ...evalRoundPath("team-1", "round-head"))),
    );
  });

  it("lets an assistant create a round stamped with their own uid", async () => {
    await assertSucceeds(
      setDoc(
        doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-asst-2")),
        {
          evaluatorId: ASSISTANT,
          coachRole: "Assistant",
          grades: {},
        },
      ),
    );
  });

  it("denies planting a round under someone else's uid", async () => {
    await assertFails(
      setDoc(doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-spoof")), {
        evaluatorId: OWNER,
        coachRole: "Head",
        grades: {},
      }),
    );
  });

  it("denies an outsider creating a round", async () => {
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...evalRoundPath("team-1", "round-evil")), {
        evaluatorId: OUTSIDER,
        grades: {},
      }),
    );
  });

  it("lets an assistant update their own round", async () => {
    await assertSucceeds(
      updateDoc(
        doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-asst")),
        {
          grades: { p1: { contact: 4 } },
        },
      ),
    );
  });

  it("DENIES an assistant rewriting the head's round (no more clobbering)", async () => {
    await assertFails(
      updateDoc(
        doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-head")),
        {
          grades: { p1: { contact: 1 } },
        },
      ),
    );
  });

  it("denies reassigning a round to a different author (evaluatorId immutable)", async () => {
    await assertFails(
      updateDoc(
        doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-asst")),
        {
          evaluatorId: OWNER,
        },
      ),
    );
  });

  it("lets the head update AND delete an assistant's round", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...evalRoundPath("team-1", "round-asst")), {
        grades: { p1: { contact: 2 } },
      }),
    );
    await assertSucceeds(
      deleteDoc(doc(dbFor(COHEAD), ...evalRoundPath("team-1", "round-asst"))),
    );
  });

  it("lets an assistant delete their own round but not the head's", async () => {
    await assertFails(
      deleteDoc(
        doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-head")),
      ),
    );
    await assertSucceeds(
      deleteDoc(
        doc(dbFor(ASSISTANT), ...evalRoundPath("team-1", "round-asst")),
      ),
    );
  });

  it("scopes list queries: head lists all, assistant only a self-filtered query", async () => {
    await assertSucceeds(getDocs(query(roundsCol(OWNER))));
    // An assistant cannot list the whole collection (would expose head rounds).
    await assertFails(getDocs(query(roundsCol(ASSISTANT))));
    // But a `where evaluatorId == me` query is provable and allowed.
    await assertSucceeds(
      getDocs(
        query(roundsCol(ASSISTANT), where("evaluatorId", "==", ASSISTANT)),
      ),
    );
  });
});

// Phase 1 of docs/firestore-data-migration.md — public signups move off the
// 1 MiB team doc into per-entry subcollection docs, mirroring the evalRounds
// shape above (get()-based membership). READ/UPDATE/DELETE are member-only;
// CREATE stays open to any signed-in caller (anonymous portal auth) under the
// same team-state gates the removed array lanes used, plus a payload
// allowlist + size caps. These subcollections are now the ONLY public write
// path — the deprecated array-append lanes were removed after their one
// compatibility release (see "public signup append constraints").
const signupsCol = (
  uid: string | undefined,
  key: "tryoutSignups" | "interestSignups",
) =>
  collection(
    dbFor(uid),
    "artifacts",
    APP_ID,
    "public",
    "data",
    "teams",
    "team-1",
    key,
  );

// The exact payload TryoutsPortal submits for an interest lead (booleans for
// the pitch/catch flags, positions as a short list); a tryout signup is the
// same plus `status` and a pinned date.
const portalLead = {
  id: AUTO_ID_2,
  submittedAt: "2026-07-20T12:00:00.000Z",
  firstName: "Nia",
  lastName: "Vasquez",
  dob: "2015-04-01",
  parentName: "Pat Vasquez",
  email: "pat@example.com",
  phone: "555-0100",
  currentTeam: "Rockets",
  number: "12",
  bats: "R",
  throws: "R",
  primaryPosition: "SS",
  secondaryPosition: "P",
  comfortablePositions: ["SS", "P"],
  canPitch: true,
  canCatch: false,
  isCatcher: false,
  tryoutDate: "",
  notes: "Excited to try out",
};
const portalTryoutSignup = {
  ...portalLead,
  id: AUTO_ID,
  status: "tryout",
  tryoutDate: "2026-08-01",
};

describe("signup subcollections (Phase 1 — per-entry docs)", () => {
  it("lets an anonymous visitor create a valid tryout signup while tryouts are open", async () => {
    await assertSucceeds(
      setDoc(
        doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)),
        portalTryoutSignup,
      ),
    );
  });

  it("denies a tryout signup create once tryouts are closed", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        tryoutsOpen: false,
      });
    });
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)),
        portalTryoutSignup,
      ),
    );
  });

  it("lets an anonymous visitor create a valid interest lead while a share link exists", async () => {
    await assertSucceeds(
      setDoc(
        doc(dbFor(OUTSIDER), ...interestSignupPath("team-1", AUTO_ID_2)),
        portalLead,
      ),
    );
  });

  it("denies an interest lead when no share link exists", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        tryoutShareId: null,
      });
    });
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...interestSignupPath("team-1", AUTO_ID_2)),
        portalLead,
      ),
    );
  });

  it("denies a public create smuggling an off-allowlist field", async () => {
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)), {
        ...portalTryoutSignup,
        coachNotes: "planted",
      }),
    );
    // `status` is coach-assigned on leads (set at conversion) — off-allowlist
    // for the public interest lane even though the tryout lane accepts it.
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...interestSignupPath("team-1", AUTO_ID_2)), {
        ...portalLead,
        status: "tryout",
      }),
    );
  });

  it("denies a public create with an oversized field", async () => {
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)), {
        ...portalTryoutSignup,
        notes: "x".repeat(601),
      }),
    );
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)), {
        ...portalTryoutSignup,
        comfortablePositions: Array.from({ length: 13 }, (_, i) => `P${i}`),
      }),
    );
  });

  it("denies a public create at a short legacy-style id (shadowing guard)", async () => {
    // The attack this closes: plant a doc at a KNOWN legacy genId, and the
    // union (subcollection wins), the skip-existing backfill, and the
    // head-only array drop chain together into permanent replacement of a
    // real family's signup. Auto-id length is the floor.
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", "ts-abc123")), {
        ...portalTryoutSignup,
        id: "ts-abc123",
      }),
    );
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...interestSignupPath("team-1", "int-abc123")),
        { ...portalLead, id: "int-abc123" },
      ),
    );
    // A member (the lazy backfill) MUST still be able to write short legacy
    // ids — that is how existing array entries migrate without re-minting.
    await assertSucceeds(
      setDoc(doc(dbFor(OWNER), ...tryoutSignupPath("team-1", "ts-abc123")), {
        ...portalTryoutSignup,
        id: "ts-abc123",
      }),
    );
  });

  it("denies a public create whose in-data id disagrees with the doc id", async () => {
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)), {
        ...portalTryoutSignup,
        id: "ts-somethingelse",
      }),
    );
  });

  it("denies a public tryout create declaring a curated status", async () => {
    // status drives roster projection and the advance-season deposit filters,
    // so it must not be self-declarable.
    for (const status of ["accepted", "offered", "declined"]) {
      await assertFails(
        setDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)), {
          ...portalTryoutSignup,
          status,
        }),
      );
    }
  });

  it("denies comfortablePositions entries outside the declared positions", async () => {
    // Elements are otherwise unbounded — a single one could be ~1 MiB or a
    // nested map, voiding the payload envelope and feeding non-strings to
    // coach code that assumes position codes.
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)), {
        ...portalTryoutSignup,
        comfortablePositions: ["SS", "x".repeat(5000)],
      }),
    );
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", AUTO_ID)), {
        ...portalTryoutSignup,
        comfortablePositions: [{ nested: "map" }],
      }),
    );
  });

  it("denies an unauthenticated create (the portal signs in anonymously first)", async () => {
    await assertFails(
      setDoc(
        doc(dbFor(), ...tryoutSignupPath("team-1", AUTO_ID)),
        portalTryoutSignup,
      ),
    );
  });

  it("denies a public visitor updating or deleting an existing signup doc", async () => {
    await assertFails(
      updateDoc(
        doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", "ts-doc-1")),
        {
          notes: "defaced",
        },
      ),
    );
    await assertFails(
      deleteDoc(
        doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", "ts-doc-1")),
      ),
    );
    await assertFails(
      deleteDoc(
        doc(dbFor(OUTSIDER), ...interestSignupPath("team-1", "il-doc-1")),
      ),
    );
  });

  it("denies anonymous read and list of signups (family PII is member-only)", async () => {
    await assertFails(
      getDoc(doc(dbFor(OUTSIDER), ...tryoutSignupPath("team-1", "ts-doc-1"))),
    );
    await assertFails(getDocs(query(signupsCol(OUTSIDER, "tryoutSignups"))));
    await assertFails(getDocs(query(signupsCol(undefined, "interestSignups"))));
  });

  it("lets a member read and list signups", async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(ASSISTANT), ...tryoutSignupPath("team-1", "ts-doc-1"))),
    );
    await assertSucceeds(
      getDocs(query(signupsCol(ASSISTANT, "tryoutSignups"))),
    );
    await assertSucceeds(
      getDocs(query(signupsCol(ASSISTANT, "interestSignups"))),
    );
  });

  it("lets a member update and delete a signup (coach curation)", async () => {
    await assertSucceeds(
      updateDoc(
        doc(dbFor(ASSISTANT), ...tryoutSignupPath("team-1", "ts-doc-1")),
        { status: "accepted" },
      ),
    );
    await assertSucceeds(
      deleteDoc(
        doc(dbFor(ASSISTANT), ...interestSignupPath("team-1", "il-doc-1")),
      ),
    );
  });

  it("lets a member create outside the portal shape (backfill copies legacy entries verbatim)", async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(OWNER), ...tryoutSignupPath("team-1", "ts-legacy")), {
        id: "ts-legacy",
        firstName: "Legacy",
        // Off-allowlist key a legacy array entry might carry — the member
        // lane must not be constrained by the portal allowlist.
        convertedFrom: "il-old",
      }),
    );
  });
});

// Phase 1b of docs/firestore-data-migration.md — the last two public-write
// lanes move to per-entry docs, mirroring the tryout/interest subcollections
// above: member-only READ/UPDATE/DELETE, public CREATE under the standing
// share-link gate + allowlist + caps + the auto-id length floor.
const submissionsCol = (
  uid: string | undefined,
  key: "playerInfoSubmissions" | "availabilitySubmissions",
) =>
  collection(
    dbFor(uid),
    "artifacts",
    APP_ID,
    "public",
    "data",
    "teams",
    "team-1",
    key,
  );

const portalPlayerInfo = {
  id: AUTO_ID,
  submittedAt: "2026-07-20T12:00:00.000Z",
  firstName: "Nia",
  lastName: "Vasquez",
  dob: "2015-04-01",
  number: "12",
  hatSize: "MED-LG",
  shirtSize: "YL",
  pantsSize: "YL",
  height: `4'8"`,
  weight: "85 lbs",
  school: "Jefferson Elementary",
  grade: "5th",
  parentName: "Pat Vasquez",
  email: "pat@example.com",
  phone: "555-0100",
  parent2Name: "Sam Vasquez",
  parent2Phone: "555-0101",
  parent2Email: "sam@example.com",
  notes: "Allergic to bees",
};
const portalAvailability = {
  id: AUTO_ID_2,
  submittedAt: "2026-07-21T12:00:00.000Z",
  firstName: "Nia",
  lastName: "Vasquez",
  dob: "2015-04-01",
  parentName: "Pat Vasquez",
  email: "pat@example.com",
  phone: "555-0100",
  dates: ["2026-08-01", "2026-08-02"],
  blocks: [{ date: "2026-08-01", startTime: "09:00", reason: "camp" }],
};

describe("portal submission subcollections (Phase 1b — per-entry docs)", () => {
  it("lets an anonymous visitor create a valid player-info submission while a share link exists", async () => {
    await assertSucceeds(
      setDoc(
        doc(dbFor(OUTSIDER), ...playerInfoSubPath("team-1", AUTO_ID)),
        portalPlayerInfo,
      ),
    );
  });

  it("lets an anonymous visitor create a valid availability submission while a share link exists", async () => {
    await assertSucceeds(
      setDoc(
        doc(dbFor(OUTSIDER), ...availabilitySubPath("team-1", AUTO_ID_2)),
        portalAvailability,
      ),
    );
  });

  it("denies both public creates when no share link exists", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        tryoutShareId: null,
      });
    });
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...playerInfoSubPath("team-1", AUTO_ID)),
        portalPlayerInfo,
      ),
    );
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...availabilitySubPath("team-1", AUTO_ID_2)),
        portalAvailability,
      ),
    );
  });

  it("denies a public create declaring the coach-only applied stamp", async () => {
    // appliedToPlayerId/appliedAt mark a submission as handled — a
    // self-declared stamp would hide a hostile submission from the inbox.
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...playerInfoSubPath("team-1", AUTO_ID)), {
        ...portalPlayerInfo,
        appliedToPlayerId: "p1",
      }),
    );
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...availabilitySubPath("team-1", AUTO_ID_2)),
        { ...portalAvailability, appliedAt: "2026-07-21T13:00:00.000Z" },
      ),
    );
  });

  it("denies a public create with an oversized field", async () => {
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...playerInfoSubPath("team-1", AUTO_ID)), {
        ...portalPlayerInfo,
        notes: "x".repeat(601),
      }),
    );
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...availabilitySubPath("team-1", AUTO_ID_2)),
        { ...portalAvailability, firstName: "x".repeat(61) },
      ),
    );
  });

  it("bounds the availability date/block lists (and rejects non-list shapes)", async () => {
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...availabilitySubPath("team-1", AUTO_ID_2)),
        {
          ...portalAvailability,
          dates: Array.from({ length: 401 }, (_, i) => `d${i}`),
        },
      ),
    );
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...availabilitySubPath("team-1", AUTO_ID_2)),
        { ...portalAvailability, blocks: "not-a-list" },
      ),
    );
  });

  it("denies a public create at a short legacy-style id (shadowing guard), member allowed", async () => {
    // Same attack the tryout lane closes: plant a doc at a known legacy genId
    // ("pi-xxxxxxxx" / "av-xxxxxxxx") and the union + skip-existing backfill +
    // head-only drop chain into permanently replacing a family's entry.
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...playerInfoSubPath("team-1", "pi-abc123")),
        { ...portalPlayerInfo, id: "pi-abc123" },
      ),
    );
    // The lazy backfill (a member) must still mirror short legacy ids.
    await assertSucceeds(
      setDoc(doc(dbFor(OWNER), ...playerInfoSubPath("team-1", "pi-abc123")), {
        ...portalPlayerInfo,
        id: "pi-abc123",
        // ...even carrying legacy-only keys the portal shape never sends.
        emergencyName: "Grandma",
      }),
    );
  });

  it("denies a public create whose in-data id disagrees with the doc id", async () => {
    await assertFails(
      setDoc(
        doc(dbFor(OUTSIDER), ...availabilitySubPath("team-1", AUTO_ID_2)),
        { ...portalAvailability, id: "av-somethingelse" },
      ),
    );
  });

  it("denies an unauthenticated create (the portals sign in anonymously first)", async () => {
    await assertFails(
      setDoc(
        doc(dbFor(), ...playerInfoSubPath("team-1", AUTO_ID)),
        portalPlayerInfo,
      ),
    );
  });

  it("denies a public visitor reading, updating or deleting an existing submission", async () => {
    await assertFails(
      getDoc(doc(dbFor(OUTSIDER), ...playerInfoSubPath("team-1", "pi-doc-1"))),
    );
    await assertFails(
      updateDoc(
        doc(dbFor(OUTSIDER), ...playerInfoSubPath("team-1", "pi-doc-1")),
        { notes: "defaced" },
      ),
    );
    await assertFails(
      deleteDoc(
        doc(dbFor(OUTSIDER), ...availabilitySubPath("team-1", "av-doc-1")),
      ),
    );
  });

  it("lets a member read, list, update and delete submissions (coach curation)", async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(ASSISTANT), ...playerInfoSubPath("team-1", "pi-doc-1"))),
    );
    await assertSucceeds(
      getDocs(query(submissionsCol(ASSISTANT, "playerInfoSubmissions"))),
    );
    await assertSucceeds(
      getDocs(query(submissionsCol(ASSISTANT, "availabilitySubmissions"))),
    );
    await assertSucceeds(
      updateDoc(
        doc(dbFor(ASSISTANT), ...playerInfoSubPath("team-1", "pi-doc-1")),
        { appliedToPlayerId: "p1", appliedAt: "2026-07-21T13:00:00.000Z" },
      ),
    );
    await assertSucceeds(
      deleteDoc(
        doc(dbFor(ASSISTANT), ...availabilitySubPath("team-1", "av-doc-1")),
      ),
    );
  });
});

// Prerequisites for the finances gate: without these, a member self-promotes
// to 'head' and sails through it.
describe("coachRoles escalation", () => {
  it("denies an assistant self-promoting via a plain coachRoles write", async () => {
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        [`coachRoles.${ASSISTANT}`]: "head",
      }),
    );
  });

  it("denies an assistant self-promoting through the self-join clause shape", async () => {
    // Touches only members+coachRoles (own entry) like a join write would —
    // the tightened coachRolesSelfJoinValid must reject 'head'.
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        members: arrayUnion(ASSISTANT),
        [`coachRoles.${ASSISTANT}`]: "head",
      }),
    );
  });

  it("lets the owner promote a member to head", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OWNER), ...teamPath("team-1")), {
        [`coachRoles.${ASSISTANT}`]: "head",
      }),
    );
  });

  it("lets a co-head change roles (mirrors SettingsTab access)", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(COHEAD), ...teamPath("team-1")), {
        [`coachRoles.${ASSISTANT}`]: "head",
      }),
    );
  });

  it("denies an assistant changing another member's role", async () => {
    await assertFails(
      updateDoc(doc(dbFor(ASSISTANT), ...teamPath("team-1")), {
        [`coachRoles.${COHEAD}`]: "assistant",
      }),
    );
  });
});

describe("sanitized invite lookup + self-join", () => {
  it("lets any signed-in user read the sanitized invite (only safe fields)", async () => {
    await assertSucceeds(getDoc(doc(dbFor(JOINER), ...invitePath("ABC234"))));
  });

  it("lets a code-holder add ONLY themselves as an assistant", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(JOINER), ...teamPath("team-1")), {
        members: arrayUnion(JOINER),
        [`coachRoles.${JOINER}`]: "assistant",
      }),
    );
  });

  it("denies a self-join that grants a bogus role", async () => {
    await assertFails(
      updateDoc(doc(dbFor(JOINER), ...teamPath("team-1")), {
        members: arrayUnion(JOINER),
        [`coachRoles.${JOINER}`]: "superadmin",
      }),
    );
  });

  it("denies a self-join that grants 'head' (promotion is a head's act)", async () => {
    await assertFails(
      updateDoc(doc(dbFor(JOINER), ...teamPath("team-1")), {
        members: arrayUnion(JOINER),
        [`coachRoles.${JOINER}`]: "head",
      }),
    );
  });

  it("denies a self-join smuggling a second uid into members", async () => {
    await assertFails(
      updateDoc(doc(dbFor(JOINER), ...teamPath("team-1")), {
        members: arrayUnion(JOINER, "someone-else"),
        [`coachRoles.${JOINER}`]: "assistant",
      }),
    );
  });

  it("denies a self-join that also touches another user's role", async () => {
    await assertFails(
      updateDoc(doc(dbFor(JOINER), ...teamPath("team-1")), {
        members: arrayUnion(JOINER),
        [`coachRoles.${JOINER}`]: "assistant",
        [`coachRoles.${ASSISTANT}`]: "head",
      }),
    );
  });

  it("denies adding a DIFFERENT user via the self-join path", async () => {
    await assertFails(
      updateDoc(doc(dbFor(JOINER), ...teamPath("team-1")), {
        members: arrayUnion("someone-else"),
        ["coachRoles.someone-else"]: "assistant",
      }),
    );
  });

  it("lets a team member create/rotate an invite doc for their team", async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(OWNER), ...invitePath("NEW999")), {
        teamId: "team-1",
        teamName: "Hawks",
        updatedAt: 2,
      }),
    );
  });

  it("denies a non-member creating an invite doc pointing at the team", async () => {
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...invitePath("EVIL11")), {
        teamId: "team-1",
        teamName: "Hawks",
        updatedAt: 2,
      }),
    );
  });
});

// EVERY deprecated array-append lane is now REMOVED — tryoutSignups /
// interestSignups at the Phase 1 exit, playerInfoSubmissions /
// availabilitySubmissions at the Phase 1b exit, each after its one
// compatibility release. A cached portal client's arrayUnion is DENIED even
// in the friendliest possible state — tryouts open / share link standing,
// array still on the doc, perfectly-shaped single append.
describe("public signup append constraints", () => {
  it("DENIES the removed tryout array lane — a well-formed single append while tryouts are open", async () => {
    // Exactly the write the old lane allowed; the flip of the former
    // "allows appending exactly one tryout signup while open" expectation.
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        tryoutSignups: arrayUnion({ id: "s2", firstName: "New" }),
      }),
    );
  });

  it("DENIES the removed interest array lane — a well-formed single append with a standing share link", async () => {
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        interestSignups: arrayUnion({ id: "i2", firstName: "New" }),
      }),
    );
  });

  it("DENIES the removed player-info array lane — a well-formed single append with a standing share link", async () => {
    // The flip of the former "allows appending exactly one player-info
    // submission" expectation (the Phase 1b exit).
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        playerInfoSubmissions: arrayUnion({ id: "pi1", firstName: "New" }),
      }),
    );
  });

  it("DENIES the removed availability array lane — a well-formed single append with a standing share link", async () => {
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        availabilitySubmissions: arrayUnion({ id: "av1", firstName: "New" }),
      }),
    );
  });

  it("denies removing/replacing existing signups", async () => {
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        tryoutSignups: [{ id: "s2", firstName: "Replaced" }],
      }),
    );
  });

  it("denies appending more than one signup in a single write", async () => {
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        tryoutSignups: [
          { id: "s1", firstName: "Existing" },
          { id: "s2", firstName: "New" },
          { id: "s3", firstName: "Also new" },
        ],
      }),
    );
  });

  it("denies tryout signups when tryouts are closed", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        tryoutsOpen: false,
      });
    });
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        tryoutSignups: arrayUnion({ id: "s2", firstName: "New" }),
      }),
    );
  });

  it("denies a public writer touching any other field", async () => {
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        name: "Hacked",
        tryoutSignups: arrayUnion({ id: "s2" }),
      }),
    );
  });
});

describe("user settings docs", () => {
  // The per-user selector doc (which teams I'm in / which is active) is
  // uid-scoped: only the owning uid may read or write it.
  it("lets a user write their own settings doc", async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(OWNER), ...settingsPath(OWNER)), {
        teams: [{ id: "team-1", name: "Hawks" }],
        activeTeamId: "team-1",
      }),
    );
  });

  it("lets a user read their own settings doc", async () => {
    await assertSucceeds(getDoc(doc(dbFor(OWNER), ...settingsPath(OWNER))));
  });

  it("denies reading another user's settings doc", async () => {
    await assertFails(getDoc(doc(dbFor(OUTSIDER), ...settingsPath(OWNER))));
  });

  it("denies writing another user's settings doc", async () => {
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...settingsPath(OWNER)), {
        activeTeamId: "hijacked",
      }),
    );
  });

  it("denies an unauthenticated caller reading a settings doc", async () => {
    await assertFails(getDoc(doc(dbFor(), ...settingsPath(OWNER))));
  });
});

describe("public mirror", () => {
  it("lets an anonymous visitor read the mirror but NOT the team doc", async () => {
    const anon = dbFor(); // unauthenticated still fails (rules require auth)
    await assertFails(getDoc(doc(anon, ...mirrorPath("team-1"))));
    // Anonymous-auth visitors (signed in) may read the mirror.
    await assertSucceeds(getDoc(doc(dbFor(JOINER), ...mirrorPath("team-1"))));
    // ...but never the private team doc.
    await assertFails(getDoc(doc(dbFor(JOINER), ...teamPath("team-1"))));
  });

  it("denies a non-member writing the mirror", async () => {
    await assertFails(
      setDoc(doc(dbFor(OUTSIDER), ...mirrorPath("team-1")), { name: "X" }),
    );
  });

  it("lets a member write the mirror", async () => {
    await assertSucceeds(
      setDoc(
        doc(dbFor(OWNER), ...mirrorPath("team-1")),
        { name: "Hawks 2" },
        { merge: true },
      ),
    );
  });
});
