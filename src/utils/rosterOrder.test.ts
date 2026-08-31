import { describe, it, expect } from "vitest";
import {
  byJerseyNumber,
  rosterDisplayOrder,
  rosterNeighbors,
} from "./rosterOrder";

const p = (over: any) => ({ id: over.id, name: "Kid", ...over });

describe("rosterDisplayOrder", () => {
  it("orders numbered players ascending, numerically not lexically", () => {
    const list = [p({ id: "c", number: "10" }), p({ id: "a", number: "2" })];
    expect(rosterDisplayOrder(list).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("puts unnumbered players last, alphabetically among themselves", () => {
    const list = [
      p({ id: "zed", name: "Zed" }),
      p({ id: "num", number: "9", name: "Numbered" }),
      p({ id: "abe", name: "Abe" }),
    ];
    expect(rosterDisplayOrder(list).map((x) => x.id)).toEqual([
      "num",
      "abe",
      "zed",
    ]);
  });

  it("sorts departed players to the end, matching the Roster tab's sections", () => {
    const list = [
      p({ id: "gone", number: "1", rosterStatus: "departed" }),
      p({ id: "here", number: "50" }),
    ];
    expect(rosterDisplayOrder(list).map((x) => x.id)).toEqual(["here", "gone"]);
  });

  it("excludes tournament subs — they are not roster", () => {
    const list = [
      p({ id: "kid", number: "1" }),
      p({ id: "sub", number: "2", isSub: true, subTournamentIds: ["t1"] }),
    ];
    expect(rosterDisplayOrder(list).map((x) => x.id)).toEqual(["kid"]);
  });

  it("drops entries with no id rather than paging into them", () => {
    const list = [p({ id: "ok", number: "1" }), { name: "Ghost" } as any];
    expect(rosterDisplayOrder(list)).toHaveLength(1);
  });

  it("does not mutate the input array", () => {
    const list = [p({ id: "b", number: "9" }), p({ id: "a", number: "1" })];
    rosterDisplayOrder(list);
    expect(list.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("handles null and empty input", () => {
    expect(rosterDisplayOrder(null)).toEqual([]);
    expect(rosterDisplayOrder([])).toEqual([]);
  });
});

describe("byJerseyNumber", () => {
  it("treats a missing number the same as an unparseable one", () => {
    const noNumber = p({ id: "x", name: "Ann" });
    const blank = p({ id: "y", number: "", name: "Bob" });
    expect(byJerseyNumber(noNumber, blank)).toBeLessThan(0);
  });
});

describe("rosterNeighbors", () => {
  const list = [
    p({ id: "a", number: "1" }),
    p({ id: "b", number: "2" }),
    p({ id: "c", number: "3" }),
  ];

  it("returns the players either side, with a 1-based position", () => {
    const mid = rosterNeighbors(list, "b");
    expect(mid.prev?.id).toBe("a");
    expect(mid.next?.id).toBe("c");
    expect(mid.position).toBe(2);
    expect(mid.total).toBe(3);
  });

  it("does not wrap at either end", () => {
    expect(rosterNeighbors(list, "a").prev).toBeNull();
    expect(rosterNeighbors(list, "a").next?.id).toBe("b");
    expect(rosterNeighbors(list, "c").next).toBeNull();
    expect(rosterNeighbors(list, "c").prev?.id).toBe("b");
  });

  it("reports position 0 for someone not in the sequence", () => {
    // A tournament sub is on team.players but never in the roster order.
    const withSub = [...list, p({ id: "s1", isSub: true })];
    const off = rosterNeighbors(withSub, "s1");
    expect(off).toMatchObject({ prev: null, next: null, position: 0 });
    // The sub is not counted in the total either.
    expect(off.total).toBe(3);
  });

  it("reports position 0 for an id that no longer resolves", () => {
    expect(rosterNeighbors(list, "deleted").position).toBe(0);
    expect(rosterNeighbors(list, null).position).toBe(0);
  });

  it("neighbours follow display order, not array order", () => {
    const shuffled = [
      p({ id: "c", number: "3" }),
      p({ id: "a", number: "1" }),
      p({ id: "b", number: "2" }),
    ];
    expect(rosterNeighbors(shuffled, "b").prev?.id).toBe("a");
    expect(rosterNeighbors(shuffled, "b").next?.id).toBe("c");
  });

  it("crosses from the last active player into the departed section", () => {
    const withDeparted = [
      ...list,
      p({ id: "gone", number: "0", rosterStatus: "departed" }),
    ];
    expect(rosterNeighbors(withDeparted, "c").next?.id).toBe("gone");
    expect(rosterNeighbors(withDeparted, "gone").next).toBeNull();
  });
});
