// Pure, side-effect-free in-game swap logic, extracted from InGameView so the
// game-critical "move a player on the field" transform can be unit-tested in
// isolation. The component keeps the side effects (optimistic write/debounce,
// undo stack, toast, haptics); this module only computes lineup state.
import type { Inning, SlimPlayer } from "../types";

// A tapped cell: either a fielding position slot, or a specific bench player.
export type SwapSel =
  | { type: "position"; pos: string }
  | { type: "bench"; playerId: string };

const bench = (inning: Inning): SlimPlayer[] =>
  Array.isArray(inning.BENCH) ? (inning.BENCH as SlimPlayer[]) : [];

// Resolve the player currently occupying a selected cell (undefined if empty).
export const getPlayerAt = (
  inning: Inning,
  sel: SwapSel,
): SlimPlayer | undefined => {
  if (sel.type === "position") return inning[sel.pos] as SlimPlayer | undefined;
  return bench(inning).find((p) => p?.id === sel.playerId);
};

// Catcher is opt-in: a swap is blocked if it would drop a player into the C
// slot when they aren't cleared to catch. `isClearedToCatch` resolves that from
// the roster (kept as a callback so this module stays free of team state).
// After the swap, firstSel receives playerB and secondSel receives playerA.
export const isCatcherBlocked = (
  firstSel: SwapSel,
  secondSel: SwapSel,
  playerA: SlimPlayer | undefined,
  playerB: SlimPlayer | undefined,
  isClearedToCatch: (player: SlimPlayer | undefined) => boolean,
): boolean =>
  (firstSel.type === "position" &&
    firstSel.pos === "C" &&
    !isClearedToCatch(playerB)) ||
  (secondSel.type === "position" &&
    secondSel.pos === "C" &&
    !isClearedToCatch(playerA));

// Return a NEW inning with the two cells' players exchanged. Immutable: the
// input inning (and its BENCH array) are not mutated. Returns null when either
// cell is empty (nothing to swap) so callers can no-op cleanly.
//
// Both players are resolved up front and the bench is rebuilt in a SINGLE pass
// keyed on the original ids. (Mutating the bench sequentially is wrong: after
// the first write the id used for the second write can match the just-written
// element — a bench↔bench swap would duplicate one player.)
export const applySwap = (
  inning: Inning,
  firstSel: SwapSel,
  secondSel: SwapSel,
): Inning | null => {
  const playerA = getPlayerAt(inning, firstSel);
  const playerB = getPlayerAt(inning, secondSel);
  if (!playerA || !playerB) return null;

  const next: Inning = { ...inning, BENCH: [...bench(inning)] };

  // firstSel ends up holding playerB; secondSel ends up holding playerA.
  if (firstSel.type === "position") next[firstSel.pos] = playerB;
  if (secondSel.type === "position") next[secondSel.pos] = playerA;

  const benchReplacements = new Map<string, SlimPlayer>();
  if (firstSel.type === "bench")
    benchReplacements.set(firstSel.playerId, playerB);
  if (secondSel.type === "bench")
    benchReplacements.set(secondSel.playerId, playerA);
  if (benchReplacements.size > 0) {
    next.BENCH = (next.BENCH as SlimPlayer[]).map((p) =>
      p && benchReplacements.has(p.id) ? benchReplacements.get(p.id)! : p,
    );
  }
  return next;
};

// Carry an in-game substitution FORWARD to a later inning by identity: wherever
// player `a` appears (field or bench) put `b`, and wherever `b` appears put `a`.
// Every player occupies exactly one cell per inning, so this preserves the
// roster and the bench size — it's the "fill only the vacated spot, keep the
// rest of the inning as-is" rule applied to a future inning. Catcher stays
// opt-in: if the swap would seat a player who isn't cleared at C, the inning is
// left untouched (the sub simply doesn't propagate into that inning).
export const swapPlayersInInning = (
  inning: Inning,
  a: SlimPlayer,
  b: SlimPlayer,
  isClearedToCatch: (player: SlimPlayer | undefined) => boolean,
): Inning => {
  if (!a || !b) return inning;
  const catcherId = (inning.C as SlimPlayer | undefined)?.id;
  if (catcherId === a.id && !isClearedToCatch(b)) return inning;
  if (catcherId === b.id && !isClearedToCatch(a)) return inning;

  const sub = (p: SlimPlayer | undefined): SlimPlayer | undefined =>
    !p ? p : p.id === a.id ? b : p.id === b.id ? a : p;

  const next: Inning = { ...inning };
  for (const key of Object.keys(inning)) {
    if (key === "BENCH") continue;
    next[key] = sub(inning[key] as SlimPlayer | undefined);
  }
  next.BENCH = bench(inning).map((p) => sub(p) as SlimPlayer);
  return next;
};
