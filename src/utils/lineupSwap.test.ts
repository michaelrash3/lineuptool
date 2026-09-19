import { describe, it, expect } from "vitest";
import { applyLineupSwap, moveBatterTo, type LineupSwap } from "./lineupSwap";
import type { Inning, SlimPlayer } from "../types";

const p = (id: string): NonNullable<SlimPlayer> => ({
  id,
  name: id.toUpperCase(),
  number: "",
});

// 4-inning grid: Alice starts at SS innings 1-2 & 4, a sub (Bob) takes SS in
// inning 3. Carl catches every inning (rule-driven). Dan is on the bench until
// tapped in.
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
      carryForward: true,
    });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("with carryForward off, only the edited inning changes", () => {
    const out = applyLineupSwap(grid(), {
      innIdx: 0,
      sPos: "SS",
      sPlayer: p("alice"),
      tPos: "1B",
      tPlayer: p("ed"),
      carryForward: false,
    });
    expect((out[0].SS as SlimPlayer)?.id).toBe("ed");
    expect((out[0]["1B"] as SlimPlayer)?.id).toBe("alice");
    // Later innings untouched.
    expect((out[1].SS as SlimPlayer)?.id).toBe("alice");
  });

  it("carries a field swap forward to matching later innings", () => {
    // Move bench Dan into SS in inning 1, sending Alice to the bench.
    const out = applyLineupSwap(grid(), {
      innIdx: 0,
      sPos: "BENCH",
      sPlayer: p("dan"),
      tPos: "SS",
      tPlayer: p("alice"),
      carryForward: true,
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
      carryForward: true,
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
      carryForward: true,
    });
    // Field swap of Alice<->Ed carries across matching innings, catcher intact.
    expect(ssIds(out)).toEqual(["ed", "ed", "bob", "ed"]);
    out.forEach((inn) => expect((inn.C as SlimPlayer)?.id).toBe("carl"));
  });

  it("carries forward from the edited inning, never to earlier ones", () => {
    const out = applyLineupSwap(grid(), {
      innIdx: 1,
      sPos: "SS",
      sPlayer: p("alice"),
      tPos: "1B",
      tPlayer: p("ed"),
      carryForward: true,
    });
    // Edit in inning 2 (index 1): inning 1 (earlier) is untouched, inning 2 is
    // swapped, inning 3 keeps the scripted sub (Bob), inning 4 matches so it
    // carries.
    expect(ssIds(out)).toEqual(["alice", "ed", "bob", "ed"]);
  });

  it("field -> bench is a SWAP: the tapped bench player takes the vacated position", () => {
    // The bug this pins: moving a fielder to the bench removed the tapped
    // bench player from the game entirely — filtered off the bench, never
    // placed at the vacated slot — leaving the position empty. A coach tapping
    // fielder-then-bench-kid means "trade places", exactly like the
    // bench-then-fielder direction already did.
    const a = { id: "a", name: "A", number: "1" };
    const b = { id: "b", name: "B", number: "2" };
    const lineup = [{ P: a, BENCH: [b] }] as any;
    const next = applyLineupSwap(lineup, {
      innIdx: 0,
      sPos: "P",
      sPlayer: a,
      tPos: "BENCH",
      tPlayer: b,
      carryForward: false,
    });
    expect((next[0].P as any)?.id).toBe("b");
    expect((next[0].BENCH as any[]).map((p) => p.id)).toEqual(["a"]);
  });
});

// The batting order's drag-and-drop: a MOVE, not the arrows' neighbor swap.
describe("moveBatterTo (drag a batter to a new slot)", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("slides everyone between the two slots along, dragging up", () => {
    // The 5-hole hitter dragged to leadoff pushes the rest down one slot —
    // nobody is banished to the bottom of the order.
    expect(moveBatterTo(order, 4, 0)).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("slides everyone along dragging down too", () => {
    expect(moveBatterTo(order, 0, 3)).toEqual(["b", "c", "d", "a", "e"]);
  });

  it("moves a batter one slot without swapping the neighbor past them", () => {
    expect(moveBatterTo(order, 1, 2)).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("returns the same array for a drag that ends where it started", () => {
    expect(moveBatterTo(order, 2, 2)).toBe(order);
  });

  it("returns the same array for out-of-range or non-integer slots", () => {
    expect(moveBatterTo(order, -1, 2)).toBe(order);
    expect(moveBatterTo(order, 2, 99)).toBe(order);
    expect(moveBatterTo(order, 2, NaN)).toBe(order);
    expect(moveBatterTo([], 0, 1)).toEqual([]);
  });

  it("never mutates the order it was given", () => {
    const copy = [...order];
    moveBatterTo(order, 0, 4);
    expect(order).toEqual(copy);
  });
});
