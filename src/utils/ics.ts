// Schedule calendar export (.ics), extracted from helpers.ts.
//
// Reminders fired from the app only land while it's open (Spark plan — no
// backend push). Exporting the schedule as an .ics lets a coach add games to
// their phone/desktop calendar, which then handles reliable native reminders
// even when the app is closed. This builder is pure so it's unit-testable; the
// UI wraps the string in a Blob download.
//
// A game with a first-pitch time (startUtc) is a TIMED event, so the phone's
// calendar can alert before it and show it at the right hour; the instant is
// written in UTC and every calendar app converts it to the viewer's zone. A
// game with only a date is an all-day event on that day. The app stores no
// end time, so a timed game is given GAME_SLOT_MINUTES on the calendar.

import { APP_NAME } from "../constants/ui";
import { normalizeDateToIso } from "./dates";
import { isGameFinalized } from "./gameStatus";

const icsEscapeText = (value: string): string =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

const icsCompactDate = (iso: string): string => iso.replace(/-/g, "");

// All-day DTEND is exclusive, so it points at the day after DTSTART.
const icsNextDay = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(
    dt.getUTCDate(),
  )}`;
};

// How long a timed game occupies on the calendar. Games have a start time but
// no end; two hours covers a typical youth time limit plus warm-up overlap
// without swallowing the next slot of a doubleheader.
export const GAME_SLOT_MINUTES = 120;

const icsStamp = (now: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate(),
  )}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(
    now.getUTCSeconds(),
  )}Z`;
};

// Build an RFC 5545 VCALENDAR string for the team's upcoming games. Finalized
// and postponed games and rows without a parseable date are omitted; events
// are sorted by date, then by start time. Returns a valid (empty) calendar
// when nothing qualifies.
export const buildScheduleIcs = (
  games:
    | Array<{
        id?: string;
        date?: string;
        time?: string;
        startUtc?: string | null;
        opponent?: string;
        isHome?: boolean | null;
        location?: string;
        status?: string;
        teamScore?: number | string | null;
        opponentScore?: number | string | null;
      }>
    | null
    | undefined,
  teamName: string | null | undefined,
  now: Date = new Date(),
): string => {
  const stamp = icsStamp(now);
  const team = (teamName || "").trim() || "Team";

  const events = (Array.isArray(games) ? games : [])
    .filter((g) => g && g.id)
    .filter((g) => (g!.status || "scheduled") !== "postponed")
    .filter((g) => !isGameFinalized(g!))
    .map((g) => ({
      g: g!,
      iso: normalizeDateToIso(g!.date),
      // NaN (not 0) when there is no usable instant, so it can't be mistaken
      // for a real start.
      startMs: Date.parse(g!.startUtc || ""),
    }))
    .filter((e) => !!e.iso)
    .sort(
      (a, b) =>
        a.iso.localeCompare(b.iso) || (a.startMs || 0) - (b.startMs || 0),
    );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Schedule//EN`,
    "CALSCALE:GREGORIAN",
  ];
  for (const { g, iso, startMs } of events) {
    const opp = (g.opponent || "").trim() || "TBD";
    const matchup = `${team} ${g.isHome === false ? "@" : "vs"} ${opp}`;
    const timed = !Number.isNaN(startMs);
    // An all-day event has nowhere else to carry a clock time; `time` is the
    // free-text field on games saved before startUtc existed.
    const legacyTime = timed ? "" : (g.time || "").trim();
    const summary = legacyTime ? `${matchup} (${legacyTime})` : matchup;
    const location = String(g.location || "").trim();
    lines.push(
      "BEGIN:VEVENT",
      `UID:game-${g.id}@coachscard`,
      `DTSTAMP:${stamp}`,
      ...(timed
        ? [
            `DTSTART:${icsStamp(new Date(startMs))}`,
            `DTEND:${icsStamp(new Date(startMs + GAME_SLOT_MINUTES * 60_000))}`,
          ]
        : [
            `DTSTART;VALUE=DATE:${icsCompactDate(iso)}`,
            `DTEND;VALUE=DATE:${icsNextDay(iso)}`,
          ]),
      `SUMMARY:${icsEscapeText(summary)}`,
      ...(location ? [`LOCATION:${icsEscapeText(location)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
};

// Hand the calendar to the browser as a download. On a phone the OS offers to
// open the .ics in its calendar app, which adds every event in one step.
export const downloadScheduleIcs = (
  games: Parameters<typeof buildScheduleIcs>[0],
  teamName: string | null | undefined,
): void => {
  const blob = new Blob([buildScheduleIcs(games, teamName)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = (teamName || "team")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  a.download = `${slug || "team"}-schedule.ics`;
  a.click();
  URL.revokeObjectURL(url);
};
