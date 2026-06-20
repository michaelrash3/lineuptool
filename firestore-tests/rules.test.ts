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
const OUTSIDER = "outsider-uid";
const JOINER = "joiner-uid";

let testEnv: RulesTestEnvironment;

const teamPath = (teamId: string) =>
  ["artifacts", APP_ID, "public", "data", "teams", teamId] as const;
const mirrorPath = (teamId: string) =>
  ["artifacts", APP_ID, "public", "data", "teamPublic", teamId] as const;
const invitePath = (code: string) =>
  ["artifacts", APP_ID, "public", "data", "teamInvites", code] as const;

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
      members: [OWNER, ASSISTANT],
      coachRoles: { [OWNER]: "head", [ASSISTANT]: "assistant" },
      joinCode: "ABC234",
      tryoutsOpen: true,
      tryoutShareId: "share-1",
      tryoutSignups: [{ id: "s1", firstName: "Existing" }],
      interestSignups: [{ id: "i1", firstName: "Lead" }],
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
