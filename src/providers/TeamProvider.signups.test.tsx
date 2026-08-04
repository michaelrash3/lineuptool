import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Provider-level coverage for the signup read/write wiring (Phase 1 of
// docs/firestore-data-migration.md). The union, the lazy backfill and the
// irreversible legacy-array drop live in TeamProvider effects fed by three
// Firestore listeners whose interleaving IS the behavior under test, so the
// only way to reach them is to mount the real provider and hand it snapshots.
// Everything the provider reaches through utils/tryoutSignupDocs
// (assembleSignups, allLegacyMigrated, backfillSignupDocs,
// dropLegacySignupArrays) stays REAL — only the Firestore transport is faked.

vi.mock("../firebase", () => ({ auth: {}, db: {}, appId: "test-app" }));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "u1" });
    return () => {};
  },
  getRedirectResult: () => Promise.resolve(null),
  isSignInWithEmailLink: () => false,
  signInWithEmailLink: vi.fn(),
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  sendSignInLinkToEmail: vi.fn(),
  GoogleAuthProvider: class {},
  setPersistence: () => Promise.resolve(),
  browserLocalPersistence: {},
  getAuth: () => ({}),
}));

vi.mock("firebase/firestore", () => {
  // Every live listener, tagged with the path it subscribed to. The tests
  // deliver snapshots by path (see emitDoc/emitCollection), so a listener that
  // failed to unsubscribe on a team switch would show up as the previous
  // team's data leaking into the next assertion.
  // `options` is recorded, not shrugged off: includeMetadataChanges is the
  // only reason the cache→server transition is ever delivered, so a mock that
  // accepted either call shape indiscriminately made that option structurally
  // untestable (see "subscribes to both signup lanes with
  // includeMetadataChanges" below).
  // The ERROR callback is kept alongside `next` for the same reason `options`
  // is: a listener whose error arm is never delivered to is a listener whose
  // error arm is untestable, and the signup lanes' rationale for the
  // pre-landed legacy paint ("a rules lag that denies the subcollection read
  // can't freeze a stale list") lives entirely in that arm.
  const listeners: Array<{
    path: string;
    next: (snap: unknown) => void;
    error?: (e: unknown) => void;
    options: unknown;
  }> = [];
  // doc()/collection() take (db, ...segments); drop the db handle and keep the
  // path so listeners and writes are addressable. The 1-arg doc(collectionRef)
  // form is the auto-id mint used by the portal write path.
  const ref = (...args: unknown[]) =>
    args.length === 1
      ? {
          __path: `${(args[0] as { __path: string }).__path}/auto-id`,
          id: "auto-id",
        }
      : { __path: args.slice(1).map(String).join("/") };
  return {
    __listeners: listeners,
    doc: (...args: unknown[]) => ref(...args),
    collection: (...args: unknown[]) => ref(...args),
    // The evalRounds listener subscribes to a query; passing the target
    // through keeps its path addressable so it registers (and stays silent)
    // alongside the signup listeners.
    query: (target: unknown) => target,
    where: () => ({}),
    onSnapshot: (target: unknown, ...rest: unknown[]) => {
      // Both call shapes: (ref, next, err) and (ref, options, next, err). The
      // options object is KEPT rather than discarded — tests assert on it.
      const hasOptions = typeof rest[0] !== "function";
      const options = hasOptions ? rest[0] : undefined;
      const next = (hasOptions ? rest[1] : rest[0]) as (s: unknown) => void;
      const error = (hasOptions ? rest[2] : rest[1]) as
        | ((e: unknown) => void)
        | undefined;
      listeners.push({
        path: (target as { __path: string }).__path,
        next,
        error,
        options,
      });
      return () => {
        const i = listeners.findIndex((l) => l.next === next);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    getDoc: vi.fn(() =>
      Promise.resolve({ exists: () => false, data: () => ({}) }),
    ),
    getDocs: vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
    setDoc: vi.fn(() => Promise.resolve()),
    updateDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(() => Promise.resolve()),
    })),
    arrayRemove: vi.fn((v: unknown) => ({ __arrayRemove: v })),
    arrayUnion: vi.fn((v: unknown) => ({ __arrayUnion: v })),
    deleteField: vi.fn(() => ({ __deleteField: true })),
    DocumentSnapshot: class {},
    FirestoreError: class {},
  };
});

import * as firestore from "firebase/firestore";
import { ToastProvider } from "./ToastProvider";
import { TeamProvider } from "./TeamProvider";
import { ConfirmProvider } from "../components/ConfirmDialog";
import { useTeam } from "../contexts";

const listeners = (
  firestore as unknown as {
    __listeners: Array<{
      path: string;
      next: (snap: unknown) => void;
      error?: (e: unknown) => void;
      options: unknown;
    }>;
  }
).__listeners;
// The options object each live listener on `path` was created with.
const subOptions = (path: string) =>
  listeners.filter((l) => l.path === path).map((l) => l.options);
const setDocMock = firestore.setDoc as unknown as ReturnType<typeof vi.fn>;
const updateDocMock = firestore.updateDoc as unknown as ReturnType<
  typeof vi.fn
>;
const writeBatchMock = firestore.writeBatch as unknown as ReturnType<
  typeof vi.fn
>;
// The most recent writeBatch the provider minted — Phase 3a routes games ops
// through batches so multi-shape cascades stay atomic.
const lastBatch = () =>
  writeBatchMock.mock.results[writeBatchMock.mock.results.length - 1]?.value;

const SETTINGS = "artifacts/test-app/users/u1/settings/teams";
const teamPath = (id: string) => `artifacts/test-app/public/data/teams/${id}`;
const subPath = (id: string, key: string) => `${teamPath(id)}/${key}`;

// The signup lanes must be quiet for this long before the head's client drops
// the legacy arrays — mirrors SIGNUP_ARRAY_DROP_SETTLE_MS in TeamProvider.
const SETTLE_MS = 5000;

type Doc = { id: string; data: Record<string, unknown> };

// Hand a doc snapshot to its listeners WITHOUT flushing React — the caller
// owns the act() scope. Used to reproduce the real-world interleaving the
// drop's fire-time re-proof exists for: a snapshot mutates the raw refs
// synchronously, but the effect that would cancel the pending timer only
// re-runs on the next commit, so a timer scheduled for that window fires
// against refs the arm-time proof never saw.
const deliverDoc = (
  path: string,
  data: Record<string, unknown> | null,
  fromCache = false,
) => {
  const snap = {
    exists: () => data !== null,
    data: () => data,
    metadata: { fromCache, hasPendingWrites: false },
  };
  listeners
    .filter((l) => l.path === path)
    .forEach((l) => l.next(snap as unknown));
};

const emitDoc = (
  path: string,
  data: Record<string, unknown> | null,
  fromCache = false,
) => act(() => deliverDoc(path, data, fromCache));

const emitCollection = (path: string, docs: Doc[], fromCache = false) =>
  act(() => {
    const snap = {
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
      empty: docs.length === 0,
      metadata: { fromCache, hasPendingWrites: false },
    };
    listeners
      .filter((l) => l.path === path)
      .forEach((l) => l.next(snap as unknown));
  });

