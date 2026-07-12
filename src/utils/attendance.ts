// Attendance mark predicates, shared by every attendance consumer (season
// report, awards, development report, home dashboard, player development).
//
// The dual format is LOAD-BEARING data compat, not legacy debt: game
// attendance writes booleans today (UIProvider toggles true/false), while
// practice attendance writes strings ("present" / "absent" / "excused").
// Both shapes coexist in stored team docs, so both predicates accept both.
// "excused" (and any unmarked value) counts neither present nor absent.
export const attIsPresent = (v: unknown): boolean =>
  v === true || v === "present";

export const attIsAbsent = (v: unknown): boolean =>
  v === false || v === "absent";
