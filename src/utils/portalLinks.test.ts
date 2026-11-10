import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDoc, getDocs } from "firebase/firestore";
import { resolvePortalTeam } from "./portalLinks";

vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));
const mockGetDoc = getDoc as unknown as ReturnType<typeof vi.fn>;
const mockGetDocs = getDocs as unknown as ReturnType<typeof vi.fn>;

const docSnap = (data: any, fromCache = false) => ({
  exists: () => data != null,
  data: () => data,
  metadata: { fromCache },
});
const db = {} as any;

beforeEach(() => {
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
});

describe("resolvePortalTeam", () => {
  it("uses the owned link doc and never consults the listable query", async () => {
    mockGetDoc
      .mockResolvedValueOnce(docSnap({ teamId: "team-1" }))
      .mockResolvedValueOnce(docSnap({ name: "Hawks", tryoutShareId: "abc" }));
    // A look-alike team publishing the same share id would come back from
    // the query — it must never be asked.
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [{ id: "evil", data: () => ({ tryoutShareId: "abc" }) }],
    });
    expect(await resolvePortalTeam(db, "app", "abc")).toEqual({
      status: "found",
      teamId: "team-1",
      data: { name: "Hawks", tryoutShareId: "abc" },
    });
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockGetDoc.mock.calls[1][0].path).toBe(
      "artifacts/app/public/data/teamPublic/team-1",
    );
  });

  it("a rotated-out link stays dead even though its link doc remains", async () => {
    mockGetDoc
      .mockResolvedValueOnce(docSnap({ teamId: "team-1" }))
      .mockResolvedValueOnce(docSnap({ tryoutShareId: "new-id" }));
    expect(await resolvePortalTeam(db, "app", "abc")).toEqual({
      status: "not-found",
    });
  });

  it("falls back to the mirror query for a team with no link doc yet", async () => {
    mockGetDoc.mockResolvedValueOnce(docSnap(null));
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "team-2", data: () => ({ tryoutShareId: "xyz" }) }],
      metadata: { fromCache: false },
    });
    expect(await resolvePortalTeam(db, "app", "xyz")).toMatchObject({
      status: "found",
      teamId: "team-2",
    });
  });

  it("reads 'offline' when nothing was found and the answer came from cache", async () => {
    mockGetDoc.mockResolvedValueOnce(docSnap(null, true));
    mockGetDocs.mockResolvedValueOnce({
      empty: true,
      docs: [],
      metadata: { fromCache: true },
    });
    expect(await resolvePortalTeam(db, "app", "xyz")).toEqual({
      status: "offline",
    });
  });

  it("reads 'not-found' when the server says there's no such link", async () => {
    mockGetDoc.mockResolvedValueOnce(docSnap(null));
    mockGetDocs.mockResolvedValueOnce({
      empty: true,
      docs: [],
      metadata: { fromCache: false },
    });
    expect(await resolvePortalTeam(db, "app", "nope")).toEqual({
      status: "not-found",
    });
  });
});