// Deny the listeners on `path` — Firestore's error arm, which is what a rules
// lag (or a member removed mid-session) actually delivers. Fails loudly if the
// subscription was created without an error handler at all: an unhandled
// listener error is a crash in production, so "no handler" is never the
// behavior under test.
const emitError = (path: string, code = "permission-denied") => {
  const targets = listeners.filter((l) => l.path === path);
  expect(targets.length).toBeGreaterThan(0);
  targets.forEach((l) => {
    if (!l.error) {
      throw new Error(`listener on ${path} was created with no error handler`);
    }
  });
  return act(() => {
    targets.forEach((l) => l.error?.({ code, name: "FirebaseError" }));
  });
};

// Make the ONE write that deletes team-doc fields reject, the way a rules
// change or a lost connection would, while every other updateDoc the provider
// issues keeps succeeding. Returns the rejection count so a test can prove the
// write it is asserting about actually failed.
const failFieldDrop = (field: "tryoutSignups" | "evaluationEvents") => {
  const failed: unknown[] = [];
  updateDocMock.mockImplementation((_ref: unknown, payload: any) => {
    if (payload?.[field]?.__deleteField === true) {
      failed.push(payload);
      return Promise.reject(new Error("permission-denied"));
    }
    return Promise.resolve();
  });
  return () => failed.length;
};

// A team doc the provider treats as fully loaded and owned by the test user
// (ownerId ⇒ realRole "head", the only role allowed to drop the arrays), at the
// current eval schema so the migration ladder never fires a write.
const teamDoc = (over: Record<string, unknown> = {}) => ({
  name: "Test Team",
  ownerId: "u1",
  members: ["u1"],
  players: [],
  games: [],
  evalSchemaVersion: 11,
  tryoutSignups: [],
  interestSignups: [],
  ...over,
});

let teamApi: any = null;

// One entry per commit of the Probe. signupsReady is derived from refs DURING
// render, so "eventually true" is not the property — "true in the commit that
// published the union it gates" is. Only a per-commit log can tell those two
// apart, and the difference is exactly a deep link bouncing or not.
const renders: Array<{ ready: boolean; tryout: string; interest: string }> = [];

const Probe = () => {
  const team = useTeam();
  teamApi = team;
  // `team` is the context's name for teamData — the assembled union.
  const ids = (key: string) =>
    (
      ((team.team as Record<string, unknown>)?.[key] as Array<{
        id?: string;
      }>) || []
    )
      .map((e) => e?.id)
      .join(",");
  const entry = {
    ready: team.signupsReady === true,
    denied: team.signupsDenied === true,
    tryout: ids("tryoutSignups"),
    interest: ids("interestSignups"),
  };
  renders.push(entry);
  return (
    <div>
      <div data-testid="tryout">{entry.tryout}</div>
      <div data-testid="interest">{entry.interest}</div>
      <div data-testid="ready">{String(entry.ready)}</div>
      <div data-testid="denied">{String(entry.denied)}</div>
    </div>
  );
};

const mountProvider = async () => {
  // The auth effect awaits before subscribing, so the user — and with it the
  // team-list listener — lands a microtask after mount; render inside act so
  // that update is not reported as unwrapped.
  await act(async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <TeamProvider>
              <Probe />
            </TeamProvider>
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
  });
  await emitDoc(SETTINGS, { teams: [{ id: "t1", name: "T1" }] });
};

// The migration write-effects gate on EVERY migrating lane (the four portal
// lanes of Phases 1/1b plus the Phase 3a games lane), not just the
// tryout/interest pair most tests here exercise. This stands in for the
// other lanes being quiet — empty snapshots, server-confirmed unless a test
// says otherwise.
const emitSubmissionLanes = async (team = "t1", fromCache = false) => {
  await emitCollection(subPath(team, "playerInfoSubmissions"), [], fromCache);
  await emitCollection(subPath(team, "availabilitySubmissions"), [], fromCache);
  await emitCollection(subPath(team, "games"), [], fromCache);
};

// Arm the signup-array drop: one legacy entry, mirrored, every lane
// server-confirmed. Everything the drop asks for is in place except the
// settle window.
const armDrop = async () => {
  await mountProvider();
  await emitDoc(
    teamPath("t1"),
    teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
  );
  await emitCollection(subPath("t1", "tryoutSignups"), [
    { id: "legacy-a", data: {} },
  ]);
  await emitCollection(subPath("t1", "interestSignups"), []);
  await emitSubmissionLanes();
};

const tryoutIds = () => screen.getByTestId("tryout").textContent;
const interestIds = () => screen.getByTestId("interest").textContent;
const readyFlag = () => screen.getByTestId("ready").textContent;
// The legacy-array drop is the only write that deletes team-doc fields.
const dropWrites = () =>
  updateDocMock.mock.calls.filter(
    (call) =>
      (call[1] as { tryoutSignups?: { __deleteField?: boolean } })
        ?.tryoutSignups?.__deleteField === true,
  );
// The evalRounds equivalent: the other irreversible field delete, wired to the
// same "clear the guard on write failure" retry contract.
const evalDropWrites = () =>
  updateDocMock.mock.calls.filter(
    (call) =>
      (call[1] as { evaluationEvents?: { __deleteField?: boolean } })
        ?.evaluationEvents?.__deleteField === true,
  );
const backfillWrites = (path: string) =>
  setDocMock.mock.calls.filter(
    (call) => (call[0] as { __path?: string })?.__path === path,
  );

beforeEach(() => {
  // Only setTimeout: faking Date/performance would stall React's scheduler.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.clearAllMocks();
  // clearAllMocks wipes recorded calls but NOT implementations, so a test that
  // made a write reject would leak that into every test after it.
  updateDocMock.mockImplementation(() => Promise.resolve());
  setDocMock.mockImplementation(() => Promise.resolve());
  listeners.length = 0;
  teamApi = null;
  renders.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TeamProvider signup subcollections — read assembly", () => {
  it("never unions the previous team's legacy arrays into the next team", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "t1-legacy", playerName: "Alpha" }] }),
    );
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(tryoutIds()).toBe("t1-legacy");

    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    // The new team's SUBCOLLECTION lands before its team doc — the window in
    // which the raw legacy refs, if they survived the switch, would be team
    // t1's. Another family's PII rendering under team t2 is the bug.
    await emitCollection(subPath("t2", "tryoutSignups"), [
      { id: "t2-sub", data: { playerName: "Beta" } },
    ]);
    expect(tryoutIds()).toBe("t2-sub");
  });

  // Same teardown, the other collection. The interest lane carries the same
  // family PII as the tryout lane and is cleared by its own line in the same
  // cleanup — testing only the tryout lane leaves half the exposure uncovered.
  it("never unions the previous team's legacy INTEREST array into the next team", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        interestSignups: [{ id: "t1-interest", playerName: "Alpha" }],
      }),
    );
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(interestIds()).toBe("t1-interest");

    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    await emitCollection(subPath("t2", "interestSignups"), [
      { id: "t2-sub", data: { playerName: "Beta" } },
    ]);
    expect(interestIds()).toBe("t2-sub");
  });

  it("re-assembles when a straggler lands on the legacy ARRAY after the subscription", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc());
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "sub-1", data: { submittedAt: "2026-03-02" } },
    ]);
    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(tryoutIds()).toBe("sub-1");

    // The legacy ARRAY changes on the team doc (historically a cached portal
    // client's append via the now-removed deprecated lane; today a member
    // cleanup shape or another device's write). Nothing re-runs the
    // subcollection listener, so only the team-doc snapshot can surface it —
    // assembly must react to EITHER input moving.
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        tryoutSignups: [{ id: "straggler", submittedAt: "2026-03-01" }],
      }),
    );
    expect(tryoutIds()).toBe("sub-1,straggler");
  });

  // The pre-landed paint is a VERBATIM pass-through of the legacy array, not a
  // re-assembly of it. That distinction is the whole of the branch: once the
  // subscription lands every paint goes through assembleSignups, which
  // re-sorts by recency, so an array stored out of recency order is the only
  // observable that tells "returned the raw array" apart from "unioned with an
  // empty doc set". Entries are handed through exactly as the doc holds them —
  // before anything has landed that array is the only source of truth there
  // is, and rewriting it would invent an order nothing has confirmed.
  it("keeps painting the legacy array VERBATIM while the subscription has not landed", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        tryoutSignups: [
          { id: "stored-first", submittedAt: "2026-01-05" },
          { id: "stored-second", submittedAt: "2026-03-09" },
        ],
      }),
    );
    expect(subOptions(subPath("t1", "tryoutSignups"))).toHaveLength(1);
    expect(tryoutIds()).toBe("stored-first,stored-second");

    // ...and the moment the subscription lands, the SAME two entries are
    // republished through the union — recency-sorted, newest first. Same
    // inputs, different output: that is the branch doing something.
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    expect(tryoutIds()).toBe("stored-second,stored-first");
  });
});

