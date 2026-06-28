// Game-status predicates, extracted from helpers.ts so non-helpers modules
// (e.g. the .ics export) can import them without pulling in — or cycling
// through — the rest of the helpers grab-bag. Pure.

export const isGameFinalized = (
  game:
    | {
        status?: string;
        teamScore?: number | string | null;
        opponentScore?: number | string | null;
      }
    | null
    | undefined,
): boolean => {
  if (!game) return false;
  if (game.status === "final" || game.status === "completed") return true;
  const ts = game.teamScore;
  const os = game.opponentScore;
  if (ts == null || ts === "" || os == null || os === "") return false;
  return Number.isFinite(Number(ts)) && Number.isFinite(Number(os));
};

// Whether a game contributes to CUMULATIVE totals — the W-L record, run
// totals/form/streak, player stats, defensive-innings distribution, bench
// equity, and the lineup engine's seasonal fairness. A scrimmage is finalizable
// and lives on the schedule (so it's playable and keeps GameChanger's sync
// happy) but is excluded from all of the above. Display/scheduling code keeps
// using isGameFinalized() — a scrimmage is still a real, finalizable game.
export const countsTowardStats = (
  game:
    | {
        status?: string;
        teamScore?: number | string | null;
        opponentScore?: number | string | null;
        isScrimmage?: boolean;
      }
    | null
    | undefined,
): boolean => isGameFinalized(game) && !game?.isScrimmage;
