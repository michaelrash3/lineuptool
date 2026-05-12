// lineupEngine.js
// =============================================================================
// Pure function lineup generation engine.
// No React, no Firebase, no DOM  fully testable in isolation and trivially
// movable to a Web Worker if the UI thread ever needs to be freed up.
//
// Public API
// ----------
//   generateLineup(input)  -> { lineup, battingLineup } | { error: string }
//   generateBattingOrder(profiledPlayers, battingSize, opts) -> Player[]
//
// Plus exported helpers (`getPositionsForInning`, `getCombinedGrades`,
// `getOffensiveScore`, `calculateTotalScore`, etc.) used by the UI.
//
// What this version adds vs. the inline original
// ----------------------------------------------
//   Pre computed player profiles (no repeated stat parsing in inner loops)
//   One pass aggregated position history (was: full re scan per scoring call)
//   Fisher Yates shuffle with a seeded PRNG (mulberry32)  unbiased + reproducible
//   200 attempt score guided greedy with early exit on penalty=0 (was: 5,000)
//   Diversity penalty: punishes 3+ innings at the same non C/non P position
//     across the game, which produces noticeably more rotation
//   Explicit `seed` parameter so the UI can offer "Regenerate" deliberately
// =============================================================================

// ---------- Constants ----------
const POS_10 = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "RCF", "RF"];
const POS_9 = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const OF_POSITIONS = new Set(["LF", "LCF", "RCF", "RF", "CF"]);
const INFIELD_NON_1B = new Set(["C", "2B", "SS", "3B"]);

const POS_DIFFICULTY = {
  P: 5,
  "1B": 5,
  SS: 5,
  C: 4,
  "2B": 4,
  "3B": 4,
  LCF: 2,
  RCF: 2,
  CF: 2,
  LF: 1,
  RF: 1,
};

const EVAL_CATEGORIES = [
  { id: "fielding", weight: 2.5 },
  { id: "baseballIQ", weight: 2.0 },
  { id: "armStrength", weight: 1.5 },
  { id: "armAccuracy", weight: 1.5 },
  { id: "speedAgility", weight: 1.5 },
  { id: "coachability", weight: 1.0 },
];

const DEFAULT_GRADES = Object.freeze({
  fielding: 5,
  armStrength: 5,
  armAccuracy: 5,
  speedAgility: 5,
  baseballIQ: 5,
  coachability: 5,
});

// ---------- Public helpers (re exported for the UI) ----------

export function getPositionsForInning(playerCount, defSize) {
  const base = defSize === "10" ? POS_10 : POS_9;
  if (defSize === "10") {
    if (playerCount >= 10) return [...base];
    if (playerCount === 9) return base.filter((p) => p !== "RF");
    if (playerCount === 8) return base.filter((p) => p !== "RF" && p !== "LF");
    return base.filter((p) => p !== "RF" && p !== "LF" && p !== "RCF");
  }
  if (playerCount >= 9) return [...base];
  if (playerCount === 8) return base.filter((p) => p !== "RF");
  return base.filter((p) => p !== "RF" && p !== "LF");
}

export function getCombinedGrades(evaluationEvents, playersList) {
  let latestHead = null;
  for (const e of evaluationEvents) {
    if (e.coachRole !== "Head") continue;
    if (!latestHead || new Date(e.date) > new Date(latestHead.date))
      latestHead = e;
  }

  const latestAssistantByEvaluator = new Map();
  for (const e of evaluationEvents) {
    if (e.coachRole !== "Assistant" || !e.evaluatorId) continue;
    const cur = latestAssistantByEvaluator.get(e.evaluatorId);
    if (!cur || new Date(e.date) > new Date(cur.date)) {
      latestAssistantByEvaluator.set(e.evaluatorId, e);
    }
  }
  const assistantEvals = [...latestAssistantByEvaluator.values()];
  const astCount = assistantEvals.length;

  const out = {};
  for (const p of playersList) {
    const headG = latestHead?.grades?.[p.id];
    const grades = { ...DEFAULT_GRADES };

    if (astCount > 0) {
      const astSum = {
        fielding: 0,
        armStrength: 0,
        armAccuracy: 0,
        speedAgility: 0,
        baseballIQ: 0,
        coachability: 0,
      };
      let participating = 0;
      for (const ev of assistantEvals) {
        const g = ev.grades?.[p.id];
        if (!g) continue;
        for (const cat of EVAL_CATEGORIES) astSum[cat.id] += g[cat.id] || 5;
        participating++;
      }
      if (participating > 0) {
        for (const cat of EVAL_CATEGORIES) {
          const astAvg = astSum[cat.id] / participating;
          if (headG)
            grades[cat.id] = Math.round((headG[cat.id] * 2 + astAvg) / 3);
          else grades[cat.id] = Math.round(astAvg);
        }
        out[p.id] = grades;
        continue;
      }
    }

    if (headG) {
      for (const cat of EVAL_CATEGORIES) grades[cat.id] = headG[cat.id];
    }
    out[p.id] = grades;
  }
  return out;
}

// Compute "effective" stats for a player by blending current season stats with
// recent past seasons. This addresses the small sample problem early in a
// season (when current AB counts are tiny) AND the recency problem (where last
// year's stats matter less than this year's).
//
// Weighting strategy:
//   Past season N 1 (most recent past): weight 0.5 baseline
//   Past season N 2: weight 0.25 baseline
//   Past seasons further back: ignored
//   Current season: weight scales with sample size
//       0 ABs:  weight 0   (entirely past driven)
//       10 ABs: weight 0.5 (half past, half current)
//       30 ABs: weight 1.0 (current only)
//       30+ ABs: weight 1.0 (still current only)
//   When current weight is high, past weights scale down so totals don't double count.
//
// All stats use AB weighted averaging where appropriate. Counting stats
// (H, HR, RBI, etc.) come straight from current  they don't need blending.
export function getEffectiveStats(player) {
  const cur = player?.stats || {};
  const pastAll = Array.isArray(player?.pastSeasons) ? player.pastSeasons : [];
  // Take up to two most recent past seasons. Sort by descending season string.
  const past = [...pastAll]
    .filter((p) => p && p.stats)
    .sort((a, b) => String(b.season).localeCompare(String(a.season)))
    .slice(0, 2);

  const curAB = +cur.ab || 0;
  // Current weight ramps from 0  1 over the first 30 ABs.
  const wCur = Math.min(1, curAB / 30);
  // Past weights scale down as current ramps up.
  const wP1 = past[0] ? 0.5 * (1 - wCur) : 0;
  const wP2 = past[1] ? 0.25 * (1 - wCur) : 0;
  const totalW = wCur + wP1 + wP2;

  // If we somehow have nothing, return whatever the current stats are (or empty).
  if (totalW === 0) return cur;

  // Blend rate stats (avg, ops, obp, contact, ld, hard, qab, babip).
  const blend = (key) => {
    const c = +cur[key] || 0;
    const p1 = past[0]?.stats ? +past[0].stats[key] || 0 : 0;
    const p2 = past[1]?.stats ? +past[1].stats[key] || 0 : 0;
    return (c * wCur + p1 * wP1 + p2 * wP2) / totalW;
  };

  return {
    ...cur, // preserve any non blended fields (counting stats etc.)
    avg: blend("avg"),
    ops: blend("ops"),
    obp: blend("obp"),
    contact: blend("contact"),
    ld: blend("ld"),
    hard: blend("hard"),
    qab: blend("qab"),
    babip: blend("babip"),
    // Mark for downstream code that this is blended; debug aid.
    __blended: true,
    __blendWeights: { current: wCur, past1: wP1, past2: wP2 },
  };
}

export function getOffensiveScore(stats) {
  if (!stats) return 5;
  const ops = +stats.ops || 0;
  const avg = +stats.avg || 0;
  const obp = +stats.obp || 0;
  const contact = +stats.contact || 0;
  const ld = +stats.ld || 0;
  const hard = +stats.hard || 0;
  const qab = +stats.qab || 0;
  const babip = +stats.babip || 0;

  if (ops === 0 && avg === 0 && qab === 0) return 5;

  const opsScore = Math.min(10, ops * 5);
  const avgScore = Math.min(10, avg * 10);
  const obpScore = Math.min(10, obp * 10);
  const conScore = Math.min(10, contact * 10);
  const advanced = Math.max(ld * 25, hard * 20, qab * 15);
  const hasAdv = ld > 0 || hard > 0 || qab > 0;

  const weighted = hasAdv
    ? opsScore * 0.35 +
      avgScore * 0.15 +
      obpScore * 0.2 +
      Math.min(10, advanced) * 0.3
    : opsScore * 0.4 + avgScore * 0.25 + obpScore * 0.2 + conScore * 0.15;

  const hr = +stats.hr || 0;
  const doubles = +stats.doubles || 0;
  const triples = +stats.triples || 0;
  const xbBonus = Math.min(1.5, hr * 0.5 + triples * 0.3 + doubles * 0.1);
  const unlucky =
    (ld > 0.15 || hard > 0.15) && babip < 0.3
      ? Math.min(2, (0.3 - babip) * 5)
      : 0;

  return Math.min(10, Math.max(1, Math.round(weighted + xbBonus + unlucky)));
}

