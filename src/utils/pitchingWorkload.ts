import type { Player } from "../types";

// Per-day pitch totals from a pitcher's log, chronological (oldest → newest) and
// trimmed to the most recent `maxPoints` outings — the series the Arm Care
// sparkline draws so a coach sees the workload trend, not just season totals.
// Same-day entries (doubleheaders) are summed, matching the engine's rest math.
export const pitchOutingSeries = (
  pitching: Player["pitching"] | undefined,
  maxPoints = 8,
): number[] => {
  const rawLog = pitching?.log;
  const log = Array.isArray(rawLog) ? rawLog : [];
  const byDay = new Map<string, number>();
  for (const o of log) {
    if (!o?.date) continue;
    byDay.set(o.date, (byDay.get(o.date) || 0) + (Number(o.pitches) || 0));
  }
  // ISO yyyy-mm-dd strings sort chronologically.
  const days = [...byDay.keys()].sort();
  return days.slice(-maxPoints).map((d) => byDay.get(d) || 0);
};
