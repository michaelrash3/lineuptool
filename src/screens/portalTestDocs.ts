// Test helper for the parent-form portals (not shipped: only tests import
// it). Makes a mocked firebase/firestore `getDoc` answer the way the real
// lookup is laid out: portalLinks/{slug} → { teamId }, then the team's
// mirror at teamPublic/{teamId}. The test files mock `doc()` to return
// { __path: "artifacts/app/public/data/…" }.
type MockFn = { mockImplementation: (fn: (ref: any) => unknown) => unknown };
type Mirror = { id: string; data: () => Record<string, unknown> };

const base = "artifacts/app/public/data";

// The docs a working link resolves through.
export const portalDocs = (
  mirror: Mirror,
  slug = "abc",
): Record<string, unknown> => ({
  [`${base}/portalLinks/${slug}`]: { teamId: mirror.id },
  [`${base}/teamPublic/${mirror.id}`]: mirror.data(),
});

export const schedulePath = (slug = "abc") => `${base}/portalSchedules/${slug}`;

// Answer every getDoc from `docs` (path → data; anything absent is a missing
// doc). `fromCache` marks the answers as coming from the browser's offline
// cache — what weak signal looks like.
export const answerGetDoc = (
  getDoc: MockFn,
  docs: Record<string, unknown>,
  { fromCache = false } = {},
) =>
  getDoc.mockImplementation((ref: { __path?: string }) => {
    const data = docs[String(ref?.__path || "")] ?? null;
    return Promise.resolve({
      exists: () => data != null,
      data: () => data,
      metadata: { fromCache },
    });
  });
