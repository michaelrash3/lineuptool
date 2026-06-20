import { describe, it, expect } from "vitest";
import { applyLineupSwap, type LineupSwap } from "./lineupSwap";
import type { Inning, SlimPlayer } from "../types";

const p = (id: string): NonNullable<SlimPlayer> => ({
  id,
  name: id.toUpperCase(),
  number: "",
});

// 4-inning tournament-style grid: Alice starts at SS innings 1-2 & 4, a sub
// (Bob) takes SS in inning 3. Carl catches every inning (rule-driven). Dan is
// on the bench until tapped in.
const grid = (): Inning[] => [
  { SS: p("alice"), "1B": p("ed"), C: p("carl"), BENCH: [p("dan")] },
  { SS: p("alice"), "1B": p("ed"), C: p("carl"), BENCH: [p("dan")] },
  { SS: p("bob"), "1B": p("ed"), C: p("carl"), BENCH: [p("alice")] },
  { SS: p("alice"), "1B": p("ed"), C: p("carl"), BENCH: [p("dan")] },
];

const ssIds = (lineup: Inning[]) =>
  lineup.map((inn) => (inn.SS as SlimPlayer)?.id ?? null);

describe("applyLineupSwap", () => {
  it("does not mutate the input lineup", () => {
    const original = grid();
    const snapshot = JSON.stringify(original);
    applyLineupSwap(original, {
      innIdx: 0,
      sPos: "SS",
      sPlayer: p("alice"),
      tPos: "1B",
      tPlayer: p("ed"),
      propagateToStarterInnings: true,
    });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("non-tournament edit only changes the edited inning", () => {
    const out = applyLineupSwap(grid(), {
      innIdx: 0,
      sPos: "SS",
      sPlayer: p("alice"),
      tPos: "1B",
      tPlayer: p("ed"),
      propagateToStarterInnings: false,
    });
    expect((out[0].SS as SlimPlayer)?.id).toBe("ed");
    expect((out[0]["1B"] as SlimPlayer)?.id).toBe("alice");
    // Later innings untouched.
    expect((out[1].SS as SlimPlayer)?.id).toBe("alice");
  });

  it("tournament edit carries a field swap to matching starter innings", () => {
    // Move bench Dan into SS in inning 1, sending Alice to the bench.
    const out = applyLineupSwap(grid(), {
      innIdx: 0,
      sPos: "BENCH",
      sPlayer: p("dan"),
      tPos: "SS",
      tPlayer: p("alice"),
      propagateToStarterInnings: true,
    });
    // Innings 1,2,4 (Alice was the SS starter) -> Dan. Inning 3 keeps the
    // scripted sub Bob.
    expect(ssIds(out)).toEqual(["dan", "dan", "bob", "dan"]);
    // Alice is benched in the starter innings she lost.
    expect((out[0].BENCH || []).map((x) => x?.id)).toContain("alice");
    // The sub-window inning's bench is untouched.
    expect((out[2].BENCH || []).map((x) => x?.id)).toEqual(["alice"]);
  });

  it("never propagates a catcher edit", () => {
    // Swap the catcher (Carl) with the shortstop (Alice) in inning 1.
    const out = applyLineupSwap(grid(), {
      innIdx: 0,
      sPos: "C",
      sPlayer: p("carl"),
      tPos: "SS",
      tPlayer: p("alice"),
      propagateToStarterInnings: true,
    });
    // Only inning 1 changed; the rest keep Carl behind the plate and Alice at SS.
    expect((out[0].C as SlimPlayer)?.id).toBe("alice");
    expect((out[0].SS as SlimPlayer)?.id).toBe("carl");
    expect((out[1].C as SlimPlayer)?.id).toBe("carl");
    expect((out[2].C as SlimPlayer)?.id).toBe("carl");
    expect((out[3].C as SlimPlayer)?.id).toBe("carl");
    // Alice stays the SS starter in the other starter innings (no carry).
    expect(ssIds(out)).toEqual(["carl", "alice", "bob", "alice"]);
  });

  it("never displaces an inning's catcher when propagating a field swap", () => {
    // Carl catches every inning. Try to move Carl onto the field at SS from
    // inning 1 — propagation must not pull him out of the catcher slot later.
    const out = applyLineupSwap(grid(), {
      innIdx: 0,
      sPos: "SS",
      sPlayer: p("alice"),
      tPos: "1B",
      tPlayer: p("ed"),
      propagateToStarterInnings: true,
    });
    // Field swap of Alice<->Ed carries across starter innings, catcher intact.
    expect(ssIds(out)).toEqual(["ed", "ed", "bob", "ed"]);
    out.forEach((inn) => expect((inn.C as SlimPlayer)?.id).toBe("carl"));
  });

  it("only carries edits made to the first inning", () => {
    const out = applyLineupSwap(grid(), {
      innIdx: 1,
      sPos: "SS",
      sPlayer: p("alice"),
      tPos: "1B",
      tPlayer: p("ed"),
      propagateToStarterInnings: true,
    });
    // Edit was in inning 2 (index 1) -> no propagation.
    expect(ssIds(out)).toEqual(["alice", "ed", "bob", "alice"]);
  });
});
