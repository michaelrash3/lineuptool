import { describe, it, expect, vi } from "vitest";

// Stub the firestore query primitives so we can assert the role-scoping
// decision without a real Firestore. Type-only imports (Firestore, Query,
// DocumentData) are erased at compile time, so the mock needn't provide them.
vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db, ...path: string[]) => ({ __col: path.join("/") })),
  query: vi.fn((col, ...constraints) => ({ __query: col, constraints })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  doc: vi.fn((_db, ...path: string[]) => ({ __doc: path.join("/") })),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteField: vi.fn(() => ({ __deleteField: true })),
}));

import {
  buildEvalRoundsQuery,
  assembleEvalRounds,
  mirrorEvalRound,
  removeEvalRoundDoc,
  backfillOwnEvalRounds,
  allLegacyRoundsMigrated,
  dropEvalEventsArray,
} from "./evalRounds";
import {
  collection,
  query,
  where,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
} from "firebase/firestore";
import type { EvaluationEvent } from "../types";

const db = {} as never;
const mkRound = (over: Partial<EvaluationEvent> = {}): EvaluationEvent =>
  ({
    id: "r1",
    date: "2026-06-01",
    evaluatorId: "u1",
    coachRole: "Head",
    grades: {},
    ...over,
  }) as EvaluationEvent;

describe("buildEvalRoundsQuery", () => {
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

describe("mirrorEvalRound", () => {
  it("writes the round to its own subcollection doc", async () => {
    (setDoc as unknown as { mockClear: () => void }).mockClear();
    await mirrorEvalRound(db, "app1", "team1", mkRound({ id: "r7" }));
    expect(doc).toHaveBeenCalledWith(
      db,
      "artifacts",
      "app1",
      "public",
      "data",
      "teams",
      "team1",
      "evalRounds",
      "r7",
    );
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect((setDoc as any).mock.calls[0][1]).toMatchObject({
      id: "r7",
      evaluatorId: "u1",
    });
  });

  it("skips a round with no id", async () => {
    (setDoc as unknown as { mockClear: () => void }).mockClear();
    await mirrorEvalRound(db, "app1", "team1", { grades: {} } as never);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("swallows a write failure (best-effort — array stays authoritative)", async () => {
    (
      setDoc as unknown as { mockRejectedValueOnce: (e: unknown) => void }
    ).mockRejectedValueOnce(new Error("denied"));
    await expect(
      mirrorEvalRound(db, "app1", "team1", mkRound()),
    ).resolves.toBeUndefined();
  });
});

describe("removeEvalRoundDoc", () => {
  it("deletes the round's subcollection doc", async () => {
    (deleteDoc as unknown as { mockClear: () => void }).mockClear();
    await removeEvalRoundDoc(db, "app1", "team1", "r9");
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  it("skips when no id is given, and swallows failures", async () => {
    (deleteDoc as unknown as { mockClear: () => void }).mockClear();
    await removeEvalRoundDoc(db, "app1", "team1", "");
    expect(deleteDoc).not.toHaveBeenCalled();
    (
      deleteDoc as unknown as { mockRejectedValueOnce: (e: unknown) => void }
    ).mockRejectedValueOnce(new Error("denied"));
    await expect(
      removeEvalRoundDoc(db, "app1", "team1", "r9"),
    ).resolves.toBeUndefined();
  });
});

describe("backfillOwnEvalRounds", () => {
  it("mirrors ONLY the caller's own rounds and returns the count", async () => {
    (setDoc as unknown as { mockClear: () => void }).mockClear();
    const n = await backfillOwnEvalRounds(
      db,
      "app1",
      "team1",
      [
        mkRound({ id: "mine-1", evaluatorId: "u1" }),
        mkRound({ id: "theirs", evaluatorId: "other" }),
        mkRound({ id: "mine-2", evaluatorId: "u1" }),
      ],
      "u1",
    );
    expect(n).toBe(2);
    expect(setDoc).toHaveBeenCalledTimes(2);
  });

  it("returns 0 for an empty or missing array", async () => {
    expect(await backfillOwnEvalRounds(db, "app1", "team1", [], "u1")).toBe(0);
    expect(await backfillOwnEvalRounds(db, "app1", "team1", null, "u1")).toBe(
      0,
    );
  });
});

describe("allLegacyRoundsMigrated (phase 3b drop gate)", () => {
  it("true only when EVERY legacy round id is in the subcollection", () => {
    const legacy = [mkRound({ id: "a" }), mkRound({ id: "b" })];
    expect(allLegacyRoundsMigrated(legacy, ["a", "b", "extra"])).toBe(true);
    // One round not yet mirrored (e.g. an assistant who hasn't logged in to
    // backfill theirs) → the drop must wait.
    expect(allLegacyRoundsMigrated(legacy, ["a"])).toBe(false);
  });

  it("false for an empty/missing legacy array — an empty or failed read can never trigger a drop", () => {
    expect(allLegacyRoundsMigrated([], ["a", "b"])).toBe(false);
    expect(allLegacyRoundsMigrated(null, ["a"])).toBe(false);
    expect(allLegacyRoundsMigrated(undefined, [])).toBe(false);
  });

  it("ignores malformed legacy entries without an id", () => {
    const legacy = [mkRound({ id: "a" }), { grades: {} } as never];
    expect(allLegacyRoundsMigrated(legacy, ["a"])).toBe(true);
  });
});

describe("dropEvalEventsArray", () => {
  it("deletes the evaluationEvents field on the TEAM doc (not a subcollection doc)", async () => {
    (doc as any).mockClear();
    (updateDoc as any).mockClear();
    await dropEvalEventsArray(db, "app1", "team1");
    expect(doc).toHaveBeenCalledWith(
      db,
      "artifacts",
      "app1",
      "public",
      "data",
      "teams",
      "team1",
    );
    expect(updateDoc).toHaveBeenCalledTimes(1);
    // The payload must be the delete sentinel — never a value write.
    expect((updateDoc as any).mock.calls[0][1]).toEqual({
      evaluationEvents: { __deleteField: true },
    });
  });

  it("REJECTS on failure so the caller can retry next session", async () => {
    (updateDoc as any).mockRejectedValueOnce(new Error("offline"));
    await expect(dropEvalEventsArray(db, "app1", "team1")).rejects.toThrow(
      "offline",
    );
  });
});
