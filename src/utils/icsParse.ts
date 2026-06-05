// GameChanger (and general iCalendar) schedule parsing.
//
// GameChanger Team Manager publishes a team's schedule as an .ics calendar
// feed (webcal://api.team-manager.gc.com/...). Each game is a VEVENT whose
// SUMMARY is "<Team Name> vs <Opponent>" for a HOME game or
// "<Team Name> @ <Opponent>" for an AWAY game, with DTSTART in UTC (Z). We
// parse those into structured events; the caller converts the UTC instant to
// the viewer's LOCAL date when building a game row (so an evening game stored
// as e.g. 2026-05-30T00:00:00Z lands on May 29 locally, not May 30).
//
// This module is pure (no I/O) so it can be unit-tested against real feed
// samples. Fetching the feed is the job of the /api/gc-schedule proxy, since
// the calendar host doesn't send CORS headers for a browser fetch.

export interface GcEvent {
  /** Stable per-game UID from the feed — used to de-dupe on re-sync. */
  uid: string;
  /** Event start as an ISO-8601 instant (UTC), e.g. 2026-03-31T22:00:00.000Z. */
  startUtc: string;
  /** Event end as an ISO-8601 instant, or null when absent. */
  endUtc: string | null;
  /** Raw SUMMARY text (unescaped). */
  summary: string;
  /** Opponent name parsed out of the SUMMARY, or the full summary if unparsed. */
  opponent: string;
  /** true = home (" vs "), false = away (" @ "), null = couldn't tell. */
  isHome: boolean | null;
  /** Venue (unescaped), or null when absent. */
  location: string | null;
}

// RFC 5545 line folding: a CRLF (or LF) followed by a space or tab continues
// the previous line. Unfold before parsing so long LOCATION/SUMMARY values
// that wrapped are rejoined.
const unfoldLines = (text: string): string[] => {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
};

// Unescape ICS TEXT values: \n -> newline, \, -> comma, \; -> semicolon,
// \\ -> backslash.
const unescapeText = (value: string): string =>
  value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");

// Parse an ICS datetime ("20260331T220000Z", "20260331T220000", or
// "20260331") into an ISO instant. A trailing Z (or a feed that only emits
// UTC, as GameChanger does) is treated as UTC; a bare local datetime is built
// from local components; a date-only value is midnight UTC.
const parseIcsDate = (value: string): string | null => {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const hour = Number(hh ?? "0");
  const min = Number(mi ?? "0");
  const sec = Number(ss ?? "0");
  // Date-only or explicit Z -> UTC. Bare datetime without Z -> local.
  const date =
    !hh || z
      ? new Date(Date.UTC(year, month, day, hour, min, sec))
      : new Date(year, month, day, hour, min, sec);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// Pull the opponent + home/away out of a GameChanger SUMMARY. Away (" @ ") is
// checked before home (" vs ") and we use the LAST separator occurrence so a
// team name that itself contains "vs"/"@" doesn't mislead the split.
const parseMatchup = (summary: string): { opponent: string; isHome: boolean | null } => {
  const away = summary.lastIndexOf(" @ ");
  if (away !== -1) {
    return { opponent: summary.slice(away + 3).trim(), isHome: false };
  }
  const home = summary.toLowerCase().lastIndexOf(" vs ");
  if (home !== -1) {
    return { opponent: summary.slice(home + 4).trim(), isHome: true };
  }
  return { opponent: summary.trim(), isHome: null };
};

// Split "DTSTART;TZID=...:20260331T220000Z" into the property name ("DTSTART")
// and its raw value, ignoring any parameters between the name and the colon.
const splitProp = (line: string): { name: string; value: string } | null => {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const name = left.split(";")[0].toUpperCase();
  return { name, value };
};

export const parseGameChangerIcs = (icsText: string): GcEvent[] => {
  if (!icsText || icsText.indexOf("BEGIN:VEVENT") === -1) return [];
  const lines = unfoldLines(icsText);
  const events: GcEvent[] = [];
  let cur: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) {
        const summary = cur.SUMMARY ? unescapeText(cur.SUMMARY) : "";
        const startUtc = cur.DTSTART ? parseIcsDate(cur.DTSTART) : null;
        // A VEVENT with no parseable start is unusable as a game; skip it.
        if (startUtc) {
          const { opponent, isHome } = parseMatchup(summary);
          events.push({
            uid: cur.UID || "",
            startUtc,
            endUtc: cur.DTEND ? parseIcsDate(cur.DTEND) : null,
            summary,
            opponent,
            isHome,
            location: cur.LOCATION ? unescapeText(cur.LOCATION) : null,
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const prop = splitProp(line);
    if (prop) cur[prop.name] = prop.value;
  }
  return events;
};

// Convert a UTC ISO instant to a local "YYYY-MM-DD" date string (the format
// the app stores game.date in). Done with LOCAL components so an instant near
// midnight UTC maps to the correct local calendar day.
export const isoInstantToLocalDate = (iso: string): string => {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Format a UTC ISO instant as a local clock time, e.g. "6:00 PM". Returns ""
// for a missing/unparseable instant so callers can simply skip rendering it.
export const isoInstantToLocalTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};
