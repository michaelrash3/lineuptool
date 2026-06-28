// Availability / scheduled-absence helpers, extracted from helpers.ts. Pure
// date-and-roster math with no React or Firestore — the parent availability
// form, the coach's Availability calendar, and Game Day Attendance all share
// it. All dates are ISO yyyy-mm-dd, built from UTC parts so a viewer's local
// timezone never shifts a day.

// Scheduled absences: dates a family already knows the kid is out (vacation,
// school event), entered ahead of time on the player profile. A game on one
// of these dates defaults the kid to absent in Game Day Attendance — the
// coach can still toggle them back if plans change.
const minutesFromTime = (value: unknown): number | null => {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (
    !Number.isFinite(h) ||
    !Number.isFinite(min) ||
    h < 0 ||
    h > 23 ||
    min < 0 ||
    min > 59
  )
    return null;
  return h * 60 + min;
};

export const availabilityBlockOverlapsEvent = (
  block:
    | { date?: string; startTime?: string; endTime?: string }
    | null
    | undefined,
  event:
    | {
        date?: string | null;
        time?: string | null;
        startTime?: string | null;
        endTime?: string | null;
      }
    | string
    | null
    | undefined,
): boolean => {
  const eventDate = typeof event === "string" ? event : event?.date;
  if (!block?.date || !eventDate) return false;
  if (String(block.date).slice(0, 10) !== String(eventDate).slice(0, 10))
    return false;
  const blockStart = minutesFromTime(block.startTime);
  const blockEnd = minutesFromTime(block.endTime);
  const eventStart =
    typeof event === "string"
      ? null
      : minutesFromTime(event?.startTime || event?.time);
  const eventEnd =
    typeof event === "string" ? null : minutesFromTime(event?.endTime);
  const blockAllDay = blockStart == null || blockEnd == null;
  const eventAllDay = eventStart == null;
  if (blockAllDay || eventAllDay) return true;
  const normalizedBlockEnd = Math.max(blockStart + 1, blockEnd);
  const normalizedEventEnd =
    eventEnd == null ? eventStart + 120 : Math.max(eventStart + 1, eventEnd);
  return blockStart < normalizedEventEnd && eventStart < normalizedBlockEnd;
};

export const isPlayerScheduledOut = (
  player:
    | {
        absences?: string[];
        availabilityBlocks?: Array<{
          date?: string;
          startTime?: string;
          endTime?: string;
        }>;
      }
    | null
    | undefined,
  dateIso: string | null | undefined,
  eventTime?: string | null,
  eventEndTime?: string | null,
): boolean => {
  if (!dateIso) return false;
  const event = {
    date: String(dateIso).slice(0, 10),
    time: eventTime || null,
    endTime: eventEndTime || null,
  };
  if ((player?.absences || []).includes(event.date)) return true;
  return (player?.availabilityBlocks || []).some((block) =>
    availabilityBlockOverlapsEvent(block, event),
  );
};

// Walk an inclusive yyyy-mm-dd range via UTC parts (no local-TZ drift) and
// merge each day into the existing absence list, deduped + sorted. Reversed
// inputs are swapped; absurd ranges are capped at 60 days so a typo'd year
// can't generate thousands of entries.
const isoToUtcMs = (iso: string): number | null => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ABSENCE_RANGE_CAP_DAYS = 60;

export const addAbsenceDateRange = (
  absences: string[] | null | undefined,
  fromIso: string,
  toIso?: string | null,
): string[] => {
  const startMs = isoToUtcMs(fromIso);
  // Blank "to" = a single-day absence.
  const endMs = toIso ? isoToUtcMs(toIso) : startMs;
  if (startMs == null || endMs == null) return [...(absences || [])];
  const lo = Math.min(startMs, endMs);
  const hi = Math.min(
    Math.max(startMs, endMs),
    lo + (ABSENCE_RANGE_CAP_DAYS - 1) * DAY_MS,
  );
  const out = new Set(absences || []);
  for (let ms = lo; ms <= hi; ms += DAY_MS) {
    out.add(new Date(ms).toISOString().slice(0, 10));
  }
  return [...out].sort();
};

export const removeAbsenceDates = (
  absences: string[] | null | undefined,
  dates: string[],
): string[] => {
  const drop = new Set(dates);
  return (absences || []).filter((d) => !drop.has(d));
};

// Fold a flat absence list into contiguous ranges for display: consecutive
// days collapse into one { from, to } chip; `dates` carries the exact days a
// chip's remove button should delete.
export const foldAbsenceRanges = (
  absences: string[] | null | undefined,
): Array<{ from: string; to: string; dates: string[] }> => {
  const sorted = [...new Set(absences || [])]
    .filter((d) => isoToUtcMs(d) != null)
    .sort();
  const out: Array<{ from: string; to: string; dates: string[] }> = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && isoToUtcMs(d) === (isoToUtcMs(last.to) as number) + DAY_MS) {
      last.to = d;
      last.dates.push(d);
    } else {
      out.push({ from: d, to: d, dates: [d] });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Availability calendar helpers. The coach's Availability tab blocks out dates
// where the team can't field a full defense; the parent form and that calendar
// share the month-grid date math here. All dates are ISO yyyy-mm-dd, built from
// UTC parts so a viewer's local timezone never shifts a day.
// ---------------------------------------------------------------------------

// A player counts toward availability unless they've left the team. Departed
// players are excluded; everyone else still counts. `rosterStatus` is typed as
// unknown so the loose `Player` shape (open index signature) passes without a
// cast at every call site.
export const isDepartedPlayer = (
  player: { rosterStatus?: unknown; [key: string]: unknown } | null | undefined,
): boolean => player?.rosterStatus === "departed";

// How many non-departed players are available on a date (i.e. NOT scheduled
// out via their absences or an overlapping availability block).
export const countAvailableOnDate = (
  players:
    | Array<{ rosterStatus?: string; absences?: string[] }>
    | null
    | undefined,
  dateIso: string | null | undefined,
): number => {
  if (!dateIso) return 0;
  const day = String(dateIso).slice(0, 10);
  return (players || []).filter(
    (p) => !isDepartedPlayer(p) && !isPlayerScheduledOut(p, day),
  ).length;
};

// True when fewer than `minPlayers` players are available on the date — the
// signal to block the day out on the calendar. `minPlayers` is the team's
// defenseSize (9 or 10).
export const isShortHandedOnDate = (
  players:
    | Array<{ rosterStatus?: string; absences?: string[] }>
    | null
    | undefined,
  dateIso: string | null | undefined,
  minPlayers: number,
): boolean => countAvailableOnDate(players, dateIso) < minPlayers;

// The non-departed players scheduled out on a date — drives the "who's out"
// panel when the coach taps a day.
export const playersOutOnDate = <
  T extends { rosterStatus?: string; absences?: string[] },
>(
  players: T[] | null | undefined,
  dateIso: string | null | undefined,
): T[] => {
  if (!dateIso) return [];
  const day = String(dateIso).slice(0, 10);
  return (players || []).filter(
    (p) => !isDepartedPlayer(p) && isPlayerScheduledOut(p, day),
  );
};
