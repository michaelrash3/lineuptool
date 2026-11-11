import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The availability form's game/practice DAYS (portalSchedules/{slug}). Only
// published while the head coach has it on, only under a confirmed link doc,
// and taken down when turned off. Harness copied from
// TeamProvider.mapDeletes.test.tsx (real provider tree, mocked Firestore).

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
  const listeners: Array<{ path: string; next: (snap: unknown) => void }> = [];
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
    query: (target: unknown) => target,
    where: () => ({}),
    onSnapshot: (target: unknown, ...rest: unknown[]) => {
      const hasOptions = typeof rest[0] !== "function";
      const next = (hasOptions ? rest[1] : rest[0]) as (s: unknown) => void;
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
import { UIProvider } from "./UIProvider";
import { ConfirmProvider } from "../components/ConfirmDialog";
import { useTeam } from "../contexts";

const listeners = (
  firestore as unknown as {
    __listeners: Array<{ path: string; next: (snap: unknown) => void }>;
  }
).__listeners;

const SETTINGS = "artifacts/test-app/users/u1/settings/teams";
const teamPath = (id: string) => `artifacts/test-app/public/data/teams/${id}`;

const emitDoc = (path: string, data: Record<string, unknown> | null) =>
  act(() => {
    const snap = {
      exists: () => data !== null,
      data: () => data,
      metadata: { fromCache: false, hasPendingWrites: false },
    };
    listeners.filter((l) => l.path === path).forEach((l) => l.next(snap));
  });

// Games and players are per-doc subcollections (the Phase 3a/3b migration).
// updateTeamArrays refuses a mapEntries op on a lane that has not landed, so
// a lineup save is a no-op until these deliver — which is exactly what
// saveCurrentGame needs here.
const emitCollection = (path: string, docs: Array<{ id: string; data: any }>) =>
  act(() => {
    const snap = {
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
      empty: docs.length === 0,
      metadata: { fromCache: false, hasPendingWrites: false },
    };
    listeners.filter((l) => l.path === path).forEach((l) => l.next(snap));
  });

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const GAME_DAY = inDays(5);
const PRACTICE_DAY = inDays(3);
const SCHEDULE = "artifacts/test-app/public/data/portalSchedules/share-ta";
const LINK = "artifacts/test-app/public/data/portalLinks/share-ta";

let teamApi: any = null;
const Probe = () => {
  teamApi = useTeam();
  return null;
};

const mount = async (extra: Record<string, unknown>) => {
  await act(async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <TeamProvider>
              <UIProvider>
                <Probe />
              </UIProvider>
            </TeamProvider>
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
  });
  await emitDoc(SETTINGS, {
    teams: [{ id: "ta", name: "TA" }],
    activeTeamId: "ta",
  });
  const game = {
    id: "ta-g1",
    opponent: "Rivals",
    location: "Field 3",
    date: GAME_DAY,
  };
  await emitDoc(teamPath("ta"), {
    name: "Team ta",
    ownerId: "u1",
    members: ["u1"],
    players: [],
    games: [game],
    practices: [{ id: "pr1", date: PRACTICE_DAY, location: "Park" }],
    evalSchemaVersion: 11,
    leagueRuleSet: "USSSA",
    teamAge: "10U",
    tryoutShareId: "share-ta",
    tryoutSignups: [],
    interestSignups: [],
    ...extra,
  });
  await emitCollection(`${teamPath("ta")}/games`, [
    { id: game.id, data: game },
  ]);
  await emitCollection(`${teamPath("ta")}/players`, []);
};

const callsTo = (fn: any, path: string) =>
  fn.mock.calls.filter((c: any[]) => c[0]?.__path === path);

beforeEach(() => {
  listeners.length = 0;
  teamApi = null;
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, and some tests below make getDoc
  // report docs as existing — put the default (nothing exists) back.
  (firestore.getDoc as any).mockImplementation(() =>
    Promise.resolve({ exists: () => false, data: () => ({}) }),
  );
});

describe("availability-form schedule days", () => {
  it("publishes nothing — and reads nothing — for a team that never turned it on", async () => {
    await mount({});
    // The link doc still gets made...
    await waitFor(() =>
      expect(callsTo(firestore.setDoc, LINK)).toHaveLength(1),
    );
    // ...but no schedule doc is touched.
    expect(callsTo(firestore.setDoc, SCHEDULE)).toHaveLength(0);
    expect(callsTo(firestore.getDoc, SCHEDULE)).toHaveLength(0);
    expect(callsTo(firestore.deleteDoc, SCHEDULE)).toHaveLength(0);
  });

  it("publishes bare dates once the link doc is confirmed", async () => {
    await mount({ availabilityShowsSchedule: true });
    await waitFor(() =>
      expect(callsTo(firestore.setDoc, SCHEDULE)).toHaveLength(1),
    );
    // The link doc was written first — the rules only allow the schedule
    // under a link that names this team.
    const order = (firestore.setDoc as any).mock.calls.map(
      (c: any[]) => c[0]?.__path,
    );
    expect(order.indexOf(LINK)).toBeLessThan(order.indexOf(SCHEDULE));
    const [, payload] = callsTo(firestore.setDoc, SCHEDULE)[0];
    expect(payload).toEqual({
      teamId: "ta",
      gameDays: [GAME_DAY],
      practiceDays: [PRACTICE_DAY],
      updatedAt: expect.any(Number),
    });
    expect(JSON.stringify(payload)).not.toMatch(/Rivals|Field|Park/);
  });

  it("takes the days down when the coach turns it off", async () => {
    (firestore.getDoc as any).mockImplementation((ref: any) =>
      Promise.resolve({
        exists: () => ref?.__path === SCHEDULE || ref?.__path === LINK,
        data: () => ({ teamId: "ta" }),
      }),
    );
    await mount({ availabilityShowsSchedule: false });
    await waitFor(() =>
      expect(callsTo(firestore.deleteDoc, SCHEDULE)).toHaveLength(1),
    );
    expect(callsTo(firestore.setDoc, SCHEDULE)).toHaveLength(0);
  });

  it("takes them down when the Availability module is off", async () => {
    (firestore.getDoc as any).mockImplementation((ref: any) =>
      Promise.resolve({
        exists: () => ref?.__path === SCHEDULE || ref?.__path === LINK,
        data: () => ({ teamId: "ta" }),
      }),
    );
    await mount({
      availabilityShowsSchedule: true,
      disabledFeatures: ["availability"],
    });
    await waitFor(() =>
      expect(callsTo(firestore.deleteDoc, SCHEDULE)).toHaveLength(1),
    );
    expect(callsTo(firestore.setDoc, SCHEDULE)).toHaveLength(0);
    expect(teamApi).toBeTruthy();
  });
});

describe("the form-link doc", () => {
  it("retries a failed create — without it the team's form links are dead", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      (firestore.setDoc as any).mockImplementation((ref: any) =>
        ref?.__path === LINK && callsTo(firestore.setDoc, LINK).length === 1
          ? Promise.reject(new Error("unavailable"))
          : Promise.resolve(),
      );
      await mount({});
      await vi.waitFor(() =>
        expect(callsTo(firestore.setDoc, LINK)).toHaveLength(1),
      );
      // Nothing changes on the team — the retry has to come by itself.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await vi.waitFor(() =>
        expect(callsTo(firestore.setDoc, LINK)).toHaveLength(2),
      );
    } finally {
      vi.useRealTimers();
      (firestore.setDoc as any).mockImplementation(() => Promise.resolve());
    }
  });
});
