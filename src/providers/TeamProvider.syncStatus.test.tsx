import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The header's "Saving / Synced" label must stay "Saving" until the LAST
// write in flight lands — it used to read clean as soon as ANY write
// finished. Harness shared with UIProvider.remoteConflict.test.tsx.
//
// Original harness notes follow.
//
// Coverage for the "another coach changed this game" warning in UIProvider.
//
// The warning used to fire on EVERY save. The editor holds whole player
// objects straight off the engine; persistTeam slims them to
// {id, name, number} — so the coach's own save echoed back as a byte-different
// lineup and a raw JSON compare called it a remote edit. The comparison now
// runs on lineupSignature/battingSignature (who is in which slot), so the echo
// reads as identical and only a genuinely different lineup warns.
//
// Mounts the REAL provider tree (ToastProvider > TeamProvider > UIProvider) so
// the snapshot seam is exercised end to end, mirroring
// UIProvider.gameSwitchUndo.test.tsx.

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
import { useTeam, useUI } from "../contexts";

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

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

const roster = Array.from({ length: 9 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Kid ${i + 1}`,
  number: String(i + 1),
  // Season data the editor's copies carry and the persisted lineup drops.
  stats: { ab: i, h: i },
}));

// What the editor holds: whole player objects, straight off the engine.
const fatLineup = (order: typeof roster) => [
  Object.fromEntries(
    POSITIONS.map((pos, i) => [
      pos,
      { ...order[i], profile: { arm: i, contact: i } },
    ]),
  ),
];
// What Firestore holds: the same lineup after slimGame.
const slimLineup = (order: typeof roster) => [
  Object.fromEntries(
    POSITIONS.map((pos, i) => [
      pos,
      { id: order[i].id, name: order[i].name, number: order[i].number },
    ]),
  ),
];
const slimBatting = (order: typeof roster) =>
  order.map((p) => ({ id: p.id, name: p.name, number: p.number }));

const swapped = [roster[1], roster[0], ...roster.slice(2)];

const gameWith = (lineup: unknown, battingLineup: unknown) => ({
  id: "ta-g1",
  opponent: "Rivals",
  date: "2026-05-01",
  lineup,
  battingLineup,
});

const teamDoc = (game: Record<string, unknown>) => ({
  name: "Team ta",
  ownerId: "u1",
  members: ["u1"],
  players: roster,
  games: [game],
  evalSchemaVersion: 11,
  leagueRuleSet: "USSSA",
  teamAge: "8U",
  defenseSize: "9",
  pitchingFormat: "Kid Pitch",
  tryoutSignups: [],
  interestSignups: [],
});

let teamApi: any = null;
let uiApi: any = null;

const Probe = () => {
  teamApi = useTeam();
  uiApi = useUI();
  return null;
};

const mount = async () => {
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
  const game = gameWith(slimLineup(roster), slimBatting(roster));
  await emitDoc(teamPath("ta"), teamDoc(game));
  await emitCollection(`${teamPath("ta")}/games`, [
    { id: game.id, data: game },
  ]);
  await emitCollection(`${teamPath("ta")}/players`, []);
};

beforeEach(() => {
  listeners.length = 0;
  teamApi = null;
  uiApi = null;
  vi.clearAllMocks();
});

describe("TeamProvider — save status waits for every write", () => {
  it("stays 'Saving' until the last write in flight lands", async () => {
    await mount();
    const resolvers: Array<() => void> = [];
    // Hold the TEAM-doc saves open; other writes (the public mirror, the
    // invite backfill) resolve as usual.
    (firestore.setDoc as any).mockImplementation((ref: any) =>
      ref?.__path === teamPath("ta")
        ? new Promise<void>((r) => resolvers.push(r))
        : Promise.resolve(),
    );
    await act(async () => {
      teamApi.updateTeam({ name: "One" });
      teamApi.updateTeam({ notes: "Two" });
    });
    expect(teamApi.syncStatus).toBe("Saving");
    expect(resolvers).toHaveLength(2);

    // The first write lands; the second is still out there.
    await act(async () => {
      resolvers[0]();
    });
    expect(teamApi.syncStatus).toBe("Saving");

    await act(async () => {
      resolvers[1]();
    });
    await waitFor(() => expect(teamApi.syncStatus).toBe("Synced"));
  });
});
