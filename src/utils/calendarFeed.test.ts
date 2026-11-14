import { describe, it, expect } from "vitest";
import {
  CALENDAR_FEED_TOKEN_RE,
  buildCalendarFeedIcs,
  calendarFeedContentKey,
  calendarFeedId,
  calendarFeedUrl,
  calendarFeedWebcalUrl,
  newCalendarFeedToken,
} from "./calendarFeed";
import { buildScheduleIcs } from "./ics";

const TOKEN = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4";

describe("calendar feed token", () => {
  it("is 32 url-safe characters and different every time", () => {
    const tokens = Array.from({ length: 50 }, newCalendarFeedToken);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(CALENDAR_FEED_TOKEN_RE.test(t)).toBe(true);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("rejects anything short or with characters a URL would mangle", () => {
    for (const bad of ["", "hawks", "a".repeat(31), `${"a".repeat(31)}/`])
      expect(CALENDAR_FEED_TOKEN_RE.test(bad)).toBe(false);
  });
});

describe("calendar feed link", () => {
  it("names the team and the token, on this site's own endpoint", () => {
    expect(calendarFeedId("team-ab12cd34", TOKEN)).toBe(
      `team-ab12cd34.${TOKEN}`,
    );
    expect(
      calendarFeedUrl("team-ab12cd34", TOKEN, "https://app.example/"),
    ).toBe(`https://app.example/api/calendar?feed=team-ab12cd34.${TOKEN}`);
  });

  it("has a webcal:// form, which is what makes a phone offer Subscribe", () => {
    expect(
      calendarFeedWebcalUrl("team-ab12cd34", TOKEN, "https://app.example"),
    ).toBe(`webcal://app.example/api/calendar?feed=team-ab12cd34.${TOKEN}`);
  });
});

describe("buildCalendarFeedIcs", () => {
  const now = new Date(Date.UTC(2026, 4, 10, 12, 0, 0));
  const team = {
    name: "Hawks",
    games: [
      {
        id: "played",
        date: "2026-05-01",
        opponent: "Rays",
        status: "final",
        teamScore: 7,
        opponentScore: 3,
        startUtc: "2026-05-01T22:30:00.000Z",
      },
      {
        id: "next",
        date: "2026-05-16",
        opponent: "Cubs",
        startUtc: "2026-05-16T15:00:00.000Z",
      },
      { id: "rained", date: "2026-05-20", status: "postponed" },
    ],
  };

  it("keeps played games — dropping one would delete it from every subscriber's calendar", () => {
    const feed = buildCalendarFeedIcs(team, now);
    const uids = [...feed.matchAll(/UID:(.+)/g)].map((m) => m[1].trim());
    expect(uids).toEqual(["game-played@coachscard", "game-next@coachscard"]);
    // ...while the one-time download still leaves them out.
    expect(buildScheduleIcs(team.games, "Hawks", now)).not.toContain(
      "game-played",
    );
  });

  it("names the calendar and asks subscribers to re-check hourly", () => {
    const feed = buildCalendarFeedIcs(team, now);
    expect(feed).toContain("X-WR-CALNAME:Hawks schedule");
    expect(feed).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(buildScheduleIcs(team.games, "Hawks", now)).not.toContain(
      "X-WR-CALNAME",
    );
  });

  it("is a valid empty calendar for a team with no games", () => {
    const feed = buildCalendarFeedIcs({ name: "Hawks" }, now);
    expect(feed.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(feed).not.toContain("BEGIN:VEVENT");
  });
});

describe("calendarFeedContentKey", () => {
  const games = [{ id: "g1", date: "2026-05-16", opponent: "Cubs" }];
  const at = (h: number) => new Date(Date.UTC(2026, 4, 10, h, 0, 0));

  it("is the same for two builds of the same schedule at different times", () => {
    const a = buildCalendarFeedIcs({ name: "Hawks", games }, at(9));
    const b = buildCalendarFeedIcs({ name: "Hawks", games }, at(17));
    expect(a).not.toBe(b);
    expect(calendarFeedContentKey(a)).toBe(calendarFeedContentKey(b));
  });

  it("changes when a game moves", () => {
    const before = buildCalendarFeedIcs({ name: "Hawks", games }, at(9));
    const after = buildCalendarFeedIcs(
      { name: "Hawks", games: [{ ...games[0], date: "2026-05-17" }] },
      at(9),
    );
    expect(calendarFeedContentKey(before)).not.toBe(
      calendarFeedContentKey(after),
    );
  });
});
