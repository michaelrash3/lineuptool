import type {
  Game,
  OpponentStrength,
  TiebreakerId,
  TiebreakerRule,
  Tournament,
  TournamentStructure,
} from "../types";
import { countsTowardStats } from "./gameStatus";
import { orderedTournamentGames } from "./tournamentPitching";

// Tournament stakes — pure math + coaching copy for HOW to play a tournament
// game, derived from the structure the coach entered (pools, advancement,
// tiebreaker ladder) and the team's own results. Hard boundary: the app never
// computes standings or claims a seed — it can't see other pools' scores. It
// coaches to the currency: which tiebreakers matter, what a run allowed
// costs, when margin stops counting.

// USSSA baseball's pool-play ladder after overall record: head-to-head
// (two-team ties), fewest runs allowed, run differential capped at +8 per
// game, most runs scored, then a coin flip. The default for every tournament
// until the coach reorders it.
export const DEFAULT_TIEBREAKERS: readonly TiebreakerRule[] = Object.freeze([
  { id: "h2h" as TiebreakerId },
  { id: "runsAllowed" as TiebreakerId },
  { id: "runDiff" as TiebreakerId, cap: 8 },
  { id: "runsScored" as TiebreakerId },
  { id: "coinFlip" as TiebreakerId },
]);

// Catalog for the tiebreaker editor: every criterion the app understands.
export const TIEBREAKER_OPTIONS: ReadonlyArray<{
  id: TiebreakerId;
  label: string;
  // Whether the rule takes a per-game cap (run differential only).
  supportsCap: boolean;
}> = Object.freeze([
  { id: "h2h", label: "Head-to-head", supportsCap: false },
  { id: "runsAllowed", label: "Fewest runs allowed", supportsCap: false },
  { id: "runDiff", label: "Run differential", supportsCap: true },
  { id: "runsScored", label: "Most runs scored", supportsCap: false },
  { id: "coinFlip", label: "Coin flip", supportsCap: false },
]);

const KNOWN_IDS = new Set<string>(TIEBREAKER_OPTIONS.map((o) => o.id));

export const tiebreakerLabel = (rule: TiebreakerRule): string => {
  const base =
    TIEBREAKER_OPTIONS.find((o) => o.id === rule.id)?.label ?? rule.id;
  return rule.id === "runDiff" && rule.cap
    ? `${base} (cap +${rule.cap})`
    : base;
};

// Stored ladders pass through here before use: unknown ids dropped,
// duplicates keep their first position, caps only survive on runDiff and
// only when positive. Absent/empty falls back to the USSSA default.
export function normalizeTiebreakers(
  list: TiebreakerRule[] | null | undefined,
): TiebreakerRule[] {
  const seen = new Set<string>();
  const out: TiebreakerRule[] = [];
  for (const rule of list || []) {
    if (!rule || !KNOWN_IDS.has(rule.id) || seen.has(rule.id)) continue;
    seen.add(rule.id);
    const cap =
      rule.id === "runDiff" && Number.isFinite(Number(rule.cap))
        ? Math.floor(Number(rule.cap))
        : undefined;
    out.push(cap && cap > 0 ? { id: rule.id, cap } : { id: rule.id });
  }
  return out.length > 0 ? out : DEFAULT_TIEBREAKERS.map((r) => ({ ...r }));
}

// The run-differential cap in a ladder, if it has one.
export const runDiffCapOf = (
  tiebreakers: TiebreakerRule[] | null | undefined,
): number | undefined =>
  normalizeTiebreakers(tiebreakers).find((r) => r.id === "runDiff")?.cap;

// ---------------------------------------------------------------------------
// Structure math
// ---------------------------------------------------------------------------

export interface StructureSummary {
  teamCount?: number;
  poolCount?: number;
  // Teams per pool, when the split is even (16/4 → 4); absent otherwise.
  poolSize?: number;
  advanceCount?: number;
  // Automatic bids for pool winners (poolCount when poolWinnersAdvance).
  autoBids?: number;
  // Advancement spots decided across pools on tiebreakers.
  wildcards?: number;
}

const posInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
};

// Null when the coach hasn't entered anything usable yet.
export function summarizeStructure(
  structure: TournamentStructure | null | undefined,
): StructureSummary | null {
  if (!structure) return null;
  const teamCount = posInt(structure.teamCount);
  const poolCount = posInt(structure.poolCount);
  const advanceCount = posInt(structure.advanceCount);
  if (!teamCount && !poolCount && !advanceCount) return null;
  const summary: StructureSummary = {};
  if (teamCount) summary.teamCount = teamCount;
  if (poolCount) summary.poolCount = poolCount;
  if (teamCount && poolCount && teamCount % poolCount === 0) {
    summary.poolSize = teamCount / poolCount;
  }
  if (advanceCount) summary.advanceCount = advanceCount;
  if (advanceCount && poolCount && structure.poolWinnersAdvance) {
    // Pool winners can't take more spots than exist.
    summary.autoBids = Math.min(poolCount, advanceCount);
    summary.wildcards = Math.max(0, advanceCount - poolCount);
  }
  return summary;
}

// One-line human read of the field: "16 teams · 4 pools of 4 · top 6
// advance — 4 pool winners + 2 wildcards". Renders whatever parts are known.
export function describeStructure(
  structure: TournamentStructure | null | undefined,
): string | null {
  const s = summarizeStructure(structure);
  if (!s) return null;
  const parts: string[] = [];
  if (s.teamCount) parts.push(`${s.teamCount} teams`);
  if (s.poolCount) {
    parts.push(
      s.poolSize
        ? `${s.poolCount} pools of ${s.poolSize}`
        : `${s.poolCount} pools`,
    );
  }
  if (s.advanceCount) {
    if (s.autoBids != null && s.wildcards != null && s.wildcards > 0) {
      parts.push(
        `top ${s.advanceCount} advance — ${s.autoBids} pool winners + ${s.wildcards} wildcard${s.wildcards === 1 ? "" : "s"}`,
      );
    } else if (s.autoBids != null && s.wildcards === 0) {
      parts.push(`top ${s.advanceCount} advance — pool winners only`);
    } else {
      parts.push(`top ${s.advanceCount} advance`);
    }
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The team's own pool-play ledger (never standings — just our currency)
// ---------------------------------------------------------------------------

export interface PoolLedger {
  played: number;
  wins: number;
  losses: number;
  ties: number;
  runsScored: number;
  runsAllowed: number;
  // Run differential with the ladder's per-game cap applied both ways —
  // what the tiebreaker would actually count.
  runDiff: number;
  // Margin the cap threw away (positive when we won bigger than it counts).
  runDiffLostToCap: number;
  // Pool games not yet finalized (scrimmages excluded throughout).
  remaining: number;
}

const isPoolGame = (g: Game): boolean =>
  g.gameType !== "bracket" && !g.isScrimmage;

export function poolPlayLedger(
  tournament: Tournament,
  games: Game[] | null | undefined,
  tiebreakers?: TiebreakerRule[] | null,
): PoolLedger {
  const cap = runDiffCapOf(tiebreakers ?? tournament.tiebreakers);
  const ledger: PoolLedger = {
    played: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    runsScored: 0,
    runsAllowed: 0,
    runDiff: 0,
    runDiffLostToCap: 0,
    remaining: 0,
  };
  for (const g of orderedTournamentGames(tournament, games || [])) {
    if (!isPoolGame(g)) continue;
    if (!countsTowardStats(g)) {
      ledger.remaining += 1;
      continue;
    }
    const ts = Number(g.teamScore);
    const os = Number(g.opponentScore);
    ledger.played += 1;
    ledger.runsScored += ts;
    ledger.runsAllowed += os;
    if (ts > os) ledger.wins += 1;
    else if (ts < os) ledger.losses += 1;
    else ledger.ties += 1;
    const margin = ts - os;
    // USSSA-style cap counts at most ±cap per game.
    const counted =
      cap != null ? Math.max(-cap, Math.min(cap, margin)) : margin;
    ledger.runDiff += counted;
    ledger.runDiffLostToCap += margin - counted;
  }
  return ledger;
}

// ---------------------------------------------------------------------------
// Coaching copy
// ---------------------------------------------------------------------------

export interface TiebreakerGuidanceLine {
  id: TiebreakerId;
  label: string;
  detail: string;
}

// One coaching line per rung of the ladder, in ladder order. Copy is written
// order-independent; the UI numbers the rungs.
export function tiebreakerGuidance(
  tiebreakers: TiebreakerRule[] | null | undefined,
): TiebreakerGuidanceLine[] {
  return normalizeTiebreakers(tiebreakers).map((rule) => {
    switch (rule.id) {
      case "h2h":
        return {
          id: rule.id,
          label: tiebreakerLabel(rule),
          detail:
            "Settles two-team ties — beating the team you're tied with outweighs anything you do elsewhere. Three-way ties usually skip it.",
        };
      case "runsAllowed":
        return {
          id: rule.id,
          label: tiebreakerLabel(rule),
          detail:
            "Every run you give up in pool play is tiebreaker currency — defense and strikes late in a decided game still matter.",
        };
      case "runDiff":
        return {
          id: rule.id,
          label: tiebreakerLabel(rule),
          detail: rule.cap
            ? `Margin counts up to +${rule.cap} a game — once you're up ${rule.cap}, extra runs buy nothing. That's the spot to rest arms and get bench kids innings.`
            : "Margin always counts — no cap, so a big win keeps paying.",
        };
      case "runsScored":
        return {
          id: rule.id,
          label: tiebreakerLabel(rule),
          detail:
            "Total offense breaks it here — keep the bats working even with the game in hand.",
        };
      case "coinFlip":
      default:
        return {
          id: rule.id,
          label: tiebreakerLabel(rule),
          detail:
            "Dead even after everything above comes down to a flip — bank enough currency that it never gets here.",
        };
    }
  });
}

// The coach's scouting read, translated into pool-play guidance that knows
// the ladder (capped margin changes what a blowout is worth).
export function opponentStrengthGuidance(
  strength: OpponentStrength | null | undefined,
  tiebreakers: TiebreakerRule[] | null | undefined,
): string | null {
  if (!strength) return null;
  const cap = runDiffCapOf(tiebreakers);
  if (strength === "weaker") {
    return cap != null
      ? `Weaker opponent — get to +${cap}, then pull starters and bank innings; margin past the cap counts for nothing.`
      : "Weaker opponent — margin is uncapped, so the bats keep paying, but don't spend frontline pitching to get it.";
  }
  if (strength === "stronger") {
    return "Stronger opponent — runs allowed is the currency that bleeds here. Keep it close with your best available arm; a tight loss can still cash tiebreakers.";
  }
  return "Even matchup — play it straight up; the win itself is worth more than any tiebreaker math.";
}

// ---------------------------------------------------------------------------
// Per-game stakes
// ---------------------------------------------------------------------------

export interface GameStakes {
  phase: "pool" | "bracket";
  // 1-based position among the tournament's games of the same phase,
  // chronological.
  gameNumber: number;
  gamesInPhase: number;
  headline: string;
  // Ordered guidance copy for this game (structure, scramble, strength).
  lines: string[];
  // The team's own pool currency so far (pool phase only).
  ledger?: PoolLedger;
}

// Everything the UI needs to frame one tournament game. Null when the game
// isn't part of the tournament.
export function gameStakes({
  tournament,
  game,
  games,
}: {
  tournament: Tournament;
  game: Game;
  games: Game[] | null | undefined;
}): GameStakes | null {
  if (!(tournament.gameIds || []).includes(game.id)) return null;
  const ordered = orderedTournamentGames(tournament, games || []);
  const phase: GameStakes["phase"] =
    game.gameType === "bracket" ? "bracket" : "pool";
  const inPhase = ordered.filter((g) =>
    phase === "bracket" ? g.gameType === "bracket" : isPoolGame(g),
  );
  const idx = inPhase.findIndex((g) => g.id === game.id);
  const gameNumber = idx >= 0 ? idx + 1 : 1;
  const gamesInPhase = Math.max(inPhase.length, gameNumber);
  const structureLine = describeStructure(tournament.structure);
  const lines: string[] = [];
  if (structureLine) lines.push(structureLine);

  if (phase === "bracket") {
    lines.push(
      "Bracket play — win or go home. Tiebreakers no longer apply; best available arm, best defense.",
    );
    const strength = opponentStrengthGuidance(
      game.opponentStrength,
      tournament.tiebreakers,
    );
    // Bracket strength read stays simple: the ladder doesn't apply anymore.
    if (game.opponentStrength === "stronger") {
      lines.push(
        "Stronger opponent — empty the tank; there's no later game to save for unless you win this one.",
      );
    } else if (strength && game.opponentStrength === "weaker") {
      lines.push(
        "Weaker opponent — win first, but any inning you can save an arm here pays in the next round.",
      );
    }
    return {
      phase,
      gameNumber,
      gamesInPhase,
      headline: `Bracket game ${gameNumber} of ${gamesInPhase}`,
      lines,
    };
  }

  const summary = summarizeStructure(tournament.structure);
  if (summary?.wildcards != null && summary.wildcards > 0) {
    lines.push(
      `Win the pool and you're in on the automatic bid; anything less is the wildcard scramble for ${summary.wildcards} spot${summary.wildcards === 1 ? "" : "s"}, where the tiebreakers below decide.`,
    );
  } else if (summary?.wildcards === 0) {
    lines.push(
      "Only pool winners advance — the pool is win-or-done, and tiebreakers only matter inside a tied pool.",
    );
  }
  const strengthLine = opponentStrengthGuidance(
    game.opponentStrength,
    tournament.tiebreakers,
  );
  if (strengthLine) lines.push(strengthLine);

  return {
    phase,
    gameNumber,
    gamesInPhase,
    headline: `Pool game ${gameNumber} of ${gamesInPhase}`,
    lines,
    ledger: poolPlayLedger(tournament, games, tournament.tiebreakers),
  };
}

// Convenience for surfaces that only have a game id: which stored tournament
// claims this game, if any.
export function tournamentForGame(
  tournaments: Tournament[] | null | undefined,
  gameId: string,
): Tournament | undefined {
  return (tournaments || []).find((t) => (t.gameIds || []).includes(gameId));
}

// Live in-game advisory for a pool game whose margin has reached the
// ladder's run-diff cap: the moment extra runs stop buying tiebreaker
// currency is exactly when the coach should pull starters, rest arms, and
// run the bench. Null whenever there's nothing actionable — bracket games,
// scrimmages, no cap in the ladder, or margin still under it.
export function liveMarginAdvisory(
  game: Game,
  tournament: Tournament | null | undefined,
): string | null {
  if (!tournament || !(tournament.gameIds || []).includes(game.id)) return null;
  if (!isPoolGame(game)) return null;
  const ladder = normalizeTiebreakers(tournament.tiebreakers);
  const cap = ladder.find((r) => r.id === "runDiff")?.cap;
  if (cap == null) return null;
  const margin = Number(game.teamScore ?? 0) - Number(game.opponentScore ?? 0);
  if (!Number.isFinite(margin) || margin < cap) return null;
  const runsAllowedCounts = ladder.some((r) => r.id === "runsAllowed");
  return (
    `Up ${margin} — margin past +${cap} doesn't count for tiebreakers. Rest arms and run the bench` +
    (runsAllowedCounts
      ? "; runs allowed still counts, so keep the defense honest."
      : ".")
  );
}
