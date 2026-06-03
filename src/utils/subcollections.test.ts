import { describe, it, expect } from "vitest";
import { mergeSubcollections } from "./subcollections";

describe("mergeSubcollections", () => {
  it("returns the same reference when no active key has subcollection data", () => {
    const team = { players: [{ id: "p1" }], games: [] };
    const out = mergeSubcollections(team, {}, ["players", "games"]);
    expect(out).toBe(team);
  });

  it("unions legacy root-array entries with subcollection docs", () => {
    const team = { tryoutSignups: [{ id: "a" }] };
    const out = mergeSubcollections(
      team,
      { tryoutSignups: [{ id: "b", _sub: "tryoutSignups" }] },
      ["tryoutSignups"]
    );
    expect(out.tryoutSignups).toEqual([
      { id: "a" },
      { id: "b", _sub: "tryoutSignups" },
    ]);
  });

  it("de-duplicates by id, with the subcollection copy winning", () => {
    // Mid-drain: an entry exists both on the root array and in the
    // subcollection. The merged list must show it once (subcollection wins).
    const team = { players: [{ id: "p1", name: "Old" }] };
    const out = mergeSubcollections(
      team,
      { players: [{ id: "p1", name: "New", _sub: "players" }] },
      ["players"]
    );
    expect(out.players).toEqual([{ id: "p1", name: "New", _sub: "players" }]);
  });

  it("only merges collections in activeKeys", () => {
    const team = { games: [{ id: "g1" }], players: [{ id: "p1" }] };
    const out = mergeSubcollections(
      team,
      {
        games: [{ id: "g2", _sub: "games" }],
        players: [{ id: "p2", _sub: "players" }],
      },
      ["games"] // players not yet active
    );
    expect(out.games).toEqual([{ id: "g1" }, { id: "g2", _sub: "games" }]);
    expect(out.players).toEqual([{ id: "p1" }]); // untouched
  });

  it("handles a missing/empty legacy array", () => {
    const team = { name: "T" } as any;
    const out = mergeSubcollections(
      team,
      { games: [{ id: "g1", _sub: "games" }] },
      ["games"]
    );
    expect(out.games).toEqual([{ id: "g1", _sub: "games" }]);
  });
});
