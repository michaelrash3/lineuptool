import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "module";

// The Vercel proxy for GameChanger calendar feeds (api/gc-schedule.js) must
// only ever fetch gc.com: no open redirects out of it, and no unbounded bodies.
const require = createRequire(import.meta.url);
const handler = require("../../api/gc-schedule.js");

const call = async (url: string) => {
  const res = await handler(
    { query: { url } },
    undefined, // Web-handler style: the function returns a Response
  );
  return { status: res.status, body: await res.text() };
};
const reply = (
  status: number,
  body = "",
  headers: Record<string, string> = {},
) => new Response(body, { status, headers });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/gc-schedule", () => {
  it("refuses a feed that isn't on gc.com", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("https://evil.example/feed.ics")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a redirect that stays on gc.com", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(302, "", { location: "https://api.team-manager.gc.com/x.ics" }),
      )
      .mockResolvedValueOnce(reply(200, "BEGIN:VCALENDAR"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("webcal://api.team-manager.gc.com/feed.ics");
    expect(res).toEqual({ status: 200, body: "BEGIN:VCALENDAR" });
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("refuses a redirect that leaves gc.com", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          reply(302, "", { location: "https://169.254.169.254/latest" }),
        ),
    );
    expect(
      (await call("https://api.team-manager.gc.com/feed.ics")).status,
    ).toBe(400);
  });

  it("refuses an oversized body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(reply(200, "x".repeat(2 * 1024 * 1024 + 1))),
    );
    expect(
      (await call("https://api.team-manager.gc.com/feed.ics")).status,
    ).toBe(502);
  });
});
