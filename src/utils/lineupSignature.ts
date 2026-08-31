// Canonical identity of a lineup, for answering one question: is what I'm
// looking at the same lineup as what's stored?
//
// A raw JSON.stringify cannot answer it. The in-editor lineup holds whole
// player objects straight off the engine (stats, eval profile and all), while
// the persisted one is slimmed to {id, name, number} by slimGame — and object
// key order differs between the two besides. Comparing those two strings said
// "changed" on every single save, which is what made the "Game updated
// remotely" warning fire every time a coach hit Save.
//
// So reduce both sides to what actually identifies a lineup: which player id
// is in which position, inning by inning. Names and jersey numbers are roster
// data, not lineup data — renaming a kid is not a lineup change. Bench order
// carries no meaning either (the engine emits it in scheduling order), so it
// is sorted; batting order is meaningful and is kept in order.
import type { Inning, SlimPlayer } from "../types";

const idOf = (slot: unknown): string => {
  if (!slot || typeof slot !== "object") return "";
  const id = (slot as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
};

const inningSignature = (inning: Inning | null | undefined): string => {
  if (!inning || typeof inning !== "object") return "";
  const parts: string[] = [];
  for (const pos of Object.keys(inning).sort()) {
    if (pos === "BENCH") {
      const bench = Array.isArray(inning.BENCH) ? inning.BENCH : [];
      parts.push(`BENCH:${bench.map(idOf).filter(Boolean).sort().join("+")}`);
    } else {
      parts.push(`${pos}:${idOf(inning[pos])}`);
    }
  }
  return parts.join(",");
};

export const lineupSignature = (lineup: Inning[] | null | undefined): string =>
  Array.isArray(lineup) ? lineup.map(inningSignature).join("|") : "";

// Batting order is positional: the same nine kids in a different order is a
// different batting lineup.
export const battingSignature = (
  batting: SlimPlayer[] | null | undefined,
): string => (Array.isArray(batting) ? batting.map(idOf).join(",") : "");
