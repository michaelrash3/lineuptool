import { describe, it, expect } from "vitest";
import {
  gcPracticesToPrune,
  mergeGcEventsIntoGames,
  mergeGcEventsIntoPractices,
} from "./gcSync";
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
    const { games, added, updated } = mergeGcEventsIntoGames(
      [],
      [ev({ uid: "a" })],
      defaults,
    );
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(games).toHaveLength(1);
    expect(games[0].gcUid).toBe("a");
    expect(games[0].opponent).toBe("Dirt Dobbers");
    expect(games[0].status).toBe("scheduled");
    expect(games[0].defenseSize).toBe("10");
    expect(typeof games[0].id).toBe("string");
  });

  it("stamps classification on new games: pool for USSSA teams, league otherwise", () => {
    const rec = mergeGcEventsIntoGames([], [ev({ uid: "a" })], defaults);
    expect(rec.games[0].gameType).toBe("league");
    const tourney = mergeGcEventsIntoGames([], [ev({ uid: "a" })], {
      ...defaults,
      leagueRuleSet: "USSSA",
    });
    expect(tourney.games[0].gameType).toBe("pool");
  });

  it("re-sync never overwrites a coach's classification on an existing game", () => {
    const first = mergeGcEventsIntoGames([], [ev({ uid: "a" })], defaults);
    const coached = [{ ...first.games[0], gameType: "bracket" }];
    const { games, updated } = mergeGcEventsIntoGames(
      coached,
      [ev({ uid: "a", opponent: "New Opp" })],
      defaults,
    );
    expect(updated).toBe(1);
    expect(games[0].gameType).toBe("bracket");
  });

  it("routes GameChanger practice titles with matchup words to practices, not games", () => {
    const practice = ev({
      uid: "practice-vs",
      summary:
        "TrashPandas Baseball Club 9U vs TrashPandas Baseball Club 9U Practice",
      opponent: "TrashPandas Baseball Club 9U Practice",
      isHome: true,
      startDate: "2026-07-17",
      startUtc: "2026-07-17T23:00:00.000Z",
      endUtc: "2026-07-18T00:30:00.000Z",
      location: "Rec Kid Pitch",
    });

    const gameResult = mergeGcEventsIntoGames([], [practice], defaults);
    expect(gameResult.added).toBe(0);
    expect(gameResult.games).toHaveLength(0);

    const practiceResult = mergeGcEventsIntoPractices([], [practice]);
    expect(practiceResult.added).toBe(1);
    expect(practiceResult.practices).toHaveLength(1);
    expect(practiceResult.practices[0]).toMatchObject({
      gcUid: "practice-vs",
      date: "2026-07-17",
      startUtc: "2026-07-17T23:00:00.000Z",
      endUtc: "2026-07-18T00:30:00.000Z",
      location: "Rec Kid Pitch",
      source: "gamechanger",
      status: "scheduled",
    });
  });

  it("de-dupes by gcUid — re-syncing the same feed adds nothing", () => {
    const first = mergeGcEventsIntoGames([], [ev({ uid: "a" })], defaults);
    const second = mergeGcEventsIntoGames(
      first.games,
      [ev({ uid: "a" })],
      defaults,
    );
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
      defaults,
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
    const { games, added } = mergeGcEventsIntoGames(
      existing,
      [ev({ uid: "a" })],
      defaults,
    );
    expect(added).toBe(1);
    expect(games).toHaveLength(2);
    expect(games.find((g) => g.id === "m1")).toBeTruthy();
  });

  it("all-day events keep their literal feed date and carry no instant", () => {
    const { games } = mergeGcEventsIntoGames(
      [],
      [ev({ uid: "t", allDay: true, startUtc: null, startDate: "2026-06-20" })],
      defaults,
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
      defaults,
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
      defaults,
    );
    expect(res.updated).toBe(0);
    expect(res.games).toBe(existing); // reference-equal
  });
});

