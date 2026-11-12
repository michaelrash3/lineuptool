import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve } from "path";
import { CALENDAR_FEED_TOKEN_RE } from "../utils/calendarFeed";

// The calendar subscription endpoint (api/calendar.js) serves ONE Firestore
// doc — the feed the coach's browser published — as text/calendar. It holds no
// credentials, so the things worth pinning are: it can only ever ask Firestore
// for a calendarFeeds doc, it answers every kind of "no" the same way, and it
// tells Vercel's edge how long it may cache.
const require = createRequire(import.meta.url);
const handler = require("../../api/calendar.js");

const TOKEN = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4";
const FEED = `team-ab12cd34.${TOKEN}`;
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

const call = async (feed: string | undefined) => {
  const res = await handler({ query: feed === undefined ? {} : { feed } });
  return {
    status: res.status,
    body: await res.text(),
    type: res.headers.get("content-type"),
    cache: res.headers.get("cache-control"),
  };
};
const firestoreDoc = (fields: Record<string, unknown>) =>
  new Response(JSON.stringify({ name: "x", fields }), { status: 200 });
const stubFetch = (response: Response | (() => Promise<Response>)) => {
  const reply =
    typeof response === "function" ? response : async () => response;
  const mock = vi.fn((_url: string, _init?: unknown) => reply());
  vi.stubGlobal("fetch", mock);
  return mock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/calendar", () => {
  it("returns the published calendar as text/calendar, cacheable at the edge", async () => {
    const fetchMock = stubFetch(
      firestoreDoc({
        teamId: { stringValue: "team-ab12cd34" },
        ics: { stringValue: ICS },
      }),
    );
    const res = await call(FEED);
    expect(res.status).toBe(200);
    expect(res.body).toBe(ICS);
    expect(res.type).toBe("text/calendar; charset=utf-8");
    expect(res.cache).toBe(
      `public, max-age=0, s-maxage=${handler.EDGE_CACHE_SECONDS}`,
    );
    // Exactly one read, of exactly that feed doc.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://firestore.googleapis.com/v1/projects/${handler.PROJECT_ID}/databases/(default)/documents/artifacts/${handler.APP_ID}/public/data/calendarFeeds/${FEED}`,
    );
  });

  it("never asks Firestore about anything that isn't shaped like a feed id", async () => {
    const fetchMock = stubFetch(firestoreDoc({}));
    for (const bad of [
      undefined,
      "",
      TOKEN, // no team half
      `team-1.${"a".repeat(31)}`, // token too short
      `../teams/team-1.${TOKEN}`, // path traversal
      `team-1/games.${TOKEN}`,
      `team-1.${TOKEN}?x=1`,
      `team-1.${TOKEN}.extra`,
    ]) {
      const res = await call(bad);
      expect(res.status).toBe(404);
      expect(res.cache).toBe("no-store");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives a link that was turned off, never existed or is denied the same 404", async () => {
    for (const status of [404, 403]) {
      stubFetch(new Response("{}", { status }));
      const res = await call(FEED);
      expect(res.status).toBe(404);
      expect(res.body).toBe("No calendar at this link.\n");
      expect(res.cache).toBe("no-store");
    }
  });

  it("won't serve a doc whose body isn't a calendar", async () => {
    for (const fields of [
      {},
      { ics: { integerValue: "7" } },
      { ics: { stringValue: "<html>hello</html>" } },
    ]) {
      stubFetch(firestoreDoc(fields));
      expect((await call(FEED)).status).toBe(404);
    }
  });

  it("answers 502, uncached, when Firestore is down or unreachable", async () => {
    stubFetch(new Response("oops", { status: 500 }));
    expect((await call(FEED)).status).toBe(502);
    stubFetch(async () => {
      throw new Error("network");
    });
    const res = await call(FEED);
    expect(res.status).toBe(502);
    expect(res.cache).toBe("no-store");
  });

  it("reads the feed id from a raw request URL too (Web-handler style)", async () => {
    stubFetch(firestoreDoc({ ics: { stringValue: ICS } }));
    const res = await handler({ url: `/api/calendar?feed=${FEED}` });
    expect(res.status).toBe(200);
  });

  it("writes through a Node-style response object", async () => {
    stubFetch(firestoreDoc({ ics: { stringValue: ICS } }));
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 0,
      body: "",
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      end(body: string) {
        this.body = body;
      },
    };
    await handler({ query: { feed: FEED } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(ICS);
    expect(headers["content-type"]).toBe("text/calendar; charset=utf-8");
  });

  it("points at the same Firebase project and app id the client uses", () => {
    const client = readFileSync(resolve(__dirname, "../firebase.ts"), "utf8");
    expect(client).toContain(`projectId: "${handler.PROJECT_ID}"`);
    expect(client).toContain(`_hostAppId || "${handler.APP_ID}"`);
  });

  it("accepts every token the client can mint", () => {
    // The token half of FEED_ID_RE and CALENDAR_FEED_TOKEN_RE must agree.
    for (const t of [TOKEN, "a".repeat(32), "A-_9".repeat(16)]) {
      expect(CALENDAR_FEED_TOKEN_RE.test(t)).toBe(true);
      expect(handler.FEED_ID_RE.test(`team-ab12cd34.${t}`)).toBe(true);
    }
    expect(handler.FEED_ID_RE.test(`team-ab12cd34.${"a".repeat(65)}`)).toBe(
      false,
    );
  });
});
