import { describe, it, expect } from "vitest";
import { mergeGcEventsIntoGames } from "./gcSync";
import type { GcEvent } from "./icsParse";

const defaults = {
  leagueRuleSet: "NKB",
  pitchingFormat: "Machine Pitch",
  defenseSize: "10",
  battingSize: "roster",
  positionLock: "1",
};

const ev = (over: Partial<GcEvent> & { uid: string }): GcEvent => ({
  startUtc: "2026-06-06T14:00:00.000Z",
  endUtc: null,
  allDay: false,
  startDate: "2026-06-06",
  summary: "Trash Pandas 8u vs Dirt Dobbers",
  opponent: "Dirt Dobbers",
  isHome: true,
  location: null,
  ...over,
});

describe("mergeGcEventsIntoGames", () => {
  it("adds new games stamped with gcUid + defaults", () => {
    const { games, added, updated } = mergeGcEventsIntoGames([], [ev({ uid: "a" })], defaults);
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(games).toHaveLength(1);
    expect(games[0].gcUid).toBe("a");
    expect(games[0].opponent).toBe("Dirt Dobbers");
    expect(games[0].status).toBe("scheduled");
    expect(games[0].defenseSize).toBe("10");
    expect(typeof games[0].id).toBe("string");
  });

  it("de-dupes by gcUid — re-syncing the same feed adds nothing", () => {
    const first = mergeGcEventsIntoGames([], [ev({ uid: "a" })], defaults);
    const second = mergeGcEventsIntoGames(first.games, [ev({ uid: "a" })], defaults);
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.games).toHaveLength(1);
  });

  it("returns the SAME array reference when nothing changed (no needless write)", () => {
    const existing = [
      {
        id: "g1",
        gcUid: "a",
        date: "2026-06-06",
        startUtc: "2026-06-06T14:00:00.000Z",
        opponent: "Dirt Dobbers",
        isHome: true,
        location: "",
      },
    ];
    const res = mergeGcEventsIntoGames(existing, [ev({ uid: "a" })], defaults);
    expect(res.added).toBe(0);
    expect(res.updated).toBe(0);
    expect(res.games).toBe(existing); // reference-equal
  });

  it("updates a rescheduled game in place and preserves scores/lineup", () => {
    const existing = [
      {
        id: "g1",
        gcUid: "a",
        date: "2026-06-06",
        opponent: "Dirt Dobbers",
        isHome: true,
        location: "",
        teamScore: 7,
        opponentScore: 3,
        lineup: [{ inning: 1 }],
        status: "final",
      },
    ];
    const { games, added, updated } = mergeGcEventsIntoGames(
      existing,
      [
        // moved a day
        ev({
          uid: "a",
          startUtc: "2026-06-07T14:00:00.000Z",
          startDate: "2026-06-07",
        }),
      ],
      defaults
    );
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(games[0].date).toBe("2026-06-07");
    // Scores, lineup, status, and id untouched.
    expect(games[0].teamScore).toBe(7);
    expect(games[0].opponentScore).toBe(3);
    expect(games[0].lineup).toEqual([{ inning: 1 }]);
    expect(games[0].status).toBe("final");
    expect(games[0].id).toBe("g1");
  });

  it("leaves manually-added (non-gcUid) games alone", () => {
    const existing = [{ id: "m1", opponent: "Manual", date: "2026-05-01" }];
    const { games, added } = mergeGcEventsIntoGames(existing, [ev({ uid: "a" })], defaults);
    expect(added).toBe(1);
    expect(games).toHaveLength(2);
    expect(games.find((g) => g.id === "m1")).toBeTruthy();
  });

  it("all-day events keep their literal feed date and carry no instant", () => {
    const { games } = mergeGcEventsIntoGames(
      [],
      [ev({ uid: "t", allDay: true, startUtc: null, startDate: "2026-06-20" })],
      defaults
    );
    // No UTC-midnight shift: the game lands on June 20, not June 19 local.
    expect(games[0].date).toBe("2026-06-20");
    expect(games[0].startUtc).toBeNull();
  });

  it("self-heals a previously day-shifted all-day game on re-sync", () => {
    // Imported before the fix: midnight-UTC instant shifted to June 19.
    const existing = [
      {
        id: "g1",
        gcUid: "t",
        date: "2026-06-19",
        startUtc: "2026-06-20T00:00:00.000Z",
        opponent: "Dirt Dobbers",
        isHome: true,
        location: "",
      },
    ];
    const { games, updated } = mergeGcEventsIntoGames(
      existing,
      [ev({ uid: "t", allDay: true, startUtc: null, startDate: "2026-06-20" })],
      defaults
    );
    expect(updated).toBe(1);
    expect(games[0].date).toBe("2026-06-20");
    expect(games[0].startUtc).toBeNull();
  });

  it("no-op sync stays writeless for an all-day game (null startUtc both sides)", () => {
    const existing = [
      {
        id: "g1",
        gcUid: "t",
        date: "2026-06-20",
        startUtc: null,
        opponent: "Dirt Dobbers",
        isHome: true,
        location: "",
      },
    ];
    const res = mergeGcEventsIntoGames(
      existing,
      [ev({ uid: "t", allDay: true, startUtc: null, startDate: "2026-06-20" })],
      defaults
    );
    expect(res.updated).toBe(0);
    expect(res.games).toBe(existing); // reference-equal
  });
});
