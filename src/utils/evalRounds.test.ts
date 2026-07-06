import { describe, it, expect, vi } from "vitest";

// Stub the firestore query primitives so we can assert the role-scoping
// decision without a real Firestore. Type-only imports (Firestore, Query,
// DocumentData) are erased at compile time, so the mock needn't provide them.
vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db, ...path: string[]) => ({ __col: path.join("/") })),
  query: vi.fn((col, ...constraints) => ({ __query: col, constraints })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
}));

import { buildEvalRoundsQuery, assembleEvalRounds } from "./evalRounds";
import { collection, query, where } from "firebase/firestore";

describe("buildEvalRoundsQuery", () => {
  const db = {} as never;

  it("targets the team's evalRounds subcollection", () => {
    buildEvalRoundsQuery(db, "app1", "team1", "head", "u1");
    expect(collection).toHaveBeenCalledWith(
      db,
      "artifacts",
      "app1",
      "public",
      "data",
      "teams",
      "team1",
      "evalRounds",
    );
  });

  it("does NOT filter for a head coach — reads every round", () => {
    (where as unknown as { mockClear: () => void }).mockClear();
    buildEvalRoundsQuery(db, "app1", "team1", "head", "u1");
    expect(where).not.toHaveBeenCalled();
  });

  it("filters an assistant to their own rounds (the rules require it)", () => {
    buildEvalRoundsQuery(db, "app1", "team1", "assistant", "asst-1");
    expect(where).toHaveBeenCalledWith("evaluatorId", "==", "asst-1");
  });
});

describe("assembleEvalRounds", () => {
  it("maps docs to id + data, newest round first", () => {
    const out = assembleEvalRounds([
      {
        id: "r-old",
        data: { date: "2026-01-01", coachRole: "Head", grades: {} },
      },
      {
        id: "r-new",
        data: { date: "2026-06-01", coachRole: "Head", grades: {} },
      },
    ]);
    expect(out.map((r) => r.id)).toEqual(["r-new", "r-old"]);
    expect(out[0]).toMatchObject({ coachRole: "Head", date: "2026-06-01" });
  });

  it("uses the doc id as the round id, overriding any stale id in the data", () => {
    const [round] = assembleEvalRounds([
      { id: "real-id", data: { id: "stale-id", date: "2026-06-01" } },
    ]);
    expect(round.id).toBe("real-id");
  });

  it("returns [] for empty or missing input", () => {
    expect(assembleEvalRounds([])).toEqual([]);
    expect(assembleEvalRounds(null)).toEqual([]);
    expect(assembleEvalRounds(undefined)).toEqual([]);
  });
});
