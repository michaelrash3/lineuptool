// Vercel serverless proxy for GameChanger .ics calendar feeds.
//
// A browser can't fetch the GameChanger feed directly — the calendar host
// doesn't send CORS headers — so the client calls this same-origin endpoint
// with ?url=<feed> and we fetch it server-side, then return the raw .ics text
// for the client-side parser (src/utils/icsParse.ts).
//
// Written as plain CommonJS JS (no TypeScript) because the .ts versions
// crashed at invocation (FUNCTION_INVOCATION_FAILED) before any of the handler
// logic ran — a transpile/load issue, not a logic one. This is the most
// universally-supported Vercel function format. It also tolerates EITHER
// invocation style: classic Node (req, res) and the Web Handler (Request ->
// Response), so the response can't crash on a missing `res`.
//
// Host-locked to gc.com so it can't be used as an open SSRF proxy.

module.exports = async function handler(req, res) {
  const isNodeRes = res && typeof res.setHeader === "function";
  const respond = (status, body, contentType) => {
    if (isNodeRes) {
      res.statusCode = status;
      res.setHeader("content-type", contentType);
      res.setHeader("cache-control", "no-store");
      res.end(body);
      return undefined;
    }
    return new Response(body, {
      status: status,
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  };
  const json = (status, obj) =>
    respond(status, JSON.stringify(obj), "application/json; charset=utf-8");

  try {
    // The url param can come from a parsed query (Node helper) or be read from
    // the raw request URL (path-relative for Node, absolute for Web Handler).
    let raw = "";
    if (req && req.query && typeof req.query.url === "string") {
      raw = req.query.url;
    } else if (req && typeof req.url === "string") {
      try {
        raw = new URL(req.url, "http://localhost").searchParams.get("url") || "";
      } catch (_e) {
        raw = "";
      }
    }
    if (!raw) return json(400, { error: "Missing url parameter" });

    const normalized = raw.replace(/^webcal:\/\//i, "https://");
    let parsed;
    try {
      parsed = new URL(normalized);
    } catch (_e) {
      return json(400, { error: "Invalid url" });
    }
    if (parsed.protocol !== "https:") {
      return json(400, { error: "Only https/webcal URLs are allowed" });
    }
    if (!/(^|\.)gc\.com$/i.test(parsed.hostname)) {
      return json(400, { error: "Only GameChanger (gc.com) feeds are allowed" });
    }
    if (typeof fetch !== "function") {
      return json(500, { error: "Server fetch unavailable (Node runtime too old)" });
    }

    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, 12000);
    let upstream;
    try {
      upstream = await fetch(parsed.toString(), {
        headers: {
          Accept: "text/calendar, text/plain, */*",
          "User-Agent": "lineuptool-schedule-import/1.0",
        },
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      return json(504, {
        error: aborted
          ? "GameChanger feed timed out"
          : "Could not reach feed: " + ((e && e.message) || String(e)),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      return json(502, { error: "Feed responded " + upstream.status });
    }
    const text = await upstream.text();
    return respond(200, text, "text/plain; charset=utf-8");
  } catch (e) {
    return json(500, { error: (e && e.message) || "Fetch failed" });
  }
};
