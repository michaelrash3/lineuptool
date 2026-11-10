import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDoc } from "firebase/firestore";
import { resolvePortalTeam } from "./portalLinks";

vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  getDoc: vi.fn(),
}));
const mockGetDoc = getDoc as unknown as ReturnType<typeof vi.fn>;

const docSnap = (data: any, fromCache = false) => ({
  exists: () => data != null,
  data: () => data,
  metadata: { fromCache },
});
const db = {} as any;

beforeEach(() => {
  mockGetDoc.mockReset();
});

describe("resolvePortalTeam", () => {
  it("resolves through the owned link doc, then the mirror by id", async () => {
    mockGetDoc
      .mockResolvedValueOnce(docSnap({ teamId: "team-1" }))
      .mockResolvedValueOnce(docSnap({ name: "Hawks", tryoutShareId: "abc" }));
    expect(await resolvePortalTeam(db, "app", "abc")).toEqual({
      status: "found",
      teamId: "team-1",
      data: { name: "Hawks", tryoutShareId: "abc" },
    });
    expect(mockGetDoc.mock.calls.map((c: any[]) => c[0].path)).toEqual([
      "artifacts/app/public/data/portalLinks/abc",
      "artifacts/app/public/data/teamPublic/team-1",
    ]);
  });

  it("a rotated-out link stays dead even though its link doc remains", async () => {
    mockGetDoc
      .mockResolvedValueOnce(docSnap({ teamId: "team-1" }))
      .mockResolvedValueOnce(docSnap({ tryoutShareId: "new-id" }));
    expect(await resolvePortalTeam(db, "app", "abc")).toEqual({
      status: "not-found",
    });
  });

  it("no link doc means no such link — there is no fallback lookup any more", async () => {
    mockGetDoc.mockResolvedValueOnce(docSnap(null));
    expect(await resolvePortalTeam(db, "app", "xyz")).toEqual({
      status: "not-found",
    });
    // One read: the link doc. Nothing else is consulted.
    expect(mockGetDoc).toHaveBeenCalledTimes(1);
  });

  it("reads 'offline' when no link doc came back from the browser's cache", async () => {
    mockGetDoc.mockResolvedValueOnce(docSnap(null, true));
    expect(await resolvePortalTeam(db, "app", "xyz")).toEqual({
      status: "offline",
    });
  });

  it("reads 'offline' when the link resolved but its mirror only came from cache", async () => {
    mockGetDoc
      .mockResolvedValueOnce(docSnap({ teamId: "team-1" }))
      .mockResolvedValueOnce(docSnap(null, true));
    expect(await resolvePortalTeam(db, "app", "abc")).toEqual({
      status: "offline",
    });
  });

  it("reads 'not-found' when a link doc names no team", async () => {
    mockGetDoc.mockResolvedValueOnce(docSnap({}));
    expect(await resolvePortalTeam(db, "app", "abc")).toEqual({
      status: "not-found",
    });
  });
});
