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

// Arms that have been RELIEVED within innings 0..throughInning of a live
// lineup: every id that appears at P in that range except the arm on the
// mound in the latest such inning (the current arm — still pitching, not
// relieved). Mirrors the engine's dead-arm rule (lineupEngine/generator.ts):
// once relieved, an arm never returns in kid pitch. The in-game Available
// Pitchers panel uses this to keep a relieved arm out of the one-tap re-pin
// pool — the coach's explicit pick is the engine's documented override, so
// the UI must not offer it casually. Pure; tolerates missing innings/cells.
export const relievedArmIds = (
  lineup: Array<Record<string, any>> | null | undefined,
  throughInning: number,
): Set<string> => {
  const arms = new Set<string>();
  let currentArm: string | null = null;
  const innings = Array.isArray(lineup) ? lineup : [];
  const last = Math.min(throughInning, innings.length - 1);
  for (let i = 0; i <= last; i++) {
    const id = innings[i]?.P?.id;
    if (id) {
      arms.add(id);
      currentArm = id;
    }
  }
  if (currentArm) arms.delete(currentArm);
  return arms;
};
