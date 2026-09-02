import React, { memo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Icons } from "../icons";
import { rosterNeighbors } from "../utils/rosterOrder";
import { playerSlug } from "../utils/playerSlug";
import type { Player } from "../types";

// Prev/Next across the roster from inside a player's profile, so reviewing the
// team is one pass instead of a back-out-and-tap-in per kid.
//
// Two deliberate choices:
//   - Navigation REPLACES the history entry. Flipping through twelve players
//     must not put twelve entries between the coach and the roster; Back stays
//     one press, exactly as it was before this existed.
//   - The order is the Roster tab's own display order (utils/rosterOrder), not
//     this component's idea of one, and it does not wrap. The pager shows who
//     is actually next rather than just an arrow, and the ends are disabled so
//     "I have seen everyone" is visible instead of inferred.
//
// Left/Right arrow keys drive the same moves on desktop. The profile is full of
// inline-editable fields, so the key handler stands down whenever a form
// control or an open dialog owns the keystroke.
const label = (p: Player) =>
  `${p.number != null && p.number !== "" ? `#${p.number} ` : ""}${p.name || "Unnamed"}`;

const ARROW_KEY_BLOCKING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export const PlayerPager = memo(
  ({
    players,
    playerId,
  }: {
    players: Player[] | null | undefined;
    playerId: string | null | undefined;
  }) => {
    const navigate = useNavigate();
    const { prev, next, position, total } = rosterNeighbors(players, playerId);

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        // A modified arrow is a text/selection gesture, never a page turn.
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const el = e.target as HTMLElement | null;
        if (
          el &&
          (ARROW_KEY_BLOCKING_TAGS.has(el.tagName) || el.isContentEditable)
        )
          return;
        // A confirm/alert dialog owns the keyboard while it is open.
        if (document.querySelector('[role="dialog"]')) return;
        const target = e.key === "ArrowLeft" ? prev : next;
        if (!target) return;
        e.preventDefault();
        navigate(`/roster/${playerSlug(target, players)}`, {
          replace: true,
        });
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [prev, next, navigate, players]);

    // A player who isn't in the roster sequence (a tournament sub, or an id
    // that no longer resolves) has nothing to page through.
    if (position === 0 || total < 2) return null;

    const step = (target: Player | null) => {
      if (target)
        navigate(`/roster/${playerSlug(target, players)}`, { replace: true });
    };

    return (
      <nav
        aria-label="Roster players"
        className="sticky top-0 z-20 flex items-center gap-2 px-3 sm:px-4 py-2 bg-surface border-b border-line"
      >
        <button
          type="button"
          onClick={() => step(prev)}
          disabled={!prev}
          aria-label={
            prev ? `Previous player: ${label(prev)}` : "Previous player"
          }
          className="flex items-center gap-1.5 min-w-0 flex-1 justify-start px-2 py-1.5 rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <Icons.ChevronLeft className="w-4 h-4 shrink-0" />
          <span className="text-[11px] font-bold truncate">
            {prev ? label(prev) : "Start of roster"}
          </span>
        </button>

        <span className="t-chip px-2 py-0.5 rounded-md border border-line text-ink-3 whitespace-nowrap tabular-nums shrink-0">
          {position} of {total}
        </span>

        <button
          type="button"
          onClick={() => step(next)}
          disabled={!next}
          aria-label={next ? `Next player: ${label(next)}` : "Next player"}
          className="flex items-center gap-1.5 min-w-0 flex-1 justify-end px-2 py-1.5 rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <span className="text-[11px] font-bold truncate">
            {next ? label(next) : "End of roster"}
          </span>
          <Icons.ChevronRight className="w-4 h-4 shrink-0" />
        </button>
      </nav>
    );
  },
);
