// lineupEngine/eligibility.ts
// Position eligibility (comfortable / restricted lists), catcher opt-in policy,
// and the per-inning defensive alignment. Pure — no engine state.
import type { Position } from "../types";
import { canonicalizeOutfield } from "../utils/helpers";

// ---------- Constants ----------
export const POS_10: Position[] = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "LCF",
  "RCF",
  "RF",
];
export const POS_9: Position[] = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
];
export const OF_POSITIONS = new Set<string>(["LF", "LCF", "RCF", "RF", "CF"]);
export const INFIELD_NON_1B = new Set<string>(["C", "2B", "SS", "3B"]);

export const POS_DIFFICULTY: Record<string, number> = {
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

// Resolve whether a player is blocked from a position. v4 teams store
// the positive list (comfortablePositions); legacy teams store the
// negative list (restrictions). Empty/missing comfortablePositions =
// "no preference, consider anywhere", matching the UI's "leave empty"
// helper text.
export function isPositionBlocked(
  p: { comfortablePositions?: string[]; restrictions?: string[] },
  pos: string,
): boolean {
  const comfort = Array.isArray(p.comfortablePositions)
    ? p.comfortablePositions
    : null;
  // Canonicalize outfield so a player who accepts CF is eligible for the LCF/RCF
  // field slots in a 10-fielder game, and a player who accepts LCF/RCF (legacy
  // data) is eligible for CF in a 9-fielder game. Corners (LF/RF) stay distinct.
  if (comfort && comfort.length > 0) {
    const target = canonicalizeOutfield(pos);
    return !comfort.some((c) => canonicalizeOutfield(c) === target);
  }
  const restr = Array.isArray(p.restrictions) ? p.restrictions : null;
  if (restr && restr.length > 0) {
    const target = canonicalizeOutfield(pos);
    return restr.some((c) => canonicalizeOutfield(c) === target);
  }
  return false;
}

// A HARD block on a position: an explicit entry in the player's `restrictions`
// list (a "never play here" marker), independent of their comfortable list.
// Used for in-game MANUAL overrides, which are authoritative — the coach can
// seat a kid out of their usual spot — but must still respect a hard
// restriction. (`isPositionBlocked` conflates this with the soft
// comfortable-positions preference, which a manual pick is allowed to ignore.)
export function isHardRestricted(
  p: { comfortablePositions?: string[]; restrictions?: string[] },
  pos: string,
): boolean {
  const restr = Array.isArray(p.restrictions) ? p.restrictions : null;
  if (!restr || restr.length === 0) return false;
  const target = canonicalizeOutfield(pos);
  return restr.some((c) => canonicalizeOutfield(c) === target);
}

// Catcher eligibility. Catcher is just another entry in a player's
// comfortable-positions list — there is no separate flag. A kid may be
// seated at C ONLY when "C" is explicitly present in comfortablePositions.
// Unlike every other position, an EMPTY comfortable list does NOT make a
// player catcher-eligible: catching is strictly opt-in, so a kid the coach
// never cleared for C can never end up behind the plate. A legacy negative
// "C" restriction still wins as a hard block.
export function isCatcherEligible(p: {
  comfortablePositions?: string[];
  restrictions?: string[];
}): boolean {
  if (Array.isArray(p?.restrictions) && p.restrictions.includes("C")) {
    return false;
  }
  return (
    Array.isArray(p?.comfortablePositions) &&
    p.comfortablePositions.includes("C")
  );
}

// Resolved catcher playing-time policy.
//   cap          max innings any one kid catches (Infinity = no limit)
//   consecutive  a catcher's innings must form contiguous block(s) — the
//                engine tiles the game into blocks of `cap` innings and gives
//                each block a single catcher (back-to-back)
//   enforceCap   hard-cap a single kid's catching innings during the
//                pre-pick. Only the explicit settings enforce it; "auto"
//                keeps the legacy lenient reuse so existing teams see ZERO
//                behavior change.
export interface CatcherPolicy {
  cap: number;
  consecutive: boolean;
  enforceCap: boolean;
}

// Resolve the catcher policy from the two team/game settings.
//   catcherMaxInnings: "auto" (default) | "1".."6" | "none"
//   catcherConsecutive: boolean toggle — only consulted for an explicit cap.
// "auto" reproduces the historical behavior exactly: 10-fielder uses
// back-to-back catcher pairs (cap 2, lenient reuse when catchers are scarce),
// every other alignment caps at 3 with a free-rotating catcher.
export function resolveCatcherPolicy(
  catcherMaxInnings: string | number | undefined | null,
  catcherConsecutive: boolean | undefined,
  defenseSize: string | undefined,
  profiledLength: number,
): CatcherPolicy {
  const setting =
    catcherMaxInnings === undefined ||
    catcherMaxInnings === null ||
    catcherMaxInnings === ""
      ? "auto"
      : String(catcherMaxInnings);

  if (setting === "auto") {
    return {
      cap: defenseSize === "10" ? 2 : 3,
      consecutive: defenseSize === "10" && profiledLength >= 10,
      enforceCap: false,
    };
  }
  if (setting === "none") {
    return { cap: Infinity, consecutive: false, enforceCap: false };
  }
  const n = parseInt(setting, 10);
  const cap = Number.isFinite(n) && n > 0 ? n : 3;
  return { cap, consecutive: catcherConsecutive !== false, enforceCap: true };
}
// ---------- Public helpers (re exported for the UI) ----------

export function getPositionsForInning(
  playerCount: number,
  defSize: string,
): Position[] {
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
