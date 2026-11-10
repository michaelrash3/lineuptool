import { describe, it, expect } from "vitest";
import { withMapKeyDeletes } from "./mapKeyDeletes";

const DEL = { __delete: true };
const del = () => DEL;

describe("withMapKeyDeletes", () => {
  it("turns a removed key into a delete (Depth Chart reset)", () => {
    const prev = { SS: ["a", "b"], CF: ["c"] };
    const next = { CF: ["c"] };
    expect(withMapKeyDeletes(prev, next, del)).toEqual({ CF: ["c"], SS: DEL });
  });

  it("clears a whole map written as {}", () => {
    expect(withMapKeyDeletes({ mvp: "p1", hustle: "p2" }, {}, del)).toEqual({
      mvp: DEL,
      hustle: DEL,
    });
  });

  it("returns the same object when nothing was removed", () => {
    const next = { SS: ["a"], CF: ["c"] };
    expect(withMapKeyDeletes({ SS: ["b"] }, next, del)).toBe(next);
  });

  it("descends into nested maps when asked (unhide keeps the rename)", () => {
    const prev = {
      contact: { label: "Bat", hidden: true },
      speed: { hidden: true },
    };
    const next = { contact: { label: "Bat" } };
    expect(withMapKeyDeletes(prev, next, del, 2)).toEqual({
      contact: { label: "Bat", hidden: DEL },
      speed: DEL,
    });
  });

  it("leaves arrays and missing/primitive values alone", () => {
    expect(withMapKeyDeletes(["a"], ["b"], del)).toEqual(["b"]);
    expect(withMapKeyDeletes(undefined, { a: 1 }, del)).toEqual({ a: 1 });
    expect(withMapKeyDeletes({ a: 1 }, null, del)).toBe(null);
  });
});
