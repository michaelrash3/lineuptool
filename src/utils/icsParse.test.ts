import { describe, it, expect } from "vitest";
import {
  parseGameChangerIcs,
  isoInstantToLocalDate,
  isoInstantToLocalTimeInput,
  localDateTimeToIso,
} from "./icsParse";

// Real sample taken verbatim from a GameChanger Team Manager feed
// (api.team-manager.gc.com .ics), trimmed to a few representative events:
// an away game with a LOCATION, an away game without one, a home game, and a
// home game whose opponent name contains spaces/qualifiers.
const SAMPLE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//com.gc/NONSGML GameChanger - Back End//EN
X-WR-CALNAME:Trash Pandas 8u
BEGIN:VEVENT
UID:d99d8793-0262-4387-afe2-7da067087f90
DTSTAMP:20260604T191535Z
DTSTART:20260331T220000Z
CLASS:PUBLIC
SUMMARY:Trash Pandas 8u @ Grizzlies
GEO:39.008077;-84.6322838
LOCATION:St. Henry Athletic Complex\\nFlorence\\, KY\\, United States
STATUS:CONFIRMED
DTEND:20260401T000000Z
END:VEVENT
BEGIN:VEVENT
UID:c61589ab-835e-4fae-82dd-52304c214926
DTSTART:20260414T220000Z
SUMMARY:Trash Pandas 8u @ Griddy
DTEND:20260415T000000Z
END:VEVENT
BEGIN:VEVENT
UID:b0f95ae9-9d98-4c25-b5be-1016ad160967
DTSTART:20260416T220000Z
SUMMARY:Trash Pandas 8u vs Eagles
DTEND:20260417T000000Z
END:VEVENT
BEGIN:VEVENT
UID:fce9a63f-331c-4e09-9afd-9397e5835fc0
DTSTART:20260425T160000Z
SUMMARY:Trash Pandas 8u vs NKYA Bandits 8u Smith
DTEND:20260425T180000Z
END:VEVENT
BEGIN:VEVENT
UID:1bb6dc2a-58f5-4d2e-9c64-aa2a4f4e2f10
DTSTART;VALUE=DATE:20260620
DTEND;VALUE=DATE:20260621
SUMMARY:Father's Day Classic Jun 19–Jun 20
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

describe("parseGameChangerIcs", () => {
  const events = parseGameChangerIcs(SAMPLE);

  it("parses every VEVENT", () => {
    expect(events).toHaveLength(5);
  });

  it("extracts the stable UID for de-duping", () => {
    expect(events[0].uid).toBe("d99d8793-0262-4387-afe2-7da067087f90");
  });

  it("parses an away game (@) with opponent + location", () => {
    const g = events[0];
    expect(g.isHome).toBe(false);
    expect(g.opponent).toBe("Grizzlies");
    expect(g.startUtc).toBe("2026-03-31T22:00:00.000Z");
    expect(g.endUtc).toBe("2026-04-01T00:00:00.000Z");
    // \\n and \\, unescaped to a real newline + commas.
    expect(g.location).toBe(
      "St. Henry Athletic Complex\nFlorence, KY, United States",
    );
  });

  it("parses an away game without a location", () => {
    const g = events[1];
    expect(g.isHome).toBe(false);
    expect(g.opponent).toBe("Griddy");
    expect(g.location).toBeNull();
  });

  it("parses a home game (vs)", () => {
    const g = events[2];
    expect(g.isHome).toBe(true);
    expect(g.opponent).toBe("Eagles");
  });

  it("keeps multi-word opponent names intact", () => {
    expect(events[3].opponent).toBe("NKYA Bandits 8u Smith");
    expect(events[3].isHome).toBe(true);
  });

  it("timed events carry their viewer-local startDate and allDay false", () => {
    // 16:00Z stays April 25 in every US timezone — deterministic in CI.
    expect(events[3].allDay).toBe(false);
    expect(events[3].startDate).toBe("2026-04-25");
  });

  it("all-day events keep their literal date with no instant (no UTC day shift)", () => {
    const g = events[4];
    expect(g.allDay).toBe(true);
    expect(g.startDate).toBe("2026-06-20"); // NOT June 19 local
    expect(g.startUtc).toBeNull();
    // DTEND on an all-day event is the exclusive next day, not a real end.
    expect(g.endUtc).toBeNull();
  });

  it("returns [] for empty or non-calendar input", () => {
    expect(parseGameChangerIcs("")).toEqual([]);
    expect(parseGameChangerIcs("not a calendar")).toEqual([]);
  });
});

describe("isoInstantToLocalDate", () => {
  it("formats a midday-UTC instant to its calendar day (stable across US zones)", () => {
    // 14:00Z stays June 6 in UTC and every US timezone — deterministic in CI.
    expect(isoInstantToLocalDate("2026-06-06T14:00:00.000Z")).toBe(
      "2026-06-06",
    );
  });
});

describe("localDateTimeToIso / isoInstantToLocalTimeInput", () => {
  it("round-trips a local date+time through a UTC instant (zone-independent)", () => {
    // Whatever the runner's zone, combining a local date+time and reading the
    // clock time back out must return the same HH:MM.
    const iso = localDateTimeToIso("2026-05-01", "18:30");
    expect(iso).not.toBeNull();
    expect(isoInstantToLocalTimeInput(iso)).toBe("18:30");
  });

  it("zero-pads a single-digit hour on the way back out", () => {
    const iso = localDateTimeToIso("2026-05-01", "9:05");
    expect(isoInstantToLocalTimeInput(iso)).toBe("09:05");
  });

  it("returns null for a missing or malformed date/time (all-day, no clock)", () => {
    expect(localDateTimeToIso("2026-05-01", "")).toBeNull();
    expect(localDateTimeToIso("", "18:30")).toBeNull();
    expect(localDateTimeToIso("not-a-date", "18:30")).toBeNull();
    expect(localDateTimeToIso("2026-05-01", "99")).toBeNull();
  });

  it("renders a missing instant as an empty time-input value", () => {
    expect(isoInstantToLocalTimeInput(null)).toBe("");
    expect(isoInstantToLocalTimeInput(undefined)).toBe("");
    expect(isoInstantToLocalTimeInput("garbage")).toBe("");
  });
});
