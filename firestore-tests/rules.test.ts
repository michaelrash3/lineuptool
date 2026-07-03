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
      finances: {
        clubFee: 500,
        payments: [
          { id: "pay-1", playerId: "p1", date: "2026-03-01", amount: 250 },
        ],
      },
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