// The PRODUCER side of #583. LetterPages injects signupsReady as a literal, so
// the consumer's redirect logic is covered but nothing proves the provider ever
// publishes the right value. Without these, replacing the whole derivation with
// `true` is invisible — and that restores the exact bug #583 exists to fix: a
// coach deep-links a signup that so far exists only as a subdoc, the legacy
// array is what is painted, the lookup misses, and they are bounced to
// /tryouts milliseconds before the subscription would have answered.
describe("TeamProvider signup subcollections — signupsReady", () => {
  it("withholds signupsReady until BOTH lanes have landed", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );
    // The team doc is loaded and a non-empty list is already painted — the
    // state a length-based guess would call "ready".
    expect(tryoutIds()).toBe("legacy-a");
    expect(readyFlag()).toBe("false");

    // One lane down. The interest lane has delivered nothing, so an interest
    // letter's deep link would still miss; conjunction, not disjunction.
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    expect(readyFlag()).toBe("false");

    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(readyFlag()).toBe("true");
  });

  // Same conjunction, the other lane first. A one-sided test would pass against
  // `landed.tryoutSignups` alone, which is a real way to write this bug.
  it("withholds signupsReady when only the INTEREST lane has landed", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc());
    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(readyFlag()).toBe("false");

    await emitCollection(subPath("t1", "tryoutSignups"), []);
    expect(readyFlag()).toBe("true");
  });

  it("flips signupsReady in the very commit the second lane lands", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        tryoutSignups: [{ id: "legacy-a", submittedAt: "2026-01-05" }],
      }),
    );
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "sub-1", data: { submittedAt: "2026-03-09" } },
    ]);
    // The landed gate is flipped BEFORE assembling, so the first snapshot a
    // lane delivers publishes the union rather than one last raw-only paint.
    expect(tryoutIds()).toBe("sub-1,legacy-a");
    expect(readyFlag()).toBe("false");

    const before = renders.length;
    await emitCollection(subPath("t1", "interestSignups"), []);
    // signupsReady is derived from refs during render, so it can only become
    // visible on a commit something else schedules. Assert it rode the FIRST
    // commit that snapshot produced: a flag that lagged one commit behind the
    // data it describes reopens the redirect window it exists to close.
    expect(renders.length).toBeGreaterThan(before);
    expect(renders[before].ready).toBe(true);
    expect(renders.slice(0, before).some((r) => r.ready)).toBe(false);
  });
});

describe("TeamProvider signup subcollections — subscription options", () => {
  // Firestore suppresses the metadata-only cache→server transition unless the
  // listener asks for it. On a device whose cached copy already matches the
  // server that transition is the ONLY second snapshot there would ever be, so
  // without this option metadata.fromCache reads true forever and both
  // migration write-effects — which gate on server confirmation — are stranded
  // for good. Assert the option structurally: no snapshot this harness can
  // deliver would reveal its absence, because the harness, not Firestore,
  // decides what gets delivered.
  it("subscribes to every portal lane with includeMetadataChanges", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc());

    for (const key of [
      "tryoutSignups",
      "interestSignups",
      "playerInfoSubmissions",
      "availabilitySubmissions",
    ] as const) {
      const options = subOptions(subPath("t1", key));
      expect(options).toHaveLength(1);
      expect(options[0]).toEqual(
        expect.objectContaining({ includeMetadataChanges: true }),
      );
    }
  });

  it("strands BOTH migration writes on a device that only ever sees cache", async () => {
    await mountProvider();
    // One legacy entry with no subcollection twin: backfill work outstanding,
    // and coverage not yet proven for the drop.
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );
    const backfilled = () =>
      backfillWrites(subPath("t1", "tryoutSignups") + "/legacy-a");

    // The cache-matches-server device: every snapshot it will ever get is
    // flagged fromCache, and re-delivering them changes nothing.
    for (let i = 0; i < 2; i += 1) {
      await emitCollection(subPath("t1", "tryoutSignups"), [], true);
      await emitCollection(subPath("t1", "interestSignups"), [], true);
      await emitSubmissionLanes("t1", true);
    }
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 4);
    });
    expect(backfilled()).toHaveLength(0);
    expect(dropWrites()).toHaveLength(0);

    // The metadata-only transition the option buys us. It carries no document
    // change at all — only fromCache flipping to false — and it is what
    // releases the backfill.
    await emitSubmissionLanes();
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(backfilled()).toHaveLength(1);
    // Coverage still unproven (legacy-a exists only in the array), so the
    // irreversible write stays parked.
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 2);
    });
    expect(dropWrites()).toHaveLength(0);

    // The backfilled doc streams back, and only now does the drop complete.
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "legacy-a", data: {} },
    ]);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(dropWrites()).toHaveLength(1);
  });
});

