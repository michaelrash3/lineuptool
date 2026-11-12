import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Keeping the published calendar feed in step with the schedule, and turning
// the link on and off. Firestore is a small in-memory stand-in so the tests
// can see exactly what was written to the public feed doc.

vi.mock("../firebase", () => ({ db: {}, appId: "test-app" }));

const store = vi.hoisted(() => ({
  docs: new Map<string, any>(),
  writes: [] as string[],
  failNext: null as null | "get" | "set" | "delete",
}));

vi.mock("firebase/firestore", () => {
  const fail = (op: "get" | "set" | "delete") => {
    if (store.failNext !== op) return false;
    store.failNext = null;
    return true;
  };
  return {
    doc: (_db: unknown, ...segments: string[]) => ({
      path: segments.join("/"),
    }),
    getDoc: async (ref: { path: string }) => {
      if (fail("get")) throw new Error("offline");
      const data = store.docs.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    },
    setDoc: async (ref: { path: string }, data: any) => {
      if (fail("set")) throw new Error("denied");
      store.docs.set(ref.path, data);
      store.writes.push(`set ${ref.path}`);
    },
    deleteDoc: async (ref: { path: string }) => {
      if (fail("delete")) throw new Error("offline");
      store.docs.delete(ref.path);
      store.writes.push(`delete ${ref.path}`);
    },
  };
});

import { useCalendarFeed } from "./useCalendarFeed";
import { CALENDAR_FEED_TOKEN_RE } from "../utils/calendarFeed";

const TOKEN = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4";
const FEED_PATH = `artifacts/test-app/public/data/calendarFeeds/team-1.${TOKEN}`;
const game = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  date: "2026-05-16",
  opponent: "Cubs",
  ...over,
});

const mount = (over: Record<string, unknown> = {}) => {
  const updateTeam = vi.fn();
  const toast = { push: vi.fn(), dismiss: vi.fn() };
  const initial = {
    activeTeamId: "team-1" as string | null,
    user: { uid: "u1" } as { uid: string } | null,
    teamData: {
      name: "Hawks",
      calendarFeedToken: TOKEN,
      games: [game()],
    } as any,
    gamesReady: true,
    isHead: true,
    updateTeam,
    toast,
    ...over,
  };
  const view = renderHook((props) => useCalendarFeed(props), {
    initialProps: initial,
  });
  return { ...view, initial, updateTeam, toast };
};

const published = () => store.docs.get(FEED_PATH);

beforeEach(() => {
  store.docs.clear();
  store.writes.length = 0;
  store.failNext = null;
});

describe("useCalendarFeed — publishing", () => {
  it("publishes the season under the team's id and token", async () => {
    mount();
    await waitFor(() => expect(published()).toBeDefined());
    expect(published().teamId).toBe("team-1");
    expect(published().ics).toContain("SUMMARY:Hawks vs Cubs");
    expect(Object.keys(published()).sort()).toEqual([
      "ics",
      "teamId",
      "updatedAt",
    ]);
  });

  it("publishes nothing while the team has no link", async () => {
    mount({ teamData: { name: "Hawks", games: [game()] } });
    await act(async () => {});
    expect(store.writes).toEqual([]);
  });

  it("waits for the server's games — never publishes a first paint from cache", async () => {
    // An empty or day-old cache would blank or roll back every subscriber.
    const view = mount({ gamesReady: false });
    await act(async () => {});
    expect(store.writes).toEqual([]);
    view.rerender({ ...view.initial, gamesReady: true });
    await waitFor(() => expect(published()).toBeDefined());
  });

  it("republishes when a game moves", async () => {
    const view = mount();
    await waitFor(() => expect(published()).toBeDefined());
    view.rerender({
      ...view.initial,
      teamData: {
        ...view.initial.teamData,
        games: [game({ date: "2026-05-17" })],
      },
    });
    await waitFor(() => expect(published().ics).toContain("20260517"));
    expect(store.writes).toHaveLength(2);
  });

  it("doesn't rewrite a feed that already says the same thing", async () => {
    // e.g. opening the app: the schedule hasn't changed since the last coach
    // published it, so nothing should be written (or re-stamped).
    const first = mount();
    await waitFor(() => expect(published()).toBeDefined());
    first.unmount();
    store.writes.length = 0;
    mount();
    await act(async () => {});
    expect(store.writes).toEqual([]);
  });

  it("tries again after a failed publish instead of going quiet", async () => {
    vi.useFakeTimers();
    try {
      store.failNext = "set";
      mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(published()).toBeUndefined();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(published()).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useCalendarFeed — turning the link on and off", () => {
  it("a head coach creates a link by giving the team a fresh token", () => {
    const view = mount({ teamData: { name: "Hawks", games: [] } });
    act(() => view.result.current.enableCalendarFeed());
    expect(view.updateTeam).toHaveBeenCalledTimes(1);
    const { calendarFeedToken } = view.updateTeam.mock.calls[0][0];
    expect(CALENDAR_FEED_TOKEN_RE.test(calendarFeedToken)).toBe(true);
    expect(calendarFeedToken).not.toBe(TOKEN);
  });

  it("turning it off takes the published feed down, then forgets the token", async () => {
    const view = mount();
    await waitFor(() => expect(published()).toBeDefined());
    let done: boolean | undefined;
    await act(async () => {
      done = await view.result.current.disableCalendarFeed();
    });
    expect(done).toBe(true);
    expect(published()).toBeUndefined();
    expect(view.updateTeam).toHaveBeenCalledWith({ calendarFeedToken: null });
  });

  it("keeps the token when the feed couldn't be taken down", async () => {
    // Forgetting the token first would strand a readable feed nobody could
    // find to delete.
    const view = mount();
    await waitFor(() => expect(published()).toBeDefined());
    store.failNext = "delete";
    let done: boolean | undefined;
    await act(async () => {
      done = await view.result.current.disableCalendarFeed();
    });
    expect(done).toBe(false);
    expect(published()).toBeDefined();
    expect(view.updateTeam).not.toHaveBeenCalled();
    expect(view.toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error" }),
    );
  });

  it("an assistant can neither create nor retire the link", async () => {
    const view = mount({ isHead: false });
    await waitFor(() => expect(published()).toBeDefined());
    act(() => view.result.current.enableCalendarFeed());
    await act(async () => {
      await view.result.current.disableCalendarFeed();
    });
    expect(view.updateTeam).not.toHaveBeenCalled();
    expect(published()).toBeDefined();
  });
});
