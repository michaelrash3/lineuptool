import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Team-scoped state that must not outlive a team switch — the bug class #583
// closed on the raw signup arrays and loadedTeamIdRef, audited across the rest
// of TeamProvider and covered here.
//
// Three separate holdovers, one file, because they share a failure shape: a
// ref (or a state field the team doc deliberately does NOT own) is written
// while team A is active, nothing resets it, and team B reads it as its own.
//
//  1. previousLineupRef — the lineup UNDO buffer. Holds one team's roster
//     arranged into position and batting slots. The generate / re-roll toasts
//     carry an "Undo" action that reads it at CLICK time, and ToastProvider
//     sits ABOVE TeamProvider, so a team switch does not unmount the toast
//     stack: the button is still on screen and still live. Undo pushes the
//     snapshot into the editor through the uiBridge and the next Save writes
//     the editor onto the selected game — team A's kids into team B's game.
//  2. teamData.evaluationEvents — owned by the evalRounds subscription, not by
//     the team doc (whose handler carries the field across snapshots
//     verbatim), so nothing in the team-doc path clears it.
//  3. lastAutoCorrectRef — the defenseSize/format auto-correct's anti-retry-
//     storm guard, keyed by the league/age/size/format tuple alone.
//
// Provider-level on purpose: every one of these is an interaction between an
// effect's teardown and state owned elsewhere in the provider. Only the real
// provider has both halves.

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
  // Live listeners tagged with the path they subscribed to, so a snapshot can
  // be delivered to exactly one team's lane — and a listener that failed to
  // unsubscribe shows up as the previous team's data in an assertion.
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
      // Both call shapes: (ref, next, err) and (ref, options, next, err).
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
import { ConfirmProvider } from "../components/ConfirmDialog";
import { useTeam } from "../contexts";

const listeners = (
  firestore as unknown as {
    __listeners: Array<{ path: string; next: (snap: unknown) => void }>;
  }
).__listeners;
const setDocMock = firestore.setDoc as unknown as ReturnType<typeof vi.fn>;

const SETTINGS = "artifacts/test-app/users/u1/settings/teams";
const teamPath = (id: string) => `artifacts/test-app/public/data/teams/${id}`;
const evalPath = (id: string) => `${teamPath(id)}/evalRounds`;

const emitDoc = (path: string, data: Record<string, unknown> | null) =>
  act(() => {
    const snap = {
      exists: () => data !== null,
      data: () => data,
      metadata: { fromCache: false, hasPendingWrites: false },
    };
    listeners.filter((l) => l.path === path).forEach((l) => l.next(snap));
  });

const emitCollection = (
  path: string,
  docs: Array<{ id: string; data: Record<string, unknown> }>,
) =>
  act(() => {
    const snap = {
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
      empty: docs.length === 0,
      metadata: { fromCache: false, hasPendingWrites: false },
    };
    listeners.filter((l) => l.path === path).forEach((l) => l.next(snap));
  });

const roster = (prefix: string) =>
  Array.from({ length: 9 }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    name: `${prefix.toUpperCase()} Kid ${i + 1}`,
    number: String(i + 1),
  }));

// A team doc the provider treats as fully loaded and owned by the test user
// (ownerId ⇒ realRole "head"), at the current eval schema so the migration
// ladder never fires a write, and with a legal league/age/size/format tuple so
// the defenseSize auto-correct stays quiet unless a test asks for it.
const teamDoc = (id: string, over: Record<string, unknown> = {}) => ({
  name: `Team ${id}`,
  ownerId: "u1",
  members: ["u1"],
  players: roster(id),
  games: [{ id: `${id}-g1`, opponent: "Rivals", date: "2026-05-01" }],
  evalSchemaVersion: 11,
  leagueRuleSet: "USSSA",
  teamAge: "8U",
  defenseSize: "9",
  pitchingFormat: "Kid Pitch",
  tryoutSignups: [],
  interestSignups: [],
  ...over,
});

let teamApi: any = null;

const Probe = () => {
  teamApi = useTeam();
  return null;
};

