// Schedule calendar export (.ics), extracted from helpers.ts.
//
// Reminders fired from the app only land while it's open (Spark plan — no
// backend push). Exporting the schedule as an .ics lets a coach add games to
// their phone/desktop calendar, which then handles reliable native reminders
// even when the app is closed. This builder is pure so it's unit-testable; the
// UI wraps the string in a Blob download.
//
// Games are emitted as all-day events: the stored date has no reliable time or
// timezone, and an all-day event shows on the correct calendar day everywhere.
// Any free-text `time` is appended to the title for the coach's reference
// without affecting scheduling.

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
// are sorted by date. Returns a valid (empty) calendar when nothing qualifies.
export const buildScheduleIcs = (
  games:
    | Array<{
        id?: string;
        date?: string;
        time?: string;
        opponent?: string;
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
    .map((g) => ({ g: g!, iso: normalizeDateToIso(g!.date) }))
    .filter((e) => !!e.iso)
    .sort((a, b) => a.iso.localeCompare(b.iso));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Schedule//EN`,
    "CALSCALE:GREGORIAN",
  ];
  for (const { g, iso } of events) {
    const opp = (g.opponent || "").trim() || "TBD";
    const time = (g.time || "").trim();
    const summary = `${team} vs ${opp}${time ? ` (${time})` : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:game-${g.id}@coachscard`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsCompactDate(iso)}`,
      `DTEND;VALUE=DATE:${icsNextDay(iso)}`,
      `SUMMARY:${icsEscapeText(summary)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
};
