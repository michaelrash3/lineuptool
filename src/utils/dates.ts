// Date / calendar helpers extracted from helpers.ts. Pure functions only — no
// React, no Firestore — so they unit-test in isolation and can be imported
// without dragging in the rest of the helpers grab-bag.
//
// All date-only parsing is done from numeric parts instead of `new Date(raw)`
// so imports are deterministic and do not shift a day across time zones.

const padDatePart = (value: string | number): string =>
  String(value).padStart(2, "0");

const isValidDateParts = (
  year: number,
  month: number,
  day: number,
): boolean => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  )
    return false;
  if (
    year < 1900 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
};

const toIsoDate = (year: number, month: number, day: number): string =>
  isValidDateParts(year, month, day)
    ? `${year}-${padDatePart(month)}-${padDatePart(day)}`
    : "";

// Normalize a date string to YYYY-MM-DD (the format `<input type="date">`
// requires). Handles common imports: ISO (2026-04-27), US slash (04/27/2026
// or 4/27/26), ISO with time (2026-04-27T...). Returns "" if unparseable.
export const normalizeDateToIso = (dateString: unknown): string => {
  if (!dateString || typeof dateString !== "string") return "";
  const trimmed = dateString.trim();
  if (!trimmed) return "";

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    return toIsoDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = Number(slashMatch[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return toIsoDate(year, Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const dashedUsMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashedUsMatch) {
    let year = Number(dashedUsMatch[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return toIsoDate(year, Number(dashedUsMatch[1]), Number(dashedUsMatch[2]));
  }

  return "";
};

export const formatGameDateDisplay = (
  dateString: string | null | undefined,
): string => {
  if (!dateString) return "";
  const iso = normalizeDateToIso(dateString);
  if (!iso) return dateString;
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

// Compact, locale-independent date for display: zero-padded MM/DD/YYYY (e.g.
// "10/08/2017"). Used for DOBs and submission timestamps that previously leaked
// raw ISO ("2017-10-08") or unpadded locale strings ("6/27/2026").
//
// - Date-only strings (DOB) are read as calendar parts via normalizeDateToIso,
//   so there is no timezone shift (a UTC birthdate never rolls to the day before
//   in a western zone).
// - Numbers / Date objects are timestamps (e.g. submittedAt = Date.now()) and
//   are formatted in the viewer's local time.
// Unparseable input is returned unchanged so we never render "NaN/NaN/".
export const formatDateDisplay = (
  value: string | number | Date | null | undefined,
): string => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" || value instanceof Date) {
    const dt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dt.getTime())) return "";
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${mm}/${dd}/${dt.getFullYear()}`;
  }
  const iso = normalizeDateToIso(value);
  if (!iso) return String(value);
  const [y, m, d] = iso.split("-");
  return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y}`;
};

export const calculateBaseballAge = (
  dob: string | null | undefined,
  currentSeasonStr: string | null | undefined,
): number | null => {
  if (!dob) return null;
  const parts = (currentSeasonStr || "").split(" ");
  let seasonYear = new Date().getFullYear();
  if (parts.length > 1) {
    seasonYear = parseInt(parts[parts.length - 1], 10);
    if (parts[0].toLowerCase() === "fall") seasonYear += 1;
  }
  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) return null;
  let age = seasonYear - dobDate.getUTCFullYear();
  if (dobDate.getUTCMonth() > 3) age -= 1;
  return age;
};

// Build a 6-row × 7-col month matrix (Sun-first) for `year`/`month` (month is
// 0-based). Each cell is an ISO yyyy-mm-dd string for in-month days, or null
// for the leading/trailing blanks. Pure; UTC-based so no timezone drift.
export const buildMonthGrid = (
  year: number,
  month: number,
): Array<string | null> => {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

export const dateToIsoLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Milliseconds in one calendar day — shared by the day-delta math in the
// eval cadence and game-day reminder helpers.
export const MS_PER_DAY = 86_400_000;

// Parse a stored ISO date ("YYYY-MM-DD", optionally with a time suffix) into
// a *local* midnight Date. Local construction keeps day-delta math on the
// same footing as other local-midnight dates and avoids the UTC skew you'd
// get from `new Date("YYYY-MM-DD")`.
export const isoToLocalDate = (s: string): Date => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export const sameLocalDay = (a: Date, b: Date): boolean => {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};
