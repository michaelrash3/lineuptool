// Tournament subs (guest players). A sub is borrowed for one weekend: they
// need to appear in that tournament's attendance, lineups, pitch plans and
// in-game view, but must stay off the season roster and out of every
// season-long readout (stats, evals, development, practices, availability,
// finances, tryouts, advance-season).
//
// They are stored in the same `team.players` array as everyone else — flagged
// with `isSub` and attached to tournaments by id — because the alternative
// (a parallel array) would mean teaching the engine, the lineup grid, the
// in-game swaps and every PDF generator about a second player source. Here
// the rule is inverted instead: game-day surfaces ask playsGame(), and
// season-long surfaces ask isRosterPlayer().
import type { Game, Player, Tournament } from "../types";

// The loose shapes these helpers accept. Player has an open index signature,
// so the narrow structural types below let callers pass raw team data
// (and tests pass minimal literals) without a cast at every site.
interface SubLike {
  isSub?: unknown;
  subTournamentIds?: unknown;
  rosterStatus?: unknown;
  [key: string]: unknown;
}

export const isSubPlayer = (p: SubLike | null | undefined): boolean =>
  p?.isSub === true;

// True for players who belong to the season roster: on the team and not a
// borrowed sub. Mirrors (and replaces) the bare `!isDepartedPlayer(p)` test
// that every season-long surface used before subs existed — departed players
// are still excluded, so the meaning at those call sites is unchanged for
// teams with no subs.
export const isRosterPlayer = (p: SubLike | null | undefined): boolean =>
  !!p && p.rosterStatus !== "departed" && !isSubPlayer(p);

// Season-roster players only, preserving order. Generic over the element type
// rather than constrained to SubLike: team data reaches most call sites as
// `any`, and a constrained generic would widen the result to SubLike and
// break every downstream signature that wants a real Player.
export const rosterOnly = <T>(players: T[] | null | undefined): T[] =>
  (players || []).filter((p) => !isSubPlayer(p as SubLike));

export const subTournamentIds = (p: SubLike | null | undefined): string[] =>
  Array.isArray(p?.subTournamentIds)
    ? (p.subTournamentIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];

// The subs brought in for one tournament, in roster order.
export const subsForTournament = <T>(
  players: T[] | null | undefined,
  tournamentId: string | null | undefined,
): T[] =>
  !tournamentId
    ? []
    : (players || []).filter(
        (p) =>
          isSubPlayer(p as SubLike) &&
          subTournamentIds(p as SubLike).includes(tournamentId),
      );

// Every game id a sub is eligible for — the union of their tournaments'
// linked games. A tournament id that no longer resolves (deleted tournament)
// contributes nothing, which is what strands a sub rather than silently
// re-admitting them to the whole schedule.
export const subGameIds = (
  p: SubLike | null | undefined,
  tournaments: Tournament[] | null | undefined,
): Set<string> => {
  const attached = new Set(subTournamentIds(p));
  const ids = new Set<string>();
  for (const t of tournaments || []) {
    if (!attached.has(t.id)) continue;
    for (const gid of t.gameIds || []) if (gid) ids.add(gid);
  }
  return ids;
};

// Is this player in the picture for this game? Roster players always are
// (their availability is decided elsewhere — attendance, absences, health);
// a sub only for games inside a tournament they were added to. Every game-day
// surface that starts from the raw player list gates on this so a sub can
// never leak into an unrelated game.
export const playsGame = (
  p: SubLike | null | undefined,
  gameId: string | null | undefined,
  tournaments: Tournament[] | null | undefined,
): boolean => {
  if (!isSubPlayer(p)) return true;
  if (!gameId) return false;
  return subGameIds(p, tournaments).has(gameId);
};

// Roster players plus the subs eligible for this one game — the player pool
// for attendance, lineup generation and the in-game view.
export const playersForGame = <T>(
  players: T[] | null | undefined,
  gameId: string | null | undefined,
  tournaments: Tournament[] | null | undefined,
): T[] =>
  (players || []).filter((p) => playsGame(p as SubLike, gameId, tournaments));

// The tournament a game belongs to, if any. A game belongs to at most one
// (enforced by the membership editor on the tournament detail page).
export const tournamentForGame = (
  tournaments: Tournament[] | null | undefined,
  gameId: string | null | undefined,
): Tournament | undefined =>
  !gameId
    ? undefined
    : (tournaments || []).find((t) => (t.gameIds || []).includes(gameId));

// How a sub's attachment reads on screen: the tournament names they were
// brought in for, or a warning when every one of them is gone.
export const subTournamentLabel = (
  p: Player | SubLike | null | undefined,
  tournaments: Tournament[] | null | undefined,
): string => {
  const attached = new Set(subTournamentIds(p));
  const names = (tournaments || [])
    .filter((t) => attached.has(t.id))
    .map((t) => t.name)
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : "No tournament";
};

// Games a sub is eligible for, dated ascending — for the "playing in" read on
// the sub row.
export const subGames = (
  p: SubLike | null | undefined,
  games: Game[] | null | undefined,
  tournaments: Tournament[] | null | undefined,
): Game[] => {
  const ids = subGameIds(p, tournaments);
  return (games || [])
    .filter((g) => ids.has(g.id))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
};
