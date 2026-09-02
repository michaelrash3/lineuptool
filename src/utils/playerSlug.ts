// Human-readable URL segments for players: /roster/marcus-elliott instead of
// /roster/p-rcq7zzwi.
//
// `player.id` stays the identity everywhere else — attendance maps, lineups,
// eval rounds and game docs are all keyed by it, so it is never what changes
// here. Only the address does: a slug is derived from the name for display,
// and resolved back to a player on the way in.
//
// Resolution is deliberately more forgiving than generation, so no link a
// coach has already sent or bookmarked stops working: raw ids still resolve,
// and so does a bare name slug that has since become ambiguous.

// Path segments under /roster that belong to real routes rather than to a
// player. React Router ranks these static segments above /roster/:playerId,
// so a player whose name slugged to one of them would have an unreachable
// page — they get the disambiguated form instead.
const RESERVED_ROSTER_SEGMENTS = new Set(["new", "import"]);

// The loose shape these helpers accept. Team data reaches most call sites as
// `any`, and tests pass minimal literals.
export interface PlayerLike {
  id?: unknown;
  name?: unknown;
  [key: string]: unknown;
}

// "José O'Brien-Smith Jr." -> "jose-o-brien-smith-jr". Accents are folded
// rather than dropped so the name still reads correctly; everything else
// collapses to single dashes.
export const nameSlug = (name: unknown): string =>
  String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// The canonical URL segment for a player: their name when it is unambiguous
// on this roster, otherwise name-plus-id. Falls back to the bare id for a
// player with no sluggable name (a blank entry, or a name that is entirely
// punctuation or non-Latin script), since an empty segment would resolve to
// the roster index.
export const playerSlug = (
  player: PlayerLike | null | undefined,
  players: readonly PlayerLike[] | null | undefined = [],
): string => {
  const id = String(player?.id ?? "");
  const base = nameSlug(player?.name);
  if (!base) return id;
  if (!id) return base;
  const shared = (players || []).some(
    (p) => p && String(p.id) !== id && nameSlug(p.name) === base,
  );
  return shared || RESERVED_ROSTER_SEGMENTS.has(base) ? `${base}-${id}` : base;
};

// Resolve a :playerId URL segment, in most-specific-first order.
export const findPlayerByParam = <T extends PlayerLike>(
  param: string | null | undefined,
  players: readonly T[] | null | undefined,
): T | null => {
  const list = players || [];
  if (!param) return null;

  // A raw id — every link and bookmark made before slugs existed, plus the
  // unnamed-player case above.
  const byId = list.find((p) => p && String(p.id) === param);
  if (byId) return byId;

  // The disambiguated "<name>-<id>" form.
  const bySuffixed = list.find(
    (p) => p && p.id && param === `${nameSlug(p.name)}-${String(p.id)}`,
  );
  if (bySuffixed) return bySuffixed;

  // A bare name slug. Only resolves when exactly one player matches: once two
  // kids share a name, an old bare link can no longer say which one is meant,
  // and opening the wrong kid's page silently would be worse than the
  // not-found state.
  const byName = list.filter((p) => p && nameSlug(p.name) === param);
  return byName.length === 1 ? byName[0] : null;
};

// True when the segment already is the player's canonical slug — the check
// the profile page uses to decide whether to rewrite the address.
export const isCanonicalPlayerParam = (
  param: string | null | undefined,
  player: PlayerLike | null | undefined,
  players: readonly PlayerLike[] | null | undefined,
): boolean => !!param && !!player && param === playerSlug(player, players);

// The slug for a player id, for callers that only hold an id and build a
// path shape of their own (e.g. /evaluation/trend/<slug>). Unknown ids pass
// through so the destination page renders its own not-found state.
export const playerSlugFromId = (
  id: string,
  players: readonly PlayerLike[] | null | undefined,
): string => {
  const player = (players || []).find((p) => p && String(p.id) === id);
  return player ? playerSlug(player, players) : id;
};

// /roster/<slug> for a player id, for the callers that only hold an id.
// Unknown ids pass through unchanged so the profile page can render its own
// not-found state rather than being redirected to the roster from here.
export const playerPathFromId = (
  id: string,
  players: readonly PlayerLike[] | null | undefined,
  suffix = "",
): string => `/roster/${playerSlugFromId(id, players)}${suffix}`;
