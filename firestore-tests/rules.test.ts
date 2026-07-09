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

  // Tryout-season arrays: the anonymous portal lanes stay append-only (see
  // "public signup append constraints"), while members get the full granular
  // shapes — append, exact-entry arrayRemove, and whole-array rewrite.
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
    // A single arrayUnion append can legitimately ride the public lane while
    // tryouts are open — removal/rewrite must not.
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

describe("public signup append constraints", () => {
  it("allows appending exactly one tryout signup while open", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        tryoutSignups: arrayUnion({ id: "s2", firstName: "New" }),
      }),
    );
  });

  it("allows appending exactly one interest lead", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        interestSignups: arrayUnion({ id: "i2", firstName: "New" }),
      }),
    );
  });

  it("allows appending exactly one player-info submission", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        playerInfoSubmissions: arrayUnion({ id: "pi1", firstName: "New" }),
      }),
    );
  });

  it("denies player-info writes when no share link exists", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        tryoutShareId: null,
      });
    });
    await assertFails(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        playerInfoSubmissions: arrayUnion({ id: "pi1", firstName: "New" }),
      }),
    );
  });

  it("allows appending exactly one availability submission", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(OUTSIDER), ...teamPath("team-1")), {
        availabilitySubmissions: arrayUnion({ id: "av1", firstName: "New" }),
      }),
    );
  });

  it("denies availability writes when no share link exists", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ...teamPath("team-1")), {
        tryoutShareId: null,
      });
    });
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
