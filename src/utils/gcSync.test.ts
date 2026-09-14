import { describe, it, expect } from "vitest";
import {
  gcPracticesVsFeed,
  mergeGcEventsIntoGames,
  mergeGcEventsIntoPractices,
  practiceHasLoggedWork,
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

  // A practice as the merge stores one. Every fence here is measured against
  // the FEED's own span, never the wall clock, so these dates are fixed.
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

  // A feed that still publishes May 1 -> July 1 but no longer lists p1.
  const feedWithoutP1 = () => [
    ev({ uid: "g-early", startDate: "2026-05-01" }),
    ev({ uid: "g-late", startDate: "2026-07-01" }),
  ];

  it("removes a practice the feed no longer carries", () => {
    const { practices, removed, added, updated } = mergeGcEventsIntoPractices(
      [stored()],
      feedWithoutP1(),
    );
    expect(removed).toBe(1);
    expect(added).toBe(0);
    expect(updated).toBe(0);
    expect(practices).toHaveLength(0);
  });

  it("removes one already PLAYED, attendance and all", () => {
    // The fence is the feed's span, not today: a practice the feed covers and
    // no longer lists was deleted upstream, whether or not it has happened.
    const played = stored({
      id: "old",
      gcUid: "gone",
      date: "2026-05-04",
      attendance: { p1: "present", p2: "absent" },
      drills: [{ id: "d1", name: "Tee work" }],
    });
    const { practices, removed } = mergeGcEventsIntoPractices(
      [played],
      feedWithoutP1(),
    );
    expect(removed).toBe(1);
    expect(practices).toHaveLength(0);
  });

  it("removes a practice GameChanger retitled into a game", () => {
    // Same UID, summary no longer says practice: it belongs to the schedule
    // now, so it must not linger on the Practices tab as well.
    const { practices, removed } = mergeGcEventsIntoPractices(
      [stored()],
      [ev({ uid: "p1", startDate: "2026-06-10" }), ...feedWithoutP1()],
    );
    expect(removed).toBe(1);
    expect(practices).toHaveLength(0);
  });

  it("keeps a practice the feed still carries", () => {
    const res = mergeGcEventsIntoPractices([stored()], [practiceEv()]);
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
      feedWithoutP1(),
    );
    expect(removed).toBe(0);
    expect(practices).toHaveLength(2);
  });

  it("keeps a practice older than the feed reaches", () => {
    // This is what a feed that rolls old events off looks like. Its silence
    // about April is not evidence, so a season of attendance survives.
    const ancient = stored({ id: "old", gcUid: "gone", date: "2026-04-02" });
    const { practices, removed } = mergeGcEventsIntoPractices(
      [ancient],
      feedWithoutP1(),
    );
    expect(removed).toBe(0);
    expect(practices).toHaveLength(1);
  });

  it("keeps a practice dated past the feed's last event", () => {
    const far = stored({ id: "far", gcUid: "far-uid", date: "2026-08-30" });
    const { practices, removed } = mergeGcEventsIntoPractices(
      [far],
      feedWithoutP1(),
    );
    expect(removed).toBe(0);
    expect(practices).toHaveLength(1);
  });

  it("keeps a practice whose date is unusable", () => {
    const broken = stored({ id: "bad", gcUid: "bad-uid", date: "" });
    const res = mergeGcEventsIntoPractices([broken], feedWithoutP1());
    expect(res.removed).toBe(0);
  });

  it("an empty feed removes nothing", () => {
    // A feed that failed to publish must not read as "everything was cancelled".
    const existing = [stored()];
    const res = mergeGcEventsIntoPractices(existing, []);
    expect(res.removed).toBe(0);
    expect(res.practices).toBe(existing);
  });

  it("returns the SAME array reference when nothing changed", () => {
    const existing = [stored()];
    const res = mergeGcEventsIntoPractices(existing, [practiceEv()]);
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
    );
    expect(updated).toBe(1);
    expect(practices[0]).toMatchObject({
      date: "2026-06-11",
      attendance: { p1: "absent" },
      drills: [{ id: "d1", name: "Tee work" }],
      planNotes: "Infield focus",
    });
  });
});

describe("gcPracticesVsFeed", () => {
  const stored = (over: Record<string, any>) => ({
    source: "gamechanger",
    attendance: {},
    drills: [],
    planNotes: "",
    ...over,
  });
  const feed = [
    ev({ uid: "g-early", startDate: "2026-05-01" }),
    ev({ uid: "g-late", startDate: "2026-07-01" }),
  ];

  it("splits the missing practices by whether the feed covers their date", () => {
    const inside = stored({ id: "in", gcUid: "a", date: "2026-06-10" });
    const tooOld = stored({ id: "old", gcUid: "b", date: "2026-04-01" });
    const tooNew = stored({ id: "new", gcUid: "c", date: "2026-08-01" });
    const diff = gcPracticesVsFeed([inside, tooOld, tooNew], feed);
    expect(diff.prune).toEqual([inside]);
    expect(diff.outsideWindow).toEqual([tooOld, tooNew]);
  });

  it("reports the span so the preview can explain what it skipped", () => {
    const diff = gcPracticesVsFeed(
      [stored({ id: "old", gcUid: "b", date: "2026-04-01" })],
      feed,
    );
    expect(diff.firstFeedDate).toBe("2026-05-01");
    expect(diff.lastFeedDate).toBe("2026-07-01");
  });

  it("reports an empty span for an empty feed", () => {
    const diff = gcPracticesVsFeed(
      [stored({ id: "in", gcUid: "a", date: "2026-06-10" })],
      [],
    );
    expect(diff).toMatchObject({
      prune: [],
      outsideWindow: [],
      firstFeedDate: "",
      lastFeedDate: "",
    });
  });
});

describe("practiceHasLoggedWork", () => {
  it("is false for an untouched practice", () => {
    expect(
      practiceHasLoggedWork({ attendance: {}, drills: [], planNotes: "" }),
    ).toBe(false);
    expect(practiceHasLoggedWork({})).toBe(false);
  });

  it("is true once a coach has put anything into it", () => {
    expect(practiceHasLoggedWork({ attendance: { p1: "absent" } })).toBe(true);
    expect(practiceHasLoggedWork({ drills: [{ id: "d1", name: "Tee" }] })).toBe(
      true,
    );
    expect(practiceHasLoggedWork({ planNotes: "Infield" })).toBe(true);
  });
});
