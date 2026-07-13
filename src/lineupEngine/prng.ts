// lineupEngine/prng.ts
// Deterministic seeded PRNG (mulberry32) plus small scoring-weight tables
// (lefty-infield penalty, positional-scarcity reserve, depth-chart bonuses,
// premium-importance extras). Pure.

// ---------- Lefty infield penalty (precomputed table) ----------

export const LEFTY_PENALTY: Record<string, number> = {
  "NKB|6U": 5,
  "NKB|7U": 5,
  "NKB|8U": 10,
  "NKB|9U": 25,
  "USSSA|6U": 20,
  "USSSA|7U": 20,
  "USSSA|8U": 35,
};
export function leftyInfieldPenalty(rules: string, age: string): number {
  return LEFTY_PENALTY[`${rules}|${age}`] ?? 50;
}

// ---------- Positional-scarcity reservation ----------
// Two kinds of scarcity drive a good defensive rotation:
//   1. Position-side ("holes"): a slot only a few present kids are cleared
//      for. Handled by the posScarcity ordering in tryBuildLineup — the
//      hardest-to-fill positions are assigned first so they never get
//      stranded.
//   2. Player-side ("kids with few positions"): a glove-limited kid cleared
//      for, say, only 1B/RF. When such a kid AND a play-anywhere kid are both
//      eligible for the slot being filled, we want to seat the less-flexible
//      kid here and reserve the do-anything kid to plug the remaining holes.
// SCARCITY_RESERVE_WEIGHT scores that second dimension: each extra position a
// candidate is eligible for adds a small "save them for elsewhere" penalty, so
// the least-flexible eligible kid wins the slot. Fair mode only — Big Game
// pins strong kids to premium spots by skill, and the 200-attempt retry loop
// already guards feasibility there.
export const SCARCITY_RESERVE_WEIGHT = 2;

// Competitive depth-chart bonus (see pickBestForPosition). BASE is an order of
// magnitude larger than every other in-loop term (rotation, comfort, premium
// pull, jitter ≈ tens–hundreds) so a charted player reliably wins their slot;
// STEP keeps the coach's order strict (rank 0 beats rank 1 beats …). The bonus
// is only applied to candidates that already passed every hard eligibility gate,
// so it reorders — never expands — the legal candidate set. (It does not exceed
// the legacy primaryPosition pre-pin, which claims slots earlier; modern teams
// use comfortablePositions and never trigger that pre-pin.)
export const DEPTH_CHART_BASE_BONUS = 9000;
export const DEPTH_CHART_RANK_STEP = 100;
// Repulsion applied to a charted player at a position they're NOT charted at,
// so they stay available for their charted slot. Smaller than the base bonus so
// it never blocks a slot (a charted-elsewhere player is a valid last resort).
export const DEPTH_CHART_AVOID_PENALTY = 6000;
// Position-importance extra pull (Big Game / competitive), on top of the base
// premium pull: the spine is Pitcher > Catcher > 1B, so the strongest players
// fill those before SS/3B. Skill-scaled at the call site.
export const PREMIUM_IMPORTANCE_EXTRA: Record<string, number> = {
  P: 10,
  C: 7,
  "1B": 4,
};

// ---------- Seeded PRNG ----------
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
