// Season-stat aggregation from per-game imported stat lines.
//
// Coaches import ONE game's GameChanger box score at a time, attributed to a
// specific game. A player's season line is then the aggregate of every game
// line they have:
//   • counting stats (AB, H, HR, RBI, TC, A, …) are summed
//   • innings pitched are summed in OUTS (.1 = ⅓, .2 = ⅔) so 5.2 + 1.1 = 7.0,
//     not the 6.3 a naive decimal add would give
//   • rate stats (AVG, OPS, ERA, WHIP, FPCT, S%, …) are denominator-weighted,
//     which is exact for ratios whose numerator = rate × denominator
//     (AVG×AB = H, ERA×IP = 9·ER, WHIP×IP = H+BB, FPCT×TC = PO+A); AVG is then
//     re-derived exactly from summed H/AB
//   • velocity (top/fastball mph) takes the season MAX
// Pure; no React/Firebase.

import type { Game, Player, PlayerStats } from "../types";

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

// Counting stats — summed across games. IP fields are handled separately (thirds).
const SUM_FIELDS = [
  "ab", "h", "doubles", "triples", "hr", "rbi", "sb", "k", "totalPitches",
  "pBf", "tc", "a", "po",
  "fTc", "fErrors", "fAssists", "fPutouts", "fPb", "fSbAllowed", "fSbAtt",
] as const;

// Innings-pitched fields, summed in outs to respect the .1/.2 = ⅓/⅔ convention.
const IP_FIELDS = ["ip", "pIp"] as const;

// Measured peaks — take the best across games, not a sum or average.
const MAX_FIELDS = ["pTopMph", "pFbMph"] as const;

// Rate stat → the counting field it's weighted by. Weighting by the proper
// denominator makes the season rate exact for true ratios and a sound
// at-bat/innings-weighted average otherwise.
const RATE_FIELDS: Record<string, string> = {
  avg: "ab", obp: "ab", ops: "ab", contact: "ab",
  ld: "ab", fb: "ab", gb: "ab", hard: "ab", qab: "ab", babip: "ab",
  era: "ip",
  pEra: "pIp", pWhip: "pIp", pStrikePct: "pIp", pFps: "pIp", pBbPerInn: "pIp",
  pKbb: "pIp", pBaa: "pIp", pKbf: "pIp", pSwingMiss: "pIp", pWeak: "pIp",
  pHardPct: "pIp", pGoAo: "pIp",
  fpct: "tc", fFpct: "fTc", fCsPct: "fSbAtt",
};

// IP decimal (5.2 = 5⅔) → whole outs.
const ipToOuts = (ip: number): number => {
  const whole = Math.trunc(ip);
  const thirds = Math.round((ip - whole) * 10); // .1→1, .2→2
  return whole * 3 + Math.min(2, Math.max(0, thirds));
};
const outsToIp = (outs: number): number =>
  Math.trunc(outs / 3) + (outs % 3) / 10;

// Aggregate a single player's per-game stat lines into one season line.
export function aggregatePlayerStats(
  lines: Array<PlayerStats | null | undefined>
): PlayerStats {
  const out: Record<string, number> = {};
  const sums: Record<string, number> = {};
  const ipOuts: Record<string, number> = {};
  const maxv: Record<string, number> = {};
  const wAcc: Record<string, number> = {};
  const wDen: Record<string, number> = {};

  for (const line of lines) {
    if (!line) continue;
    for (const fRaw of SUM_FIELDS) {
      const f = fRaw as string;
      const v = num((line as any)[f]);
      if (v !== undefined) sums[f] = (sums[f] || 0) + v;
    }
    for (const fRaw of IP_FIELDS) {
      const f = fRaw as string;
      const v = num((line as any)[f]);
      if (v !== undefined) ipOuts[f] = (ipOuts[f] || 0) + ipToOuts(v);
    }
    for (const fRaw of MAX_FIELDS) {
      const f = fRaw as string;
      const v = num((line as any)[f]);
      if (v !== undefined) maxv[f] = Math.max(maxv[f] ?? -Infinity, v);
    }
    for (const [f, wField] of Object.entries(RATE_FIELDS)) {
      const v = num((line as any)[f]);
      if (v === undefined) continue;
      // Weight by the denominator if present (and the IP fields, in real outs);
      // otherwise weight each game equally so a rate still carries through.
      let w: number | undefined;
      if (wField === "ip" || wField === "pIp") {
        const ipv = num((line as any)[wField]);
        w = ipv !== undefined ? ipToOuts(ipv) : undefined;
      } else {
        w = num((line as any)[wField]);
      }
      const weight = w === undefined || w <= 0 ? 1 : w;
      wAcc[f] = (wAcc[f] || 0) + v * weight;
      wDen[f] = (wDen[f] || 0) + weight;
    }
  }

  for (const f of Object.keys(sums)) out[f] = sums[f];
  for (const f of Object.keys(ipOuts)) out[f] = outsToIp(ipOuts[f]);
  for (const f of Object.keys(maxv)) out[f] = maxv[f];
  for (const f of Object.keys(wDen)) if (wDen[f] > 0) out[f] = wAcc[f] / wDen[f];

  // Exact batting average from the summed totals when we have them.
  if (out.ab > 0 && out.h !== undefined) out.avg = out.h / out.ab;

  return out as PlayerStats;
}

// Rebuild every player's season stats from the per-game lines stored on games.
// Returns a new players array (only the stats field is replaced, for players
// that have at least one game line; others are left untouched). Pure.
export function recomputeSeasonStats(
  games: Array<Game> | null | undefined,
  players: Array<Player> | null | undefined
): Player[] {
  const list = Array.isArray(players) ? players : [];
  const gs = Array.isArray(games) ? games : [];
  const linesByPlayer = new Map<string, PlayerStats[]>();
  for (const g of gs) {
    const ps = (g as any)?.playerStats as
      | Record<string, PlayerStats>
      | undefined;
    if (!ps) continue;
    for (const [pid, line] of Object.entries(ps)) {
      if (!line) continue;
      const arr = linesByPlayer.get(pid) || [];
      arr.push(line);
      linesByPlayer.set(pid, arr);
    }
  }
  return list.map((p) => {
    const lines = linesByPlayer.get(p.id);
    if (!lines || lines.length === 0) return p;
    return { ...p, stats: aggregatePlayerStats(lines) };
  });
}
