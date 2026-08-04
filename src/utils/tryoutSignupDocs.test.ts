import { vi } from "vitest";
import { getDocs, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import {
  assembleSignups,
  allLegacyMigrated,
  backfillSignupDocs,
  deleteAllSignupDocs,
  dropLegacySignupArray,
  dropLegacySignupArrays,
  findLegacySignupEntries,
  removeLegacySignupEntries,
} from "./tryoutSignupDocs";
import type { TryoutSignup } from "../types";

// The pure halves of the Phase 1 signup migration (union/precedence/sort and
// the drop's coverage check), the backfill's skip-existing guard, and the two
// destructive writes: the legacy-array cleanup and the irreversible field
// drop. Firestore is mocked; refs encode their path so assertions can tell
// which doc a write targeted.
vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({
    path: path.join("/"),
  })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteField: vi.fn(() => ({ __deleteField: true })),
  // Sentinels, not values: assertions compare the payload shape, and the
  // variadic capture is what proves a bulk remove is ONE write.
  arrayRemove: vi.fn((...values: unknown[]) => ({ __arrayRemove: values })),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  writeBatch: vi.fn(() => ({
    delete: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  })),
}));

const mockSetDoc = setDoc as unknown as ReturnType<typeof vi.fn>;
const mockUpdateDoc = updateDoc as unknown as ReturnType<typeof vi.fn>;
const mockGetDocs = getDocs as unknown as ReturnType<typeof vi.fn>;
const mockWriteBatch = writeBatch as unknown as ReturnType<typeof vi.fn>;
const TEAM_PATH = "artifacts/app/public/data/teams/team1";

