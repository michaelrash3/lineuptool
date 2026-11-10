// Game and practice DAYS for the parent availability form, so a family marking
// the dates their player will miss can see which days actually matter.
//
// Published only when the head coach turns it on (team.availabilityShowsSchedule),
// and only as bare dates: no times, places, opponents or anything else. It
// lives in its own doc, portalSchedules/{slug} — keyed by the form link, read
// by `get` only — and NOT in the public team mirror, which any signed-in
// session can list (so dates there would publish every team's schedule).
import { doc, type Firestore } from "firebase/firestore";
import { dateToIsoLocal, isoToLocalDate, isValidIsoDate } from "./dates";

// How far ahead the form shows events, and a cap per kind — enough for any
// season, small enough that the doc stays tiny (the rules cap it too).
export const PORTAL_SCHEDULE_DAYS_AHEAD = 183;
export const PORTAL_SCHEDULE_MAX_DAYS = 150;

export type PortalSchedule = { gameDays: string[]; practiceDays: string[] };

export const portalScheduleRef = (db: Firestore, appId: string, slug: string) =>
  doc(db, "artifacts", appId, "public", "data", "portalSchedules", slug);

const upcomingDays = (
  dates: unknown[],
  fromIso: string,
  toIso: string,
): string[] =>
  Array.from(
    new Set(
      dates
        .map((d) => String(d || "").slice(0, 10))
        .filter((d) => isValidIsoDate(d) && d >= fromIso && d <= toIso),
    ),
  )
    .sort()
    .slice(0, PORTAL_SCHEDULE_MAX_DAYS);

// The days to publish, from `todayIso` (the coach's local today) forward.
// Postponed games and cancelled practices are left off. Pure.
export const buildPortalSchedule = (
  team: { games?: any[]; practices?: any[] } | null | undefined,
  todayIso: string,
): PortalSchedule => {
  const end = isoToLocalDate(todayIso);
  end.setDate(end.getDate() + PORTAL_SCHEDULE_DAYS_AHEAD);
  const toIso = dateToIsoLocal(end);
  const games = (team?.games || []).filter(
    (g: any) => g && g.status !== "postponed",
  );
  const practices = (team?.practices || []).filter(
    (p: any) => p && p.status !== "cancelled",
  );
  return {
    gameDays: upcomingDays(
      games.map((g: any) => g.date),
      todayIso,
      toIso,
    ),
    practiceDays: upcomingDays(
      practices.map((p: any) => p.date),
      todayIso,
      toIso,
    ),
  };
};
