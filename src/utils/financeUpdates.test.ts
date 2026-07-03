import {
  applyFinanceUpdate,
  buildFinancePayload,
  withFinanceKeyDeletes,
  type FinanceFieldOps,
} from "./financeUpdates";
import type { TeamFinances } from "../types";

const baseFinances = (): TeamFinances => ({
  clubFee: 500,
  payments: [{ id: "p1", playerId: "kid1", date: "2026-03-01", amount: 250 }],
  incomes: [{ id: "i1", date: "2026-03-02", label: "Sponsor", amount: 100 }],
  expenses: [{ id: "e1", date: "2026-03-03", label: "Balls", amount: 40 }],
});

// Tagged stub sentinels so payload assertions can check both which op was
// used and what it wrapped.
const ops: FinanceFieldOps = {
  arrayUnion: (v) => ({ __op: "arrayUnion", v }),
  arrayRemove: (v) => ({ __op: "arrayRemove", v }),
  deleteField: () => ({ __op: "deleteField" }),
  scrub: (v) => v,
};

describe("applyFinanceUpdate", () => {
  it("appends to an existing array", () => {
    const next = applyFinanceUpdate(baseFinances(), {
      op: "append",
      key: "payments",
      entry: { id: "p2", playerId: "kid2", date: "2026-03-04", amount: 100 },
    });
    expect(next.payments?.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("appends to an absent array", () => {
    const next = applyFinanceUpdate(
      {},
      {
        op: "append",
        key: "sponsorships",
        entry: { id: "sp1", sponsor: "Pizza Co", amount: 200 },
      },
    );
    expect(next.sponsorships).toHaveLength(1);
  });

  it("removes by id and leaves other arrays untouched", () => {
    const fin = baseFinances();
    const next = applyFinanceUpdate(fin, {
      op: "removeById",
      key: "incomes",
      id: "i1",
    });
    expect(next.incomes).toEqual([]);
    expect(next.payments).toBe(fin.payments);
  });

  it("removeById of a missing id is a content no-op", () => {
    const next = applyFinanceUpdate(baseFinances(), {
      op: "removeById",
      key: "expenses",
      id: "nope",
    });
    expect(next.expenses).toHaveLength(1);
  });

  it("mapEntries rewrites one array from the given items", () => {
    const next = applyFinanceUpdate(baseFinances(), {
      op: "mapEntries",
      key: "payments",
      map: (items) => items.map((p) => ({ ...p, amount: 999 })),
    });
    expect(next.payments?.[0].amount).toBe(999);
  });

  it("set assigns scalars and null deletes the key", () => {
    const next = applyFinanceUpdate(baseFinances(), {
      op: "set",
      fields: { clubFee: 750, nextClubFee: null },
    });
    expect(next.clubFee).toBe(750);
    expect("nextClubFee" in next).toBe(false);
  });
});

describe("buildFinancePayload", () => {
  it("append → dotted-path arrayUnion of the scrubbed entry", () => {
    const entry = { id: "p2", playerId: "kid2", date: "2026-03-04", amount: 5 };
    expect(
      buildFinancePayload(
        baseFinances(),
        { op: "append", key: "payments", entry },
        ops,
      ),
    ).toEqual({ "finances.payments": { __op: "arrayUnion", v: entry } });
  });

  it("removeById → arrayRemove of the EXACT stored entry", () => {
    const fin = baseFinances();
    expect(
      buildFinancePayload(
        fin,
        { op: "removeById", key: "payments", id: "p1" },
        ops,
      ),
    ).toEqual({
      "finances.payments": { __op: "arrayRemove", v: fin.payments?.[0] },
    });
  });

  it("removeById of a missing id resolves to null (successful no-op)", () => {
    expect(
      buildFinancePayload(
        baseFinances(),
        { op: "removeById", key: "payments", id: "ghost" },
        ops,
      ),
    ).toBeNull();
  });

  it("mapEntries → single dotted path replacing that ONE array", () => {
    const payload = buildFinancePayload(
      baseFinances(),
      {
        op: "mapEntries",
        key: "incomes",
        map: (items) => items.map((i) => ({ ...i, amount: 1 })),
      },
      ops,
    );
    expect(Object.keys(payload || {})).toEqual(["finances.incomes"]);
    expect(
      (payload?.["finances.incomes"] as { amount: number }[])[0].amount,
    ).toBe(1);
  });

  it("set → one dotted path per field; null becomes deleteField", () => {
    expect(
      buildFinancePayload(
        baseFinances(),
        { op: "set", fields: { clubFee: 750, nextClubFee: null } },
        ops,
      ),
    ).toEqual({
      "finances.clubFee": 750,
      "finances.nextClubFee": { __op: "deleteField" },
    });
  });

  it("empty set resolves to null", () => {
    expect(
      buildFinancePayload(baseFinances(), { op: "set", fields: {} }, ops),
    ).toBeNull();
  });
});

describe("withFinanceKeyDeletes", () => {
  const del = () => ({ __op: "deleteField" });

  it("converts vanished top-level keys into delete sentinels", () => {
    const prev = { clubFee: 500, nextClubFee: 600, feeExemptIds: ["a"] };
    const next = { clubFee: 500, payments: [] };
    expect(withFinanceKeyDeletes(prev, next, del)).toEqual({
      clubFee: 500,
      payments: [],
      nextClubFee: { __op: "deleteField" },
      feeExemptIds: { __op: "deleteField" },
    });
  });

  it("returns the same reference when nothing vanished", () => {
    const prev = { clubFee: 500 };
    const next = { clubFee: 750, payments: [] };
    expect(withFinanceKeyDeletes(prev, next, del)).toBe(next);
  });

  it("passes through when either side is not a plain object", () => {
    const next = { clubFee: 1 };
    expect(withFinanceKeyDeletes(undefined, next, del)).toBe(next);
    expect(withFinanceKeyDeletes({ a: 1 }, undefined, del)).toBeUndefined();
  });
});