const entry = (
  id: string,
  submittedAt: string,
  over: Partial<TryoutSignup> = {},
): TryoutSignup => ({
  id,
  submittedAt,
  firstName: "Kid",
  lastName: id.toUpperCase(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockUpdateDoc.mockResolvedValue(undefined);
  // clearAllMocks wipes recorded calls but NOT implementations: without this a
  // test that made setDoc reject would leak that into every test after it.
  mockSetDoc.mockResolvedValue(undefined);
});

describe("assembleSignups", () => {
  it("unions subcollection docs with unmigrated legacy entries, newest first", () => {
    const docs = [
      { id: "b", data: entry("b", "2026-03-02T10:00:00.000Z") },
      { id: "a", data: entry("a", "2026-03-01T10:00:00.000Z") },
    ];
    const legacy = [entry("c", "2026-03-03T10:00:00.000Z")];
    const out = assembleSignups(docs, legacy);
    expect(out.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("treats the doc id as authoritative over a stale `id` in the doc data", () => {
    const docs = [
      {
        id: "a",
        // A doc whose stored data still carries a divergent `id` field: the
        // STREAMED doc id must win, and the legacy twin keyed by that doc id
        // must still be shadowed.
        data: {
          ...entry("stale", "2026-03-01T10:00:00.000Z"),
          status: "tryout",
        },
      },
    ];
    const legacy = [
      entry("a", "2026-03-01T10:00:00.000Z", { firstName: "StaleLegacy" }),
    ];
    const out = assembleSignups(docs, legacy);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].firstName).toBe("Kid"); // from the doc, not the legacy twin
  });

  it("drops a legacy entry whose id already exists as a subcollection doc", () => {
    const docs = [
      {
        id: "a",
        data: entry("a", "2026-03-01T10:00:00.000Z", { firstName: "Edited" }),
      },
    ];
    const legacy = [
      entry("a", "2026-03-01T10:00:00.000Z", { firstName: "StaleLegacy" }),
      entry("z", "2026-02-01T10:00:00.000Z"),
    ];
    const out = assembleSignups(docs, legacy);
    expect(out.map((s) => s.id)).toEqual(["a", "z"]);
    expect(out[0].firstName).toBe("Edited");
  });

  it("sorts same-instant entries by id so re-assembly is stable across input order", () => {
    const t = "2026-03-01T10:00:00.000Z";
    const docs = [
      { id: "b", data: entry("b", t) },
      { id: "a", data: entry("a", t) },
    ];
    const forward = assembleSignups(docs, [entry("c", t)]);
    const reversed = assembleSignups([...docs].reverse(), [entry("c", t)]);
    expect(forward.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(reversed.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("sinks entries without a submittedAt stamp to the end", () => {
    const out = assembleSignups(
      [{ id: "nostamp", data: { id: "nostamp", firstName: "X" } }],
      [entry("a", "2026-03-01T10:00:00.000Z")],
    );
    expect(out.map((s) => s.id)).toEqual(["a", "nostamp"]);
  });

  it("keeps an id-less legacy entry — nothing can shadow it, and dropping it would lose a signup", () => {
    const out = assembleSignups(
      [{ id: "a", data: entry("a", "2026-03-01T10:00:00.000Z") }],
      [{ submittedAt: "2026-03-02T10:00:00.000Z" } as TryoutSignup],
    );
    expect(out).toHaveLength(2);
    expect(out[0].submittedAt).toBe("2026-03-02T10:00:00.000Z");
  });

  it("tolerates null/undefined inputs", () => {
    expect(assembleSignups(null, null)).toEqual([]);
    expect(assembleSignups(undefined, undefined)).toEqual([]);
  });
});

describe("allLegacyMigrated", () => {
  it("is false for an empty legacy array even when subdocs exist (a failed/empty read must never trigger the drop)", () => {
    expect(allLegacyMigrated([], ["a", "b"])).toBe(false);
    expect(allLegacyMigrated(null, ["a"])).toBe(false);
    expect(allLegacyMigrated(undefined, [])).toBe(false);
  });

  it("is false while any legacy entry is missing from the subcollection", () => {
    const legacy = [entry("a", "t"), entry("b", "t")];
    expect(allLegacyMigrated(legacy, ["a"])).toBe(false);
    expect(allLegacyMigrated(legacy, [])).toBe(false);
    expect(allLegacyMigrated(legacy, null)).toBe(false);
  });

  it("is true once every id-bearing legacy entry has a subcollection doc", () => {
    const legacy = [entry("a", "t"), entry("b", "t")];
    expect(allLegacyMigrated(legacy, ["a", "b", "extra"])).toBe(true);
    // Malformed id-less entries are ignored, matching evalRounds semantics.
    expect(
      allLegacyMigrated([...legacy, { id: "" } as TryoutSignup], ["a", "b"]),
    ).toBe(true);
  });
});

describe("backfillSignupDocs", () => {
  it("writes only legacy entries not already present as subdocs", async () => {
    const legacy = [
      entry("kept", "t", { firstName: "AlreadyMigrated" }),
      entry("new1", "t"),
      entry("new2", "t"),
    ];
    await backfillSignupDocs(
      {} as never,
      "app",
      "team1",
      "tryoutSignups",
      legacy,
      new Set(["kept"]),
    );
    const paths = mockSetDoc.mock.calls.map((c) => c[0].path);
    expect(paths).toEqual([
      "artifacts/app/public/data/teams/team1/tryoutSignups/new1",
      "artifacts/app/public/data/teams/team1/tryoutSignups/new2",
    ]);
    // Never overwrite an existing subdoc — a coach may have edited it, and the
    // legacy copy is stale by definition once the doc exists.
    expect(paths).not.toContain(
      "artifacts/app/public/data/teams/team1/tryoutSignups/kept",
    );
  });

  it("writes the full entry with undefined fields scrubbed (setDoc rejects undefined)", async () => {
    const legacy = [entry("a", "t", { notes: undefined, status: "tryout" })];
    await backfillSignupDocs(
      {} as never,
      "app",
      "team1",
      "interestSignups",
      legacy,
      new Set(),
    );
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const payload = mockSetDoc.mock.calls[0][1];
    expect(payload).toEqual({
      id: "a",
      submittedAt: "t",
      firstName: "Kid",
      lastName: "A",
      status: "tryout",
    });
    expect("notes" in payload).toBe(false);
  });

  it("skips id-less entries and is a no-op for an empty/missing legacy array", async () => {
    const skipped = await backfillSignupDocs(
      {} as never,
      "app",
      "team1",
      "tryoutSignups",
      [{ id: "" } as TryoutSignup],
      new Set(),
    );
    const missing = await backfillSignupDocs(
      {} as never,
      "app",
      "team1",
      "tryoutSignups",
      null,
      new Set(),
    );
    expect(mockSetDoc).not.toHaveBeenCalled();
    // Nothing pending is a SUCCESS with no work, not a failure — the caller
    // reads failed === 0 as "this team is fully mirrored, never run again".
    expect(skipped).toEqual({ written: 0, failed: 0, writtenIds: [] });
    expect(missing).toEqual({ written: 0, failed: 0, writtenIds: [] });
  });

  // Contract change (see backfillSignupDocs): this used to resolve `void`
  // whether every write landed or every write was denied, so the caller could
  // not tell a finished migration from a wholly failed one — and it consumes a
  // once-per-session guard on the strength of that answer. It now reports both
  // halves, still without rejecting, so the fire-and-forget call site stays
  // safe and a partial failure keeps its progress count.
  it("reports per-entry write failures instead of swallowing them", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("denied"));
    await expect(
      backfillSignupDocs(
        {} as never,
        "app",
        "team1",
        "tryoutSignups",
        [entry("a", "t"), entry("b", "t")],
        new Set(),
      ),
    ).resolves.toEqual({ written: 1, failed: 1, writtenIds: ["b"] });
    // A rejection on one entry never cancels its siblings.
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });

  it("reports a wholly denied pass as written 0 — the case that was invisible", async () => {
    mockSetDoc.mockRejectedValue(new Error("permission-denied"));
    await expect(
      backfillSignupDocs(
        {} as never,
        "app",
        "team1",
        "interestSignups",
        [entry("a", "t"), entry("b", "t"), entry("c", "t")],
        new Set(),
      ),
    ).resolves.toEqual({ written: 0, failed: 3, writtenIds: [] });
  });

  // Firestore validates EAGERLY: an invalid path segment throws out of
  // signupDocRef, and invalid data throws out of setDoc — neither rejects.
  // Before this was handled, such a throw escaped the per-entry catch entirely:
  // an unhandled rejection, no tally, so the caller consumed no attempt,
  // scheduled no retry and logged no give-up. A silent single-attempt stall —
  // the exact failure this function was rewritten to end, on a different
  // trigger.
  it("counts a SYNCHRONOUS throw as a failure, not an escape", async () => {
    mockSetDoc.mockImplementationOnce(() => {
      throw new Error("Function setDoc() called with invalid data");
    });
    await expect(
      backfillSignupDocs(
        {} as never,
        "app",
        "team1",
        "tryoutSignups",
        [entry("a", "t"), entry("b", "t")],
        new Set(),
      ),
    ).resolves.toEqual({ written: 1, failed: 1, writtenIds: ["b"] });
  });

  it("counts a clean pass", async () => {
    await expect(
      backfillSignupDocs(
        {} as never,
        "app",
        "team1",
        "tryoutSignups",
        [entry("a", "t"), entry("b", "t")],
        new Set(["a"]),
      ),
    ).resolves.toEqual({ written: 1, failed: 0, writtenIds: ["b"] });
  });
});

describe("findLegacySignupEntries", () => {
  it("returns the EXACT stored objects, not copies — arrayRemove matches by value", () => {
    const stored = entry("a", "t", { firstName: "PreEdit" });
    const out = findLegacySignupEntries([stored, entry("b", "t")], ["a"]);
    expect(out).toHaveLength(1);
    // Identity, not deep equality: a reconstructed entry would silently fail
    // to match the element Firestore has stored.
    expect(out[0]).toBe(stored);
  });

  it("matches every requested id, ignores unknown ids, and tolerates junk input", () => {
    const legacy = [entry("a", "t"), entry("b", "t"), entry("c", "t")];
    expect(
      findLegacySignupEntries(legacy, ["c", "a", "ghost"]).map((e) => e.id),
    ).toEqual(["a", "c"]); // array order, not requested order
    expect(findLegacySignupEntries(legacy, [])).toEqual([]);
    expect(findLegacySignupEntries(null, ["a"])).toEqual([]);
    expect(findLegacySignupEntries([{ id: "" } as TryoutSignup], [""])).toEqual(
      [],
    );
  });
});

describe("removeLegacySignupEntries", () => {
  it("arrayRemoves the exact entries from the team doc in ONE write", async () => {
    const a = entry("a", "t", { firstName: "PreEdit" });
    const b = entry("b", "t");
    await removeLegacySignupEntries(
      {} as never,
      "app",
      "team1",
      "tryoutSignups",
      [a, b],
    );
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = mockUpdateDoc.mock.calls[0];
    // The TEAM doc, not a subcollection doc — this is the legacy array's home.
    expect(ref.path).toBe(TEAM_PATH);
    // Variadic arrayRemove: a bulk delete's legacy cleanup is a single
    // value-level op, never a whole-array rewrite.
    expect(payload).toEqual({ tryoutSignups: { __arrayRemove: [a, b] } });
    expect(payload.tryoutSignups.__arrayRemove[0]).toBe(a);
  });

  it("writes under the interest key when asked", async () => {
    const lead = entry("i1", "t");
    await removeLegacySignupEntries(
      {} as never,
      "app",
      "team1",
      "interestSignups",
      [lead],
    );
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({
      interestSignups: { __arrayRemove: [lead] },
    });
  });

  it("is a no-op with NO write when the entry isn't legacy-resident", async () => {
    await expect(
      removeLegacySignupEntries(
        {} as never,
        "app",
        "team1",
        "tryoutSignups",
        [],
      ),
    ).resolves.toBeUndefined();
    await expect(
      removeLegacySignupEntries(
        {} as never,
        "app",
        "team1",
        "tryoutSignups",
        null,
      ),
    ).resolves.toBeUndefined();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("propagates a rejection so the caller can toast", async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(
      removeLegacySignupEntries({} as never, "app", "team1", "tryoutSignups", [
        entry("a", "t"),
      ]),
    ).rejects.toThrow("permission-denied");
  });
});

describe("dropLegacySignupArrays", () => {
  // The one IRREVERSIBLE write in the migration — TeamProvider fires it only
  // once coverage is proven, so its payload and target have to be exact.
  it("deletes EVERY legacy array field from the team doc in ONE write", async () => {
    await dropLegacySignupArrays({} as never, "app", "team1");
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = mockUpdateDoc.mock.calls[0];
    expect(ref.path).toBe(TEAM_PATH);
    expect(payload).toEqual({
      tryoutSignups: { __deleteField: true },
      interestSignups: { __deleteField: true },
      playerInfoSubmissions: { __deleteField: true },
      availabilitySubmissions: { __deleteField: true },
      games: { __deleteField: true },
    });
    // Every key in the SAME update: one collection being long gone (or a team
    // an earlier phase's drop already reached) must never block dropping the
    // others, and separate writes could half-apply.
    expect(Object.keys(payload)).toHaveLength(5);
  });

  it("REJECTS on failure so the caller can clear its once-guard and retry", async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(
      dropLegacySignupArrays({} as never, "app", "team1"),
    ).rejects.toThrow("permission-denied");
  });
});

describe("dropLegacySignupArray (single lane)", () => {
  // Season advance clears the tryout lane and must leave standing interest
  // leads alone, so the drop it uses is scoped to one key.
  it("deletes ONLY the named legacy array field, by deleteField", async () => {
    await dropLegacySignupArray({} as never, "app", "team1", "tryoutSignups");
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = mockUpdateDoc.mock.calls[0];
    expect(ref.path).toBe(TEAM_PATH);
    // deleteField, never `[]`: an empty array leaves the key PRESENT on the
    // doc, which recreates the exact field Phase 1 removes and is what an
    // evaluationEvents-shaped rules ratchet rejects.
    expect(payload).toEqual({ tryoutSignups: { __deleteField: true } });
    expect(Object.keys(payload)).toEqual(["tryoutSignups"]);
  });

  it("targets the interest lane when asked for it", async () => {
    await dropLegacySignupArray({} as never, "app", "team1", "interestSignups");
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({
      interestSignups: { __deleteField: true },
    });
  });

  it("REJECTS on failure so the caller can report a partial reset", async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(
      dropLegacySignupArray({} as never, "app", "team1", "tryoutSignups"),
    ).rejects.toThrow("permission-denied");
  });
});

describe("deleteAllSignupDocs", () => {
  const snapshotOf = (...ids: string[]) => ({
    docs: ids.map((id) => ({
      ref: { path: `${TEAM_PATH}/tryoutSignups/${id}` },
    })),
  });

  it("reads the collection and batch-deletes every doc", async () => {
    mockGetDocs.mockResolvedValueOnce(snapshotOf("a", "b"));
    const count = await deleteAllSignupDocs(
      {} as never,
      "app",
      "team1",
      "tryoutSignups",
    );
    expect(count).toBe(2);
    expect(mockGetDocs.mock.calls[0][0].path).toBe(
      `${TEAM_PATH}/tryoutSignups`,
    );
    const batch = mockWriteBatch.mock.results[0].value;
    expect(
      batch.delete.mock.calls.map(([ref]: [{ path: string }]) =>
        ref.path.split("/").pop(),
      ),
    ).toEqual(["a", "b"]);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it("chunks past the 500-op batch ceiling", async () => {
    const ids = Array.from({ length: 401 }, (_, i) => `s${i}`);
    mockGetDocs.mockResolvedValueOnce(snapshotOf(...ids));
    await deleteAllSignupDocs({} as never, "app", "team1", "interestSignups");
    expect(mockWriteBatch).toHaveBeenCalledTimes(2);
    const [first, second] = mockWriteBatch.mock.results.map((r) => r.value);
    expect(first.delete).toHaveBeenCalledTimes(400);
    expect(second.delete).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for an empty collection", async () => {
    mockGetDocs.mockResolvedValueOnce(snapshotOf());
    await expect(
      deleteAllSignupDocs({} as never, "app", "team1", "tryoutSignups"),
    ).resolves.toBe(0);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it("REJECTS so the caller can warn about orphaned family PII", async () => {
    mockGetDocs.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(
      deleteAllSignupDocs({} as never, "app", "team1", "tryoutSignups"),
    ).rejects.toThrow("permission-denied");
  });
});
