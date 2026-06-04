// Shared GameChanger schedule-sync helpers, used by both the manual import
// modal and the automatic on-open sync in ScheduleTab. Keeping the fetch +
// upsert logic in one place means both paths de-dupe games identically.

import {
  parseGameChangerIcs,
  isoInstantToLocalDate,
  type GcEvent,
} from "./icsParse";

// Fetch a GameChanger .ics feed through our same-origin proxy and parse it.
// Throws with a readable message (the proxy returns JSON errors) on failure.
export const fetchGcEvents = async (feedUrl: string): Promise<GcEvent[]> => {
  const res = await fetch(`/api/gc-schedule?url=${encodeURIComponent(feedUrl.trim())}`);
  if (!res.ok) {
    let msg = `Feed request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const text = await res.text();
  return parseGameChangerIcs(text);
};

// Game-config defaults stamped onto newly-created games (mirrors manual add).
export interface GcMergeDefaults {
  leagueRuleSet: unknown;
  pitchingFormat: unknown;
  defenseSize: unknown;
  battingSize: unknown;
  positionLock: unknown;
}

export interface GcMergeResult {
  games: any[];
  added: number;
  updated: number;
}

// Upsert parsed feed events into the existing games array, matched by the
// feed's stable UID (game.gcUid):
//   - new events become new "scheduled" games,
//   - existing games get their schedule fields refreshed ONLY when something
//     actually changed (so a no-op sync writes nothing — important to avoid
//     needless Firestore writes on every Schedule open),
//   - scores, lineups, attendance, and status on existing games are preserved.
// Returns the (possibly same) array plus added/updated counts. When both counts
// are 0 the returned `games` is reference-equal to the input, so callers can
// skip the write.
export const mergeGcEventsIntoGames = (
  existingGames: any[],
  events: GcEvent[],
  defaults: GcMergeDefaults
): GcMergeResult => {
  const base = Array.isArray(existingGames) ? existingGames : [];
  const next = [...base];
  const idxByUid = new Map<string, number>();
  next.forEach((g, i) => {
    if (g?.gcUid) idxByUid.set(g.gcUid, i);
  });

  let added = 0;
  let updated = 0;
  for (const ev of events) {
    const fields = {
      date: isoInstantToLocalDate(ev.startUtc),
      opponent: ev.opponent || "TBD",
      isHome: ev.isHome,
      location: ev.location || "",
      gcUid: ev.uid,
    };
    const existingIdx = ev.uid ? idxByUid.get(ev.uid) : undefined;
    if (existingIdx != null) {
      const g = next[existingIdx];
      const changed =
        g.date !== fields.date ||
        g.opponent !== fields.opponent ||
        g.isHome !== fields.isHome ||
        (g.location || "") !== fields.location;
      if (changed) {
        next[existingIdx] = { ...g, ...fields };
        updated++;
      }
    } else {
      next.push({
        id: "g-" + Math.random().toString(36).substring(2, 10),
        ...fields,
        leagueRuleSet: defaults.leagueRuleSet,
        pitchingFormat: defaults.pitchingFormat,
        defenseSize: defaults.defenseSize,
        battingSize: defaults.battingSize,
        positionLock: defaults.positionLock,
        lineup: null,
        battingLineup: null,
        attendance: {},
        status: "scheduled",
        teamScore: null,
        opponentScore: null,
      });
      added++;
    }
  }

  return { games: added > 0 || updated > 0 ? next : base, added, updated };
};
