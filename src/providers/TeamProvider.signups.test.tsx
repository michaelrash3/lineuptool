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
  const listeners: Array<{ path: string; next: (snap: unknown) => void }> = [];
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
    onSnapshot: (target: unknown, a: unknown, b: unknown) => {
      // Both call shapes: (ref, next, err) and (ref, options, next, err).
      const next = (typeof a === "function" ? a : b) as (s: unknown) => void;
      listeners.push({ path: (target as { __path: string }).__path, next });
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
    __listeners: Array<{ path: string; next: (snap: unknown) => void }>;
  }
).__listeners;
const setDocMock = firestore.setDoc as unknown as ReturnType<typeof vi.fn>;
const updateDocMock = firestore.updateDoc as unknown as ReturnType<
  typeof vi.fn
>;

const SETTINGS = "artifacts/test-app/users/u1/settings/teams";
const teamPath = (id: string) => `artifacts/test-app/public/data/teams/${id}`;
const subPath = (id: string, key: string) => `${teamPath(id)}/${key}`;

// The signup lanes must be quiet for this long before the head's client drops
// the legacy arrays — mirrors SIGNUP_ARRAY_DROP_SETTLE_MS in TeamProvider.
const SETTLE_MS = 5000;

type Doc = { id: string; data: Record<string, unknown> };

const emitDoc = (
  path: string,
  data: Record<string, unknown> | null,
  fromCache = false,
) =>
  act(() => {
    const snap = {
      exists: () => data !== null,
      data: () => data,
      metadata: { fromCache, hasPendingWrites: false },
    };
    listeners
      .filter((l) => l.path === path)
      .forEach((l) => l.next(snap as unknown));
  });

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
  return (
    <div>
      <div data-testid="tryout">{ids("tryoutSignups")}</div>
      <div data-testid="interest">{ids("interestSignups")}</div>
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

const tryoutIds = () => screen.getByTestId("tryout").textContent;
// The legacy-array drop is the only write that deletes team-doc fields.
const dropWrites = () =>
  updateDocMock.mock.calls.filter(
    (call) =>
      (call[1] as { tryoutSignups?: { __deleteField?: boolean } })
        ?.tryoutSignups?.__deleteField === true,
  );
const backfillWrites = (path: string) =>
  setDocMock.mock.calls.filter(
    (call) => (call[0] as { __path?: string })?.__path === path,
  );

beforeEach(() => {
  // Only setTimeout: faking Date/performance would stall React's scheduler.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.clearAllMocks();
  listeners.length = 0;
  teamApi = null;
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

  it("re-assembles when a straggler lands on the legacy ARRAY after the subscription", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), teamDoc());
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "sub-1", data: { submittedAt: "2026-03-02" } },
    ]);
    await emitCollection(subPath("t1", "interestSignups"), []);
    expect(tryoutIds()).toBe("sub-1");

    // A cached portal client appends to the deprecated ARRAY lane. Nothing
    // re-runs the subcollection listener, so only the team-doc snapshot can
    // surface it — that visibility is the whole reason the lane was kept.
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        tryoutSignups: [{ id: "straggler", submittedAt: "2026-03-01" }],
      }),
    );
    expect(tryoutIds()).toBe("sub-1,straggler");
  });

  it("keeps painting the legacy array while the subscription has not landed", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-only" }] }),
    );
    expect(tryoutIds()).toBe("legacy-only");
  });
});

describe("TeamProvider signup subcollections — migration writes", () => {
  // Legacy entry with no subcollection twin: the backfill's only job.
  const legacyOnly = teamDoc({
    tryoutSignups: [{ id: "legacy-a", playerName: "Alpha" }],
  });

  it("holds the backfill until BOTH subscriptions are server-confirmed", async () => {
    await mountProvider();
    await emitDoc(teamPath("t1"), legacyOnly);
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

  it("abandons the pending drop when a new legacy entry arrives mid-settle", async () => {
    await mountProvider();
    await emitDoc(
      teamPath("t1"),
      teamDoc({ tryoutSignups: [{ id: "legacy-a" }] }),
    );
    await emitCollection(subPath("t1", "tryoutSignups"), [
      { id: "legacy-a", data: {} },
    ]);
    await emitCollection(subPath("t1", "interestSignups"), []);

    // A portal client's arrayUnion lands before the timer fires. The re-proof
    // at write time must see it and abandon the drop, or the entry is deleted
    // having never been mirrored into the subcollection.
    await emitDoc(
      teamPath("t1"),
      teamDoc({
        tryoutSignups: [{ id: "legacy-a" }, { id: "legacy-late" }],
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS * 2);
    });
    expect(dropWrites()).toHaveLength(0);
    // ...and the straggler is visible to the coach in the meantime.
    expect(tryoutIds()).toBe("legacy-a,legacy-late");
  });
});
