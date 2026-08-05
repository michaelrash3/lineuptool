import {
  assembleGames,
  diffEntityArrays,
  gameUnionOrder,
  stableStringify,
} from "./teamEntityDocs";

describe("stableStringify", () => {
  it("is key-order-insensitive, recursively", () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      stableStringify({ b: { d: [1, 2], c: 2 }, a: 1 }),
    );
  });

  it("distinguishes genuinely different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify(null)).not.toBe(stableStringify({}));
  });

  it("drops undefined-valued keys, matching scrubUndefined's stored shape", () => {
    // A locally built entry with `lineup: undefined` must compare equal to
    // its stored twin where the key is simply absent — otherwise every
    // assembly re-diff would rewrite every doc.
    expect(stableStringify({ id: "g1", lineup: undefined })).toBe(
      stableStringify({ id: "g1" }),
    );
  });
});

describe("diffEntityArrays", () => {
  const g1 = { id: "g1", opponent: "Sharks", teamScore: null };
  const g2 = { id: "g2", opponent: "Comets", teamScore: 4 };

  it("returns no writes when nothing changed — even across re-built references", () => {
    // Wholesale undo restores rebuild every object; a reference diff would
    // rewrite every doc.
    const rebuilt = [{ ...g2 }, { ...g1 }]; // order change too
    const diff = diffEntityArrays([g1, g2], rebuilt);
    expect(diff.sets).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("is key-order-insensitive per entry", () => {
    const reordered = [{ teamScore: null, opponent: "Sharks", id: "g1" }];
    expect(diffEntityArrays([g1], reordered).sets).toEqual([]);
  });

  it("sets added and value-changed entries, deletes removed ones", () => {
    const next = [
      { ...g1, teamScore: 7 }, // changed
      { id: "g3", opponent: "New" }, // added
      // g2 removed
    ];
    const diff = diffEntityArrays([g1, g2], next);
    expect(diff.sets.map((e) => e.id).sort()).toEqual(["g1", "g3"]);
    expect(diff.deletes).toEqual(["g2"]);
  });

  it("treats a field cleared by omission as a change (full-entry set carries the clear)", () => {
    // Several writers clear game fields by dropping the key from the rebuilt
    // entry (stripFromGame, stat resets). The diff must see that as a change
    // so the full-entry set overwrites the stored doc without the key.
    const withPlan = { id: "g1", pitchPlan: [{ playerId: "p1" }] };
    const cleared = { id: "g1" };
    const diff = diffEntityArrays([withPlan], [cleared]);
    expect(diff.sets).toEqual([cleared]);
  });

  it("tolerates null/undefined inputs and idless entries", () => {
    expect(diffEntityArrays(null, undefined)).toEqual({
      sets: [],
      deletes: [],
    });
    // An idless entry is unaddressable — ignored rather than crashed on.
    const diff = diffEntityArrays([{ opponent: "??" } as never], [g1]);
    expect(diff.sets).toEqual([g1]);
    expect(diff.deletes).toEqual([]);
  });
});

describe("gameUnionOrder / assembleGames", () => {
  it("orders by date, then start time, then id — deterministically", () => {
    const games = [
      { id: "b", date: "2026-06-08" },
      { id: "a", date: "2026-06-01", startUtc: "2026-06-01T17:00:00Z" },
      { id: "c", date: "2026-06-01", startUtc: "2026-06-01T15:00:00Z" },
      // Same-date game WITHOUT a start time sorts after timed ones.
      { id: "d", date: "2026-06-01" },
    ];
    const sorted = [...games].sort(gameUnionOrder);
    expect(sorted.map((g) => g.id)).toEqual(["c", "a", "d", "b"]);
  });

  it("unions docs + legacy with the doc winning id conflicts", () => {
    const docs = [
      // The coach edited this game — its subdoc carries the final score...
      { id: "g1", data: { date: "2026-06-01", teamScore: 5 } },
      { id: "g3", data: { date: "2026-06-15" } },
    ];
    const legacy = [
      // ...so its stale legacy twin (no score) must NOT resurface.
      { id: "g1", date: "2026-06-01" },
      { id: "g2", date: "2026-06-08" },
    ];
    const union = assembleGames(docs, legacy as never[]) as Array<{
      id: string;
      teamScore?: number;
    }>;
    expect(union.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    expect(union[0].teamScore).toBe(5);
  });

  it("doc id is authoritative over a stale in-data id", () => {
    const union = assembleGames(
      [{ id: "real", data: { id: "stale", date: "2026-06-01" } }],
      [],
    ) as Array<{ id: string }>;
    expect(union[0].id).toBe("real");
  });
});