describe("mergeGcEventsIntoPractices", () => {
  // A feed event that routes to the Practices tab, not the schedule.
  const practiceEv = (
    over: Partial<GcEvent> & { uid: string } = { uid: "p1" },
  ): GcEvent =>
    ev({
      summary: "Trash Pandas 8u Practice",
      opponent: "Trash Pandas 8u Practice",
      startDate: "2026-06-10",
      startUtc: "2026-06-10T23:00:00.000Z",
      ...over,
    });

  // A practice as the merge stores one. TODAY is the fixed "now" the prune
  // fences compare against, so these tests never drift with the wall clock.
  const TODAY = "2026-06-01";
  const stored = (over: Record<string, any> = {}) => ({
    id: "pr1",
    gcUid: "p1",
    date: "2026-06-10",
    startUtc: "2026-06-10T23:00:00.000Z",
    endUtc: null,
    location: "",
    source: "gamechanger",
    status: "scheduled",
    attendance: {},
    drills: [],
    planNotes: "",
    ...over,
  });

  it("removes an upcoming practice the feed no longer carries", () => {
    const { practices, removed, added, updated } = mergeGcEventsIntoPractices(
      [stored()],
      // The feed still publishes a game, so it is live — it just no longer
      // has that practice.
      [ev({ uid: "g1", startDate: "2026-06-20" })],
      TODAY,
    );
    expect(removed).toBe(1);
    expect(added).toBe(0);
    expect(updated).toBe(0);
    expect(practices).toHaveLength(0);
  });

  it("removes a practice GameChanger retitled into a game", () => {
    // Same UID, summary no longer says practice: it belongs to the schedule
    // now, so it must not linger on the Practices tab as well.
    const { practices, removed } = mergeGcEventsIntoPractices(
      [stored()],
      [ev({ uid: "p1", startDate: "2026-06-10" })],
      TODAY,
    );
    expect(removed).toBe(1);
    expect(practices).toHaveLength(0);
  });

  it("keeps a practice the feed still carries", () => {
    const res = mergeGcEventsIntoPractices([stored()], [practiceEv()], TODAY);
    expect(res.removed).toBe(0);
    expect(res.added).toBe(0);
    expect(res.updated).toBe(0);
    expect(res.practices).toHaveLength(1);
  });

  it("never removes a manually-added practice", () => {
    const manual = stored({ id: "m1", gcUid: undefined, source: "manual" });
    // A feed-created practice missing its source stamp is left alone too:
    // the prune wants both marks before it deletes anything.
    const unstamped = stored({ id: "u1", gcUid: "legacy", source: undefined });
    const { practices, removed } = mergeGcEventsIntoPractices(
      [manual, unstamped],
      [ev({ uid: "g1", startDate: "2026-06-20" })],
      TODAY,
    );
    expect(removed).toBe(0);
    expect(practices).toHaveLength(2);
  });

  it("keeps a practice already played, attendance and all", () => {
    // Feeds roll old events off; a past practice is a record, not a plan.
    const past = stored({
      id: "old",
      gcUid: "gone",
      date: "2026-05-02",
      attendance: { p1: "present", p2: "absent" },
    });
    const { practices, removed } = mergeGcEventsIntoPractices(
      [past],
      [ev({ uid: "g1", startDate: "2026-06-20" })],
      TODAY,
    );
    expect(removed).toBe(0);
    expect(practices[0].attendance).toEqual({ p1: "present", p2: "absent" });
  });

  it("keeps a practice dated past the feed's last event", () => {
    // Beyond the window the feed publishes, so its silence proves nothing.
    const far = stored({ id: "far", gcUid: "far-uid", date: "2026-08-30" });
    const { practices, removed } = mergeGcEventsIntoPractices(
      [far],
      [ev({ uid: "g1", startDate: "2026-06-20" })],
      TODAY,
    );
    expect(removed).toBe(0);
    expect(practices).toHaveLength(1);
  });

  it("an empty feed removes nothing", () => {
    // A feed that failed to publish must not read as "everything was cancelled".
    const existing = [stored()];
    const res = mergeGcEventsIntoPractices(existing, [], TODAY);
    expect(res.removed).toBe(0);
    expect(res.practices).toBe(existing);
  });

  it("returns the SAME array reference when nothing changed", () => {
    const existing = [stored()];
    const res = mergeGcEventsIntoPractices(existing, [practiceEv()], TODAY);
    expect(res.practices).toBe(existing); // reference-equal: no write
  });

  it("adds, updates and removes in one pass", () => {
    const existing = [
      stored(), // still in the feed, but moved
      stored({ id: "pr2", gcUid: "p2", date: "2026-06-12" }), // dropped in GC
    ];
    const { practices, added, updated, removed } = mergeGcEventsIntoPractices(
      existing,
      [
        practiceEv({
          uid: "p1",
          startDate: "2026-06-11",
          startUtc: "2026-06-11T23:00:00.000Z",
        }),
        practiceEv({ uid: "p3", startDate: "2026-06-18" }),
      ],
      TODAY,
    );
    expect({ added, updated, removed }).toEqual({
      added: 1,
      updated: 1,
      removed: 1,
    });
    expect(practices.map((p) => p.gcUid)).toEqual(["p1", "p3"]);
    expect(practices[0].date).toBe("2026-06-11");
    expect(practices[0].id).toBe("pr1"); // updated in place, not re-created
  });

  it("preserves logged work on a practice that only moved", () => {
    const worked = stored({
      attendance: { p1: "absent" },
      drills: [{ id: "d1", name: "Tee work" }],
      planNotes: "Infield focus",
    });
    const { practices, updated } = mergeGcEventsIntoPractices(
      [worked],
      [
        practiceEv({
          uid: "p1",
          startDate: "2026-06-11",
          startUtc: "2026-06-11T23:00:00.000Z",
        }),
      ],
      TODAY,
    );
    expect(updated).toBe(1);
    expect(practices[0]).toMatchObject({
      date: "2026-06-11",
      attendance: { p1: "absent" },
      drills: [{ id: "d1", name: "Tee work" }],
      planNotes: "Infield focus",
    });
  });

  it("gcPracticesToPrune names the practices the merge would drop", () => {
    const doomed = stored({ id: "pr2", gcUid: "p2", date: "2026-06-12" });
    const list = gcPracticesToPrune(
      [stored(), doomed],
      // A later event puts the dropped practice inside the feed's window.
      [practiceEv({ uid: "p1" }), ev({ uid: "g1", startDate: "2026-06-20" })],
      TODAY,
    );
    expect(list).toEqual([doomed]);
  });
});
