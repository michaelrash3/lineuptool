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
  HITTING_SAMPLE_K,
  approachOf,
  getEffectiveStats,
  hittingTier,
  plateAppearances,
  powerOf,
  speedBaseOf,
  type HittingContext,
  type HittingTier,
} from "./grades";
import { calcDefensiveScore } from "./evaluation";
import type { ExtraSitEntry } from "./types";

// ---------- Player profile cache ----------
// The batting order reads these scores, so they follow the same idea as the
// hitting evaluation (grades.ts): getting on base comes first, a walk counts
// like a double at kid pitch through 12U, not striking out matters, and every
// rate is shrunk toward an average by sample size — so a 5-for-6 week can't
// leap a kid to the top of the order, and counting stats that just grow with
// games played (RBI, HR totals) no longer drive it.

// What an average kid in each tier looks like — the point a thin sample is
// shrunk toward. Judgment defaults, matching the hitting-grade bands.
const HITTING_PRIORS: Record<
  HittingTier,
  { obp: number; basesPerPa: number; iso: number; kRate: number }
> = {
  machine: { obp: 0.5, basesPerPa: 0.6, iso: 0.1, kRate: 0.15 },
  kidYouth: { obp: 0.45, basesPerPa: 0.65, iso: 0.1, kRate: 0.2 },
  kidTeen: { obp: 0.38, basesPerPa: 0.5, iso: 0.13, kRate: 0.18 },
};

const shrink = (
  value: number | null,
  n: number,
  k: number,
  prior: number,
): number =>
  value == null || !Number.isFinite(value) || n <= 0
    ? prior
    : (value * n + prior * k) / (n + k);

// The stat side of a hitter, shrunk toward the tier's average by sample
// size: on-base, bases per plate appearance (a walk = two bases through 12U
// kid pitch), isolated power and strikeout rate, plus the 0–100 batting value
// they combine into. Shared by the batting order and Roster Decisions.
export function hittingRates(
  p: Player,
  hitting?: HittingContext | null,
): {
  pa: number;
  obp: number;
  basesPerPa: number;
  iso: number;
  kRate: number;
  battingValue: number;
} {
  const tier = hittingTier(hitting);
  const prior = HITTING_PRIORS[tier];
  // Effective (blended) rates: current season blended with the last 1–2
  // past seasons while the current sample is small. Counts are this season's.
  const s: PlayerStats = getEffectiveStats(p);
  const cs: PlayerStats = p.stats || {};
  const num = (v: unknown) => Number(v) || 0;
  const rate = (v: unknown): number | null => {
    const n = Number(v);
    return typeof v === "number" && Number.isFinite(n) ? n : null;
  };

  const pa = plateAppearances(cs);
  const ab = num(cs.ab);
  const h = rate(cs.h);
  const walks = num(cs.bb) + num(cs.hbp);
  const doubles = num(cs.doubles);
  const triples = num(cs.triples);
  const hr = num(cs.hr);

  // On-base: the rate, or from the counts. A bare 0 with no counts is "not
  // tracked" (getEffectiveStats used to zero-fill), not an 0-for.
  let obp = rate(s.obp);
  if ((obp == null || obp === 0) && h != null && pa > 0) obp = (h + walks) / pa;
  else if (obp === 0 && h == null) obp = null;
  const avg = rate(s.avg) || (h != null && ab > 0 ? h / ab : null);
  const slg =
    rate(s.slg) ??
    (rate(s.ops) != null && obp != null && num(s.ops) >= obp
      ? num(s.ops) - obp
      : null);
  // Total bases: from the counts when there are hits, else from SLG × AB.
  const totalBases =
    h != null && h > 0
      ? h + doubles + 2 * triples + 3 * hr
      : slg != null && ab > 0
        ? slg * ab
        : null;
  // A walk / HBP counts as two bases (like a double) at kid pitch through
  // 12U — free steals and passed balls — and as one base elsewhere.
  const walkBases = tier === "kidYouth" ? 2 : 1;
  const basesPerPa =
    totalBases != null && pa > 0 ? (totalBases + walkBases * walks) / pa : null;
  const iso = slg != null && avg != null && slg >= avg ? slg - avg : null;
  const kRate = pa > 0 && rate(cs.k) != null ? num(cs.k) / pa : null;

  const obpS = shrink(obp, pa, HITTING_SAMPLE_K.onBase, prior.obp);
  const basesS = shrink(
    basesPerPa,
    pa,
    HITTING_SAMPLE_K.power,
    prior.basesPerPa,
  );
  return {
    pa,
    obp: obpS,
    basesPerPa: basesS,
    iso: shrink(iso, ab || pa, HITTING_SAMPLE_K.power, prior.iso),
    kRate: shrink(kRate, pa, HITTING_SAMPLE_K.contact, prior.kRate),
    // OBP is worth ~1.8× a point of slugging for scoring runs.
    battingValue: (100 * (1.8 * obpS + basesS)) / 2.8,
  };
}

export function buildPlayerProfile(
  p: Player,
  grades: GradeMap | null | undefined,
  // The team's age group + pitching format (the hitting tier).
  hitting?: HittingContext | null,
): PlayerProfile {
  // Cast: GradeMap has every value as number|undefined, but the engine always
  // operates on the DEFAULT_GRADES-filled shape internally. Casting to a
  // strict Record<string, number> avoids null-coalescing every access.
  const g = { ...DEFAULT_GRADES, ...(grades || {}) } as Record<string, number>;
  const s: PlayerStats = getEffectiveStats(p);
  const r = hittingRates(p, hitting);
  const contactPct =
    typeof s.contact === "number" && s.contact > 0 ? s.contact : null;
  const hard = Number(s.hard) || 0;
  const approach = approachOf(g);

  const battingValue = r.battingValue;
  const leadoffScore =
    r.obp * 60 +
    (1 - r.kRate) * 10 +
    speedBaseOf(g) * 2.5 +
    approach * 2.0 +
    g.baseballIQ * 1.0;
  const powerScore = r.iso * 100 + hard * 20 + powerOf(g) * 3.0;
  const contactScore =
    (1 - r.kRate) * 40 +
    (contactPct ?? 0.7) * 10 +
    approach * 2.0 +
    speedBaseOf(g) * 1.0 +
    g.baseballIQ * 1.0;
  const overallScore = battingValue + approach * 2.0 + g.baseballIQ * 1.5;

  const defensiveScore = calcDefensiveScore(g);

  return {
    grades: g,
    leadoffScore,
    powerScore,
    contactScore,
    overallScore,
    defensiveScore,
    battingValue,
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
