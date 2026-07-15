// GameChanger (and general iCalendar) schedule parsing.
//
// GameChanger Team Manager publishes a team's schedule as an .ics calendar
// feed (webcal://api.team-manager.gc.com/...). Each game is a VEVENT whose
// SUMMARY is "<Team Name> vs <Opponent>" for a HOME game or
// "<Team Name> @ <Opponent>" for an AWAY game. Timed events carry DTSTART in
// UTC (Z); we convert the instant to the viewer's LOCAL date when building a
// game row (so an evening game stored as e.g. 2026-05-30T00:00:00Z lands on
// May 29 locally, not May 30). "All Day" events carry a date-only DTSTART
// (DTSTART;VALUE=DATE:20260620) — those are floating calendar dates with no
// instant, so they keep their literal day and get no clock time.
//
// This module is pure (no I/O) so it can be unit-tested against real feed
// samples. Fetching the feed is the job of the /api/gc-schedule proxy, since
// the calendar host doesn't send CORS headers for a browser fetch.

export interface GcEvent {
  /** Stable per-game UID from the feed — used to de-dupe on re-sync. */
  uid: string;
  /**
   * Event start as an ISO-8601 instant (UTC), e.g. 2026-03-31T22:00:00.000Z.
   * null for all-day events (a floating date has no instant).
   */
  startUtc: string | null;
  /** Event end as an ISO-8601 instant, or null when absent or all-day. */
  endUtc: string | null;
  /** true when DTSTART is date-only (GameChanger "All Day" events). */
  allDay: boolean;
  /**
   * The game's calendar day as "YYYY-MM-DD": the literal feed date for
   * all-day events, the viewer-local day of startUtc for timed ones.
   */
  startDate: string;
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

// Parse an ICS datetime ("20260331T220000Z" or "20260331T220000") into an
// ISO instant. A trailing Z (or a feed that only emits UTC, as GameChanger
// does) is treated as UTC; a bare local datetime is built from local
// components. Date-only values are NOT handled here — they're floating
// calendar dates, not instants (see the all-day branch in
// parseGameChangerIcs).
const parseIcsDate = (value: string): string | null => {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const hour = Number(hh);
  const min = Number(mi);
  const sec = Number(ss);
  const date = z
    ? new Date(Date.UTC(year, month, day, hour, min, sec))
    : new Date(year, month, day, hour, min, sec);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// Pull the opponent + home/away out of a GameChanger SUMMARY. Away (" @ ") is
// checked before home (" vs ") and we use the LAST separator occurrence so a
// team name that itself contains "vs"/"@" doesn't mislead the split.
const parseMatchup = (
  summary: string,
): { opponent: string; isHome: boolean | null } => {
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
        const rawStart = cur.DTSTART || "";
        // "All Day" events are date-only (DTSTART;VALUE=DATE:20260620 —
        // splitProp already stripped the param). They're floating calendar
        // dates: keep the literal day, no instant, no clock time. DTEND on
        // an all-day event is the EXCLUSIVE next day (RFC 5545), not a real
        // end instant, so it's dropped too.
        const allDay = /^\d{8}$/.test(rawStart);
        const startUtc = allDay ? null : parseIcsDate(rawStart);
        const startDate = allDay
          ? `${rawStart.slice(0, 4)}-${rawStart.slice(4, 6)}-${rawStart.slice(6, 8)}`
          : startUtc
            ? isoInstantToLocalDate(startUtc)
            : null;
        // A VEVENT with no parseable start is unusable as a game; skip it.
        if (startDate) {
          const { opponent, isHome } = parseMatchup(summary);
          events.push({
            uid: cur.UID || "",
            startUtc,
            endUtc: allDay || !cur.DTEND ? null : parseIcsDate(cur.DTEND),
            allDay,
            startDate,
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
export const isoInstantToLocalTime = (
  iso: string | null | undefined,
): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

// Format a UTC ISO instant as a 24h "HH:MM" local string for an
// <input type="time"> value. "" when missing/unparseable (all-day / no clock).
export const isoInstantToLocalTimeInput = (
  iso: string | null | undefined,
): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

// Combine a local calendar date (YYYY-MM-DD) and a 24h clock time (HH:MM, from
// an <input type="time">) into a UTC ISO instant, so a hand-entered game's time
// is stored the same way feed-imported games are (Game.startUtc) and renders
// through isoInstantToLocalTime. Returns null when either part is missing or
// malformed — the "all-day, no clock shown" state.
export const localDateTimeToIso = (
  date: string | null | undefined,
  time: string | null | undefined,
): string | null => {
  if (!date || !time) return null;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const d = new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,
    0,
  );
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};