export function calculateTotalScore(grades, stats) {
  if (!grades) return 0;
  const off = getOffensiveScore(stats);
  return Math.round(
    (grades.fielding || 5) * 2.5 +
      (grades.baseballIQ || 5) * 2.0 +
      (grades.armStrength || 5) * 1.5 +
      (grades.armAccuracy || 5) * 1.5 +
      (grades.speedAgility || 5) * 1.5 +
      (grades.coachability || 5) * 1.0 +
      off * 2.0
  );
}

// ---------- Pitch count eligibility ----------

const PITCH_LIMITS = {
  "6U": 50,
  "7U": 50,
  "8U": 50,
  "9U": 75,
  "10U": 75,
  "11U to 12U": 85,
  "13U to 14U": 95,
  "15U to 18U": 105,
};

function maxPitchesForAge(age) {
  return PITCH_LIMITS[age] ?? 105;
}
function requiredRestDays(p) {
  if (p >= 66) return 4;
  if (p >= 51) return 3;
  if (p >= 36) return 2;
  if (p >= 21) return 1;
  return 0;
}

export function checkPitchEligibility(player, targetDateStr, ageGroup) {
  const pitching = player.pitching;
  if (!pitching?.lastPitchDate || !pitching.recentPitches) return true;
  const recent = pitching.recentPitches;
  if (recent === 0) return true;
  if (recent >= maxPitchesForAge(ageGroup)) return false;
  const diffDays = Math.floor(
    (new Date(targetDateStr).getTime() -
      new Date(pitching.lastPitchDate).getTime()) /
      86_400_000
  );
  return diffDays > requiredRestDays(recent);
}

// ---------- Lefty infield penalty (precomputed table) ----------

const LEFTY_PENALTY = {
  "NKB|6U": 5,
  "NKB|7U": 5,
  "NKB|8U": 10,
  "NKB|9U": 25,
  "USSSA|6U": 20,
  "USSSA|7U": 20,
  "USSSA|8U": 35,
};
function leftyInfieldPenalty(rules, age) {
  return LEFTY_PENALTY[`${rules}|${age}`] ?? 50;
}

// ---------- Seeded PRNG ----------
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ---------- Player profile cache ----------