describe("TeamProvider signup subcollections — migration writes", () => {
  // Legacy entry with no subcollection twin: the backfill's only job.
  const legacyOnly = teamDoc({
    tryoutSignups: [{ id: "legacy-a", playerName: "Alpha" }],
  });

  // The third thing the team-doc teardown clears. loadedTeamIdRef is what
  // pins the raw arrays and the id sets to ONE team; leaving it set means it
  // still names the last team whose doc landed, which reads as "loaded" the
  // moment that team becomes active again — before its doc has actually
  // re-landed and while the raw refs are still empty from the teardown. The
  // backfill would then run against nothing, burn its once-per-team guard, and
  // never run again this session: the legacy entries stay unmirrored, and the
  // migration silently stalls for that team.
  it("re-arms the backfill for a team revisited in the same session", async () => {
    await mountProvider();
    // t1's doc lands (so a stale loadedTeamIdRef would name t1), but its
    // subscriptions never do — the backfill has not run for t1 yet.
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );

    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    await act(async () => {
      await teamApi.switchTeam("t1");
    });

    // t1's subcollections land FIRST, server-confirmed and empty. The raw
    // arrays are still empty from the teardown, so this is precisely the
    // window in which "loaded" must read false.
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    await emitSubmissionLanes();
    // Now the doc itself re-lands, carrying the entry to mirror.
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );

    expect(
      backfillWrites(subPath("t1", "tryoutSignups") + "/legacy-a"),
    ).toHaveLength(1);
  });

  it("holds the backfill until BOTH subscriptions are server-confirmed", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), legacyOnly);
    // The submission lanes are quiet and confirmed throughout — the pair
    // under test is tryout/interest.
    await emitSubmissionLanes();
    // Cache-served snapshots: the id sets under-report, and the backfill would
    // setDoc stale legacy copies over whatever the server actually holds.
    await emitCollection(subPath("t1", "tryoutSignups"), [], true);
    await emitCollection(subPath("t1", "interestSignups"), [], true);
    expect(
      backfillWrites(subPath("t1", "tryoutSignups") + "/legacy-a"),
    ).toHaveLength(0);

    // One server snapshot is not enough — the guard spans both collections.
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    expect(
      backfillWrites(subPath("t1", "tryoutSignups") + "/legacy-a"),
    ).toHaveLength(0);

    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(
      backfillWrites(subPath("t1", "tryoutSignups") + "/legacy-a"),
    ).toHaveLength(1);
  });

  it("never drops the legacy arrays off a cache-only view", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );
    // Full coverage on paper, but every snapshot came from the local cache.
    await emitCollection(
      subPath("t1", "tryoutSignups"),
      [{ id: "legacy-a", data: {} }],
      true,
    );
    await emitCollection(subPath("t1", "interestSignups"), [], true);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 2);
    });
    expect(dropWrites()).toHaveLength(0);
  });

  it("drops the legacy arrays only after the signup lanes settle", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "legacy-a", data: {} },
    ]);
    await emitCollection(subPath("t1", "interestSignups"), []);
    await emitSubmissionLanes();
    // Coverage is proven, but the write is not issued in the same tick — the
    // settle window gives an in-flight legacy-lane append time to arrive.
    expect(dropWrites()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(dropWrites()).toHaveLength(1);
    expect((dropWrites()[0][0] as { __path: string }).__path).toBe(
      teamPath("t1"),
    );
  });

  // The weaker of the two abandonment paths, and the one the original version
  // of this test was actually exercising: a mid-settle snapshot re-runs the
  // effect, whose cleanup clears the pending timer, and the fresh arm-time
  // coverage check then refuses to re-arm. Nothing here reaches the fire-time
  // re-proof — the timer never fires at all. Kept because it is the common
  // case; the test below covers the case it cannot.
  it("never re-arms the drop after a mid-settle legacy append (arm-time proof)", async () => {
    await armDrop();
    // A portal client's arrayUnion lands, and React commits it before the
    // timer is due.
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        tryoutSignups: [{ id: "legacy-a" }, { id: "legacy-late" }],
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 4);
    });
    expect(dropWrites()).toHaveLength(0);
    // ...and the straggler is visible to the coach in the meantime.
    expect(tryoutIds()).toBe("legacy-a,legacy-late");
  });

  it("abandons the pending drop when a new legacy entry arrives mid-settle", async () => {
    await armDrop();

    // The case the arm-time check cannot catch. The snapshot handler writes
    // rawTryoutSignupsRef SYNCHRONOUSLY, but the effect that would cancel the
    // armed timer only re-runs on the next commit — so a timer due inside that
    // window fires holding an arm-time proof that is already false. Delivering
    // the snapshot and advancing the clock inside ONE act() scope reproduces
    // exactly that: React has not re-rendered yet when the timer runs.
    act(() => {
      deliverDoc(
        teamPath("t1"),
        teamDoc({
          tryoutSignups: [{ id: "legacy-a" }, { id: "legacy-late" }],
        }),
      );
      vi.advanceTimersByTime(SETTLE_MS);
    });
    // Re-proved from the refs at write time, the coverage is gone: legacy-late
    // exists only in the array. Dropping now would delete a parent's signup
    // that was never mirrored into the subcollection.
    expect(dropWrites()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 4);
    });
    expect(dropWrites()).toHaveLength(0);
    expect(tryoutIds()).toBe("legacy-a,legacy-late");
  });

  // The head-only gate is the ONLY thing electing a single dropper. The rules
  // grant every team member update on the team doc, so an assistant's client
  // that reached this code would issue the deleteField itself — and nothing
  // server-side would refuse it. Identical setup to the passing drop test
  // above, changed in exactly one way: this user is an assistant.
  it("never lets an assistant issue the irreversible drop", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        ownerId: "u2",
        members: ["u2", "u1"],
        coachRoles: { u2: "head", u1: "assistant" },
        tryoutSignups: [{ id: "legacy-a" }],
      }),
    );
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "legacy-a", data: {} },
    ]);
    await emitCollection(subPath("t1", "interestSignups"), []);
    await emitSubmissionLanes();
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 4);
    });
    expect(dropWrites()).toHaveLength(0);
    // The setup is proven droppable by "drops the legacy arrays only after the
    // signup lanes settle" above, which differs only in who is signed in — so
    // the role, not a missing precondition, is what held the write back.
    expect(teamApi.realRole).toBe("assistant");
  });

  it("keeps the once-guard for the write, not for the attempt", async () => {
    await armDrop();
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS / 2);
    });
    // A snapshot on either lane restarts the settle window. Under the older
    // arm-time once-guard this interruption BURNED the team's single attempt
    // for the session and the arrays were never dropped at all — the guard is
    // taken when the write is issued, so an interrupted window costs nothing
    // but time.
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "legacy-a", data: {} },
    ]);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS / 2);
    });
    expect(dropWrites()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(dropWrites()).toHaveLength(1);

    // And the guard still does its real job: further snapshots and further
    // settle windows never issue a second irreversible write.
    await emitCollection(subPath("t1", "interestSignups"), []);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 4);
    });
    expect(dropWrites()).toHaveLength(1);
  });
});

