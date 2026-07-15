// Pure helpers for the What-If Lineup Sandbox and the Lineup Rationale readout.
//
// They consume the lineup engine's existing output (EngineResult from
// generateLineup / buildCompetitiveLineup) — an inning-by-inning defense plus
// the diagnostic fields the engine already returns (qualityPenalty, why strict
// fairness was relaxed, which innings had their rotation lock relaxed, or a
// blocker error). No engine changes and no persistence: the sandbox re-runs the
// engine in memory and these functions summarize / diff / explain the result.
import type { Inning, SlimPlayer } from "../types";

// The subset of the engine result these helpers read.
export interface EngineLike {
  lineup?: Inning[];
  battingLineup?: SlimPlayer[];
  error?: string;
  qualityPenalty?: number;
  fairnessRelaxed?: boolean;
  fairnessRelaxedReason?: string;
  lockRelaxedInnings?: number[];
}

export interface PlayerFairness {
  id: string;
  name: string;
  benchInnings: number;
  positions: string[]; // distinct field positions played, in first-seen order
  distinctPositions: number;
}

export interface ScenarioSummary {
  ok: boolean;
  error?: string;
  penalty: number | null;
  fairnessRelaxed: boolean;
  fairnessRelaxedReason?: string;
  lockRelaxedInnings: number[];
  totalInnings: number;
  perPlayer: PlayerFairness[];
}

// Per-player bench innings + distinct field positions across the whole lineup.
// A player is "benched" an inning when they appear in that inning's BENCH array;
// they "play" a position when they hold a non-BENCH key that inning.
export const computeFairness = (
  lineup: Inning[] | undefined,
  activePlayers: { id: string; name?: string }[],
): PlayerFairness[] => {
  const nameById = new Map(
    (activePlayers || []).map((p) => [p.id, p.name || "Unnamed"]),
  );
  const bench = new Map<string, number>();
  const positions = new Map<string, string[]>();
  for (const id of nameById.keys()) {
    bench.set(id, 0);
    positions.set(id, []);
  }
  for (const inning of lineup || []) {
    if (!inning) continue;
    for (const key of Object.keys(inning)) {
      const val = inning[key];
      if (key === "BENCH") {
        for (const p of (val as SlimPlayer[]) || []) {
          if (p?.id && bench.has(p.id)) bench.set(p.id, bench.get(p.id)! + 1);
        }
      } else {
        const p = val as SlimPlayer;
        if (p?.id && positions.has(p.id)) {
          const list = positions.get(p.id)!;
          if (!list.includes(key)) list.push(key);
        }
      }
    }
  }
  return (activePlayers || []).map((p) => ({
    id: p.id,
    name: nameById.get(p.id) || "Unnamed",
    benchInnings: bench.get(p.id) || 0,
    positions: positions.get(p.id) || [],
    distinctPositions: (positions.get(p.id) || []).length,
  }));
};

export const summarizeScenario = (
  result: EngineLike | null | undefined,
  activePlayers: { id: string; name?: string }[],
): ScenarioSummary => {
  const lineup = result?.lineup;
  const ok = !!(result && !result.error && lineup && lineup.length > 0);
  return {
    ok,
    error: result?.error,
    penalty:
      typeof result?.qualityPenalty === "number" ? result.qualityPenalty : null,
    fairnessRelaxed: !!result?.fairnessRelaxed,
    fairnessRelaxedReason: result?.fairnessRelaxedReason,
    lockRelaxedInnings: result?.lockRelaxedInnings || [],
    totalInnings: lineup?.length || 0,
    perPlayer: ok ? computeFairness(lineup, activePlayers) : [],
  };
};

// Plain-English "why" lines from the engine's own diagnostics + the fairness
// spread it produced. Deterministic, no AI. Ordered most- to least-important.
export const buildRationale = (summary: ScenarioSummary): string[] => {
  if (!summary.ok) {
    return [summary.error || "Couldn't build a lineup with these players."];
  }
  const lines: string[] = [];
  if (summary.fairnessRelaxed && summary.fairnessRelaxedReason) {
    lines.push(
      `Season fairness was relaxed for this game — ${summary.fairnessRelaxedReason}`,
    );
  }
  if (summary.lockRelaxedInnings.length > 0) {
    const innings = summary.lockRelaxedInnings.join(", ");
    lines.push(
      `Position-rotation lock was relaxed in inning ${innings} to keep a valid, fair defense.`,
    );
  }
  if (summary.penalty != null) {
    lines.push(
      summary.penalty === 0
        ? "Every fairness and rotation constraint was satisfied (penalty 0)."
        : `Fairness/constraint cost: ${summary.penalty} (lower is better; 0 is a perfect fit).`,
    );
  }
  // Bench-time spread.
  const benches = summary.perPlayer.map((p) => p.benchInnings);
  if (benches.length > 0) {
    const max = Math.max(...benches);
    const min = Math.min(...benches);
    if (max > 0) {
      const sitters = summary.perPlayer
        .filter((p) => p.benchInnings === max)
        .map((p) => p.name);
      lines.push(
        `Most bench time: ${sitters.join(", ")} (${max} inning${max === 1 ? "" : "s"}).`,
      );
    }
    if (max - min >= 2) {
      lines.push(
        `Bench time is uneven this game (${min}–${max} innings) — it evens out across the season.`,
      );
    }
  }
  // Single-position players (low variety).
  const oneSpot = summary.perPlayer
    .filter((p) => p.distinctPositions === 1)
    .map((p) => p.name);
  if (oneSpot.length > 0 && oneSpot.length <= 4) {
    lines.push(`Played a single position all game: ${oneSpot.join(", ")}.`);
  }
  return lines;
};

export interface ScenarioDiff {
  bothOk: boolean;
  penaltyA: number | null;
  penaltyB: number | null;
  penaltyDelta: number | null; // B − A; negative means B is fairer
  benchChanges: { id: string; name: string; from: number; to: number }[];
}

// Compare two scenarios (A = baseline, B = tweaked). Surfaces the fairness-cost
// delta and per-player bench-inning changes for the A/B view.
export const diffScenarios = (
  a: ScenarioSummary,
  b: ScenarioSummary,
): ScenarioDiff => {
  const benchA = new Map(a.perPlayer.map((p) => [p.id, p.benchInnings]));
  const nameById = new Map<string, string>();
  a.perPlayer.forEach((p) => nameById.set(p.id, p.name));
  b.perPlayer.forEach((p) => nameById.set(p.id, p.name));
  const benchChanges: ScenarioDiff["benchChanges"] = [];
  for (const p of b.perPlayer) {
    const from = benchA.has(p.id) ? benchA.get(p.id)! : 0;
    if (from !== p.benchInnings) {
      benchChanges.push({
        id: p.id,
        name: p.name,
        from,
        to: p.benchInnings,
      });
    }
  }
  return {
    bothOk: a.ok && b.ok,
    penaltyA: a.penalty,
    penaltyB: b.penalty,
    penaltyDelta:
      a.penalty != null && b.penalty != null ? b.penalty - a.penalty : null,
    benchChanges,
  };
};