function buildPlayerProfile(p, grades) {
  const g = grades || DEFAULT_GRADES;
  // Use effective (blended) stats: blends current with last 1 to 2 past seasons,
  // weighted by current AB sample size. Smooths out small samples early in
  // the season and decays past season influence as current data accumulates.
  const s = getEffectiveStats(p);

  const obp = +s.obp || 0;
  const ops = +s.ops || 0;
  const avg = +s.avg || 0;
  const contact = +s.contact || 0;
  // Counting stats (HR, RBI, etc.) come from current season only  they don't
  // need blending, but past versions of them aren't directly meaningful here
  // anyway. We keep them as is from the player.stats object.
  const cs = p.stats || {};
  const hr = +cs.hr || 0;
  const rbi = +cs.rbi || 0;
  const doubles = +cs.doubles || 0;
  const triples = +cs.triples || 0;
  const ld = +s.ld || 0;
  const hard = +s.hard || 0;
  const qab = +s.qab || 0;

  const advContact = Math.max(ld * 2.5, hard * 2.0, qab * 1.5);
  const finalContact =
    advContact > 0 ? contact * 10 + advContact * 15 : contact * 25;

  const leadoffScore =
    obp * 50 + g.speedAgility * 2.5 + finalContact * 0.4 + g.baseballIQ * 1.0;
  const powerScore =
    ops * 40 + hr * 15 + doubles * 4 + triples * 5 + rbi * 2 + hard * 20;
  const contactScore =
    avg * 30 + finalContact + g.speedAgility * 1.0 + g.baseballIQ * 1.0;
  const overallScore =
    ops * 30 +
    obp * 20 +
    avg * 15 +
    finalContact +
    rbi * 1.5 +
    g.baseballIQ * 1.5 +
    hard * 10;

  const defensiveScore =
    g.fielding * 3.0 +
    g.armStrength * 1.5 +
    g.armAccuracy * 1.5 +
    g.speedAgility * 2.0 +
    g.baseballIQ * 2.0;

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

function buildPositionHistory(games, currentGameId) {
  const out = new Map();
  for (const g of games) {
    if (g.id === currentGameId || !g.lineup) continue;
    // Only completed games count toward fairness  postponed/scheduled don't.
    if (g.status && g.status !== "final") continue;
    const wasBigGame = g.isBigGame === true;
    for (const inning of g.lineup) {
      for (const pos in inning) {
        if (pos === "BENCH") continue;
        const p = inning[pos];
        if (!p) continue;
        let m = out.get(p.id);
        if (!m) {
          m = new Map();
          out.set(p.id, m);
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

function buildFirstInningBenchHistory(games, currentGameId) {
  const counts = new Map();
  for (const g of games) {
    if (g.id === currentGameId || !g.lineup?.length) continue;
    if (g.status && g.status !== "final") continue;
    const firstBench = g.lineup[0]?.BENCH;
    if (!firstBench) continue;
    for (const bp of firstBench) {
      if (g.attendance?.[bp.id] === false) continue;
      counts.set(bp.id, (counts.get(bp.id) || 0) + 1);
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
function buildExtraSitHistory(games, currentGameId) {
  const out = new Map();

  for (const g of games) {
    if (g.id === currentGameId || !g.lineup?.length) continue;
    if (g.status && g.status !== "final") continue;

    // For this game, count attending players and bench slots per inning.
    // Bench slots per inning is constant within a game (driven by defenseSize
    // + roster present), so we read it from the first inning's BENCH array.
    const attending = new Set();
    for (const inning of g.lineup) {
      for (const pos in inning) {
        if (pos === "BENCH") continue;
        const p = inning[pos];
        if (p) attending.add(p.id);
      }
      for (const bp of inning.BENCH || []) {
        if (g.attendance?.[bp.id] === false) continue;
        attending.add(bp.id);
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
    // Fair share of defense innings for an attending kid in this game
    const expectedDefThisGame = totalDefenseSlots / playerCount;

    // Tally each attending player's bench count this game.
    const benchCount = new Map();
    for (const id of attending) benchCount.set(id, 0);
    for (const inning of g.lineup) {
      for (const bp of inning.BENCH || []) {
        if (g.attendance?.[bp.id] === false) continue;
        if (benchCount.has(bp.id)) {
          benchCount.set(bp.id, benchCount.get(bp.id) + 1);
        }
      }
    }

    // Update per player tallies: extraSits, raw bench, raw defense, AND
    // the per game expected defense (so absent games don't skew the kid's
    // expected total).
    for (const [pid, count] of benchCount) {
      const cur = out.get(pid) || {
        extraSits: 0,
        benchInn: 0,
        defInn: 0,
        expectedDef: 0,
      };
      const extra = Math.max(0, count - minBenchPerPlayer);
      cur.extraSits += extra;
      cur.benchInn += count;
      cur.defInn += innings - count;
      cur.expectedDef += expectedDefThisGame;
      out.set(pid, cur);
    }
  }
  return out;
}

// ---------- Batting order ----------

// Detects whether NKB's per half inning run cap applies to a given league/age.
// NKB caps half innings at 7 runs for 7U/8U Machine Pitch (and 6U coach pitch).
// 9U+ NKB and all USSSA tiers have no run cap.
export function hasNkbRunCap(leagueRuleSet, teamAge) {
  if (leagueRuleSet !== "NKB") return false;
  return teamAge === "6U" || teamAge === "7U" || teamAge === "8U";
}

/**
 * Modern analytical batting order builder.
 *
 * Two strategies, auto selected:
 *
 * 1) UNCAPPED (no per inning run limit)  uses Tango/The Book logic:
 * #1: Best OBP (table setter)
 * #2: Second best overall (modern view of #2 as a primary RBI spot)
 * #3: Fourth best overall (the "sacrificed" #3 in modern analytics)
 * #4: Best slugger (cleanup)
 * #5: Next best power
 * #6+: Descending overall score
 *
 * 2) CAPPED (NKB 6U/7U/8U with 7 run per inning cap)  distributes strong
 * hitters more evenly so each inning has a better chance of hitting the
 * cap (rather than clustering all the strength up top and "wasting" hits
 * against the cap). Spreads top tier hitters across the first ~7 spots:
 * #1: Best OBP (still want a baserunner)
 * #2: Best overall remaining
 * #3: Best slugger (move power up; he'll bat with men on)
 * #4: Next best OBP (so we can keep the rally rolling)
 * #5: Next best slugger
 * #6: Next best overall
 * #7: Next best OBP
 * #8+: Descending overall score (weak kids cluster at bottom per config)
 *
 * Both strategies return the order plus per spot reasoning ('why' metadata)
 * accessible via the player's `profile.battingReason` field after generation.
 *
 * `battingSize` matches the existing semantics: "roster" = bat everyone, or
 * a number to limit to top N hitters.
 */
export function generateBattingOrder(profiledPlayers, battingSize, opts = {}) {
  const { leagueRuleSet, teamAge, seed } = opts;
  const total = profiledPlayers.length;
  const count =
    battingSize === "roster"
      ? total
      : Math.min(parseInt(battingSize, 10) || total, total);

  // Per player plus or minus 2 percent score jitter for re roll variance. A single factor per
  // player applied to every score key  strong/weak ends barely move,
  // similarly rated kids in the middle can swap on a different seed.
  // Same seed  same order (deterministic).
  const rand = mulberry32((seed ?? Date.now()) >>> 0);
  const JITTER = 0.02;
  const factor = new Map();
  for (const p of profiledPlayers) {
    factor.set(p.id, 1 + (rand() * 2 - 1) * JITTER);
  }
  const score = (p, key) => (p.profile[key] || 0) * factor.get(p.id);
  // OPS lives on raw stats, not in the precomputed profile, so wrap it the
  // same way for jittered selection (only used by the youth strategy).
  const opsScore = (p) => (+p.stats?.ops || 0) * factor.get(p.id);

  const byOverall = [...profiledPlayers].sort(
    (a, b) => score(b, "overallScore") - score(a, "overallScore")
  );
  const pool = byOverall.slice(0, count);
  const order = new Array(count).fill(null);
  const reasons = new Array(count).fill("");

  function takeBest(scoreKey) {
    if (pool.length === 0) return null;
    let bestIdx = 0;
    for (let i = 1; i < pool.length; i++) {
      if (score(pool[i], scoreKey) > score(pool[bestIdx], scoreKey))
        bestIdx = i;
    }
    return pool.splice(bestIdx, 1)[0];
  }

  function takeBestOps() {
    if (pool.length === 0) return null;
    let bestIdx = 0;
    for (let i = 1; i < pool.length; i++) {
      if (opsScore(pool[i]) > opsScore(pool[bestIdx])) bestIdx = i;
    }
    return pool.splice(bestIdx, 1)[0];
  }

  function place(idx, player, role, note) {
    if (player && idx < count) {
      order[idx] = player;
      reasons[idx] = { role, note };
    }
  }

  // Strategy selection:
  //   NKB 6U/7U/8U: youth strategy (continuous roster batting, 7 run
  //     cap, no walks, no real "power"  but OPS still flags genuine
  //     big hitters at this age). Spread strong OPS across the top half
  //     (3, 4, 7) so they bat with runners on without clustering.
  //   Everyone else: existing Tango/Book modern lineup. Unchanged.
  const useYouth =
    leagueRuleSet === "NKB" &&
    (teamAge === "6U" || teamAge === "7U" || teamAge === "8U");

  if (useYouth) {
    if (count > 0)
      place(
        0,
        takeBest("leadoffScore"),
        "Leadoff",
        "Best OBP+speed  set the table"
      );
    if (count > 1)
      place(
        1,
        takeBest("contactScore"),
        "#2 Contact",
        "Top contact  extends the rally"
      );
    if (count > 2)
      place(2, takeBestOps(), "#3 OPS", "Best OPS  bat with runners on");
    if (count > 3)
      place(3, takeBestOps(), "Cleanup OPS", "Second best OPS  drive runs in");
    if (count > 4)
      place(
        4,
        takeBest("leadoffScore"),
        "#5 Turnover",
        "Next best OBP  turn the order over"
      );
    if (count > 5)
      place(
        5,
        takeBest("contactScore"),
        "#6 Sustain",
        "More contact  keep it going"
      );
    if (count > 6)
      place(
        6,
        takeBestOps(),
        "#7 Late OPS",
        "Third big hitter  late inning threat"
      );

    // Tail: descending by composite youthScore (leadoff + contact + OPS).
    // No `powerScore`  HR/SLG/RBI are noise at this age.
    const youthScore = (p) =>
      score(p, "leadoffScore") + score(p, "contactScore") + opsScore(p) * 100;
    pool.sort((a, b) => youthScore(b) - youthScore(a));
    let descIdx = 0;
    for (let i = 7; i < count; i++) {
      if (order[i] === null && pool.length > 0) {
        order[i] = pool.shift();
        descIdx++;
        reasons[i] = {
          role: descIdx <= 3 ? "Middle" : "Bottom",
          note: `Descending youth composite (#${descIdx})`,
        };
      }
    }
  } else {
    // Modern Tango / Book style strategy for uncapped leagues
    if (count > 0)
      place(0, takeBest("leadoffScore"), "Leadoff", "Best OBP  leadoff");
    if (count > 1)
      place(
        1,
        takeBest("overallScore"),
        "#2 Premium",
        "Best overall  modern #2 spot is a premium RBI position"
      );
    if (count > 3)
      place(3, takeBest("powerScore"), "Cleanup", "Best slugger  cleanup");
    if (count > 2)
      place(
        2,
        takeBest("overallScore"),
        "#3 Modern",
        "Strong bat  modern #3 is the 4th best slot"
      );
    if (count > 4)
      place(
        4,
        takeBest("powerScore"),
        "#5 Power",
        "Next best power  second cleanup"
      );

    // Fill remaining spots descending by overallScore (jittered).
    pool.sort((a, b) => score(b, "overallScore") - score(a, "overallScore"));
    let descIdx = 0;
    for (let i = 0; i < count; i++) {
      if (order[i] === null && pool.length > 0) {
        order[i] = pool.shift();
        descIdx++;
        reasons[i] = {
          role: descIdx <= 3 ? "Middle" : "Bottom",
          note: `Descending overall (#${descIdx})`,
        };
      }
    }
  }

  // Attach structured reasons to the placed players. The UI looks for
  // `battingReason` with shape { role, note, effective: {ops, avg, hard} }.
  for (let i = 0; i < count; i++) {
    const player = order[i];
    if (!player) continue;
    const reason = reasons[i] || { role: "", note: "" };
    const stats = player.stats || {};
    player.battingReason = {
      role: reason.role,
      note: reason.note,
      effective: {
        ops: +stats.ops || 0,
        avg: +stats.avg || 0,
        obp: +stats.obp || 0,
        hard: +stats.hard || 0,
      },
    };
  }
  return order.filter(Boolean);
}

// Lightweight wrapper for "re roll batting only"  builds player profiles
// from raw players + grades and runs generateBattingOrder. Defense side
// state (lineup, bench schedule, etc.) is untouched. Returns the new
// batting order or { error } if the inputs are too thin.
export function generateBattingOnly(input) {
  const {
    activePlayers,
    allPlayers,
    evaluationEvents = [],
    leagueRuleSet,
    teamAge,
    battingSize,
    seed,
  } = input;

  if (!Array.isArray(activePlayers) || activePlayers.length < 1) {
    return { error: "No active players to build a batting order from." };
  }

  const combinedGrades = getCombinedGrades(
    evaluationEvents,
    allPlayers || activePlayers
  );
  const profiled = activePlayers.map((p) => ({
    ...p,
    profile: buildPlayerProfile(p, combinedGrades[p.id]),
  }));

  const battingLineup = generateBattingOrder(profiled, battingSize, {
    leagueRuleSet,
    teamAge,
    seed,
  });

  // Mirror the effective stats decoration that generateLineup applies, so
  // the UI sees the same structured `battingReason` shape regardless of
  // which entry point produced the order.
  battingLineup.forEach((player) => {
    if (!player || !player.battingReason) return;
    const eff = getEffectiveStats(player);
    if (eff.__blended && eff.__blendWeights?.current < 0.95) {
      player.battingReason.blendNote = `Stats blended (current ${Math.round(
        eff.__blendWeights.current * 100
      )}% / past ${Math.round(
        (eff.__blendWeights.past1 + eff.__blendWeights.past2) * 100
      )}%)`;
    }
    player.battingReason.effective = {
      ops: +eff.ops || 0,
      avg: +eff.avg || 0,
      obp: +eff.obp || 0,
      ld: +eff.ld || 0,
      hard: +eff.hard || 0,
      qab: +eff.qab || 0,
    };
  });

  return { battingLineup };
}

// ---------- Main generator ----------

export function generateLineup(input) {
  const {
    activePlayers,
    allPlayers,
    games,
    evaluationEvents,
    currentGame,
    firstInningOverridesById = {},
    totalInnings,
    leagueRuleSet,
    teamAge,
    defenseSize,
    positionLock,
    battingSize,
    seed,
    // When true, ignore the cumulative seasonal fairness pressure
    // (priorExtraSits). Useful when constraints have stacked up and the
    // strict fairness solver can't find a valid lineup.
    relaxFairness = false,
    // When true, the lineup is built for a high stakes game:
    //  Seasonal fairness is automatically relaxed
    //  Strong players are pulled toward premium defensive positions
    //   (8U: C/1B/SS, 9U+: P/SS/3B/C/1B)
    //  Weak players are pushed toward the OF
    isBigGame = false,
  } = input;

  if (!Array.isArray(activePlayers) || activePlayers.length < 7) {
    return {
      error: "You need at least 7 active players to generate a lineup.",
    };
  }

  const currentGameId = currentGame?.id ?? null;
  const targetDateStr =
    currentGame?.date || new Date().toISOString().split("T")[0];

  const combinedGrades = getCombinedGrades(evaluationEvents, allPlayers);

  const profiled = activePlayers.map((p) => ({
    ...p,
    profile: buildPlayerProfile(p, combinedGrades[p.id]),
  }));

  // Big Game mode automatically relaxes seasonal fairness too
  const effectiveRelax = relaxFairness || isBigGame;

  const positionHistory = buildPositionHistory(games, currentGameId);
  const firstInningBenchHx = effectiveRelax
    ? new Map()
    : buildFirstInningBenchHistory(games, currentGameId);
  // Cumulative seasonal fairness pressure. When relaxed, we feed the solver
  // an empty history so this game's bench distribution doesn't get skewed by
  // accumulated debt  useful when the strict solver has failed.
  const benchHistory = effectiveRelax
    ? new Map()
    : buildExtraSitHistory(games, currentGameId);

  const battingLineup = generateBattingOrder(profiled, battingSize, {
    leagueRuleSet,
    teamAge,
    seed,
  });

  // generateBattingOrder now sets `battingReason` on each player directly,
  // including role/note appropriate for the chosen strategy (capped vs Tango).
  // We only need to add the recency blend note here, since that depends on
  // info computed in profiles, not in the order builder.
  battingLineup.forEach((player) => {
    if (!player || !player.battingReason) return;
    const eff = getEffectiveStats(player);
    if (eff.__blended && eff.__blendWeights?.current < 0.95) {
      player.battingReason.blendNote = `Stats blended (current ${Math.round(
        eff.__blendWeights.current * 100
      )}% / past ${Math.round(
        (eff.__blendWeights.past1 + eff.__blendWeights.past2) * 100
      )}%)`;
    }
    // Also enrich effective stats from the player's blended profile (the
    // engine's batting math used these blended numbers; the UI should show
    // the same numbers for transparency).
    player.battingReason.effective = {
      ops: +eff.ops || 0,
      avg: +eff.avg || 0,
      obp: +eff.obp || 0,
      ld: +eff.ld || 0,
      hard: +eff.hard || 0,
      qab: +eff.qab || 0,
    };
  });
  const isStarter = new Set();
  if (battingSize === "roster") {
    for (const p of profiled) isStarter.add(p.id);
  } else {
    const N = Math.min(parseInt(battingSize, 10), profiled.length);
    for (let i = 0; i < N; i++) isStarter.add(battingLineup[i].id);
  }

  let latestHead = null;
  for (const e of evaluationEvents) {
    if (e.coachRole !== "Head") continue;
    if (!latestHead || new Date(e.date) > new Date(latestHead.date))
      latestHead = e;
  }
  const headGrades = latestHead?.grades || {};

  const positionsToFill = getPositionsForInning(
    activePlayers.length,
    defenseSize
  );
  const numToBench = Math.max(0, activePlayers.length - positionsToFill.length);
  const leftyPenalty = leftyInfieldPenalty(leagueRuleSet, teamAge);

  const baseSeed = (seed ?? Date.now()) >>> 0;
  const MAX_ATTEMPTS = 200;

  // Try generation with given history maps. Returns { lineup, penalty } or null.
  const runAttempts = (firstInnHx, seasonHx) => {
    let bestLineup = null;
    let bestPenalty = Infinity;
    const failureReasons = []; // accumulate every failure for diagnostic
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const rand = mulberry32(baseSeed + attempt * 2654435761);
      const result = tryBuildLineup({
        profiled,
        positionsToFill,
        numToBench,
        totalInnings,
        isStarter,
        firstInningOverridesById,
        positionHistory,
        firstInningBenchHx: firstInnHx,
        benchHistory: seasonHx,
        headGrades,
        defenseSize,
        positionLock,
        leagueRuleSet,
        teamAge,
        targetDateStr,
        leftyPenalty,
        isBigGame,
        rand,
      });
      if (!result.ok) {
        if (result.failure) failureReasons.push(result.failure);
        continue;
      }
      const { lineup, penalty } = result;
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestLineup = lineup;
        if (penalty === 0) break;
      }
    }
    if (bestLineup) return { lineup: bestLineup, penalty: bestPenalty };
    // No lineup found  pick the most common failure reason for diagnostic
    return { failures: failureReasons };
  };

  // First pass: try with the user's chosen fairness settings
  let attempt = runAttempts(firstInningBenchHx, benchHistory);
  if (attempt.lineup) {
    // success
  }

  // Second pass: if the user wanted fairness ON but the engine couldn't satisfy
  // all the constraints, internally fall back to relaxed fairness rather than
  // failing. The kid imbalance can be made up over future games  this game
  // just needs a working lineup. We surface this as a soft note in the result.
  let fairnessRelaxed = false;
  if (!attempt.lineup && !effectiveRelax) {
    fairnessRelaxed = true;
    attempt = runAttempts(new Map(), new Map());
  }

  if (!attempt.lineup) {
    // Build a specific, actionable error from the captured failures.
    // Pick the most common failure type  that's likely the real blocker.
    const failures = attempt.failures || [];
    const counts = new Map();
    for (const f of failures) {
      const key = JSON.stringify({
        type: f.type,
        position: f.position,
        inning: f.inning,
        playerName: f.playerName,
      });
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let topKey = null;
    let topCount = 0;
    for (const [k, c] of counts) {
      if (c > topCount) {
        topCount = c;
        topKey = k;
      }
    }
    let errorMsg = "Couldn't build a lineup.";
    if (topKey) {
      const top = JSON.parse(topKey);
      if (top.type === "no-candidate-for-position") {
        // Find which kids COULD play this position but were unavailable
        const candidates = activePlayers.filter(
          (p) => !p.restrictions?.includes(top.position)
        );
        const restrictedCount = activePlayers.length - candidates.length;
        errorMsg = `No eligible player for ${top.position} in inning ${top.inning}.`;
        if (restrictedCount > 0) {
          errorMsg += ` ${restrictedCount} present player${
            restrictedCount === 1 ? " is" : "s are"
          } restricted from ${top.position}.`;
        }
        errorMsg +=
          " Check player restrictions or first inning setup for this position.";
      } else if (top.type === "first-inning-override-benched") {
        errorMsg = `${top.playerName} is set to play ${top.position} in inning 1 but the bench schedule has them benched. Adjust first inning setup.`;
      } else if (top.type === "bench-schedule-impossible") {
        errorMsg =
          "Bench schedule couldn't satisfy attendance + catcher continuity rules. Check who's marked present.";
      } else if (top.type === "bench-schedule-mismatch") {
        errorMsg = `Bench math doesn't add up in inning ${top.inning}. This usually means too many position locks or first inning overrides.`;
      }
    }
    return { error: errorMsg };
  }
  return {
    lineup: attempt.lineup,
    battingLineup,
    fairnessRelaxed,
  };
}

// ---------- Single attempt builder ----------

/* ----------------------------------------------------------------------------
   precomputeBenchSchedule
   Decides EXACTLY which innings each player sits, before position assignment.
   This produces math optimal bench distribution (everyone sits floor(S/N)
   or ceil(S/N) innings) regardless of roster size.

   Inputs:
     profiled               array of profiled players (already filtered to attendees)
     totalInnings           game length (typically 6)
     numToBench             bench slots per inning (= profiled.length minus defenseSize)
     priorExtraSits         Map<playerId, { extraSits: number }>
     firstInningBenchHx     Map<playerId, number>
     topHalfIds             Set<playerId> (top half by defensive score)
     catcherInningPairs     Array<[inn, inn]> for 10 fielder C continuity, OR
                               null for 9 fielder (no continuity)
     rand                   seeded random function for tiebreakers
     firstInningBenchOverride  Set<playerId> who MUST be benched in inning 0
     firstInningOverridesById  Map of positions locked in inning 0 so we don't bench them

   Returns: { schedule: Map<playerId, Set<inning>>, catcherByPair: Map<pairIdx, playerId> }
   On infeasibility: returns null (caller restarts attempt).
---------------------------------------------------------------------------- */
function precomputeBenchSchedule(opts) {
  const {
    profiled,
    totalInnings,
    numToBench,
    priorExtraSits,
    firstInningBenchHx,
    topHalfIds,
    catcherInningPairs,
    rand,
    forcedBenchInning0,
    firstInningOverridesById,
  } = opts;

  const N = profiled.length;
  const totalBenchSlots = numToBench * totalInnings;
  if (numToBench === 0) {
    // No benching to do
    const empty = new Map();
    for (const p of profiled) empty.set(p.id, new Set());
    return { schedule: empty, catcherByPair: new Map() };
  }

  const firstInningMustPlay = new Set();
  const firstInningLockedPos = new Map();
  if (firstInningOverridesById) {
    for (const pos of Object.keys(firstInningOverridesById)) {
      const pid = firstInningOverridesById[pos];
      firstInningMustPlay.add(pid);
      firstInningLockedPos.set(pid, pos);
    }
  }

  // ============================================================
  // Step 1: decide each kid's target sit count.
  //
  // Old approach: every kid gets at least minSits, with extraSittersNeeded
  // kids getting +1 to absorb the remainder.
  //
  // New approach: distribute the total bench slots based on season cumulative
  // playing time disparity. Kids who have been OVER PLAYED (low priorRatio,
  // high defInn vs team avg) absorb MORE than their share. Kids who have
  // been UNDER PLAYED (high priorRatio) absorb LESS  possibly zero  letting
  // them catch up.
  //
  // Constraints:
  //   Total target sits across all kids = totalBenchSlots (math invariant)
  //   No kid sits more than (minSits + 2)  the user's "max 2 extras" rule
  //   When the schedule is empty (no past games), defaults to even split
  // ============================================================
  const minSits = Math.floor(totalBenchSlots / N);
  const maxSits = minSits + 2; // Cap: never more than 2 above minimum

  // Compute each kid's actual vs expected defensive innings across past games.
  // expectedDef is computed per game from games actually attended, so a kid
  // who missed games is NOT shown as under played for those absences.
  // Delta > 0: played more than fair (over played)  take more sits this game
  // Delta < 0: played less than fair (under played)  take fewer sits, even 0
  const playerDeltas = [...profiled].map((p) => {
    const hist = priorExtraSits.get(p.id);
    const benchInn = hist?.benchInn || 0;
    const defInn = hist?.defInn || 0;
    const expectedDef = hist?.expectedDef || 0;
    return {
      p,
      defInn,
      benchInn,
      expectedDef,
      delta: defInn - expectedDef, // positive = over played
      defScore: p.profile.defensiveScore,
      rand: rand(),
    };
  });

  // Sort: most over played first. Ties broken by defensive score (worse
  // defenders sit first, all else equal) and random.
  playerDeltas.sort((a, b) => {
    if (a.delta !== b.delta) return b.delta - a.delta;
    if (a.defScore !== b.defScore) return a.defScore - b.defScore;
    return a.rand - b.rand;
  });

  // Distribute bench slots.
  // Algorithm:
  //   Start with everyone at minSits.
  //   The "extras" needed = totalBenchSlots minus N * minSits.
  //     With evenly divisible math, extras=0 (everyone exactly minSits).
  //     Otherwise some kids get +1.
  //   When season disparity exists, transfer sits from under played kids
  //     (drop their target below minSits, possibly to 0) to over played kids
  //     (raise theirs above, up to maxSits).
  //   Net total stays at totalBenchSlots.
  const targetSits = new Map();
  for (const x of playerDeltas) targetSits.set(x.p.id, minSits);

  const extraSittersNeeded = totalBenchSlots - N * minSits;
  // First: assign the remainder (+1) to over played kids
  for (let i = 0; i < extraSittersNeeded; i++) {
    targetSits.set(
      playerDeltas[i].p.id,
      targetSits.get(playerDeltas[i].p.id) + 1
    );
  }

  // Now apply seasonal disparity transfer  "rob from over played, give to
  // under played." For each big positive delta (kid played extra), they take
  // an extra sit. For each big negative delta (kid played short), they give
  // up a sit. We pair these one for one to keep the total invariant.
  //
  // A "big" disparity here means at least 1 inning vs team avg. We transfer
  // up to one full sit per pair, capped by maxSits per kid and floor of 0.
  // Apply seasonal disparity transfer  "rob from over played, give to
  // under played." Skip entirely if there's no meaningful disparity (first
  // game of season, or everyone already balanced).
  const hasDisparity = playerDeltas.some((x) => Math.abs(x.delta) >= 1);
  if (hasDisparity) {
    // Identify donors (over played, can take more sits) and recipients
    // (under played, can give up sits).
    const donors = playerDeltas.filter((x) => x.delta >= 1).slice(); // most over played first
    const recipients = playerDeltas
      .filter((x) => x.delta <= -1)
      .slice()
      .sort((a, b) => a.delta - b.delta); // most under played first

    // Pair them: recipient with biggest negative delta gives up a sit;
    // donor with biggest positive delta takes it. Only transfer what helps
    // narrow the disparity AND respects the maxSits/minimum 0 caps.
    let dIdx = 0,
      rIdx = 0;
    while (dIdx < donors.length && rIdx < recipients.length) {
      const donor = donors[dIdx];
      const recipient = recipients[rIdx];
      const donorTarget = targetSits.get(donor.p.id);
      const recipientTarget = targetSits.get(recipient.p.id);
      // Find the minimum target across all kids  we cap at min + 2 so the
      // gap between most sit and least sit kid is never more than 2.
      let minActual = Infinity;
      for (const t of targetSits.values()) {
        if (t < minActual) minActual = t;
      }
      const dynamicMax = Math.max(maxSits, minActual + 2);
      if (donorTarget >= dynamicMax) {
        dIdx++;
        continue;
      }
      // Recipient at 0 already? Can't go below.
      if (recipientTarget <= 0) {
        rIdx++;
        continue;
      }
      // Don't transfer if it would create a gap of more than 2 between
      // the new max (donor + 1) and the new min (recipient minus 1, or any
      // existing kid at the bottom).
      const donorAfter = donorTarget + 1;
      const recipientAfter = recipientTarget - 1;
      // Find the smallest target across all kids EXCEPT the recipient
      // (they're moving). Actual minimum after transfer = min(otherMins, recipientAfter).
      let otherMin = Infinity;
      for (const [pid, t] of targetSits) {
        if (pid === recipient.p.id) continue;
        if (t < otherMin) otherMin = t;
      }
      const newMin = Math.min(otherMin, recipientAfter);
      if (donorAfter - newMin > 2) {
        dIdx++;
        continue;
      }
      // Transfer
      targetSits.set(donor.p.id, donorAfter);
      targetSits.set(recipient.p.id, recipientAfter);
      donor.delta -= 1;
      recipient.delta += 1;
      if (dIdx + 1 < donors.length && donor.delta < donors[dIdx + 1].delta)
        dIdx++;
      if (
        rIdx + 1 < recipients.length &&
        recipient.delta > recipients[rIdx + 1].delta
      )
        rIdx++;
    }
  }

  // Sanity: total targets should equal totalBenchSlots
  // (transfers preserve the total, but verify in case of bugs)
  let sumTargets = 0;
  for (const t of targetSits.values()) sumTargets += t;
  if (sumTargets !== totalBenchSlots) {
    // Fallback: reset to baseline (minSits with extras to over played first)
    targetSits.clear();
    for (const x of playerDeltas) targetSits.set(x.p.id, minSits);
    for (let i = 0; i < extraSittersNeeded; i++) {
      targetSits.set(
        playerDeltas[i].p.id,
        targetSits.get(playerDeltas[i].p.id) + 1
      );
    }
  }

  // Build sortedForExtra in the legacy shape (downstream catcher logic uses it)
  const sortedForExtra = playerDeltas.map((x) => ({
    p: x.p,
    prior: priorExtraSits.get(x.p.id)?.extraSits || 0,
    defScore: x.defScore,
    rand: x.rand,
  }));

  // ============================================================
  // Step 2: pre pick catchers (10 fielder C continuity).
  // Each catcher pair of (inn, inn+1) needs a single kid who can play
  // both. They cannot be on bench in those innings. We pick catcher
  // kids whose target sit count is LOW (so we use up the must play kids
  // first as catchers).
  // ============================================================
  const catcherByPair = new Map();
  const offFieldByInning = new Array(totalInnings)
    .fill(null)
    .map(() => new Set());

  if (catcherInningPairs && catcherInningPairs.length > 0) {
    // Eligible catchers: not C restricted, AND have enough remaining play
    // budget to cover both innings of a catcher pair.
    const allEligibleC = sortedForExtra
      .filter(({ p }) => !p.restrictions?.includes("C"))
      .filter(({ p }) => (targetSits.get(p.id) || 0) <= totalInnings - 2)
      .sort((a, b) => {
        // Tier 1 wins over tier 2: kids whose primary position is catcher
        // are picked first.
        const aPrimary = a.p.primaryPosition === "C" ? 0 : 1;
        const bPrimary = b.p.primaryPosition === "C" ? 0 : 1;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;

        // Prefer kids with LOW target sit (they need to play more)
        const ta = targetSits.get(a.p.id);
        const tb = targetSits.get(b.p.id);
        if (ta !== tb) return ta - tb;

        // Then prefer higher catcher skill if available (defensive score)
        if (a.defScore !== b.defScore) return b.defScore - a.defScore;
        return a.rand - b.rand;
      });

    const usedCatchers = new Set();
    for (let i = 0; i < catcherInningPairs.length; i++) {
      const [a, b] = catcherInningPairs[i];
      const involvesInning0 = a === 0 || b === 0;

      const isAvailableForPair = (p) => {
        if (involvesInning0) {
          const lockedPos = firstInningLockedPos.get(p.id);
          // If you forced them to play a specific spot that IS NOT catcher in the 1st inning,
          // they cannot be the catcher for the (0, 1) pair!
          if (lockedPos && lockedPos !== "C") return false;
        }
        return true;
      };

      // 1. Unused Primary Catcher
      let candidate = allEligibleC.find(
        ({ p }) =>
          p.primaryPosition === "C" &&
          !usedCatchers.has(p.id) &&
          isAvailableForPair(p)
      );

      // 2. Unused Secondary Catcher (can catch, but different primary)
      if (!candidate) {
        candidate = allEligibleC.find(
          ({ p }) =>
            p.primaryPosition !== "C" &&
            !usedCatchers.has(p.id) &&
            isAvailableForPair(p)
        );
      }

      // 3. Reuse a Primary Catcher (if we ran out of unique catchers)
      if (!candidate) {
        candidate = allEligibleC.find(
          ({ p }) => p.primaryPosition === "C" && isAvailableForPair(p)
        );
      }

      // 4. Reuse whatever eligible catcher we have
      if (!candidate) {
        candidate = allEligibleC.find(({ p }) => isAvailableForPair(p));
      }

      if (!candidate) {
        return null; // Infeasible: no kids can play catcher
      }

      catcherByPair.set(i, candidate.p.id);
      usedCatchers.add(candidate.p.id);
      // Mark this kid as off the bench list for both innings
      offFieldByInning[a].add(candidate.p.id);
      offFieldByInning[b].add(candidate.p.id);
    }
  }

  // ============================================================
  // Step 3: distribute each kid's bench innings across the game.
  // We use a greedy round robin: at each inning, pick from kids with
  // (a) remaining bench debt, (b) eligible for this inning.
  // Tiebreaker: prefer kids with higher remaining debt; then top half
  // pairing (avoid two top half on bench together); then random.
  // ============================================================
  const remaining = new Map();
  for (const [pid, target] of targetSits) remaining.set(pid, target);

  const schedule = new Map();
  for (const p of profiled) schedule.set(p.id, new Set());

  // forcedBenchInning0: kids who must sit in inning 0 (e.g., because
  // they're not in firstInningOverridesById and can't fit otherwise).
  // We honor this by pre assigning them.
  if (forcedBenchInning0) {
    for (const pid of forcedBenchInning0) {
      if (offFieldByInning[0].has(pid)) {
        return null; // can't both catch and sit
      }
      schedule.get(pid).add(0);
      remaining.set(pid, Math.max(0, (remaining.get(pid) || 0) - 1));
    }
  }

  for (let inn = 0; inn < totalInnings; inn++) {
    const slotsThisInning = numToBench;
    const alreadyBenched = new Set();
    for (const pid of schedule.keys()) {
      if (schedule.get(pid).has(inn)) alreadyBenched.add(pid);
    }
    const remainingSlots = slotsThisInning - alreadyBenched.size;
    if (remainingSlots <= 0) continue;

    // Build eligible list for this inning:
    //  has remaining debt
    //  not already benched this inning
    //  not catching this inning
    //  did NOT sit the previous inning (no back to back benches)
    const eligible = [];
    for (const p of profiled) {
      if (alreadyBenched.has(p.id)) continue;
      if (offFieldByInning[inn].has(p.id)) continue;
      // 1st Inning Override safety: Do not bench a kid if the user explicitly forced them into a position in Inning 0
      if (inn === 0 && firstInningMustPlay.has(p.id)) continue;
      // Hard rule: no kid sits two innings in a row.
      if (inn > 0 && schedule.get(p.id).has(inn - 1)) continue;

      const debt = remaining.get(p.id) || 0;
      if (debt <= 0) continue;
      const hist = priorExtraSits.get(p.id);
      const totalPrior = (hist?.benchInn || 0) + (hist?.defInn || 0);
      // Season ratio: lower means under sat across the season.
      // No history  0.5 (neutral).
      const priorRatio = totalPrior > 0 ? hist.benchInn / totalPrior : 0.5;
      eligible.push({
        p,
        debt,
        priorRatio,
        // Raw defensive innings played this season  used as a finer grained
        // tiebreaker. Higher defInn = played more = should sit earlier.
        defInn: hist?.defInn || 0,
        priorExtra: priorExtraSits.get(p.id)?.extraSits || 0,
        firstHx: firstInningBenchHx.get(p.id) || 0,
        defScore: p.profile.defensiveScore,
        rand: rand(),
      });
    }

    if (eligible.length < remainingSlots) {
      // Not enough kids with remaining debt to fill this inning's bench.
      // This happens when offFieldByInning constraints over block.
      // Allow kids who have target=minSits AND have already used their
      // minSits to take an extra "overflow" sit by raising their target.
      // (Rare edge case.)
      const overflow = profiled.filter(
        (p) =>
          !alreadyBenched.has(p.id) &&
          !offFieldByInning[inn].has(p.id) &&
          !(inn === 0 && firstInningMustPlay.has(p.id)) &&
          // No back to back: skip kids who sat the previous inning
          !(inn > 0 && schedule.get(p.id).has(inn - 1)) &&
          (remaining.get(p.id) || 0) === 0
      );
      for (const p of overflow) {
        if (eligible.length >= remainingSlots) break;
        const hist = priorExtraSits.get(p.id);
        const totalPrior = (hist?.benchInn || 0) + (hist?.defInn || 0);
        const priorRatio = totalPrior > 0 ? hist.benchInn / totalPrior : 0.5;
        eligible.push({
          p,
          debt: 1,
          priorRatio,
          defInn: hist?.defInn || 0,
          priorExtra: (priorExtraSits.get(p.id)?.extraSits || 0) + 100, // discourage
          firstHx: firstInningBenchHx.get(p.id) || 0,
          defScore: p.profile.defensiveScore,
          rand: rand(),
        });
        remaining.set(p.id, 1); // they now have 1 to use
      }
      if (eligible.length < remainingSlots) {
        return null; // infeasible
      }
    }

    // Sort eligible:
    //   1. Higher debt first (kids who must sit somewhere this game)
    //   2. Lower season bench ratio (over played kids sit FIRST, naturally
    //     pushing under played kids to the late innings  which may not even
    //     happen due to mercy rules / time limits, helping them catch up)
    //   3. HIGHER defInn first (more raw defensive innings played  sit first.
    //     This is a finer grained tiebreaker for kids with similar ratios.)
    //   4. Lower priorExtra (haven't been the "extra sitter" historically)
    //   5. Inning 0 only: lower firstInningBenchHx (haven't started on bench)
    //   6. Lower defensive score (better defenders stay on field when fair)
    //   7. Random tiebreaker
    eligible.sort((a, b) => {
      if (a.debt !== b.debt) return b.debt - a.debt;
      // Use raw priorRatio (not rounded) so subtle differences differentiate
      // kids who'd otherwise tie. Lower ratio = more played = sit earlier.
      if (a.priorRatio !== b.priorRatio) return a.priorRatio - b.priorRatio;
      // Higher defInn = more played = bench earlier
      if (a.defInn !== b.defInn) return b.defInn - a.defInn;
      if (a.priorExtra !== b.priorExtra) return a.priorExtra - b.priorExtra;
      if (inn === 0 && a.firstHx !== b.firstHx) return a.firstHx - b.firstHx;
      if (a.defScore !== b.defScore) return a.defScore - b.defScore;
      return a.rand - b.rand;
    });

    // Pick with top half pairing constraint:
    // Prefer not to put 2 top half defenders on the bench in one inning,
    // BUT don't override seasonal fairness  if the next eligible kid by
    // fairness is top half but they'd be the 2nd top half on bench, only
    // skip them in favor of a kid with similar fairness ranking. If the
    // alternative would be a notably under played kid (much higher
    // priorRatio), respect fairness instead.
    let benchedThisInning = 0;
    let topHalfCount = 0;
    for (const id of alreadyBenched) if (topHalfIds.has(id)) topHalfCount++;

    // First pass: respect top half cap of 1 per inning, BUT only skip a
    // top half kid if the next kid in line has similar (within 0.05)
    // priorRatio. Otherwise the fairness gap is more important.
    for (let i = 0; i < eligible.length; i++) {
      const e = eligible[i];
      if (benchedThisInning >= remainingSlots) break;
      if (topHalfIds.has(e.p.id) && topHalfCount >= 1) {
        // Only skip if the next un benched kid in line is within fairness
        // tolerance (so we're not punishing an under played kid)
        let nextKidRatio = null;
        for (let j = i + 1; j < eligible.length; j++) {
          if (schedule.get(eligible[j].p.id).has(inn)) continue;
          nextKidRatio = eligible[j].priorRatio;
          break;
        }
        if (nextKidRatio !== null && nextKidRatio - e.priorRatio <= 0.05) {
          continue; // safe to skip  alternative is similarly fair
        }
        // Otherwise: take the top half kid even though we'd prefer not to,
        // because the alternative is notably more under played.
      }
      schedule.get(e.p.id).add(inn);
      remaining.set(e.p.id, (remaining.get(e.p.id) || 0) - 1);
      if (topHalfIds.has(e.p.id)) topHalfCount++;
      benchedThisInning++;
    }
    // Second pass: relax pairing constraint if we couldn't fill
    if (benchedThisInning < remainingSlots) {
      for (const e of eligible) {
        if (benchedThisInning >= remainingSlots) break;
        if (schedule.get(e.p.id).has(inn)) continue;
        schedule.get(e.p.id).add(inn);
        remaining.set(e.p.id, (remaining.get(e.p.id) || 0) - 1);
        benchedThisInning++;
      }
    }
    if (benchedThisInning < remainingSlots) return null;
  }

  // Sanity check: every inning must have exactly numToBench benched
  for (let inn = 0; inn < totalInnings; inn++) {
    let count = 0;
    for (const pid of schedule.keys()) {
      if (schedule.get(pid).has(inn)) count++;
    }
    if (count !== numToBench) return null;
  }

  return { schedule, catcherByPair };
}

function tryBuildLineup(ctx) {
  const {
    profiled,
    positionsToFill,
    numToBench,
    totalInnings,
    isStarter,
    firstInningOverridesById,
    positionHistory,
    firstInningBenchHx,
    benchHistory,
    headGrades,
    defenseSize,
    positionLock,
    leagueRuleSet,
    teamAge,
    targetDateStr,
    leftyPenalty,
    isBigGame,
    rand,
  } = ctx;

  // Hoist age derived constants used by pickBestForPosition out of the
  // per call hot path (they don't change inning to inning).
  // 8U and below = no real pitcher (machine pitch), catcher matters less
  // since there are no strikes/passed balls  spine is 1B/SS/3B.
  // 9U+ = pitcher matters a lot, so spine is P/SS/3B/C/1B.
  const teamAgeNum = (() => {
    if (!teamAge) return 99;
    const m = String(teamAge).match(/(\d+)/g);
    if (!m) return 99;
    return parseInt(m[m.length - 1], 10);
  })();
  const PREMIUM_POSITIONS =
    teamAgeNum <= 8
      ? new Set(["1B", "SS", "3B"])
      : new Set(["P", "SS", "3B", "C", "1B"]);

  const state = new Map();
  for (const p of profiled) {
    state.set(p.id, { bench: 0, positions: Object.create(null), history: [] });
  }

  // Compute top half defender set (used by the schedule's pairing rule)
  const sortedByDefense = [...profiled].sort(
    (a, b) => b.profile.defensiveScore - a.profile.defensiveScore
  );
  const topHalfCount = Math.ceil(profiled.length / 2);
  const topHalfIds = new Set(
    sortedByDefense.slice(0, topHalfCount).map((p) => p.id)
  );

  // For 10 fielder mode we use catcher continuity: catcher in inning K and K+1
  // is the same kid. For 9 fielder mode there's no such constraint.
  // Pairs are (0,1), (2,3), (4,5) for a 6 inning game.
  let catcherInningPairs = null;
  if (defenseSize === "10" && profiled.length >= 10) {
    catcherInningPairs = [];
    for (let i = 0; i < totalInnings - 1; i += 2) {
      catcherInningPairs.push([i, i + 1]);
    }
    // Odd inning game: last inning is solo, catcher just for it
    if (totalInnings % 2 === 1) {
      catcherInningPairs.push([totalInnings - 1, totalInnings - 1]);
    }
  }

  // Non starters (when batting fewer than roster) must start on the bench.
  const forcedBenchInning0 = new Set();
  if (isStarter.size > 0 && isStarter.size < profiled.length) {
    for (const p of profiled) {
      if (!isStarter.has(p.id)) forcedBenchInning0.add(p.id);
    }
  }

  // Pre compute bench schedule (math optimal distribution)
  const sched = precomputeBenchSchedule({
    profiled,
    totalInnings,
    numToBench,
    priorExtraSits: benchHistory,
    firstInningBenchHx,
    topHalfIds,
    catcherInningPairs,
    rand,
    forcedBenchInning0,
    firstInningOverridesById, // Safe-guards our overrides so we don't bench them
  });
  if (!sched)
    return { ok: false, failure: { type: "bench-schedule-impossible" } };
  const { schedule: benchSchedule, catcherByPair } = sched;

  const lineup = [];

  for (let inn = 0; inn < totalInnings; inn++) {
    const isLockInning =
      (positionLock === "2" && inn % 2 !== 0) ||
      (positionLock === "3" && inn % 3 !== 0) ||
      (positionLock === "full" && inn > 0);

    const inningSlots = {};
    const benchedSet = new Set();

    // Bench assignment: read directly from the precomputed schedule.
    for (const p of profiled) {
      if (benchSchedule.get(p.id).has(inn)) {
        benchedSet.add(p.id);
      }
    }

    if (benchedSet.size !== numToBench)
      return {
        ok: false,
        failure: {
          type: "bench-schedule-mismatch",
          inning: inn + 1,
          expected: numToBench,
          actual: benchedSet.size,
        },
      };

    if (inn === 0) {
      for (const pos in firstInningOverridesById) {
        const pid = firstInningOverridesById[pos];
        const player = profiled.find((p) => p.id === pid);
        if (!player || !positionsToFill.includes(pos)) continue;
        if (benchedSet.has(pid))
          return {
            ok: false,
            failure: {
              type: "first-inning-override-benched",
              playerName: player.name,
              position: pos,
            },
          };
        if (player.restrictions?.includes(pos)) continue;
        inningSlots[pos] = player;
      }
    }

    const used = new Set(Object.values(inningSlots).map((p) => p.id));
    const remainingPositions = positionsToFill.filter(
      (pos) => !inningSlots[pos]
    );

    // 10 fielder mode: catcher is fixed by the precomputed schedule
    // (one catcher per (inn, inn+1) pair, then the next, etc.).
    if (defenseSize === "10" && !inningSlots["C"]) {
      // Which pair are we in? Pairs are (0,1), (2,3), (4,5), ...
      const pairIdx = Math.floor(inn / 2);
      const catcherId = catcherByPair.get(pairIdx);
      if (catcherId) {
        const catcher = profiled.find((p) => p.id === catcherId);
        if (
          catcher &&
          !benchedSet.has(catcherId) &&
          !used.has(catcherId) &&
          !catcher.restrictions?.includes("C")
        ) {
          inningSlots["C"] = catcher;
          used.add(catcherId);
          const idx = remainingPositions.indexOf("C");
          if (idx !== -1) remainingPositions.splice(idx, 1);
        }
      }
    }

    // PRIMARY POSITION PRE PIN: kids you marked with a primaryPosition get
    // their slot before any other assignment runs. Without this, the random
    // position shuffle could fill RF first and pick a strong 3B primary kid
    // for RF before 3B is ever scored  the minus 10000 nudge inside
    // pickBestForPosition only fires when THAT exact position is being
    // scored, so processing order matters.
    //
    // Big Game: pre pin every inning (matches the "primary kid plays
    // primary all game" behavior in pickBestForPosition). MUST run before
    // lock inning carry over so a kid bumped off their primary last inning
    // gets it back, instead of being locked into the wrong spot.
    // Fair mode: pre pin only inning 0 (matches the existing minus 100 vs minus 2
    // nudge  primary kid starts at primary but rotates after); for inn>0
    // in Fair mode this block is a no op and lock inning runs alone.
    //
    // Sort by defensive score so when two kids share a primaryPosition,
    // the better defender wins it; the runner up is unconstrained.
    if (isBigGame || inn === 0) {
      const sortedByDef = [...profiled].sort(
        (a, b) => b.profile.defensiveScore - a.profile.defensiveScore
      );
      for (const p of sortedByDef) {
        const pos = p.primaryPosition;
        if (!pos) continue;
        if (!remainingPositions.includes(pos)) continue;
        if (benchedSet.has(p.id)) continue;
        if (used.has(p.id)) continue;
        if (p.restrictions?.includes(pos)) continue;
        // Mirror pickBestForPosition's per position eligibility checks so we
        // don't pre pin into an illegal slot.
        const st = state.get(p.id);
        if (pos === "C") {
          const cCap = defenseSize === "10" ? 2 : 3;
          if ((st.positions["C"] || 0) >= cCap) continue;
        }
        if (pos === "P" && defenseSize === "9") {
          if (
            leagueRuleSet === "NKB" &&
            !checkPitchEligibility(p, targetDateStr, teamAge)
          )
            continue;
          const pCount = st.positions["P"] || 0;
          const playedHereLast = inn > 0 && st.history[inn - 1] === pos;
          if (inn > 0 && pCount > 0 && !playedHereLast) continue;
        }
        inningSlots[pos] = p;
        used.add(p.id);
        const idx = remainingPositions.indexOf(pos);
        if (idx !== -1) remainingPositions.splice(idx, 1);
      }
    }

    // LOCK INNING: a player who held a position last inning and is still on
    // the field should keep that position. Fills any slot the primary
    // pre pin pass above didn't claim  pre pin wins ties so a
    // primary position kid bumped off their primary last inning gets it
    // back here, even in lock inning + Big Game mode.
    if (isLockInning && inn > 0) {
      const prevInning = lineup[inn - 1];
      // Collect (pos, player) pairs from last inning where the player is still
      // available and the position still needs filling.
      for (const pos of [...remainingPositions]) {
        const prevPlayer = prevInning?.[pos];
        if (!prevPlayer) continue;
        if (benchedSet.has(prevPlayer.id)) continue; // they're sitting now
        if (used.has(prevPlayer.id)) continue; // already placed
        if (prevPlayer.restrictions?.includes(pos)) continue;
        // Pitcher carry over rule for 9 fielder games is handled in pickBest;
        // for lock innings we trust the prior assignment.
        inningSlots[pos] = prevPlayer;
        used.add(prevPlayer.id);
        const idx = remainingPositions.indexOf(pos);
        if (idx !== -1) remainingPositions.splice(idx, 1);
      }
    }

    // Instead of pure random shuffle, fill the hardest positions first.
    // A position is "hard" if very few unassigned, unbenched kids are eligible to play it.
    const posScarcity = remainingPositions.map((pos) => {
      let count = 0;
      for (const p of profiled) {
        if (used.has(p.id) || benchedSet.has(p.id)) continue;
        if (p.restrictions?.includes(pos)) continue;

        const st = state.get(p.id);
        if (pos === "P" && defenseSize === "9") {
          if (
            leagueRuleSet === "NKB" &&
            !checkPitchEligibility(p, targetDateStr, teamAge)
          )
            continue;
          const pCount = st.positions["P"] || 0;
          const playedHereLast = inn > 0 && st.history[inn - 1] === pos;
          if (inn > 0 && pCount > 0 && !playedHereLast) continue;
        }
        if (pos === "C") {
          const cCap = defenseSize === "10" ? 2 : 3;
          if ((st.positions["C"] || 0) >= cCap) continue;
        }
        count++;
      }
      return { pos, count, r: rand() };
    });

    // Sort by fewest eligible candidates first. Tie-breaker is random.
    posScarcity.sort((a, b) => {
      if (a.count !== b.count) return a.count - b.count;
      return a.r - b.r;
    });

    remainingPositions.length = 0;
    for (const item of posScarcity) {
      remainingPositions.push(item.pos);
    }

    for (const pos of remainingPositions) {
      const candidate = pickBestForPosition({
        pos,
        inn,
        profiled,
        used,
        benchedSet,
        state,
        positionHistory,
        headGrades,
        defenseSize,
        positionLock,
        leagueRuleSet,
        teamAge,
        targetDateStr,
        leftyPenalty,
        isLockInning,
        isBigGame,
        rand,
        premiumPositions: PREMIUM_POSITIONS,
      });
      if (!candidate) {
        return {
          ok: false,
          failure: {
            type: "no-candidate-for-position",
            position: pos,
            inning: inn + 1,
          },
        };
      }
      inningSlots[pos] = candidate;
      used.add(candidate.id);
    }

    const benchList = [];
    for (const p of profiled) {
      if (benchedSet.has(p.id)) {
        const st = state.get(p.id);
        st.bench++;
        st.history.push("BENCH");
        benchList.push(p);
      }
    }
    for (const pos of positionsToFill) {
      const player = inningSlots[pos];
      if (!player)
        return {
          ok: false,
          failure: {
            type: "no-candidate-for-position",
            position: pos,
            inning: inn + 1,
          },
        };
      const st = state.get(player.id);
      st.positions[pos] = (st.positions[pos] || 0) + 1;
      st.history.push(pos);
    }

    inningSlots["BENCH"] = benchList;
    lineup.push(inningSlots);
  }

  // ---------- Penalty ----------
  let penalty = 0;
  let maxBench = 0;
  let minBench = Infinity;

  // Math floor for this game: with N players and S total bench slots, the
  // minimum number of times any player must sit is floor(S / N).
  const totalBenchSlots = numToBench * totalInnings;
  const minBenchPerPlayer =
    profiled.length > 0 ? Math.floor(totalBenchSlots / profiled.length) : 0;
  const everyoneShouldSit = minBenchPerPlayer >= 1;
  const exactDivision =
    profiled.length > 0 && totalBenchSlots % profiled.length === 0;

  // Per player extra sit penalty: if a player ends this game with more
  // "extra sits" total across the season than others, that's unfair.
  // We compute each player's projected season extra sits if THIS lineup
  // gets played, then penalize the spread.
  const projectedExtraSits = [];
  for (const p of profiled) {
    const st = state.get(p.id);
    const priorExtra = benchHistory.get(p.id)?.extraSits || 0;
    const thisExtra = Math.max(0, st.bench - minBenchPerPlayer);
    projectedExtraSits.push(priorExtra + thisExtra);
  }
  const minExtra = Math.min(...projectedExtraSits);
  const maxExtra = Math.max(...projectedExtraSits);
  const extraSitSpread = maxExtra - minExtra;

  for (const p of profiled) {
    const st = state.get(p.id);
    const b = st.bench;
    if (b > maxBench) maxBench = b;
    if (b < minBench) minBench = b;
    if (!isStarter.has(p.id) && b === totalInnings) penalty += 5000;

    // Hard fairness floor: if everyone should sit at least once, any player
    // who didn't is heavily penalized. This dominates other concerns.
    if (everyoneShouldSit && b === 0) penalty += 10000;

    // Diversity penalty: over concentration at single non C/non P position
    for (const pos in st.positions) {
      if (pos === "C" || pos === "P") continue;
      const count = st.positions[pos];
      if (count >= 3) penalty += (count - 2) * 50;
    }
  }

  // This game spread penalty. The bench count spread (max minus min) should be
  // either 0 (exact division) or 1 (non exact). Anything bigger means some
  // kid sat 2+ more than another in the same game  the unfairness pattern
  // we're trying to prevent.
  const idealSpread = exactDivision ? 0 : 1;
  const actualSpread = maxBench - minBench;
  const excessSpread = Math.max(0, actualSpread - idealSpread);
  // 5000 per excess unit of spread. This dominates other concerns when the
  // engine has been allowing wider distributions than necessary.
  penalty += excessSpread * 5000;

  // Cumulative extra sit spread penalty: when some players have taken the
  // "extra sitter" role more than others across the season, that's unfair.
  // 1500 per unit of spread is meaningful but doesn't override hard constraints.
  penalty += extraSitSpread * 1500;

  return { ok: true, lineup, penalty };
}

// ---------- Position scoring ----------

function pickBestForPosition(opts) {
  const {
    pos,
    inn,
    profiled,
    used,
    benchedSet,
    state,
    positionHistory,
    headGrades,
    defenseSize,
    positionLock,
    leagueRuleSet,
    teamAge,
    targetDateStr,
    leftyPenalty,
    isLockInning,
    isBigGame,
    rand,
    premiumPositions,
  } = opts;

  // Premium positions are computed once in tryBuildLineup and passed in.
  // For Big Games, strong players are pulled toward these spots and weak
  // players are pushed to the OF.
  const isPremium = premiumPositions.has(pos);

  let bestPlayer = null;
  let bestScore = Infinity;

  for (const p of profiled) {
    if (used.has(p.id) || benchedSet.has(p.id)) continue;
    if (p.restrictions?.includes(pos)) continue;

    const st = state.get(p.id);
    const playedHereLast = inn > 0 && st.history[inn - 1] === pos;

    if (pos === "P" && defenseSize === "9") {
      if (
        leagueRuleSet === "NKB" &&
        !checkPitchEligibility(p, targetDateStr, teamAge)
      )
        continue;
      const pCount = st.positions["P"] || 0;
      if (inn > 0 && pCount > 0 && !playedHereLast) continue;
    }

    if (pos === "C") {
      const cCap = defenseSize === "10" ? 2 : 3;
      if ((st.positions["C"] || 0) >= cCap) continue;
    }

    const isCarryOverPos = pos === "C" || (pos === "P" && defenseSize === "9");
    if (!isCarryOverPos && !isLockInning && playedHereLast) continue;

    if (
      (positionLock === "1" || positionLock === "2") &&
      OF_POSITIONS.has(pos) &&
      inn >= 2
    ) {
      const h = st.history;
      if (OF_POSITIONS.has(h[inn - 1]) && OF_POSITIONS.has(h[inn - 2]))
        continue;
    }

    let score = Math.abs((POS_DIFFICULTY[pos] || 3) - 3);

    const histPos = positionHistory.get(p.id);
    const histEntry = histPos?.get(pos) || { total: 0, bigGame: 0 };
    const seasonCount = histEntry.total;
    const bigGameCount = histEntry.bigGame;
    // Fair mode: aggressive rotation pressure. Each prior inning at this
    // position adds 8 to score (heavy push to rotate to a different kid).
    // Big Game: lighter pressure (1.5)  let strong defenders stay at premium
    // spots even if they've played there a lot, since winning matters more.
    const rotationWeight = isBigGame ? 1.5 : 8;
    score += (seasonCount + (st.positions[pos] || 0)) * rotationWeight;
    // FAIR MODE compensatory rotation: kids who've played this position in
    // Big Games get an additional push away from it in fair mode. Helps
    // share premium positions across the roster over the season.
    if (!isBigGame && bigGameCount > 0) {
      score += bigGameCount * 6;
    }

    // Random jitter  more aggressive for fair mode so similar skilled kids
    // genuinely shuffle, less for Big Game where we want consistency.
    score += rand() * (isBigGame ? 2 : 5);

    if (pos === "SS" || pos === "3B") {
      const headG = headGrades[p.id]?.armStrength;
      const armBonus = typeof headG === "number" ? headG : 5;
      // Big Game: full arm strength bias. Fair mode: half.
      score -= armBonus * (isBigGame ? 1 : 0.5);
    }

    if (p.throws === "L") {
      if (INFIELD_NON_1B.has(pos)) score += leftyPenalty;
      else if (pos === "1B") score -= 3;
    }

    if (isLockInning && playedHereLast) score -= 1000;

    if (p.primaryPosition === pos) {
      // Big Game: primary kids stick to their position every inning they're
      // on the field  same hard preference inning 1+ as inning 0, so a
      // primary SS kid plays SS the whole game in Big Game mode (rotating
      // off only when benched).
      // Fair mode: gentle preference, lots of room for rotation.
      if (isBigGame) {
        score -= 10000;
      } else {
        score -= inn === 0 ? 100 : 2;
      }
    }

    // BIG GAME: strong players get a meaningful boost toward premium positions
    // and a penalty for OF spots.
    if (isBigGame) {
      const overall = +p.profile?.overallScore || 0;
      const skill = Math.min(Math.max(overall / 100, 0), 1);
      if (isPremium) {
        score -= skill * 20 - 5;
      } else if (OF_POSITIONS.has(pos)) {
        score += skill * 12 - 6;
      }
    }

    if (score < bestScore) {
      bestScore = score;
      bestPlayer = p;
    }
  }

  return bestPlayer;
}
