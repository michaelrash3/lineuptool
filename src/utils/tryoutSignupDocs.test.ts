import { vi } from "vitest";
import { setDoc } from "firebase/firestore";
import {
  assembleSignups,
  allLegacyMigrated,
  backfillSignupDocs,
} from "./tryoutSignupDocs";
import type { TryoutSignup } from "../types";

// The pure halves of the Phase 1 signup migration (union/precedence/sort and
// the drop's coverage check) plus the backfill's skip-existing guard.
// Firestore is mocked; refs encode their path so assertions can tell which
// doc a write targeted.
vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({
    path: path.join("/"),
  })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteField: vi.fn(() => ({ __deleteField: true })),
}));

const mockSetDoc = setDoc as unknown as ReturnType<typeof vi.fn>;

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
  mockSetDoc.mockClear();
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
    await backfillSignupDocs(
      {} as never,
      "app",
      "team1",
      "tryoutSignups",
      [{ id: "" } as TryoutSignup],
      new Set(),
    );
    await backfillSignupDocs(
      {} as never,
      "app",
      "team1",
      "tryoutSignups",
      null,
      new Set(),
    );
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("resolves despite per-entry write failures (best-effort; next session retries)", async () => {
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
    ).resolves.toBeUndefined();
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });
});
