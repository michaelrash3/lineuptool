import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

const WARNING = /another coach changed this game/i;

// Once the games lane has landed, team.games is assembled from the
// subcollection — so a "remote" edit arrives as a games-doc snapshot, not as
// a new team doc.
const emitGame = (game: Record<string, unknown>) =>
  emitCollection(`${teamPath("ta")}/games`, [
    { id: game.id as string, data: game },
  ]);

const mountAndSelect = async () => {
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
  act(() => uiApi.setSelectedGameId("ta-g1"));
};

beforeEach(() => {
  listeners.length = 0;
  teamApi = null;
  uiApi = null;
  vi.clearAllMocks();
});

describe("UIProvider — remote game-conflict warning", () => {
  it("stays silent when the coach's own save echoes back slimmed", async () => {
    await mountAndSelect();

    // Coach edits in the editor: whole player objects, a new assignment.
    act(() => {
      uiApi.setLineup(fatLineup(swapped));
      uiApi.setBattingLineup(swapped);
    });
    // Save, then the write comes back off Firestore slimmed to
    // {id, name, number} — byte-different, same lineup.
    await act(async () => {
      teamApi.saveCurrentGame();
    });
    await emitGame(gameWith(slimLineup(swapped), slimBatting(swapped)));

    // Give the toast every chance to appear before asserting it did not.
    await waitFor(() => expect(uiApi.selectedGameId).toBe("ta-g1"));
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("stays silent when a save echoes back with no local edit at all", async () => {
    await mountAndSelect();
    await act(async () => {
      teamApi.saveCurrentGame();
    });
    await emitGame(gameWith(slimLineup(roster), slimBatting(roster)));
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("stays silent when the echo of an earlier save lands mid-edit", async () => {
    // Save, then keep tweaking before Firestore answers. The echo carries the
    // SLIMMED version of what was already saved, so it is not a remote edit at
    // all — but a byte compare sees slim-vs-fat, calls it remote, and then
    // finds the in-progress tweak "unsaved". That combination is what put the
    // warning on screen mid-edit.
    await mountAndSelect();
    act(() => {
      uiApi.setLineup(fatLineup(swapped));
      uiApi.setBattingLineup(swapped);
    });
    await act(async () => {
      teamApi.saveCurrentGame();
    });

    // Still editing: a further swap the coach has not saved yet.
    const tweaked = [swapped[0], swapped[2], swapped[1], ...swapped.slice(3)];
    act(() => {
      uiApi.setLineup(fatLineup(tweaked));
      uiApi.setBattingLineup(tweaked);
    });

    // Now the earlier save comes back off Firestore.
    await emitGame(gameWith(slimLineup(swapped), slimBatting(swapped)));

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    // And the in-progress tweak survives — nothing was re-synced over it.
    expect(uiApi.battingLineup[1].id).toBe(tweaked[1].id);
  });

  it("warns when another device lands a DIFFERENT lineup over unsaved edits", async () => {
    await mountAndSelect();

    // Unsaved local work.
    act(() => {
      uiApi.setLineup(fatLineup(swapped));
      uiApi.setBattingLineup(swapped);
    });
    // Meanwhile another coach saved a third arrangement.
    const theirs = [roster[2], roster[1], roster[0], ...roster.slice(3)];
    await emitGame(gameWith(slimLineup(theirs), slimBatting(theirs)));

    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    // The coach's own work is left on screen — the warning explains the
    // choice rather than making it for them.
    expect(uiApi.battingLineup[0].id).toBe(swapped[0].id);
  });

  it("adopts a remote change silently when there is nothing unsaved", async () => {
    await mountAndSelect();

    const theirs = [roster[2], roster[1], roster[0], ...roster.slice(3)];
    await emitGame(gameWith(slimLineup(theirs), slimBatting(theirs)));

    await waitFor(() => expect(uiApi.battingLineup[0].id).toBe(theirs[0].id));
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("does not warn on a rename — roster data is not a lineup change", async () => {
    await mountAndSelect();
    act(() => {
      uiApi.setLineup(fatLineup(swapped));
      uiApi.setBattingLineup(swapped);
    });
    await act(async () => {
      teamApi.saveCurrentGame();
    });

    const renamed = swapped.map((p) =>
      p.id === "p1" ? { ...p, name: "Renamed Kid", number: "99" } : p,
    );
    await emitGame(gameWith(slimLineup(renamed), slimBatting(renamed)));

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });
});
