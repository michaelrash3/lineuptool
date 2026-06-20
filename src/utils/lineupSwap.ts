// Pure lineup-swap logic shared by the editor cell-tap handler.
//
// A swap exchanges player `a` (at `sPos`) with whatever sits at `tPos`
// (player `b`, possibly null/empty, or the BENCH). Positions are keyed by the
// Inning shape; "BENCH" is the reserve array, everything else is a field slot.
//
// Tournament starting-lineup edits additionally CARRY to the rest of the game:
// the coach's hand-picked defense should hold every inning, not just the 1st.
// Two things are deliberately left untouched when propagating:
//   1. The catcher ("C"). Its innings are rule-capped / rotated, so a catcher
//      edit never propagates, and a propagated field swap never displaces an
//      inning's catcher.
//   2. The engine's scripted substitution windows. If a sub already occupies an
//      affected slot in inning k, that inning's pre-state no longer matches
//      inning 1, so the carry skips it — auto-subs survive.

import type { Inning, SlimPlayer } from "../types";

export interface LineupSwap {
  innIdx: number;
  sPos: string;
  sPlayer: NonNullable<SlimPlayer>;
  tPos: string;
  tPlayer: SlimPlayer | null;
  // When true, an inning-0 edit carries to the matching starter innings.
  propagateToStarterInnings: boolean;
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
    swap.propagateToStarterInnings &&
    swap.innIdx === 0 &&
    swap.sPos !== "C" &&
    swap.tPos !== "C";
  if (carries) {
    const { sPos, sPlayer: a, tPos, tPlayer: b } = swap;
    for (let k = 0; k < next.length; k++) {
      if (k === swap.innIdx) continue;
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