// Stand-in for UIProvider's half of the bridge, faithful to the real contract
// (src/providers/UIProvider.tsx): getInputs publishes the editor's current
// game / attendance / lineup, applyResult receives what the action hooks push
// back. Recorded, so a wrong-team push is visible.
const applied: Array<{ lineup: any; battingLineup: any }> = [];
const wireBridge = (teamId: string) => {
  const lineup = [
    Object.fromEntries(
      ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"].map((pos, i) => [
        pos,
        {
          id: `${teamId}${i + 1}`,
          name: `${teamId.toUpperCase()} Kid ${i + 1}`,
        },
      ]),
    ),
  ];
  const battingLineup = roster(teamId).map((p) => ({ id: p.id, name: p.name }));
  teamApi.uiBridge.current = {
    getInputs: () => ({
      currentGame: { id: `${teamId}-g1` },
      currentGameAttendance: {},
      firstInningLineup: {},
      previousLineup: lineup,
      previousBattingLineup: battingLineup,
      lineup,
      battingLineup,
      lineupQualityPenalty: null,
      tournamentPlan: null,
    }),
    applyResult: (r: any) => applied.push(r),
    applyTemplate: () => {},
    markSaved: () => {},
  };
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
  await emitDoc(SETTINGS, {
    teams: [
      { id: "ta", name: "TA" },
      { id: "tb", name: "TB" },
    ],
    activeTeamId: "ta",
  });
};

// Ids of every player an undo pushed into the editor, defence and batting
// order alike — that set is what must never contain another team's.
const appliedPlayerIds = () => [
  ...new Set(
    applied.flatMap((r) => [
      ...(r.lineup || []).flatMap((inn: any) =>
        Object.values(inn || {}).map((p: any) => p?.id),
      ),
      ...(r.battingLineup || []).map((p: any) => p?.id),
    ]),
  ),
];
const foreignIds = (prefix: string) =>
  appliedPlayerIds().filter((id) => String(id).startsWith(prefix));

// Team-doc writes carrying a defenseSize correction, by team.
const defenseSizeWrites = (teamId: string) =>
  setDocMock.mock.calls.filter(
    (call) =>
      (call[0] as { __path?: string })?.__path === teamPath(teamId) &&
      (call[1] as { defenseSize?: string })?.defenseSize !== undefined,
  );

beforeEach(() => {
  listeners.length = 0;
  applied.length = 0;
  teamApi = null;
  vi.clearAllMocks();
});

describe("TeamProvider — the lineup undo buffer is team-scoped", () => {
  it("drops the undo snapshot on team switch so undo can't write team A's lineup onto team B", async () => {
    await mountProvider();
    await emitDoc(teamPath("ta"), teamDoc("ta"));

    // Team A: re-roll the batting order. That arms previousLineupRef with the
    // pre-roll snapshot — team A's roster in team A's slots.
    wireBridge("ta");
    await act(async () => {
      teamApi.regenerateBatting();
    });

    // The buffer really is armed: undo on team A restores team A's players.
    // Without this the "nothing restored" assertion below would pass against a
    // buffer that was never populated in the first place.
    applied.length = 0;
    await act(async () => {
      teamApi.undoLineup();
    });
    expect(applied).toHaveLength(1);
    expect(appliedPlayerIds()).toContain("ta1");

    // Switch to team B and let its doc land. The coach is now editing a
    // different team with the re-roll toast — and its live Undo button — still
    // on screen.
    await act(async () => {
      await teamApi.switchTeam("tb");
    });
    await emitDoc(teamPath("tb"), teamDoc("tb"));

    wireBridge("tb");
    applied.length = 0;
    await act(async () => {
      teamApi.undoLineup();
    });

    // Nothing restored: the snapshot belonged to a team the coach left. The
    // PII assertion goes first so a failure names the actual harm — team A's
    // kids in team B's editor — rather than just "a call happened".
    expect(foreignIds("ta")).toEqual([]);
    expect(applied).toHaveLength(0);
  });

  it("clears the buffer even when the next team's doc never loads", async () => {
    await mountProvider();
    await emitDoc(teamPath("ta"), teamDoc("ta"));
    wireBridge("ta");
    await act(async () => {
      teamApi.regenerateBatting();
    });

    // Missing (or denied) team doc: the previous subscription is torn down all
    // the same, and that teardown is the only thing between the stale snapshot
    // and the editor.
    await act(async () => {
      await teamApi.switchTeam("tb");
    });
    await emitDoc(teamPath("tb"), null);

    applied.length = 0;
    await act(async () => {
      teamApi.undoLineup();
    });
    expect(applied).toHaveLength(0);
  });

  it("re-arms for the new team — the clear doesn't disable undo permanently", async () => {
    await mountProvider();
    await emitDoc(teamPath("ta"), teamDoc("ta"));
    wireBridge("ta");
    await act(async () => {
      teamApi.regenerateBatting();
    });

    await act(async () => {
      await teamApi.switchTeam("tb");
    });
    await emitDoc(teamPath("tb"), teamDoc("tb"));

    wireBridge("tb");
    await act(async () => {
      teamApi.regenerateBatting();
    });
    applied.length = 0;
    await act(async () => {
      teamApi.undoLineup();
    });
    expect(applied).toHaveLength(1);
    expect(appliedPlayerIds()).toContain("tb1");
    expect(foreignIds("ta")).toEqual([]);
  });
});

