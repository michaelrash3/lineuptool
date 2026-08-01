import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The GAME-scoped sibling of TeamProvider.teamSwitch.test.tsx's undo-toast
// coverage. The generate/re-roll Undo toast reads a snapshot stamped with the
// game it was captured from, and applyUndoSnapshot refuses once a DIFFERENT
// game is selected — so after a game switch the still-visible button could
// only ever be a silent no-op. The fix dismisses it at the seam instead:
// UIProvider owns selectedGameId, TeamProvider owns the toast id, and the
// selectedGameId effect reports the change through
// team.dismissLineupUndoToast. This mounts the REAL provider tree
// (ToastProvider › TeamProvider › UIProvider, real engine, real bridge) so
// the whole seam is exercised, not a mock of it.

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
import { useTeam, useUI, useToast } from "../contexts";

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

const roster = Array.from({ length: 9 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Kid ${i + 1}`,
  number: String(i + 1),
}));
const slim = roster.map((p) => ({ id: p.id, name: p.name }));
// Each game carries a SAVED lineup + batting order so selecting it loads the
// editor (regenerateBatting refuses on an empty editor).
const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const savedGame = (id: string) => ({
  id,
  opponent: `Rivals ${id}`,
  date: "2026-05-01",
  lineup: [Object.fromEntries(POSITIONS.map((pos, i) => [pos, slim[i]]))],
  battingLineup: slim,
});

const teamDoc = () => ({
  name: "Team ta",
  ownerId: "u1",
  members: ["u1"],
  players: roster,
  games: [savedGame("ta-g1"), savedGame("ta-g2")],
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
let toastApi: any = null;

const Probe = () => {
  teamApi = useTeam();
  uiApi = useUI();
  toastApi = useToast();
  return null;
};

const mountTree = async () => {
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
  await emitDoc(teamPath("ta"), teamDoc());
};

const undoButtons = () => screen.queryAllByRole("button", { name: "Undo" });
// Dismissed toasts exit through an AnimatePresence animation — eventually-gone.
const expectNoUndoButton = () =>
  waitFor(() => expect(undoButtons()).toHaveLength(0));

beforeEach(() => {
  listeners.length = 0;
  teamApi = null;
  uiApi = null;
  toastApi = null;
  vi.clearAllMocks();
});

describe("UIProvider — the lineup Undo toast is game-scoped (dismissed at the seam)", () => {
  it("dismisses the Undo toast on game switch; unrelated toasts survive", async () => {
    await mountTree();
    act(() => uiApi.setSelectedGameId("ta-g1"));
    await act(async () => {
      teamApi.regenerateBatting();
    });
    expect(undoButtons().length).toBeGreaterThan(0);

    // Unrelated sticky toast that must SURVIVE the switch.
    act(() => {
      toastApi.push({ title: "Unrelated toast", duration: 0 });
    });

    // Selecting a different game invalidates the snapshot (applyUndoSnapshot
    // would refuse) — the toast goes with it instead of lingering as a dead
    // button.
    act(() => uiApi.setSelectedGameId("ta-g2"));
    await expectNoUndoButton();
    expect(screen.getByText("Unrelated toast")).toBeInTheDocument();
  });

  it("dismisses on DESELECT too (game deleted / selection cleared)", async () => {
    await mountTree();
    act(() => uiApi.setSelectedGameId("ta-g1"));
    await act(async () => {
      teamApi.regenerateBatting();
    });
    expect(undoButtons().length).toBeGreaterThan(0);

    act(() => uiApi.setSelectedGameId(null));
    await expectNoUndoButton();
  });

  it("an unrelated snapshot on the SAME game leaves the live toast alone", async () => {
    await mountTree();
    act(() => uiApi.setSelectedGameId("ta-g1"));
    await act(async () => {
      teamApi.regenerateBatting();
    });
    expect(undoButtons().length).toBeGreaterThan(0);

    // A fresh team-doc snapshot re-renders everything, but selectedGameId did
    // not change — the toast must stay.
    await emitDoc(teamPath("ta"), teamDoc());
    expect(undoButtons().length).toBeGreaterThan(0);
  });

  it("a NEW re-roll on the new game re-arms — exactly one live Undo", async () => {
    await mountTree();
    act(() => uiApi.setSelectedGameId("ta-g1"));
    await act(async () => {
      teamApi.regenerateBatting();
    });
    act(() => uiApi.setSelectedGameId("ta-g2"));
    await expectNoUndoButton();

    await act(async () => {
      teamApi.regenerateBatting();
    });
    expect(undoButtons()).toHaveLength(1);
  });
});
