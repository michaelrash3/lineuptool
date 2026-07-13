// lineupEngine/profile.ts
// Per-player profile bag (blended stats + grades) plus the aggregated position
// and bench history the generators consume.
import type {
  Game,
  GradeMap,
  Player,
  PlayerProfile,
  PlayerStats,
  SlimPlayer,
} from "../types";
import {
  DEFAULT_GRADES,
  contactOf,
  getEffectiveStats,
  powerOf,
  speedBaseOf,
} from "./grades";
import { calcDefensiveScore } from "./evaluation";
import type { ExtraSitEntry } from "./types";

// ---------- Player profile cache ----------

export function buildPlayerProfile(
  p: Player,
  grades: GradeMap | null | undefined,
): PlayerProfile {
  // Cast: GradeMap has every value as number|undefined, but the engine always
  // operates on the DEFAULT_GRADES-filled shape internally. Casting to a
  // strict Record<string, number> avoids null-coalescing every access.
  const g = { ...DEFAULT_GRADES, ...(grades || {}) } as Record<string, number>;
  // Use effective (blended) stats: blends current with last 1 to 2 past seasons,
  // weighted by current AB sample size. Smooths out small samples early in
  // the season and decays past season influence as current data accumulates.
  const s: PlayerStats = getEffectiveStats(p);
  const num = (v: number | undefined) => Number(v) || 0;

  const obp = num(s.obp);
  const ops = num(s.ops);
  const avg = num(s.avg);
  const contact = num(s.contact);
  // Counting stats (HR, RBI, etc.) come from current season only — they don't
  // need blending. We keep them as-is from the player.stats object.
  const cs: PlayerStats = p.stats || {};
  const hr = num(cs.hr);
  const rbi = num(cs.rbi);
  const doubles = num(cs.doubles);
  const triples = num(cs.triples);
  const ld = num(s.ld);
  const hard = num(s.hard);
  const qab = num(s.qab);

  const advContact = Math.max(ld * 2.5, hard * 2.0, qab * 1.5);
  const finalContact =
    advContact > 0 ? contact * 10 + advContact * 15 : contact * 25;

  const leadoffScore =
    obp * 50 + speedBaseOf(g) * 2.5 + finalContact * 0.4 + g.baseballIQ * 1.0;
  const powerScore =
    ops * 40 +
    hr * 15 +
    doubles * 4 +
    triples * 5 +
    rbi * 2 +
    hard * 20 +
    powerOf(g) * 1.5;
  const contactScore =
    avg * 30 +
    finalContact +
    speedBaseOf(g) * 1.0 +
    g.baseballIQ * 1.0 +
    contactOf(g) * 2.0;
  const overallScore =
    ops * 30 +
    obp * 20 +
    avg * 15 +
    finalContact +
    rbi * 1.5 +
    g.baseballIQ * 1.5 +
    hard * 10;

  const defensiveScore = calcDefensiveScore(g);

  return {
    grades: g,
    leadoffScore,
    powerScore,
    contactScore,
    overallScore,
    defensiveScore,
  };
}

// ---------- Aggregated history ----------

// Whether a past game counts toward season fairness/rotation history.
// Mirrors utils/helpers.isGameFinalized so the engine agrees with the rest
// of the app: a game finalized with the legacy `status === "completed"`
// writer, or one with both scores entered but no status flip to "final",
// STILL counts. The old strict `status === "final"` check silently dropped
// those, starving the fairness model of history.
export function isFinalizedGame(g: Game | null | undefined): boolean {
  if (!g) return false;
  // Scrimmages never feed seasonal fairness/rotation history — they don't
  // count toward bench, defensive innings, or position distribution.
  if (g.isScrimmage) return false;
  if (g.status === "final" || g.status === "completed") return true;
  const ts = g.teamScore;
  const os = g.opponentScore;
  if (ts == null || ts === "" || os == null || os === "") return false;
  return Number.isFinite(Number(ts)) && Number.isFinite(Number(os));
}

