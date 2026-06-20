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

// Carry an in-game substitution FORWARD to a later inning by filling ONLY the
// tapped spot — never the whole inning. It changes that one position if (and
// only if) the inning still matches the tapped situation exactly: the player
// who came out (`outId`) is still standing at `pos`, AND the player who came in
// (`inPlayer`) is sitting on that inning's bench. Then they trade places there
// too. Any inning whose rotation has already moved either player is left
// completely untouched, so propagation can never scramble the rotation. Catcher
// stays opt-in: a non-cleared player is never slid into C.
export const fillVacatedSpot = (
  inning: Inning,
  pos: string,
  outId: string,
  inPlayer: SlimPlayer,
  isClearedToCatch: (player: SlimPlayer | undefined) => boolean,
): Inning => {
  if (!inPlayer) return inning;
  const occupant = inning[pos] as SlimPlayer | undefined;
  if (occupant?.id !== outId) return inning; // rotation already moved them
  const onBench = bench(inning).some((p) => p?.id === inPlayer.id);
  if (!onBench) return inning; // the sub isn't free this inning
  if (pos === "C" && !isClearedToCatch(inPlayer)) return inning;

  const next: Inning = { ...inning };
  next[pos] = inPlayer;
  next.BENCH = bench(inning).map((p) => (p?.id === inPlayer.id ? occupant : p));
  return next;
};
