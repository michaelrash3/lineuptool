import React, { memo } from "react";
import { Link } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { featureEnabled } from "../../constants/features";
import {
  gameStakes,
  opponentStrengthGuidance,
  tournamentForGame,
} from "../../utils/tournamentStakes";
import {
  combinedOpponentRecord,
  formatRecord,
} from "../../utils/opponentHistory";
import type { Game, OpponentStrength, Tournament } from "../../types";

const STRENGTH_CHIPS: Array<{ id: OpponentStrength; label: string }> = [
  { id: "weaker", label: "Weaker" },
  { id: "even", label: "Even" },
  { id: "stronger", label: "Stronger" },
];

// Scouting & stakes on the game editor (tournament games only): the coach's
// read on the opponent, the name-matched head-to-head record (this season +
// archived seasons), and — when a stored tournament claims the game — the
// stakes framing from the tournament's structure and tiebreaker ladder.
// The opponent read never touches the lineup engine; it shifts guidance.
export const GameStakesPanel = memo(({ game }: { game: Game }) => {
  const { team, currentRole, updateGame } = useTeam();
  const canEdit = currentRole !== "assistant";

  const isTournamentGame =
    (game.leagueRuleSet || team.leagueRuleSet) === "USSSA";
  if (!isTournamentGame || game.isScrimmage) return null;

  const tournament: Tournament | undefined = featureEnabled(team, "tournaments")
    ? tournamentForGame(team.tournaments, game.id)
    : undefined;
  const stakes = tournament
    ? gameStakes({ tournament, game, games: team.games || [] })
    : null;

  const h2h = game.opponent
    ? combinedOpponentRecord(team.games, team.opponentArchive, game.opponent)
    : null;
  const strength = game.opponentStrength;
  const strengthLine = opponentStrengthGuidance(
    strength,
    tournament?.tiebreakers,
  );

  const setStrength = (next: OpponentStrength) =>
    updateGame(game.id, {
      // Tapping the active chip clears the read.
      opponentStrength: strength === next ? null : next,
    });

  return (
    <div className="cc-card p-4 mt-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="t-eyebrow text-ink-2">Scouting &amp; Stakes</h3>
        {tournament && (
          <Link
            to={`/schedule/tournaments/${tournament.id}`}
            className="t-chip inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-line text-ink-2 hover:bg-surface-2 transition-colors"
          >
            {tournament.name}
            <Icons.ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </div>

      {/* Head-to-head, matched on the opponent's name */}
      {h2h && (h2h.current.games > 0 || h2h.past.games > 0) ? (
        <p className="text-xs font-bold text-ink-2 mb-3">
          vs {game.opponent}:{" "}
          {h2h.current.games > 0 && (
            <span className="text-ink tabular-nums">
              {formatRecord(h2h.current)} this season
            </span>
          )}
          {h2h.current.games > 0 && h2h.past.games > 0 && " · "}
          {h2h.past.games > 0 && (
            <span className="tabular-nums">
              {formatRecord(h2h.past)} in {h2h.pastSeasons.join(", ")}
            </span>
          )}
        </p>
      ) : game.opponent ? (
        <p className="text-xs font-bold text-ink-3 mb-3">
          First meeting with {game.opponent} on record.
        </p>
      ) : null}

      {/* Opponent strength — the coach's read */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest">
          How good are they?
        </span>
        <div className="flex items-center gap-1.5">
          {STRENGTH_CHIPS.map(({ id, label }) => {
            const active = strength === id;
            return (
              <button
                key={id}
                type="button"
                disabled={!canEdit}
                onClick={() => setStrength(id)}
                aria-pressed={active}
                className={`t-chip px-3 py-1.5 rounded-lg border transition-colors disabled:cursor-not-allowed ${
                  active
                    ? "border-transparent"
                    : "border-line text-ink-2 hover:bg-surface-2"
                }`}
                style={
                  active
                    ? {
                        backgroundColor: "var(--team-primary)",
                        color: "var(--team-on-primary)",
                      }
                    : undefined
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {strengthLine && (
        <p className="mt-2 text-[11px] font-bold text-ink-2 leading-snug">
          {strengthLine}
        </p>
      )}

      {/* Stakes framing from the stored tournament */}
      {stakes && (
        <div className="mt-3 pt-3 border-t border-line">
          <p className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
            {stakes.headline}
          </p>
          {stakes.lines
            // The strength read already renders above the divider.
            .filter((l) => l !== strengthLine)
            .map((line) => (
              <p
                key={line}
                className="text-[11px] font-medium text-ink-2 leading-snug mb-1"
              >
                {line}
              </p>
            ))}
          {stakes.ledger &&
            (stakes.ledger.played > 0 || stakes.ledger.remaining > 0) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface-2 text-ink-2 tabular-nums">
                  Pool so far{" "}
                  {formatRecord({
                    games: stakes.ledger.played,
                    wins: stakes.ledger.wins,
                    losses: stakes.ledger.losses,
                    ties: stakes.ledger.ties,
                    runsFor: stakes.ledger.runsScored,
                    runsAgainst: stakes.ledger.runsAllowed,
                  })}
                </span>
                <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 tabular-nums">
                  RA {stakes.ledger.runsAllowed}
                </span>
                <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 tabular-nums">
                  Diff {stakes.ledger.runDiff >= 0 ? "+" : ""}
                  {stakes.ledger.runDiff}
                </span>
              </div>
            )}
        </div>
      )}
    </div>
  );
});
