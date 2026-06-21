// Pure lineup-swap logic shared by the editor cell-tap handler.
//
// A swap exchanges player `a` (at `sPos`) with whatever sits at `tPos`
// (player `b`, possibly null/empty, or the BENCH). Positions are keyed by the
// Inning shape; "BENCH" is the reserve array, everything else is a field slot.
//
// Edits additionally CARRY FORWARD to the rest of the game: a change in inning
// N applies to inning N and every LATER inning (N+1 .. end), so the coach's
// change holds for the remaining innings — not just the one they edited.
// Earlier innings (0 .. N-1) are always left alone. Two things are deliberately
// left untouched when propagating:
//   1. The catcher ("C"). Its innings are rule-capped / rotated, so a catcher
//      edit never propagates, and a propagated field swap never displaces an
//      inning's catcher.
//   2. Innings whose arrangement already differs (e.g. fair-rotation shuffles
//      or scripted substitution windows). If a later inning's pre-state no
//      longer matches the edited inning, the carry skips it — intentional
//      rotation and auto-subs survive.

import type { Inning, SlimPlayer } from "../types";

export interface LineupSwap {
  innIdx: number;
  sPos: string;
  sPlayer: NonNullable<SlimPlayer>;
  tPos: string;
  tPlayer: SlimPlayer | null;
  // When true, the edit carries forward to the later innings (innIdx+1 .. end),
  // applying the same swap to every later inning that still matches the
  // pre-swap arrangement.
  carryForward: boolean;
}

// Apply the swap (a@sPos <-> b@tPos) to a single inning's slot, in place.
function applySwap(slot: Inning, swap: LineupSwap): void {
  const { sPos, sPlayer: a, tPos, tPlayer: b } = swap;
  if (sPos === "BENCH") {
    slot.BENCH = (slot.BENCH || []).filter(
      (p): p is NonNullable<SlimPlayer> => p !== null && p.id !== a.id,
    );
    if (b) slot.BENCH.push(b);
    slot[tPos] = a;
  } else if (tPos === "BENCH") {
    slot.BENCH = (slot.BENCH || []).filter(
      (p): p is NonNullable<SlimPlayer> => p !== null && p.id !== b?.id,
    );
    slot.BENCH.push(a);
    slot[sPos] = null;
  } else {
    slot[sPos] = b || null;
    slot[tPos] = a;
  }
}

// Does inning `slot`'s `slotPos` still hold `who` (or, for BENCH, contain them)?
// A null `who` means "the slot was empty" / "no bench requirement".
function slotMatches(slot: Inning, slotPos: string, who: SlimPlayer): boolean {
  if (slotPos === "BENCH") {
    return who ? (slot.BENCH || []).some((p) => p && p.id === who.id) : true;
  }
  const at = slot[slotPos] as SlimPlayer;
  return who ? !!at && at.id === who.id : !at;
}

// Returns a NEW lineup with the swap applied (originals are never mutated).
export function applyLineupSwap(lineup: Inning[], swap: LineupSwap): Inning[] {
  if (swap.sPos === "BENCH" && swap.tPos === "BENCH") return lineup;

  const next = lineup.map((inn) => ({
    ...inn,
    BENCH: inn.BENCH ? [...inn.BENCH] : [],
  })) as Inning[];

  applySwap(next[swap.innIdx], swap);

  const carries =
    swap.carryForward && swap.sPos !== "C" && swap.tPos !== "C";
  if (carries) {
    const { sPos, sPlayer: a, tPos, tPlayer: b } = swap;
    for (let k = swap.innIdx + 1; k < next.length; k++) {
      const slot = next[k];
      // Never disturb an inning's catcher — that rotation is rule-driven.
      const catcherId = (slot.C as SlimPlayer)?.id;
      if (catcherId && (catcherId === a.id || catcherId === b?.id)) continue;
      if (slotMatches(slot, sPos, a) && slotMatches(slot, tPos, b)) {
        applySwap(slot, swap);
      }
    }
  }

  return next;
}
