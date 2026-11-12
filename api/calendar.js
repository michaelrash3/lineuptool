// Vercel serverless endpoint for the team's calendar SUBSCRIPTION link.
//
// A calendar app (Apple, Google, Outlook) subscribes to
//   /api/calendar?feed=<teamId>.<token>
// and re-fetches it on its own schedule. The coach's browser has already
// built the calendar text and published it to a Firestore doc readable
// without sign-in (calendarFeeds/<teamId>.<token> — see firestore.rules and
// src/utils/calendarFeed.ts); all this does is fetch that one doc over
// Firestore's REST API and return its `ics` field as text/calendar. It holds
// no credentials and can read nothing the link's holder couldn't already.
//
// Plain CommonJS and tolerant of both invocation styles, for the reasons
// written up in api/gc-schedule.js.

// Must match src/firebase.ts (fallbackConfig.projectId and the default appId)
// — src/api/calendar.test.ts fails if they drift. The env overrides exist for
// the emulator and for a deployment pointed at another project.
const PROJECT_ID = "lineupgenerator-79159";
const APP_ID = "baseball_lineup_v1";

// "<teamId>.<token>". The token half mirrors CALENDAR_FEED_TOKEN_RE in
// src/utils/calendarFeed.ts. Anything else never reaches Firestore, so this
// can't be turned into a way to read other documents.
const FEED_ID_RE = /^[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9_-]{32,64}$/;

// How long Vercel's edge may answer from cache before asking again. It caps
// both how stale a reschedule can look and how long a link the head coach
// turned off keeps answering.
const EDGE_CACHE_SECONDS = 300;

const firestoreDocUrl = (feedId) => {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const base = emulator
    ? "http://" + emulator
    : "https://firestore.googleapis.com";
  const project = process.env.CALENDAR_FEED_PROJECT_ID || PROJECT_ID;
  const app = process.env.CALENDAR_FEED_APP_ID || APP_ID;
  return (
    base +
    "/v1/projects/" +
    encodeURIComponent(project) +
    "/databases/(default)/documents/artifacts/" +
    encodeURIComponent(app) +
    "/public/data/calendarFeeds/" +
    encodeURIComponent(feedId)
  );
};

async function handler(req, res) {
  const isNodeRes = res && typeof res.setHeader === "function";
  const respond = (status, body, contentType, cacheControl) => {
    const headers = {
      "content-type": contentType,
      "cache-control": cacheControl || "no-store",
      "x-content-type-options": "nosniff",
    };
    if (isNodeRes) {
      res.statusCode = status;
      Object.keys(headers).forEach((k) => res.setHeader(k, headers[k]));
      res.end(body);
      return undefined;
    }
    return new Response(body, { status: status, headers: headers });
  };
  const text = (status, message) =>
    respond(status, message + "\n", "text/plain; charset=utf-8");

  try {
    let feedId = "";
    if (req && req.query && typeof req.query.feed === "string") {
      feedId = req.query.feed;
    } else if (req && typeof req.url === "string") {
      try {
        feedId =
          new URL(req.url, "http://localhost").searchParams.get("feed") || "";
      } catch (_e) {
        feedId = "";
      }
    }
    // One answer for "malformed", "never existed" and "turned off": a caller
    // probing ids learns nothing from the difference.
    const notFound = () => text(404, "No calendar at this link.");
    if (!FEED_ID_RE.test(feedId)) return notFound();
    if (typeof fetch !== "function") {
      return text(500, "Server fetch unavailable (Node runtime too old).");
    }

    const upstream = await fetch(firestoreDocUrl(feedId), {
      headers: { accept: "application/json" },
      redirect: "error",
    });
    if (upstream.status === 404 || upstream.status === 403) return notFound();
    if (!upstream.ok)
      return text(502, "The calendar is unavailable right now.");

    const doc = await upstream.json();
    const ics =
      doc && doc.fields && doc.fields.ics && doc.fields.ics.stringValue;
    if (typeof ics !== "string" || ics.indexOf("BEGIN:VCALENDAR") !== 0) {
      return notFound();
    }
    return respond(
      200,
      ics,
      "text/calendar; charset=utf-8",
      "public, max-age=0, s-maxage=" + EDGE_CACHE_SECONDS,
    );
  } catch (_e) {
    return text(502, "The calendar is unavailable right now.");
  }
}

module.exports = handler;
module.exports.PROJECT_ID = PROJECT_ID;
module.exports.APP_ID = APP_ID;
module.exports.FEED_ID_RE = FEED_ID_RE;
module.exports.EDGE_CACHE_SECONDS = EDGE_CACHE_SECONDS;
