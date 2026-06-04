// Vercel serverless proxy for GameChanger .ics calendar feeds.
//
// A browser can't fetch the GameChanger feed directly — the calendar host
// doesn't send CORS headers — so the client calls this same-origin endpoint
// with ?url=<feed> and we fetch it server-side, then hand back the raw .ics
// text for the client-side parser (src/utils/icsParse.ts) to handle.
//
// Host-locked to gc.com so this can't be used as an open SSRF proxy to fetch
// arbitrary internal/external URLs.
//
// Uses only the standard Node ServerResponse API (res.statusCode /
// res.setHeader / res.end) rather than the Vercel res.status()/.json()/.send()
// sugar, which isn't guaranteed to be attached in every runtime — relying on
// it made every response call throw and produced a generic 500.

export default async function handler(req: any, res: any) {
  const sendJson = (code: number, body: Record<string, unknown>) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  const sendText = (code: number, body: string) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  };

  try {
    // Read ?url= from the parsed query if present, else parse the raw URL.
    let raw = "";
    if (req.query && typeof req.query.url === "string") {
      raw = req.query.url;
    } else if (typeof req.url === "string") {
      try {
        raw = new URL(req.url, "http://localhost").searchParams.get("url") || "";
      } catch {
        raw = "";
      }
    }
    if (!raw) {
      sendJson(400, { error: "Missing url parameter" });
      return;
    }

    // webcal:// is just https:// for the purpose of fetching.
    const normalized = raw.replace(/^webcal:\/\//i, "https://");
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      sendJson(400, { error: "Invalid url" });
      return;
    }
    if (parsed.protocol !== "https:") {
      sendJson(400, { error: "Only https/webcal URLs are allowed" });
      return;
    }
    // SSRF guard: only GameChanger calendar hosts (gc.com and subdomains).
    if (!/(^|\.)gc\.com$/i.test(parsed.hostname)) {
      sendJson(400, { error: "Only GameChanger (gc.com) feeds are allowed" });
      return;
    }

    if (typeof fetch !== "function") {
      sendJson(500, { error: "Server fetch unavailable (Node runtime too old)" });
      return;
    }

    const upstream = await fetch(parsed.toString(), {
      headers: {
        Accept: "text/calendar, text/plain, */*",
        "User-Agent": "lineuptool-schedule-import/1.0",
      },
    });
    if (!upstream.ok) {
      sendJson(502, { error: `Feed responded ${upstream.status}` });
      return;
    }
    const text = await upstream.text();
    sendText(200, text);
  } catch (e: any) {
    try {
      sendJson(500, { error: (e && e.message) || "Fetch failed" });
    } catch {
      // Last-ditch: if even setHeader/end aren't usable, end the response raw.
      try {
        res.statusCode = 500;
        res.end("Fetch failed");
      } catch {
        /* nothing more we can do */
      }
    }
  }
}
