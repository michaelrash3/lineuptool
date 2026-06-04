// Vercel serverless proxy for GameChanger .ics calendar feeds.
//
// A browser can't fetch the GameChanger feed directly — the calendar host
// doesn't send CORS headers — so the client calls this same-origin endpoint
// with ?url=<feed> and we fetch it server-side, then hand back the raw .ics
// text for the client-side parser (src/utils/icsParse.ts) to handle.
//
// Host-locked to gc.com so this can't be used as an open SSRF proxy to fetch
// arbitrary internal/external URLs.

export default async function handler(req: any, res: any) {
  try {
    const raw: string = (req.query?.url ?? "") as string;
    if (!raw) {
      res.status(400).json({ error: "Missing url parameter" });
      return;
    }
    // webcal:// is just https:// for the purpose of fetching.
    const normalized = raw.replace(/^webcal:\/\//i, "https://");
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      res.status(400).json({ error: "Invalid url" });
      return;
    }
    if (parsed.protocol !== "https:") {
      res.status(400).json({ error: "Only https/webcal URLs are allowed" });
      return;
    }
    // SSRF guard: only GameChanger calendar hosts (gc.com and subdomains).
    if (!/(^|\.)gc\.com$/i.test(parsed.hostname)) {
      res.status(400).json({ error: "Only GameChanger (gc.com) feeds are allowed" });
      return;
    }
    const upstream = await fetch(parsed.toString(), {
      headers: { Accept: "text/calendar, text/plain, */*" },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `Feed responded ${upstream.status}` });
      return;
    }
    const text = await upstream.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(text);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Fetch failed" });
  }
}
