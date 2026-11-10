import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Coverage for lineup / attendance AUTOSAVE in UIProvider (harness shared with
// UIProvider.remoteConflict.test.tsx).
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

const WARNING = /another coach changed this game/i;

const emitGame = (game: Record<string, unknown>) =>
  emitCollection(`${teamPath("ta")}/games`, [
    { id: game.id as string, data: game },
  ]);

const secondGame = {
  id: "ta-g2",
  opponent: "Sharks",
  date: "2026-05-08",
  lineup: slimLineup(roster),
  battingLineup: slimBatting(roster),
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
    { id: secondGame.id, data: secondGame },
  ]);
  await emitCollection(`${teamPath("ta")}/players`, []);
  act(() => uiApi.setSelectedGameId("ta-g1"));
};

// Every game write the app sent, from any batch or direct write.
const gameWrites = () => {
  const out: Array<{ path: string; data: any }> = [];
  const batches = (firestore.writeBatch as unknown as ReturnType<typeof vi.fn>)
    .mock.results;
  for (const r of batches) {
    const b = r.value as Record<string, ReturnType<typeof vi.fn>>;
    for (const m of ["set", "update"])
      for (const call of b[m].mock.calls)
        out.push({ path: call[0]?.__path || "", data: call[1] });
  }
  for (const fn of [firestore.setDoc, firestore.updateDoc] as any[])
    for (const call of fn.mock.calls)
      out.push({ path: call[0]?.__path || "", data: call[1] });
  return out.filter((w) => w.path.includes("/games/"));
};
const writesTo = (gameId: string) =>
  gameWrites().filter((w) => w.path.endsWith(`/games/${gameId}`));

// Swap the 1B and 2B kids in inning 1 the way a coach does: two taps.
const swapOneTwo = async () => {
  await act(async () => {
    uiApi.handleCellClick(0, "1B", uiApi.lineup[0]["1B"]);
  });
  await act(async () => {
    uiApi.handleCellClick(0, "2B", uiApi.lineup[0]["2B"]);
  });
};
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];

beforeEach(() => {
  listeners.length = 0;
  teamApi = null;
  uiApi = null;
  vi.clearAllMocks();
});

describe("UIProvider — lineup autosave", () => {
  it("opening a game in the editor never writes", async () => {
    await mount();
    await new Promise((r) => setTimeout(r, 900));
    expect(gameWrites()).toEqual([]);
  });

  it("a coach's edit saves itself shortly after, to that game", async () => {
    await mount();
    await swapOneTwo();
    // Debounced: nothing yet.
    expect(writesTo("ta-g1")).toEqual([]);
    await waitFor(() => expect(writesTo("ta-g1").length).toBeGreaterThan(0), {
      timeout: 2000,
    });
    const saved = last(writesTo("ta-g1"))!.data;
    expect(saved.lineup[0]["1B"].id).toBe(roster[3].id);
    expect(saved.lineup[0]["2B"].id).toBe(roster[2].id);
  });

  it("switching games lands the pending edit on the game it was made on", async () => {
    await mount();
    await swapOneTwo();
    // Switch before the debounce fires.
    act(() => uiApi.setSelectedGameId("ta-g2"));
    await waitFor(() => expect(writesTo("ta-g1").length).toBeGreaterThan(0));
    expect(last(writesTo("ta-g1"))!.data.lineup[0]["1B"].id).toBe(roster[3].id);
    await new Promise((r) => setTimeout(r, 900));
    expect(writesTo("ta-g2")).toEqual([]);
  });

  it("an attendance tap saves itself", async () => {
    await mount();
    act(() =>
      uiApi.updateCurrentGameAttendance({
        ...uiApi.currentGameAttendance,
        p9: false,
      }),
    );
    await waitFor(
      () => expect(last(writesTo("ta-g1"))?.data.attendance?.p9).toBe(false),
      { timeout: 2000 },
    );
  });

  it("stands down when another coach changes the same game mid-edit", async () => {
    await mount();
    await swapOneTwo();
    const theirs = [roster[2], roster[1], roster[0], ...roster.slice(3)];
    await emitGame(gameWith(slimLineup(theirs), slimBatting(theirs)));
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 900));
    // Nothing overwrote the other coach's lineup.
    expect(writesTo("ta-g1")).toEqual([]);
    // The coach's own work is still on screen to save explicitly.
    expect(uiApi.lineup[0]["1B"].id).toBe(roster[3].id);
  });
});

describe("UIProvider — opening In-Game mode", () => {
  const threeInnings = {
    id: "ta-g3",
    opponent: "Owls",
    date: "2026-05-15",
    lineup: [
      ...slimLineup(roster),
      ...slimLineup(roster),
      ...slimLineup(roster),
    ],
    battingLineup: slimBatting(roster),
    liveInning: 2,
  };
  const withThird = () =>
    emitCollection(`${teamPath("ta")}/games`, [
      { id: "ta-g1", data: gameWith(slimLineup(roster), slimBatting(roster)) },
      { id: threeInnings.id, data: threeInnings },
    ]);

  it("resumes a game at its saved inning, and re-opening keeps undo", async () => {
    await mount();
    await withThird();
    act(() => uiApi.setInGameId("ta-g3"));
    await waitFor(() => expect(uiApi.inGameInning).toBe(2));

    // Some undo history, then close and re-open the SAME game.
    act(() => uiApi.setInGameUndoStack([{ lineup: [], locks: {} }]));
    act(() => uiApi.setInGameId(null));
    act(() => uiApi.setInGameId("ta-g3"));
    expect(uiApi.inGameUndoStack).toHaveLength(1);
    expect(uiApi.inGameInning).toBe(2);

    // A DIFFERENT game starts fresh.
    act(() => uiApi.setInGameId("ta-g1"));
    await waitFor(() => expect(uiApi.inGameUndoStack).toHaveLength(0));
    expect(uiApi.inGameInning).toBe(0);
  });
});
