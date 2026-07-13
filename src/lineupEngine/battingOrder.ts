// lineupEngine/battingOrder.ts
// Batting-order construction (independent of the defensive lineup) plus the
// batting-only entry point.
import type { EngineInput, EngineResult } from "../types";
import type { ProfiledPlayer } from "./types";
import { buildProfiledPlayers } from "./engineContext";
import { mulberry32 } from "./prng";

// ---------- Batting order ----------

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
export function generateBattingOrder(
  profiledPlayers: ProfiledPlayer[],
  battingSize: string,
  opts: { seed?: number; leagueRuleSet?: string; teamAge?: string } = {},
): ProfiledPlayer[] {
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
  const score = (p: ProfiledPlayer, key: string) =>
    ((p.profile as unknown as Record<string, number>)[key] || 0) *
    factor.get(p.id);
  // OPS lives on raw stats, not in the precomputed profile, so wrap it the
  // same way for jittered selection (only used by the youth strategy).
  const opsScore = (p: ProfiledPlayer) =>
    +(p.stats?.ops ?? 0) * factor.get(p.id);

  const byOverall = [...profiledPlayers].sort(
    (a, b) => score(b, "overallScore") - score(a, "overallScore"),
  );
  const pool = byOverall.slice(0, count);
  const order = new Array(count).fill(null);
  const reasons = new Array(count).fill("");

  function takeBest(scoreKey: string) {
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

  function place(
    idx: number,
    player: ProfiledPlayer | null,
    role: string,
    note: string,
  ) {
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
        "Best OBP+speed  set the table",
      );
    if (count > 1)
      place(
        1,
        takeBest("contactScore"),
        "#2 Contact",
        "Top contact  extends the rally",
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
        "Next best OBP  turn the order over",
      );
    if (count > 5)
      place(
        5,
        takeBest("contactScore"),
        "#6 Sustain",
        "More contact  keep it going",
      );
    if (count > 6)
      place(
        6,
        takeBestOps(),
        "#7 Late OPS",
        "Third big hitter  late inning threat",
      );

    // Tail: descending by composite youthScore (leadoff + contact + OPS).
    // No `powerScore`  HR/SLG/RBI are noise at this age.
    const youthScore = (p: ProfiledPlayer) =>
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
        "Best overall  modern #2 spot is a premium RBI position",
      );
    if (count > 3)
      place(3, takeBest("powerScore"), "Cleanup", "Best slugger  cleanup");
    if (count > 2)
      place(
        2,
        takeBest("overallScore"),
        "#3 Modern",
        "Strong bat  modern #3 is the 4th best slot",
      );
    if (count > 4)
      place(
        4,
        takeBest("powerScore"),
        "#5 Power",
        "Next best power  second cleanup",
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

  // Attach structured reasons to the placed players. The printable lineup
  // card renders `battingReason` as an italic "role — note" sub-line.
  for (let i = 0; i < count; i++) {
    const player = order[i];
    if (!player) continue;
    const reason = reasons[i] || { role: "", note: "" };
    player.battingReason = {
      role: reason.role,
      note: reason.note,
    };
  }
  return order.filter(Boolean);
}

// Lightweight wrapper for "re roll batting only"  builds player profiles
// from raw players + grades and runs generateBattingOrder. Defense side
// state (lineup, bench schedule, etc.) is untouched. Returns the new
// batting order or { error } if the inputs are too thin.
export function generateBattingOnly(input: EngineInput): EngineResult {
  const {
    activePlayers,
    allPlayers,
    evaluationEvents = [],
    leagueRuleSet = "USSSA",
    teamAge = "8U",
    battingSize = "roster",
    seed,
  } = input;

  if (!Array.isArray(activePlayers) || activePlayers.length < 1) {
    return { error: "No active players to build a batting order from." };
  }

  const { profiled } = buildProfiledPlayers({
    activePlayers,
    allPlayers,
    evaluationEvents,
    games: input.games,
    teamAge,
  });

  const battingLineup = generateBattingOrder(profiled, battingSize, {
    leagueRuleSet,
    teamAge,
    seed,
  });

  return { battingLineup };
}