// Both irreversible field deletes take their once-per-team guard BEFORE the
// write resolves, and hand back the failure case with a single `.catch` that
// removes the team from the guard set again. That catch encodes a promise made
// in both source comments — "on write failure the guard clears so a later
// session retries" — and it is the difference between a transient rules
// deploy or a dropped connection costing a migration one retry, and costing it
// the whole session: the drop can only re-arm if the guard is clear, and
// nothing else ever clears it.
//
// Everything below needs the write to actually REJECT. Nothing else in this
// file rejects anything, which is precisely why the catch bodies were free to
// mutate before these tests existed.
describe("TeamProvider signup subcollections — drop write failure", () => {
  it("clears the drop guard when the irreversible write FAILS, so a later cycle retries", async () => {
    const failures = failFieldDrop("tryoutSignups");
    await armDrop();
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    // The attempt was made and the server refused it. The legacy arrays are
    // still on the doc, and the raw refs still hold them — so the team still
    // has migration work outstanding.
    expect(dropWrites()).toHaveLength(1);
    expect(failures()).toBe(1);
    expect(tryoutIds()).toBe("legacy-a");

    // The next qualifying cycle: any snapshot on either lane re-runs the drop
    // effect, which re-proves coverage and re-arms the settle window. It can
    // only get past the once-guard if the failure cleared it.
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "legacy-a", data: {} },
    ]);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(dropWrites()).toHaveLength(2);
    expect((dropWrites()[1][0] as { __path: string }).__path).toBe(
      teamPath("t1"),
    );
    // Contrast, proven by "keeps the once-guard for the write, not for the
    // attempt" above: after a write that SUCCEEDS the identical follow-up
    // snapshot issues nothing. Retrying is the failure path only.
  });

  // The evalRounds drop is the same contract, one collection earlier in the
  // migration and with no settle window: guard taken at write time, cleared by
  // the catch. Its retry path had no rejection test either.
  it("clears the evalRounds drop guard when its irreversible write FAILS", async () => {
    const failures = failFieldDrop("evaluationEvents");
    await mountProvider();
    // One legacy round, and the subcollection stream proves it is mirrored.
    await emitDoc(
      teamPath("t1"),
      teamDoc({ evaluationEvents: [{ id: "r1", evaluatorId: "u1" }] }),
    );
    await emitCollection(`${teamPath("t1")}/evalRounds`, [
      { id: "r1", data: { evaluatorId: "u1" } },
    ]);
    expect(evalDropWrites()).toHaveLength(1);
    expect(failures()).toBe(1);

    // The array is still there (the delete never landed), so the next
    // subcollection snapshot must be able to try again.
    await emitCollection(`${teamPath("t1")}/evalRounds`, [
      { id: "r1", data: { evaluatorId: "u1" } },
    ]);
    expect(evalDropWrites()).toHaveLength(2);
  });

  // The other half of that contract, and the half a full-suite mutation sweep
  // found unpinned: the guard must be released ONLY on failure. Clearing it
  // unconditionally still passes the test above — the drop succeeds, the guard
  // is dropped anyway, and every later evaluationEvents snapshot re-arms the
  // effect and re-issues deleteField. Harmless-looking (the field is already
  // gone) but it is an unbounded write loop against the team doc, billed per
  // write, for as long as the session lives. The signups drop is already
  // pinned in this direction; evalRounds was not.
  it("keeps the evalRounds drop guard after the write SUCCEEDS", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ evaluationEvents: [{ id: "r1", evaluatorId: "u1" }] }),
    );
    await emitCollection(`${teamPath("t1")}/evalRounds`, [
      { id: "r1", data: { evaluatorId: "u1" } },
    ]);
    expect(evalDropWrites()).toHaveLength(1);

    // Two more qualifying snapshots. The drop already landed, so the guard has
    // to hold — exactly once, no matter how many snapshots follow.
    await emitCollection(`${teamPath("t1")}/evalRounds`, [
      { id: "r1", data: { evaluatorId: "u1" } },
    ]);
    await emitCollection(`${teamPath("t1")}/evalRounds`, [
      { id: "r1", data: { evaluatorId: "u1" } },
    ]);
    expect(evalDropWrites()).toHaveLength(1);
  });
});

// The signup subscriptions' error arm. Firestore delivers it for a rules lag
// (a member added to the team doc before the rules deploy that grants the
// subcollection read), for a member removed mid-session, and for a
// transiently unreachable backend. The source's whole justification for
// keeping the legacy array authoritative until a lane LANDS — "a rules lag
// that denies the subcollection read can't freeze a stale list" — is asserted
// in a comment and was exercised nowhere: no test in this file had ever
// reached an error callback.
//
// Two properties, and they pull in opposite directions. READ side: a denial
// must not blank the screen — the legacy array is all this client has, and it
// must keep painting and keep updating. WRITE side: a denial must never count
// as evidence. An errored lane reports an EMPTY id set, and an empty id set
// read as fact is what turns the backfill into a clobber of coach edits and
// the drop into a delete of signups nobody ever mirrored.
describe("TeamProvider signup subcollections — denied subcollection read", () => {
  const legacyPair = [
    { id: "legacy-a", submittedAt: "2026-01-05" },
    { id: "legacy-b", submittedAt: "2026-03-09" },
  ];

  it("publishes signupsDenied so a waiting consumer can stop waiting", async () => {
    // onSnapshot errors are terminal — the lane can never land, signupsReady
    // can never flip, and a consumer gating on it (the letter pages' id
    // lookup) would loader forever. The denied flag is the "stop waiting"
    // signal, and it must clear on team switch: the next team's lanes get
    // fresh listeners and deserve a fresh verdict.
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc({ tryoutSignups: legacyPair }));
    expect(screen.getByTestId("denied").textContent).toBe("false");

    await emitError(subPath("t1", "tryoutSignups"));
    expect(screen.getByTestId("denied").textContent).toBe("true");
    expect(screen.getByTestId("ready").textContent).toBe("false");

    // Team switch tears the lanes down; the verdict must not follow t2.
    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    expect(screen.getByTestId("denied").textContent).toBe("false");
  });

  it("keeps painting the legacy array when the subcollection read is DENIED", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc({ tryoutSignups: legacyPair }));
    expect(tryoutIds()).toBe("legacy-a,legacy-b");

    await emitError(subPath("t1", "tryoutSignups"));
    // Nothing landed, so nothing changed: the array is still painted, still
    // verbatim. A handler that cleared the list (or that "landed" the lane on
    // an empty doc set) would show up here as a blank or a re-sort.
    expect(tryoutIds()).toBe("legacy-a,legacy-b");

    // And the input the coach still has stays LIVE — a legacy-array change
    // arriving on the team doc (a member cleanup shape, another device's
    // write) must keep surfacing while the subcollection read is denied.
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        tryoutSignups: [...legacyPair, { id: "legacy-c" }],
      }),
    );
    expect(tryoutIds()).toBe("legacy-a,legacy-b,legacy-c");

    // A denied lane is not a delivered lane. A signup that exists only as a
    // subdoc is unknown to this client, so the union is genuinely incomplete
    // and the flag that gates "this id does not exist" must say so — even
    // once the OTHER lane has landed.
    expect(readyFlag()).toBe("false");
    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(readyFlag()).toBe("false");
  });

  it("never lets a DENIED lane satisfy the irreversible drop", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );
    // The tryout lane is fully mirrored and server-confirmed (and the
    // submission lanes are quiet)...
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "legacy-a", data: {} },
    ]);
    await emitSubmissionLanes();
    // ...and the interest lane is DENIED. Its legacy array is empty, so the
    // coverage proof reads "nothing to migrate" for it and waves it through:
    // the landed/server-confirmed gates are the only thing between a read we
    // were refused and a deleteField that spans BOTH fields.
    await emitError(subPath("t1", "interestSignups"));
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 4);
    });
    expect(dropWrites()).toHaveLength(0);

    // Once the denied lane genuinely answers, the same setup drops — so it was
    // the denial that held the write, not a missing precondition.
    await emitCollection(subPath("t1", "interestSignups"), []);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(dropWrites()).toHaveLength(1);
  });

  it("never lets a DENIED lane release the backfill", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );
    // The tryout lane's id set is what tells the backfill which legacy entries
    // already exist as subdocs — and a subdoc may carry a coach's edits
    // (tryoutNumber, status, measurements live there only). Denied, that set
    // reads empty: every entry looks unmirrored, and mirroring one means
    // setDoc-ing the stale legacy copy over the server's.
    await emitError(subPath("t1", "tryoutSignups"));
    await emitCollection(subPath("t1", "interestSignups"), []);
    await emitSubmissionLanes();
    const written = () =>
      backfillWrites(subPath("t1", "tryoutSignups") + "/legacy-a");
    expect(written()).toHaveLength(0);

    // The lane recovers and reports for itself — empty, so legacy-a really is
    // unmirrored — and only now is the write made.
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    expect(written()).toHaveLength(1);
  });
});

