// The roster's canonical display order, in one place.
//
// The Roster tab lists active players by jersey number and puts departed ones
// under their own header at the bottom. The player profile's Prev/Next pager
// walks that same sequence — "next" has to mean the next row the coach can
// see, or the pager is lying. Two independent sorts would drift the moment
// either changed, so both read this.
import { isSubPlayer } from "./subPlayers";

interface OrderablePlayer {
  id: string;
  name?: string;
  number?: unknown;
  rosterStatus?: unknown;
  [key: string]: unknown;
}

// Jersey order: numbered players ascending, then unnumbered ones by name.
// Lifted verbatim from the Roster tab's list sort.
export const byJerseyNumber = (a: OrderablePlayer, b: OrderablePlayer) => {
  const numA = parseInt(String(a.number ?? ""), 10);
  const numB = parseInt(String(b.number ?? ""), 10);
  if (isNaN(numA) && isNaN(numB))
    return (a.name || "").localeCompare(b.name || "");
  if (isNaN(numA)) return 1;
  if (isNaN(numB)) return -1;
  return numA - numB;
};

const isDeparted = (p: OrderablePlayer) => p?.rosterStatus === "departed";

// Season roster in the order the Roster tab renders it: active by jersey
// number, then departed by jersey number. Tournament subs are not roster and
// never appear (see ./subPlayers).
export const rosterDisplayOrder = <T extends OrderablePlayer>(
  players: T[] | null | undefined,
): T[] => {
  const roster = (players || []).filter((p) => p?.id && !isSubPlayer(p));
  const active = roster.filter((p) => !isDeparted(p)).sort(byJerseyNumber);
  const departed = roster.filter(isDeparted).sort(byJerseyNumber);
  return [...active, ...departed];
};

export interface RosterNeighbors<T> {
  prev: T | null;
  next: T | null;
  // 1-based position for the "3 of 12" read; 0 when the player isn't on the
  // roster (a sub, or an id that no longer resolves).
  position: number;
  total: number;
}

// The players either side of `playerId` in display order. Deliberately does
// NOT wrap: a pager that loops gives the coach no way to know they have seen
// everyone, and "next" past the last player silently restarting is worse than
// a disabled button.
export const rosterNeighbors = <T extends OrderablePlayer>(
  players: T[] | null | undefined,
  playerId: string | null | undefined,
): RosterNeighbors<T> => {
  const ordered = rosterDisplayOrder(players);
  const idx = playerId ? ordered.findIndex((p) => p.id === playerId) : -1;
  if (idx < 0)
    return { prev: null, next: null, position: 0, total: ordered.length };
  return {
    prev: idx > 0 ? ordered[idx - 1] : null,
    next: idx < ordered.length - 1 ? ordered[idx + 1] : null,
    position: idx + 1,
    total: ordered.length,
  };
};