// Resolve a past lineup-snapshot slot's id to the CURRENT roster id. Games
// store the id a player had when they were played; if the roster was deleted
// and re-added (a single kid, or the whole team by mistake) those ids are
// orphaned and the re-added players carry fresh ids. Keying season fairness
// by the raw snapshot id then finds NO history for the current roster, so the
// engine sees everyone as neutral and falls back to seating the weakest /
// least-used kids first. Coalesce by unique name (same id-with-name fallback
// as utils/helpers.lineupSlotMatchesPlayer and the Bench Equity tile). Two
// live players who share a name are left un-coalesced — we only remap when the
// snapshot id is no longer on the roster AND the name is unambiguous.
export function buildSlotIdResolver(
  roster: { id?: string; name?: string }[],
): (id?: string, name?: string) => string | undefined {
  const live = new Set((roster || []).map((p) => p && p.id).filter(Boolean));
  const norm = (s: unknown) =>
    String(s ?? "")
      .trim()
      .toLowerCase();
  const byName = new Map<string, string>();
  const dupe = new Set<string>();
  for (const p of roster || []) {
    if (!p || !p.id) continue;
    const n = norm(p.name);
    if (!n) continue;
    if (byName.has(n)) dupe.add(n);
    else byName.set(n, p.id);
  }
  return (id, name) => {
    if (!id) return id;
    if (live.has(id)) return id; // still on the roster — keep
    const n = norm(name);
    if (n && !dupe.has(n) && byName.has(n)) return byName.get(n);
    return id; // unmatched orphan — leave as-is
  };
}

export const IDENTITY_RESOLVER = (id?: string) => id;

export function buildPositionHistory(
  games: Game[],
  currentGameId?: string | null,
  resolveId: (
    id?: string,
    name?: string,
  ) => string | undefined = IDENTITY_RESOLVER,
): Map<string, Map<string, { total: number; bigGame: number }>> {
  const out = new Map<
    string,
    Map<string, { total: number; bigGame: number }>
  >();
  for (const g of games) {
    if (g.id === currentGameId || !g.lineup) continue;
    if (!isFinalizedGame(g)) continue;
    const wasBigGame = g.isBigGame === true;
    for (const inning of g.lineup) {
      // Cast to a positions-only view: we skip BENCH up front, so every
      // remaining slot is SlimPlayer (single player or null).
      const innPos = inning as unknown as Record<string, SlimPlayer>;
      for (const pos in innPos) {
        if (pos === "BENCH") continue;
        const p = innPos[pos];
        if (!p) continue;
        const key = resolveId(p.id, p.name);
        if (!key) continue;
        let m = out.get(key);
        if (!m) {
          m = new Map();
          out.set(key, m);
        }
        const cur = m.get(pos) || { total: 0, bigGame: 0 };
        cur.total += 1;
        if (wasBigGame) cur.bigGame += 1;
        m.set(pos, cur);
      }
    }
  }
  return out;
}