// The signup-subscription effect's cleanup resets four things per lane:
// landed, serverConfirmed, subDocs and subIds. The comment above it claims "a
// half-reset pair is exactly what the migration write-effects would misread as
// proof" — these tests are that claim, made checkable. Each one leaves the
// previous team fully proven, switches, and then asserts the next team has to
// prove itself from scratch.
//
// Only TWO of the four lines are testable, and the reason is worth writing down
// rather than papering over with a test that would pass either way. Both
// `subDocs[key] = []` and `subIds[key] = new Set()` are unobservable while
// `landed[key] = false` is intact: the snapshot callback re-assigns BOTH refs
// unconditionally as its first two statements, and every reader of either ref
// is gated on landed — assembledSignups returns the raw legacy array unless
// landed[key], and the backfill and the drop's coverage proof both require
// landed on BOTH lanes. So a read of subDocs/subIds can only happen after a
// callback for the CURRENT team has already overwritten them, and no snapshot
// this harness can deliver reaches a stale value. Deleting either line and
// running this file gives 20/20 — verified, not assumed. They are
// defence-in-depth (each line independently safe rather than leaning on the
// landed reset), and a test claiming otherwise would be theatre.
describe("TeamProvider signup subcollections — subscription teardown", () => {
  // landed[key] = false. Nothing else in the provider un-readies the flag, so
  // without this line the very first render after a team switch reports the
  // NEXT team's signups as fully delivered while its lanes hold the previous
  // team's state — which is the #583 bug again, now with a wrong-team list.
  it("un-readies signupsReady for the next team until ITS lanes land", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc());
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(readyFlag()).toBe("true");

    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    await emitDoc(
      teamPath("t2"),
      teamDoc({ name: "T2", tryoutSignups: [{ id: "t2-legacy" }] }),
    );
    // t2's own subscriptions have delivered nothing. The list being painted is
    // t2's legacy array alone, so a signup that lives only as a t2 subdoc is
    // absent-but-arriving — precisely what the flag must not call "missing".
    expect(tryoutIds()).toBe("t2-legacy");
    expect(readyFlag()).toBe("false");

    await emitCollection(subPath("t2", "tryoutSignups"), []);
    expect(readyFlag()).toBe("false");
    await emitCollection(subPath("t2", "interestSignups"), []);
    expect(readyFlag()).toBe("true");
  });

  // serverConfirmed[key] = false, consequence 1: the irreversible drop. The
  // drop deletes both legacy arrays on the strength of an id set, and a
  // cache-served id set under-reports. Carrying t1's confirmation into t2 lets
  // t2's drop fire having never heard from the server at all.
  it("never carries the previous team's SERVER confirmation into the next team's drop", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc());
    // t1's lanes are server-confirmed (fromCache defaults to false).
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);

    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    await emitDoc(
      teamPath("t2"),
      teamDoc({ name: "T2", tryoutSignups: [{ id: "legacy-b" }] }),
    );
    // Everything t2 delivers is cache-served. Coverage looks complete on
    // paper, but nothing here is evidence of what the server holds.
    await emitCollection(
      subPath("t2", "tryoutSignups"),
      [{ id: "legacy-b", data: {} }],
      true,
    );
    await emitCollection(subPath("t2", "interestSignups"), [], true);
    await emitSubmissionLanes("t2", true);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 4);
    });
    expect(dropWrites()).toHaveLength(0);

    // And once t2's own lanes are genuinely server-confirmed, the same setup
    // does drop — so it was the stale-confirmation guard that held, not a
    // missing precondition.
    await emitCollection(subPath("t2", "tryoutSignups"), [
      { id: "legacy-b", data: {} },
    ]);
    await emitCollection(subPath("t2", "interestSignups"), []);
    await emitSubmissionLanes("t2");
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(dropWrites()).toHaveLength(1);
    expect((dropWrites()[0][0] as { __path: string }).__path).toBe(
      teamPath("t2"),
    );
  });

  // serverConfirmed[key] = false, consequence 2: the backfill. A collection
  // this device never cached reads back EMPTY, so every legacy entry looks
  // unmirrored and the backfill setDocs its stale legacy copy over the subdoc
  // the server actually holds — silently reverting tryoutNumber, status and
  // measurements, which are written to the subdoc only.
  it("never carries the previous team's SERVER confirmation into the next team's backfill", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc());
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);

    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    await emitDoc(
      teamPath("t2"),
      teamDoc({ name: "T2", tryoutSignups: [{ id: "legacy-b" }] }),
    );
    await emitCollection(subPath("t2", "tryoutSignups"), [], true);
    await emitCollection(subPath("t2", "interestSignups"), [], true);
    await emitSubmissionLanes("t2", true);
    const written = () =>
      backfillWrites(subPath("t2", "tryoutSignups") + "/legacy-b");
    expect(written()).toHaveLength(0);

    // The server's own word releases it — and the once-per-team guard was not
    // burned by the cache-only pass.
    await emitSubmissionLanes("t2");
    await emitCollection(subPath("t2", "tryoutSignups"), []);
    await emitCollection(subPath("t2", "interestSignups"), []);
    expect(written()).toHaveLength(1);
  });
});

