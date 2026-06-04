// Vercel serverless proxy for GameChanger .ics calendar feeds.
//
// A browser can't fetch the GameChanger feed directly — the calendar host
// doesn't send CORS headers — so the client calls this same-origin endpoint
// with ?url=<feed> and we fetch it server-side, then return the raw .ics text
// for the client-side parser (src/utils/icsParse.ts).
//
// Written as a Web Handler (Request -> Response) using only web-standard
// globals (Request, Response, URL, fetch, AbortController), which are available
// in Vercel's Node runtime. The earlier (req, res) Node-style signature crashed
// at invocation (FUNCTION_INVOCATION_FAILED) because this deployment invokes
// the function with a single Request argument, leaving `res` undefined.
//
// Host-locked to gc.com so it can't be used as an open SSRF proxy.

export default async function handler(request: Request): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  try {
    const raw = new URL(request.url).searchParams.get("url") || "";
    if (!raw) return json(400, { error: "Missing url parameter" });

    // webcal:// is just https:// for the purpose of fetching.
    const normalized = raw.replace(/^webcal:\/\//i, "https://");
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      return json(400, { error: "Invalid url" });
    }
    if (parsed.protocol !== "https:") {
      return json(400, { error: "Only https/webcal URLs are allowed" });
    }
    // SSRF guard: only GameChanger calendar hosts (gc.com and subdomains).
    if (!/(^|\.)gc\.com$/i.test(parsed.hostname)) {
      return json(400, { error: "Only GameChanger (gc.com) feeds are allowed" });
    }

    // Bound the upstream fetch so a hung feed returns a clean error instead of
    // letting the function run to a platform timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let upstream: Response;
    try {
      upstream = await fetch(parsed.toString(), {
        headers: {
          Accept: "text/calendar, text/plain, */*",
          "User-Agent": "lineuptool-schedule-import/1.0",
        },
        signal: controller.signal,
      });
    } catch (e: any) {
      const aborted = e?.name === "AbortError";
      return json(504, {
        error: aborted ? "GameChanger feed timed out" : `Could not reach feed: ${e?.message || e}`,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      return json(502, { error: `Feed responded ${upstream.status}` });
    }
    const text = await upstream.text();
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return json(500, { error: (e && e.message) || "Fetch failed" });
  }
}
