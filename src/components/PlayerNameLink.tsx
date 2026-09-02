import React, { memo, useContext } from "react";
import { Link } from "react-router-dom";
import { TeamContext } from "../contexts";
import { playerSlug, type PlayerLike } from "../utils/playerSlug";

// A player's name, linked to their page. Wherever a name is shown as
// information — a leaderboard row, a fee line, a depth-chart slot — it should
// be a way into that player's profile, because that is where a coach goes to
// answer whatever the name just prompted.
//
// It is an anchor, not a button with an onClick, so it behaves like any other
// link on the site: the target previews on hover, Cmd/Ctrl/middle-click opens
// the profile in a new tab, and right-click offers to copy the address.
//
// Deliberately NOT for names that are already a control for something else —
// an in-game swap target, a lineup cell, an attendance toggle, a grading card
// heading, a wizard checkbox row. There the name is the thing you press to do
// the surface's own job, and a second meaning would be a trap.
export const PlayerNameLink = memo(
  ({
    player,
    playerId,
    className = "",
    title,
    children,
  }: {
    // Pass whichever you have; `player` wins when both are given.
    player?: PlayerLike | null;
    playerId?: string | null;
    className?: string;
    // Hover tooltip, for callers whose name chip carries extra context
    // ("Resting", "At the pitch ceiling"). Kept on the plain-text fallback
    // too, so the explanation survives when the player can't be resolved.
    title?: string;
    children?: React.ReactNode;
  }) => {
    // Read the context directly rather than through useTeam(), which throws
    // when there is no provider: this renders inside report and panel trees
    // that are mounted without one. Without the roster it can still link — it
    // just can't tell whether the name needs disambiguating.
    const teamCtx = useContext(TeamContext);
    const players: PlayerLike[] = teamCtx?.team?.players || [];
    const resolved =
      player || players.find((p) => p && String(p.id) === String(playerId));

    // A name with no player behind it (a departed kid scrubbed from the
    // roster, a stat row for someone since removed) still renders — as plain
    // text, so the caller's layout is unchanged and nothing links nowhere.
    if (!resolved || !resolved.id) {
      return (
        <span className={className} title={title}>
          {children ?? null}
        </span>
      );
    }

    return (
      <Link
        to={`/roster/${playerSlug(resolved, players)}`}
        title={title}
        className={`hover:text-team-primary hover:underline transition-colors ${className}`}
      >
        {children ?? String(resolved.name ?? "")}
      </Link>
    );
  },
);