// The backfill's once-per-session guard used to be consumed BEFORE any write
// went out and released by nothing, on top of a helper that swallowed every
// rejection inside Promise.all — so a pass in which the server refused all
// forty writes was indistinguishable from one that mirrored all forty, and the
// migration stalled for the session with no symptom whatsoever (the union read
// still paints every family, and the irreversible drop's coverage proof reads
// the very id set the failed writes never populated, so nothing downstream
// misfires either). backfillSignupDocs now reports {written, failed} and the
// guard is released when anything failed — under an explicit per-team budget,
// because this effect re-runs on subscription milestones and an unbounded
// release against a denied team is a billed write loop.
describe("TeamProvider signup backfill — failure, retry and the retry bound", () => {
  // Mirrors SIGNUP_BACKFILL_RETRY_MS / SIGNUP_BACKFILL_MAX_ATTEMPTS.
  const BACKFILL_RETRY_MS = 5000;
  const BACKFILL_MAX_ATTEMPTS = 3;

  // Deny every signup-subcollection mirror write the way lagging rules or a
  // dropped connection does, while every other setDoc the provider issues
  // keeps succeeding. Returns the denial count so a test can prove the writes
  // it is reasoning about actually failed.
  const failMirrorWrites = () => {
    const denied: string[] = [];
    setDocMock.mockImplementation((ref: unknown) => {
      const path = String((ref as { __path?: string })?.__path || "");
      if (/\/(tryoutSignups|interestSignups)\//.test(path)) {
        denied.push(path);
        return Promise.reject(new Error("permission-denied"));
      }
      return Promise.resolve();
    });
    return () => denied.length;
  };

  // Let the backfill's promise chain settle: the pass is fired from an effect
  // and its {written, failed} handling — guard release, retry scheduling — runs
  // in microtasks the emit helpers' synchronous act() never reaches.
  const settle = () => act(async () => {});

  // Everything the backfill needs: one legacy entry with no subcollection
  // twin, every lane landed and server-confirmed.
  const armBackfill = async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a", playerName: "Alpha" }] }),
    );
    await emitSubmissionLanes();
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    await settle();
  };

  const waitOutRetryDelay = async () => {
    await act(async () => {
      vi.advanceTimersByTime(BACKFILL_RETRY_MS);
    });
    await settle();
  };

  const mirrorAttempts = () =>
    backfillWrites(subPath("t1", "tryoutSignups") + "/legacy-a").length;

  it("retries a wholly denied backfill on a later cycle in the SAME session", async () => {
    const denials = failMirrorWrites();
    await armBackfill();
    expect(mirrorAttempts()).toBe(1);
    expect(denials()).toBe(1);

    // Nothing else will re-run this effect: its other triggers are
    // subscription milestones that have already fired for this team. The
    // release-plus-timer IS the retry.
    await waitOutRetryDelay();
    expect(mirrorAttempts()).toBe(2);
  });

  it("converges when the retry succeeds, and never runs again after it does", async () => {
    failMirrorWrites();
    await armBackfill();
    expect(mirrorAttempts()).toBe(1);

    // The blip clears before the retry fires.
    setDocMock.mockImplementation(() => Promise.resolve());
    await waitOutRetryDelay();
    expect(mirrorAttempts()).toBe(2);

    // A clean pass consumes the guard for good — no third attempt, no timer
    // left armed.
    await waitOutRetryDelay();
    await waitOutRetryDelay();
    expect(mirrorAttempts()).toBe(2);
  });

  it("does not re-run a backfill that succeeded, even across a team round trip", async () => {
    await armBackfill();
    expect(mirrorAttempts()).toBe(1);

    // A revisit re-lands the doc and both subscriptions — every gate the
    // backfill reads is satisfied a second time, so only the guard stands
    // between it and a duplicate mirror of an entry a coach may have edited
    // since.
    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    await act(async () => {
      await teamApi.switchTeam("t1");
    });
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a", playerName: "Alpha" }] }),
    );
    await emitSubmissionLanes();
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    await settle();
    await waitOutRetryDelay();

    expect(mirrorAttempts()).toBe(1);
  });

  it("backs off between attempts — the second retry waits double, not the base delay", async () => {
    const denials = failMirrorWrites();
    await armBackfill();
    expect(mirrorAttempts()).toBe(1);

    // Attempt 2 fires after the base delay and is denied too.
    await waitOutRetryDelay();
    expect(mirrorAttempts()).toBe(2);

    // The next retry is scheduled at DOUBLE the base delay. Advancing only the
    // base delay must not fire it — a flat cadence is what hammers a real
    // outage — and the remaining half must.
    await act(async () => {
      vi.advanceTimersByTime(BACKFILL_RETRY_MS);
    });
    await settle();
    expect(mirrorAttempts()).toBe(2);

    await act(async () => {
      vi.advanceTimersByTime(BACKFILL_RETRY_MS);
    });
    await settle();
    expect(mirrorAttempts()).toBe(3);
    expect(denials()).toBe(3);
  });

  it("stops at the attempt cap — a permanently denied team is not a write loop", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const denials = failMirrorWrites();
    await armBackfill();

    // Far more cycles than the budget allows.
    for (let i = 0; i < 10; i += 1) await waitOutRetryDelay();

    expect(mirrorAttempts()).toBe(BACKFILL_MAX_ATTEMPTS);
    expect(denials()).toBe(BACKFILL_MAX_ATTEMPTS);
    // The only signal a persistent failure gets: a maintainer-visible log, not
    // a toast. Nothing is broken from the coach's side and there is nothing
    // they could do about it.
    const giveUpLogs = errorSpy.mock.calls.filter((c) =>
      String(c[0]).includes("[signupBackfill]"),
    );
    expect(giveUpLogs).toHaveLength(1);
    expect(giveUpLogs[0]).toContain(BACKFILL_MAX_ATTEMPTS);
    errorSpy.mockRestore();
  });

  it("never refunds the budget on a team switch — the cap is per session", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    failMirrorWrites();
    await armBackfill();
    for (let i = 0; i < 10; i += 1) await waitOutRetryDelay();
    expect(mirrorAttempts()).toBe(BACKFILL_MAX_ATTEMPTS);

    // Switching away and back re-arms every other precondition. If the budget
    // reset with it, bouncing between two teams would restore the unbounded
    // loop the cap exists to prevent.
    await act(async () => {
      await teamApi.switchTeam("t2");
    });
    await act(async () => {
      await teamApi.switchTeam("t1");
    });
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a", playerName: "Alpha" }] }),
    );
    await emitSubmissionLanes();
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    await settle();
    await waitOutRetryDelay();

    expect(mirrorAttempts()).toBe(BACKFILL_MAX_ATTEMPTS);
    errorSpy.mockRestore();
  });

  it("retries ONLY the stragglers — an entry already mirrored is never rewritten", async () => {
    // One entry mirrors, one is denied: the pass is not clean, so the guard
    // releases and the next cycle re-attempts the one that never landed.
    setDocMock.mockImplementation((ref: unknown) => {
      const path = String((ref as { __path?: string })?.__path || "");
      return path.endsWith("/legacy-b")
        ? Promise.reject(new Error("permission-denied"))
        : Promise.resolve();
    });
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }, { id: "legacy-b" }] }),
    );
    await emitSubmissionLanes();
    await emitCollection(subPath("t1", "tryoutSignups"), []);
    await emitCollection(subPath("t1", "interestSignups"), []);
    await settle();

    const attemptsFor = (id: string) =>
      backfillWrites(subPath("t1", "tryoutSignups") + "/" + id).length;
    expect(attemptsFor("legacy-a")).toBe(1);
    expect(attemptsFor("legacy-b")).toBe(1);

    await waitOutRetryDelay();
    expect(attemptsFor("legacy-b")).toBe(2);
    // ...and legacy-a is NOT rewritten. This is the assertion whose absence
    // hid a real defect: the retry's skip-existing guard is the subcollection
    // id set, which is only as fresh as the last snapshot. Without unioning in
    // the ids this session already wrote, a retry 5s after a partial failure
    // re-sends the STALE legacy copy over a doc the coach may have edited in
    // between — the exact clobber this function's contract promises to avoid.
    expect(attemptsFor("legacy-a")).toBe(1);
  });
});

