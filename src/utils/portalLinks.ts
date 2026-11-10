// Resolve a parent-form link (its slug = the team's tryoutShareId) to the
// team's sanitized public mirror: the owned link doc portalLinks/{slug} →
// { teamId }, then that team's mirror by id. Both are single-document reads.
// The link doc can only be created by the team's own members for their
// CURRENT share id and is never repointed, so another team can't hijack the
// link by publishing a mirror with the same share id. The mirror's share id
// must still match the slug, so a rotated-out link stays dead.
//
// There is no fallback any more (phase 2 of section 10 in
// docs/firebase-rules-rollout.md): every team's link doc was backfilled, the
// coach app creates one whenever a team gets a share id, and the mirror is
// get-only, so the old "mirror where tryoutShareId == slug" query would be
// denied anyway.
//
// "offline" = nothing found AND the answer came from this browser's cache —
// weak signal, not a dead link.
import { doc, getDoc, type Firestore } from "firebase/firestore";

export type PortalLookup =
  | { status: "found"; teamId: string; data: Record<string, any> }
  | { status: "not-found" }
  | { status: "offline" };

const publicPath = (appId: string) =>
  ["artifacts", appId, "public", "data"] as const;

export const portalLinkRef = (db: Firestore, appId: string, slug: string) =>
  doc(db, ...publicPath(appId), "portalLinks", slug);

export const resolvePortalTeam = async (
  db: Firestore,
  appId: string,
  slug: string,
): Promise<PortalLookup> => {
  const link = await getDoc(portalLinkRef(db, appId, slug));
  let fromCache = !!link.metadata?.fromCache;
  if (link.exists()) {
    const teamId = String((link.data() as any)?.teamId || "");
    if (!teamId) return { status: "not-found" };
    const mirror = await getDoc(
      doc(db, ...publicPath(appId), "teamPublic", teamId),
    );
    fromCache = fromCache || !!mirror.metadata?.fromCache;
    const data = mirror.exists()
      ? (mirror.data() as Record<string, any>)
      : null;
    if (data && data.tryoutShareId === slug)
      return { status: "found", teamId, data };
    return fromCache && !data ? { status: "offline" } : { status: "not-found" };
  }
  return fromCache ? { status: "offline" } : { status: "not-found" };
};
