// Shared GameChanger schedule-sync helpers, used by both the manual import
// modal and the automatic on-open sync in ScheduleTab. Keeping the fetch +
// upsert logic in one place means both paths de-dupe games identically.

import { parseGameChangerIcs, type GcEvent } from "./icsParse";
import { genId } from "./id";

// Fetch a GameChanger .ics feed through our same-origin proxy and parse it.
// Throws with a readable message (the proxy returns JSON errors) on failure.
export const fetchGcEvents = async (feedUrl: string): Promise<GcEvent[]> => {
  const res = await fetch(
    `/api/gc-schedule?url=${encodeURIComponent(feedUrl.trim())}`,
  );
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

const hasPracticeKeyword = (ev: GcEvent): boolean =>
  /practice/i.test(ev.summary || "");

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
  defaults: GcMergeDefaults,
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
    if (hasPracticeKeyword(ev)) continue;
    const fields = {
      // All-day events keep their literal feed date and have no instant
      // (null startUtc → no clock-time chip in the schedule).
      date: ev.startDate,
      startUtc: ev.startUtc,
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
        (g.startUtc ?? null) !== (fields.startUtc ?? null) ||
        g.opponent !== fields.opponent ||
        g.isHome !== fields.isHome ||
        (g.location || "") !== fields.location;
      if (changed) {
        next[existingIdx] = { ...g, ...fields };
        updated++;
      }
    } else {
      next.push({
        id: genId("g"),
        ...fields,
        leagueRuleSet: defaults.leagueRuleSet,
        // Stamp the classification like manual add does (useGameCrud.addGame):
        // Tournament (USSSA) feeds default to pool play, anything else to
        // rec/league. Feed-created games used to carry NO gameType, which left
        // them invisible to classification chips and engine pool sizing.
        gameType: defaults.leagueRuleSet === "USSSA" ? "pool" : "league",
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

// GameChanger can publish practice titles like "Team vs Opponent Practice".
// Any SUMMARY that says practice should route to the Practices tab instead of
// becoming a lineup-needed game, even if the parser also found a matchup.
const isPracticeEvent = (ev: GcEvent): boolean => hasPracticeKeyword(ev);

export interface GcPracticeMergeResult {
  practices: any[];
  added: number;
  updated: number;
  removed: number;
}

// What a sync would drop, and what it deliberately would not.
//
// Deleting a practice in GameChanger should delete it here — including one
// already played, whose row is no longer a record of anything the team did.
// But a calendar feed is a poor witness for "this no longer exists": it is
// equally silent about an event the coach deleted and about any date outside
// the window it publishes. The only thing separating those two is the feed's
// OWN span, so that is the fence:
//   - manual practices are the coach's own and a feed sync never touches one
//     (gcUid + source both required, not either);
//   - a practice inside [first feed event, last feed event] that the feed does
//     not carry was deleted upstream — the feed demonstrably covers that date
//     and still does not list it. It goes, past or future;
//   - a practice outside that span is reported as `outsideWindow` and kept:
//     the feed simply does not reach it, which is what a roll-off of old
//     events looks like. Silently keeping those is how a coach ends up filing
//     "it didn't delete the old ones" with nothing to look at, so the import
//     preview names them and the span that excluded them;
//   - an empty feed (a publish that failed, an off-season feed) drops nothing,
//     for the same reason: no span, no evidence.
export interface GcPracticeFeedDiff {
  /** Missing from the feed and inside its span — these get deleted. */
  prune: any[];
  /** Missing from the feed but outside its span — kept, and worth explaining. */
  outsideWindow: any[];
  /** The feed's own span, "" / "" when it carried no events. */
  firstFeedDate: string;
  lastFeedDate: string;
}

export const gcPracticesVsFeed = (
  existingPractices: any[],
  events: GcEvent[],
): GcPracticeFeedDiff => {
  const base = Array.isArray(existingPractices) ? existingPractices : [];
  const empty: GcPracticeFeedDiff = {
    prune: [],
    outsideWindow: [],
    firstFeedDate: "",
    lastFeedDate: "",
  };
  if (base.length === 0 || events.length === 0) return empty;

  const feedPracticeUids = new Set<string>();
  let firstFeedDate = "";
  let lastFeedDate = "";
  for (const ev of events) {
    if (isPracticeEvent(ev) && ev.uid) feedPracticeUids.add(ev.uid);
    if (!firstFeedDate || ev.startDate < firstFeedDate)
      firstFeedDate = ev.startDate;
    if (ev.startDate > lastFeedDate) lastFeedDate = ev.startDate;
  }

  const prune: any[] = [];
  const outsideWindow: any[] = [];
  for (const p of base) {
    if (!p?.gcUid || p.source !== "gamechanger") continue;
    if (feedPracticeUids.has(p.gcUid)) continue;
    const date = String(p.date || "");
    // A practice with no usable date fails both comparisons, so it lands in
    // outsideWindow and is kept — the safe side of unparseable data.
    if (date >= firstFeedDate && date <= lastFeedDate) prune.push(p);
    else outsideWindow.push(p);
  }
  return { prune, outsideWindow, firstFeedDate, lastFeedDate };
};

// True when a coach has put something into a practice that deleting it would
// destroy. The prune still takes it — GameChanger is the schedule's authority
// and the coach asked for that — but the import preview flags these rows so a
// deletion that costs an attendance record is never a surprise.
export const practiceHasLoggedWork = (p: any): boolean =>
  Object.keys(p?.attendance || {}).length > 0 ||
  (Array.isArray(p?.drills) && p.drills.length > 0) ||
  String(p?.planNotes || "").trim().length > 0;

// Upsert parsed feed events into the existing practices array, matched by the
// feed UID (practice.gcUid). Mirrors mergeGcEventsIntoGames: only PRACTICE
// events (see isPracticeEvent) are considered; existing practices are refreshed
// only when a schedule field changed (so a no-op sync writes nothing), and
// attendance / drills / environment / planNotes on existing practices are
// preserved. Unlike games, the sync also PRUNES — practices GameChanger has
// dropped go with it (see gcPracticesVsFeed for the fences on that). When all
// three counts are 0 the returned `practices` is reference-equal to the input
// so callers can skip the write.
export const mergeGcEventsIntoPractices = (
  existingPractices: any[],
  events: GcEvent[],
): GcPracticeMergeResult => {
  const base = Array.isArray(existingPractices) ? existingPractices : [];
  // Identity, not id: the prune list is filtered out of `base` itself, so a
  // duplicated id can't take an innocent practice down with it.
  const doomed = new Set(gcPracticesVsFeed(base, events).prune);
  const next = base.filter((p) => !doomed.has(p));
  const removed = doomed.size;
  const idxByUid = new Map<string, number>();
  next.forEach((p, i) => {
    if (p?.gcUid) idxByUid.set(p.gcUid, i);
  });

  let added = 0;
  let updated = 0;
  for (const ev of events) {
    if (!isPracticeEvent(ev)) continue;
    const fields = {
      date: ev.startDate,
      startUtc: ev.startUtc,
      endUtc: ev.endUtc,
      location: ev.location || "",
      gcUid: ev.uid,
    };
    const existingIdx = ev.uid ? idxByUid.get(ev.uid) : undefined;
    if (existingIdx != null) {
      const p = next[existingIdx];
      const changed =
        p.date !== fields.date ||
        (p.startUtc ?? null) !== (fields.startUtc ?? null) ||
        (p.endUtc ?? null) !== (fields.endUtc ?? null) ||
        (p.location || "") !== fields.location;
      if (changed) {
        next[existingIdx] = { ...p, ...fields };
        updated++;
      }
    } else {
      next.push({
        id: genId("p"),
        ...fields,
        environment: "outdoor",
        attendance: {},
        drills: [],
        planNotes: "",
        source: "gamechanger",
        status: "scheduled",
      });
      added++;
    }
  }

  return {
    practices: added > 0 || updated > 0 || removed > 0 ? next : base,
    added,
    updated,
    removed,
  };
};