// Phase 3a: games ops entering updateTeamArrays are translated into per-doc
// subcollection writes — the caller still expresses "the next array", the
// provider diffs it against the assembled union and writes only what changed,
// on ONE batch so cascades stay atomic. These tests drive the real provider
// with real ops and assert the batch shapes.
describe("TeamProvider games translation (Phase 3a)", () => {
  const g1 = {
    id: "g1",
    date: "2026-06-01",
    opponent: "Sharks",
    status: "scheduled",
  };
  const g2 = {
    id: "g2",
    date: "2026-06-08",
    opponent: "Comets",
    status: "scheduled",
  };

  const mountWithGames = async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc({ games: [g1, g2] }));
    // The games LANE must land before an edit is safe — until it does, the
    // union is the legacy array alone (empty on an already-dropped team).
    await emitCollection(subPath("t1", "games"), []);
  };

  it("BLOCKS an edit until the games lane has landed (a silent no-op would eat it)", async () => {
    await mountProvider();
    // Team doc loaded — the old teamLoaded gate is satisfied — but the games
    // subscription has delivered nothing. On a team whose legacy array was
    // already dropped this reads as "no games at all", so a mapEntries edit
    // would diff to nothing and the coach's save would vanish silently.
    await emitDoc(teamPath("t1"), teamDoc({ games: [] }));
    await act(async () => {
      teamApi.updateTeamArrays({
        op: "mapEntries",
        key: "games",
        map: (items: any[]) =>
          items.map((g) => ({ ...g, teamScore: 9 })) as any[],
      });
    });
    expect(writeBatchMock).not.toHaveBeenCalled();
    expect(updateDocMock).not.toHaveBeenCalled();
    // ...and the coach is TOLD, rather than left believing it saved.
    expect(
      screen.getByText(/schedule hasn't finished loading/i),
    ).toBeInTheDocument();

    // Once the lane lands, the same op writes.
    await emitCollection(subPath("t1", "games"), [
      { id: "g9", data: { id: "g9", date: "2026-06-01", opponent: "Jets" } },
    ]);
    await act(async () => {
      teamApi.updateTeamArrays({
        op: "mapEntries",
        key: "games",
        map: (items: any[]) =>
          items.map((g) => ({ ...g, teamScore: 9 })) as any[],
      });
    });
    expect(lastBatch().set).toHaveBeenCalledTimes(1);
  });

  it("still allows an APPEND before the lane lands — it can only add", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc({ games: [] }));
    await act(async () => {
      teamApi.updateTeamArrays({
        op: "append",
        key: "games",
        entries: [{ id: "g-new", date: "2026-07-01", opponent: "Early" }],
      });
    });
    expect(lastBatch().set).toHaveBeenCalledTimes(1);
    expect(lastBatch().set.mock.calls[0][0].__path).toBe(
      subPath("t1", "games") + "/g-new",
    );
  });

  it("chunks a bulk write past Firestore's 500-op batch cap", async () => {
    await mountProvider();
    const many = Array.from({ length: 450 }, (_, i) => ({
      id: `g${i}`,
      date: "2026-06-01",
      opponent: `Team ${i}`,
    }));
    await emitDoc(teamPath("t1"), teamDoc({ games: [] }));
    await emitCollection(subPath("t1", "games"), []);
    await act(async () => {
      teamApi.updateTeamArrays({
        op: "append",
        key: "games",
        entries: many,
      });
    });
    await act(async () => {});
    // 450 sets → two commits (400 + 50); one batch would be REJECTED whole.
    expect(writeBatchMock).toHaveBeenCalledTimes(2);
    const batches = writeBatchMock.mock.results.map((r) => r.value);
    expect(batches[0].set).toHaveBeenCalledTimes(400);
    expect(batches[1].set).toHaveBeenCalledTimes(50);
    expect(batches[0].commit).toHaveBeenCalledTimes(1);
    expect(batches[1].commit).toHaveBeenCalledTimes(1);
  });

  it("routes a single-game edit to ONE full-entry doc set — untouched games write nothing", async () => {
    await mountWithGames();
    await act(async () => {
      teamApi.updateTeamArrays({
        op: "mapEntries",
        key: "games",
        map: (items: any[]) =>
          items.map((g) =>
            g.id === "g1" ? { ...g, teamScore: 5, status: "final" } : g,
          ),
      });
    });
    const batch = lastBatch();
    expect(batch.set).toHaveBeenCalledTimes(1);
    const [ref, entry] = batch.set.mock.calls[0];
    expect(ref.__path).toBe(subPath("t1", "games") + "/g1");
    // FULL entry, not a merge patch — clears-by-omission must round-trip.
    expect(entry).toMatchObject({
      id: "g1",
      opponent: "Sharks",
      teamScore: 5,
      status: "final",
    });
    expect(batch.delete).not.toHaveBeenCalled();
    // No legacy cleanup needed on an edit — the subdoc simply wins the union.
    expect(batch.update).not.toHaveBeenCalled();
    expect(batch.commit).toHaveBeenCalledTimes(1);
    // Optimistic union carries the edit.
    expect(
      (teamApi.team.games as any[]).find((g) => g.id === "g1").teamScore,
    ).toBe(5);
  });

  it("a game delete clears BOTH homes in one atomic batch", async () => {
    await mountWithGames();
    await act(async () => {
      teamApi.updateTeamArrays({ op: "removeById", key: "games", id: "g2" });
    });
    const batch = lastBatch();
    expect(batch.delete).toHaveBeenCalledTimes(1);
    expect(batch.delete.mock.calls[0][0].__path).toBe(
      subPath("t1", "games") + "/g2",
    );
    // The legacy twin leaves the team-doc array via exact-entry arrayRemove
    // in the SAME batch — or the union would resurrect the deleted game.
    expect(batch.update).toHaveBeenCalledTimes(1);
    const [teamRef, payload] = batch.update.mock.calls[0];
    expect(teamRef.__path).toBe(teamPath("t1"));
    expect(payload.games.__arrayRemove).toEqual(g2);
    expect(batch.set).not.toHaveBeenCalled();
    expect((teamApi.team.games as any[]).map((g) => g.id)).toEqual(["g1"]);
  });

  it("an append creates the game's own doc and nothing else", async () => {
    await mountWithGames();
    const g3 = {
      id: "g3",
      date: "2026-06-15",
      opponent: "Hawks",
      status: "scheduled",
    };
    await act(async () => {
      teamApi.updateTeamArrays({ op: "append", key: "games", entries: [g3] });
    });
    const batch = lastBatch();
    expect(batch.set).toHaveBeenCalledTimes(1);
    expect(batch.set.mock.calls[0][0].__path).toBe(
      subPath("t1", "games") + "/g3",
    );
    expect(batch.set.mock.calls[0][1]).toMatchObject({ id: "g3" });
    expect(batch.update).not.toHaveBeenCalled();
    expect(batch.delete).not.toHaveBeenCalled();
    expect((teamApi.team.games as any[]).map((g) => g.id)).toContain("g3");
  });

  it("a mixed cascade (games + another array) rides ONE batch with the team-doc payload", async () => {
    await mountWithGames();
    await act(async () => {
      teamApi.updateTeamArrays([
        { op: "removeById", key: "games", id: "g1" },
        {
          op: "mapEntries",
          key: "tournaments",
          map: () => [{ id: "t-1", name: "Kept" }] as any[],
        },
      ]);
    });
    const batch = lastBatch();
    expect(batch.delete).toHaveBeenCalledTimes(1);
    // ONE team-doc update carrying BOTH the tournaments rewrite and the
    // legacy-twin arrayRemove — atomic with the doc delete.
    expect(batch.update).toHaveBeenCalledTimes(1);
    const payload = batch.update.mock.calls[0][1];
    expect(payload.tournaments).toEqual([{ id: "t-1", name: "Kept" }]);
    expect(payload.games.__arrayRemove).toEqual(g1);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it("reverts the optimistic union when the batch commit fails", async () => {
    await mountWithGames();
    writeBatchMock.mockImplementationOnce(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(() => Promise.reject(new Error("permission-denied"))),
    }));
    await act(async () => {
      teamApi.updateTeamArrays({ op: "removeById", key: "games", id: "g1" });
    });
    await act(async () => {});
    expect((teamApi.team.games as any[]).map((g) => g.id).sort()).toEqual([
      "g1",
      "g2",
    ]);
  });
});