export function buildFirstInningBenchHistory(
  games: Game[],
  currentGameId?: string | null,
  resolveId: (
    id?: string,
    name?: string,
  ) => string | undefined = IDENTITY_RESOLVER,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of games) {
    if (g.id === currentGameId || !g.lineup?.length) continue;
    if (!isFinalizedGame(g)) continue;
    const firstBench = g.lineup[0]?.BENCH;
    if (!firstBench) continue;
    for (const bp of firstBench as NonNullable<SlimPlayer>[]) {
      // attendance is keyed by the id stored at game time, so check it on
      // the original slot id; tally under the resolved (current) id.
      if (g.attendance?.[bp.id] === false) continue;
      const key = resolveId(bp.id, bp.name);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

// Aggregate per player {bench, defensive} innings across all final past games.
// Returns Map<playerId, { bench: number, defensive: number }>.
// Used to compute each player's running cumulative bench ratio so the engine
// can prioritize benching players who've sat the least so far this season.
// For each past final game, compute the minimum bench per attending player
// (math floor) and tally each player's "extra sits" = bench count minus minimum.
// Players who weren't present don't count for that game.
// Returns Map<playerId, { extraSits: number }>.
export function buildExtraSitHistory(
  games: Game[],
  currentGameId?: string | null,
  resolveId: (
    id?: string,
    name?: string,
  ) => string | undefined = IDENTITY_RESOLVER,
): Map<string, ExtraSitEntry> {
  const out = new Map<string, ExtraSitEntry>();

  for (const g of games) {
    if (g.id === currentGameId || !g.lineup?.length) continue;
    if (!isFinalizedGame(g)) continue;

    // Mid-game removals: a kid marked as injured/ill/left from inning N
    // played innings 0..N-1 and is gone from N onward. Innings before N
    // count toward their season totals; innings after N don't (they
    // weren't there). NKB rules treat them as "skip in batting without
    // penalty," and for fairness purposes their bench/play count must
    // be prorated to the innings they actually played.
    const removedFrom = (pid: string): number | null => {
      const r = (
        g.midGameRemovals as Record<string, { fromInning?: number }>
      )?.[pid];
      const fi = r?.fromInning;
      return Number.isFinite(fi) && fi != null ? fi : null;
    };
    const isActiveAtInning = (pid: string, inn: number) => {
      if (g.attendance?.[pid] === false) return false;
      const rf = removedFrom(pid);
      if (rf !== null && inn >= rf) return false;
      return true;
    };

    // For this game, count attending players and bench slots per inning.
    // Bench slots per inning is constant within a game (driven by defenseSize
    // + roster present), so we read it from the first inning's BENCH array.
    const attending = new Set<string>();
    // Map each original snapshot id → name so we can resolve orphaned ids
    // (from a roster delete+re-add) to the current roster id at accumulation
    // time. All the per-game tallying below stays keyed by the original id so
    // attendance / mid-game-removal lookups (also keyed by the snapshot id)
    // stay correct.
    const idName = new Map<string, string>();
    for (const inning of g.lineup) {
      for (const pos in inning) {
        if (pos === "BENCH") continue;
        const p = inning[pos] as SlimPlayer | undefined;
        if (p) {
          attending.add(p.id);
          idName.set(p.id, p.name);
        }
      }
      for (const bp of (inning.BENCH || []) as NonNullable<SlimPlayer>[]) {
        if (g.attendance?.[bp.id] === false) continue;
        attending.add(bp.id);
        idName.set(bp.id, bp.name);
      }
    }
    const playerCount = attending.size;
    if (playerCount === 0) continue;

    const benchSlotsPerInning = (g.lineup[0]?.BENCH || []).length;
    const innings = g.lineup.length;
    const fieldersPerInning =
      innings > 0
        ? Object.keys(g.lineup[0] || {}).filter((k) => k !== "BENCH").length
        : 0;
    const totalBenchSlots = benchSlotsPerInning * innings;
    const totalDefenseSlots = fieldersPerInning * innings;

    // Math floor for this game: floor(totalBenchSlots / playerCount)
    const minBenchPerPlayer = Math.floor(totalBenchSlots / playerCount);
    // Fair share of defense innings for a kid who played the whole game.
    // Prorated below for kids who were removed mid-game.
    const expectedDefThisGame = totalDefenseSlots / playerCount;

    // Per-player innings-played count: every inning they were active.
    const playedInn = new Map<string, number>();
    for (const id of attending) playedInn.set(id, 0);
    for (let i = 0; i < innings; i++) {
      for (const id of attending) {
        if (isActiveAtInning(id, i)) {
          playedInn.set(id, (playedInn.get(id) || 0) + 1);
        }
      }
    }

    // Tally each attending player's bench count, skipping innings they
    // weren't active for (full absence OR mid-game removal).
    const benchCount = new Map<string, number>();
    for (const id of attending) benchCount.set(id, 0);
    for (let i = 0; i < innings; i++) {
      const inning = g.lineup[i];
      for (const bp of (inning.BENCH || []) as NonNullable<SlimPlayer>[]) {
        if (!isActiveAtInning(bp.id, i)) continue;
        if (benchCount.has(bp.id)) {
          benchCount.set(bp.id, (benchCount.get(bp.id) ?? 0) + 1);
        }
      }
    }

    // Update per player tallies: extraSits, raw bench, raw defense, AND
    // the per game expected defense. expectedDef is prorated by the
    // share of innings the kid actually played, so a kid pulled in the
    // 4th of 6 innings doesn't accumulate a 6-inning fair share.
    for (const [pid, count] of benchCount) {
      const played = playedInn.get(pid) || 0;
      // Key by the CURRENT roster id so a re-added player's pre-delete
      // history isn't stranded under their old (orphaned) id.
      const key = resolveId(pid, idName.get(pid));
      if (!key) continue;
      const cur = out.get(key) || {
        extraSits: 0,
        benchInn: 0,
        defInn: 0,
        expectedDef: 0,
      };
      const extra = Math.max(0, count - minBenchPerPlayer);
      cur.extraSits += extra;
      cur.benchInn += count;
      cur.defInn += Math.max(0, played - count);
      cur.expectedDef +=
        innings > 0 ? (played / innings) * expectedDefThisGame : 0;
      out.set(key, cur);
    }
  }
  return out;
}
