// Resolve a parent-form link (its slug = the team's tryoutShareId) to the
// team's sanitized public mirror.
//
// 1. The owned link doc portalLinks/{slug} → { teamId }, then that team's
//    mirror by id. Both are single-document reads, and the link doc can only
//    be created by the team's own members for their CURRENT share id and is
//    never repointed — so another team can't hijack the link by publishing a
//    mirror with the same share id. The mirror's share id must still match the
//    slug: a rotated-out link stays dead.
// 2. Fallback for teams whose link doc doesn't exist yet (created by the coach
//    app on open, or by scripts/backfill-portal-links.mjs): the legacy
//    "mirror where tryoutShareId == slug" query. Removed in phase 2 of the
//    rollout (docs/firebase-rules-rollout.md), when the mirror becomes
//    get-only.
//
// "offline" = nothing found AND the answer came from this browser's cache —
// weak signal, not a dead link.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";

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
  let fromCache = false;
  const link = await getDoc(portalLinkRef(db, appId, slug));
  fromCache = fromCache || !!link.metadata?.fromCache;
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
  const snap = await getDocs(
    query(
      collection(db, ...publicPath(appId), "teamPublic"),
      where("tryoutShareId", "==", slug),
    ),
  );
  fromCache = fromCache || !!snap.metadata?.fromCache;
  if (!snap.empty) {
    const d = snap.docs[0];
    return { status: "found", teamId: d.id, data: d.data() as any };
  }
  return fromCache ? { status: "offline" } : { status: "not-found" };
};
