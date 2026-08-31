import { describe, it, expect } from "vitest";
import { lineupSignature, battingSignature } from "./lineupSignature";
import type { Inning, SlimPlayer } from "../types";

// The in-editor lineup carries whole player objects off the engine; the
// persisted one is slimmed to {id, name, number}. These two must read as the
// SAME lineup, which is the whole reason the signature exists.
const fatInning = {
  P: {
    id: "p1",
    name: "Ann",
    number: "7",
    stats: { ab: 10, h: 4 },
    profile: { arm: 8 },
  },
  C: { id: "p2", name: "Bo", number: "3", stats: { ab: 8 } },
  BENCH: [{ id: "p3", name: "Cy", number: "9", stats: { ab: 2 } }],
} as unknown as Inning;

const slimInning = {
  C: { id: "p2", name: "Bo", number: "3" },
  P: { id: "p1", name: "Ann", number: "7" },
  BENCH: [{ id: "p3", name: "Cy", number: "9" }],
} as unknown as Inning;

describe("lineupSignature", () => {
  it("reads a fat engine lineup and its slimmed persisted twin as identical", () => {
    expect(lineupSignature([fatInning])).toBe(lineupSignature([slimInning]));
  });

  it("ignores key order within an inning", () => {
    const a = { P: { id: "x" }, C: { id: "y" } } as unknown as Inning;
    const b = { C: { id: "y" }, P: { id: "x" } } as unknown as Inning;
    expect(lineupSignature([a])).toBe(lineupSignature([b]));
  });

  it("ignores a rename or a jersey change — roster data is not lineup data", () => {
    const renamed = {
      ...slimInning,
      P: { id: "p1", name: "Annabel", number: "21" },
    } as unknown as Inning;
    expect(lineupSignature([renamed])).toBe(lineupSignature([slimInning]));
  });

  it("changes when a player moves position", () => {
    const swapped = {
      P: { id: "p2" },
      C: { id: "p1" },
      BENCH: [{ id: "p3" }],
    } as unknown as Inning;
    expect(lineupSignature([swapped])).not.toBe(lineupSignature([slimInning]));
  });

  it("changes when a bench player is subbed in", () => {
    const subbed = {
      P: { id: "p1" },
      C: { id: "p3" },
      BENCH: [{ id: "p2" }],
    } as unknown as Inning;
    expect(lineupSignature([subbed])).not.toBe(lineupSignature([slimInning]));
  });

  it("ignores bench ORDER, which the engine emits in scheduling order", () => {
    const a = { BENCH: [{ id: "x" }, { id: "y" }] } as unknown as Inning;
    const b = { BENCH: [{ id: "y" }, { id: "x" }] } as unknown as Inning;
    expect(lineupSignature([a])).toBe(lineupSignature([b]));
  });

  it("distinguishes an empty slot from a filled one", () => {
    const empty = { P: null, C: { id: "y" } } as unknown as Inning;
    const filled = { P: { id: "x" }, C: { id: "y" } } as unknown as Inning;
    expect(lineupSignature([empty])).not.toBe(lineupSignature([filled]));
  });

  it("distinguishes innings added or removed", () => {
    expect(lineupSignature([slimInning, slimInning])).not.toBe(
      lineupSignature([slimInning]),
    );
  });

  it("treats null, undefined and [] as the same empty lineup", () => {
    expect(lineupSignature(null)).toBe("");
    expect(lineupSignature(undefined)).toBe("");
    expect(lineupSignature([])).toBe("");
  });
});

describe("battingSignature", () => {
  const order = [
    { id: "p1", name: "Ann", number: "7" },
    { id: "p2", name: "Bo", number: "3" },
  ] as SlimPlayer[];

  it("ignores fields other than id", () => {
    const fat = [
      { id: "p1", name: "Ann", number: "7", stats: { ab: 9 } },
      { id: "p2", name: "Bo", number: "3", stats: { ab: 4 } },
    ] as unknown as SlimPlayer[];
    expect(battingSignature(fat)).toBe(battingSignature(order));
  });

  it("is order-sensitive — batting order is the point", () => {
    expect(battingSignature([order[1], order[0]])).not.toBe(
      battingSignature(order),
    );
  });

  it("treats null and [] as empty", () => {
    expect(battingSignature(null)).toBe("");
    expect(battingSignature([])).toBe("");
  });
});
