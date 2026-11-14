// The team schedule as a calendar SUBSCRIPTION — a link a calendar app
// re-fetches on its own, so a rescheduled game moves on the phone without
// anyone downloading a new file.
//
// There is no server-side code on the Spark plan to read Firestore, so the
// coach client publishes the finished .ics text to its own small doc,
// calendarFeeds/{teamId}.{token}, and a tiny Vercel function (api/calendar.js)
// hands that text to calendar apps. The doc is readable WITHOUT sign-in — a
// calendar app can't sign in — so the token is the whole secret: 24 random
// bytes, known only to the team, and replaced when the head coach turns the
// link off and on again. It is `get`-only, so ids can't be listed, and the
// team id in the doc id means no other team can publish under it. See
// firestore.rules.
import { doc, type Firestore } from "firebase/firestore";
import { buildScheduleIcs } from "./ics";

// Mirrors calendarFeedTokenOk in firestore.rules and FEED_ID_RE in
// api/calendar.js — all three must agree on what a token looks like.
export const CALENDAR_FEED_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

// "<teamId>.<token>": the doc id, and the `feed` value in the link.
export const calendarFeedId = (teamId: string, token: string): string =>
  `${teamId}.${token}`;

// The rules cap the stored text; a season of games is ~1% of this.
export const CALENDAR_FEED_MAX_CHARS = 200_000;

export const calendarFeedRef = (
  db: Firestore,
  appId: string,
  teamId: string,
  token: string,
) =>
  doc(
    db,
    "artifacts",
    appId,
    "public",
    "data",
    "calendarFeeds",
    calendarFeedId(teamId, token),
  );

// 24 random bytes as base64url: 32 characters, 192 bits.
export const newCalendarFeedToken = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const calendarFeedUrl = (
  teamId: string,
  token: string,
  origin: string,
): string =>
  `${origin.replace(/\/+$/, "")}/api/calendar?feed=${encodeURIComponent(
    calendarFeedId(teamId, token),
  )}`;

// webcal:// is what makes a phone offer "Subscribe" instead of downloading.
export const calendarFeedWebcalUrl = (
  teamId: string,
  token: string,
  origin: string,
): string =>
  calendarFeedUrl(teamId, token, origin).replace(/^https?:/i, "webcal:");

// The whole season, played games included (see includePlayed in ics.ts).
export const buildCalendarFeedIcs = (
  team: { name?: string; games?: any[] } | null | undefined,
  now: Date = new Date(),
): string => {
  const name = (team?.name || "").trim() || "Team";
  return buildScheduleIcs(team?.games, name, now, {
    includePlayed: true,
    calendarName: `${name} schedule`,
  });
};

// The feed minus its DTSTAMP lines, which carry the time it was built and so
// differ on every build. Two feeds with the same key say the same thing.
export const calendarFeedContentKey = (ics: string): string =>
  ics.replace(/^DTSTAMP:.*\r?\n/gm, "");
