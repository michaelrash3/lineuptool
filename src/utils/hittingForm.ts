// Hitting form: is a hitter's on-base really moving, or is it the luck of a
// few games? Shared by the Stats tab's Recent Form (hot / cold) and the
// development trends, so the two never disagree about the same games.
//
// What it measures: on-base percentage. Getting on base is what scores runs
// in youth baseball; a walk counts the same as a single, and at 9–12U kid
// pitch it's worth about a double. Batting average leaves walks out, so it
// called a kid who walked their way on base "cold". When a game line can't say
// how often the kid got on, it falls back to batting average and then QAB%,
// using the same one on both sides of the comparison.
//
// How big a move counts: a kid's on-base over a handful of games swings a
// lot from luck alone. Over 10 trips to the plate a .400 on-base hitter
// lands anywhere from about .250 to .550 without changing a thing. The old
// fixed ±.020 bar called nearly every kid hot or cold after every weekend. A
// move now counts only when it's bigger than that usual luck swing (one
// standard error) for the trips on each side, and never less than .050.

import { countsTowardStats } from "./gameStatus";
import type { Game } from "../types";

export type FormBasis = "obp" | "avg" | "qab";
export type FormClass = "improving" | "steady" | "declining" | "insufficient";

export interface HittingForm {
  class: FormClass;
  basis: FormBasis | null;
  // The rate over the recent and the earlier games, recent minus earlier, and
  // the move that had to be beaten for this sample.
  recent?: number;
  earlier?: number;
  delta?: number;
  threshold?: number;
  // Trips to the plate behind each side (at-bats when the basis is AVG).
  recentTrips?: number;
  earlierTrips?: number;
}

// Never call a move smaller than this a trend, however many trips back it.
export const FORM_MIN_MOVE = 0.05;
// How many standard errors a move has to clear.
export const FORM_Z = 1;

type Line = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Times on base (or hits, or quality at-bats) and the trips they came from,
// for one game line, or null when the line doesn't carry that basis.
const lineSample = (
  line: Line,
  basis: FormBasis,
): { on: number; trips: number } | null => {
  const ab = num(line.ab);
  const h = num(line.h);
  const bb = num(line.bb);
  const hbp = num(line.hbp);
  const pa = num(line.pa) ?? (ab != null ? ab + (bb ?? 0) + (hbp ?? 0) : null);
  if (basis === "avg") {
    if (ab === 0) return { on: 0, trips: 0 };
    return h != null && ab != null ? { on: h, trips: ab } : null;
  }
  if (pa === 0) return { on: 0, trips: 0 };
  if (pa == null) return null;
  if (basis === "obp") {
    // Counts when the walks were imported; otherwise the line's own OBP.
    // Lines imported before walks were read still carry GameChanger's OBP.
    if (h != null && (bb != null || hbp != null)) {
      return { on: h + (bb ?? 0) + (hbp ?? 0), trips: pa };
    }
    const obp = num(line.obp);
    return obp != null ? { on: obp * pa, trips: pa } : null;
  }
  const qab = num(line.qab);
  return qab != null
    ? { on: (qab > 1 ? qab / 100 : qab) * pa, trips: pa }
    : null;
};

// One basis over a run of game lines; null unless every line carries it, so
// the two sides of a comparison always measure the same thing.
export const formSample = (
  lines: ReadonlyArray<Line>,
  basis: FormBasis,
): { rate: number; trips: number } | null => {
  let on = 0;
  let trips = 0;
  for (const line of lines) {
    const s = lineSample(line || {}, basis);
    if (!s) return null;
    on += s.on;
    trips += s.trips;
  }
  return trips > 0 ? { rate: on / trips, trips } : null;
};

const BASES: FormBasis[] = ["obp", "avg", "qab"];

// Compare a recent run of games against the earlier ones. `minRecent` and
// `minEarlier` are the trips each side needs before any call is made.
export const compareHittingForm = (
  earlierLines: ReadonlyArray<Line>,
  recentLines: ReadonlyArray<Line>,
  {
    minRecent = 8,
    minEarlier = 10,
  }: { minRecent?: number; minEarlier?: number } = {},
): HittingForm => {
  for (const basis of BASES) {
    const earlier = formSample(earlierLines, basis);
    const recent = formSample(recentLines, basis);
    if (!earlier || !recent) continue;
    if (recent.trips < minRecent || earlier.trips < minEarlier) {
      return {
        class: "insufficient",
        basis,
        recentTrips: recent.trips,
        earlierTrips: earlier.trips,
      };
    }
    // The luck swing uses the pooled rate, held off 0 and 1 so a kid who
    // hasn't reached base yet doesn't make every change look certain.
    const pooled = Math.min(
      0.95,
      Math.max(
        0.05,
        (recent.rate * recent.trips + earlier.rate * earlier.trips) /
          (recent.trips + earlier.trips),
      ),
    );
    const se = Math.sqrt(
      pooled * (1 - pooled) * (1 / recent.trips + 1 / earlier.trips),
    );
    const threshold = Math.max(FORM_MIN_MOVE, FORM_Z * se);
    const delta = recent.rate - earlier.rate;
    return {
      class:
        delta > threshold
          ? "improving"
          : delta < -threshold
            ? "declining"
            : "steady",
      basis,
      recent: recent.rate,
      earlier: earlier.rate,
      delta,
      threshold,
      recentTrips: recent.trips,
      earlierTrips: earlier.trips,
    };
  }
  return { class: "insufficient", basis: null };
};

// The finalized, non-scrimmage games that carry a stat line for the player,
// oldest first: the games both views read.
export const countedGameLines = (
  games: ReadonlyArray<Game> | null | undefined,
  playerId: string,
): Array<{ game: Game; line: Line }> =>
  (games || [])
    .filter((g) => countsTowardStats(g) && g?.playerStats?.[playerId])
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((game) => ({ game, line: game.playerStats![playerId] as Line }));

// The basis's running season rate after each game, for a sparkline. Games
// whose line doesn't carry the basis are skipped.
export const runningFormSeries = (
  lines: ReadonlyArray<Line>,
  basis: FormBasis,
): number[] => {
  const out: number[] = [];
  let on = 0;
  let trips = 0;
  for (const line of lines) {
    const s = lineSample(line || {}, basis);
    if (!s) continue;
    on += s.on;
    trips += s.trips;
    if (trips > 0) out.push(on / trips);
  }
  return out;
};

// How a move reads: rate points like .045 for on-base and average, points
// of percentage for QAB.
export const formatFormDelta = (
  delta: number,
  basis: FormBasis | null,
): string => {
  const sign = delta >= 0 ? "+" : "";
  if (basis === "qab") return `${sign}${(delta * 100).toFixed(1)}%`;
  return `${sign}${delta.toFixed(3).replace(/^([-+]?)0\./, "$1.")}`;
};

export const FORM_BASIS_LABEL: Record<FormBasis, string> = {
  obp: "on-base",
  avg: "batting average",
  qab: "QAB%",
};