describe("TeamProvider — assembled eval rounds are team-scoped", () => {
  // The team doc's handler sets `evaluationEvents: prev.evaluationEvents`
  // because the evalRounds subscription owns the field. So team B's doc
  // landing does NOT displace team A's rounds — only that subscription's own
  // teardown can.
  it("never shows the previous team's eval rounds under the next team", async () => {
    await mountProvider();
    await emitDoc(teamPath("ta"), teamDoc("ta"));
    await emitCollection(evalPath("ta"), [
      {
        id: "round-a",
        data: {
          evaluatorId: "u1",
          coachRole: "Head",
          grades: { ta1: { hitting: 5 } },
        },
      },
    ]);
    expect(teamApi.team.evaluationEvents.map((e: any) => e.id)).toEqual([
      "round-a",
    ]);

    await act(async () => {
      await teamApi.switchTeam("tb");
    });
    // Team B's doc has landed; its evalRounds read has NOT (rules lag, or an
    // outright denial — the subscription's error arm is a no-op, so this state
    // can persist for the whole session).
    await emitDoc(teamPath("tb"), teamDoc("tb"));
    expect(teamApi.team.evaluationEvents).toEqual([]);

    // And team B's own rounds still land normally afterwards.
    await emitCollection(evalPath("tb"), [
      {
        id: "round-b",
        data: {
          evaluatorId: "u1",
          coachRole: "Head",
          grades: { tb1: { hitting: 3 } },
        },
      },
    ]);
    expect(teamApi.team.evaluationEvents.map((e: any) => e.id)).toEqual([
      "round-b",
    ]);
  });
});

describe("TeamProvider — the defenseSize auto-correct guard is per team", () => {
  // USSSA is a 9-fielder league, so a stored defenseSize of "10" is corrected
  // on load. The guard that stops a failed write from re-arming the correction
  // used to key on the league/age/size/format tuple alone — which two teams
  // can share.
  it("still corrects the next team when it needs the identical correction", async () => {
    await mountProvider();
    await emitDoc(teamPath("ta"), teamDoc("ta", { defenseSize: "10" }));
    expect(defenseSizeWrites("ta")).toHaveLength(1);
    expect(defenseSizeWrites("ta")[0][1]).toMatchObject({ defenseSize: "9" });

    await act(async () => {
      await teamApi.switchTeam("tb");
    });
    // Same league, same age, same illegal size, same format — an ordinary
    // second squad, not a contrived doc.
    await emitDoc(teamPath("tb"), teamDoc("tb", { defenseSize: "10" }));
    expect(defenseSizeWrites("tb")).toHaveLength(1);
    expect(defenseSizeWrites("tb")[0][1]).toMatchObject({ defenseSize: "9" });
  });

  it("still refuses to re-fire for the SAME team on a revert", async () => {
    await mountProvider();
    await emitDoc(teamPath("ta"), teamDoc("ta", { defenseSize: "10" }));
    expect(defenseSizeWrites("ta")).toHaveLength(1);

    // The write failed and the optimistic update rolled back: the doc still
    // says "10". The guard must swallow this rather than start a retry storm.
    await emitDoc(teamPath("ta"), teamDoc("ta", { defenseSize: "10" }));
    expect(defenseSizeWrites("ta")).toHaveLength(1);
  });
});
