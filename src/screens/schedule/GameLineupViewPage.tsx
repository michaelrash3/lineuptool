import React, { memo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useTeam, useToast } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { PlayerNameLink } from "../../components/PlayerNameLink";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { Icons } from "../../icons";
import { LineupGrid } from "../LineupGrid";
import { downloadLineupPdf } from "../../lineup/lineupCard";
import { formatGameDateDisplay, isGameFinalized } from "../../utils/helpers";
import { leagueRuleSetLabel } from "../../constants/ui";
import { isoInstantToLocalTime } from "../../utils/icsParse";
import type { Game, Inning, SlimPlayer } from "../../types";

// Display order for the defensive rows — the same order the lineup grid uses
// everywhere else, so a coach reading this page and the editor sees one table.
const POSITION_ORDER = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "LCF",
  "CF",
  "RCF",
  "RF",
];

// /schedule/game/:gameId/lineup — the lineup a coach already set, read only.
//
// The Game Command Center is a workshop: opening it to check who's playing
// first base means walking past Generate, the attendance toggles and the
// swap-armed grid, any of which rewrites the lineup on a stray tap. At the
// field, on a phone, that's the wrong surface for "just show me the card".
// This page shows the same defense grid and batting order with nothing to
// press — plus the PDF/Print handoffs, which are the other reason to open a
// finished lineup.
export const GameLineupViewPage = memo(() => {
  const { gameId } = useParams();
  const { team, currentRole } = useTeam();
  const toast = useToast();
  const back = useBackOrFallback("/schedule");
  const game: Game | undefined = (team.games || []).find(
    (g: Game) => g.id === gameId,
  );

  // No game, or a game nobody has planned yet: there is nothing to view, so
  // don't strand the coach on an empty page.
  const lineup: Inning[] = game?.lineup || [];
  if (!game || lineup.length === 0) {
    return <Navigate to="/schedule" replace />;
  }

  const battingLineup: SlimPlayer[] = game.battingLineup || [];
  // Rows come from the lineup itself rather than the roster count, so the grid
  // matches what was actually saved even if attendance has since changed.
  const positions = POSITION_ORDER.filter((pos) =>
    lineup.some((inn) => inn && inn[pos]),
  );
  const startTime = isoInstantToLocalTime(game.startUtc);
  const isFinal = isGameFinalized(game);
  // Before first pitch the whole grid past inning 1 is the generator's plan.
  // Once the game is live those innings are being played (and re-flowed) for
  // real in the in-game view, so the projection caveat no longer applies.
  const notStarted = !isFinal && game.status !== "in_progress";
  const canEdit = currentRole !== "assistant";

  return (
    <PageShell
      eyebrow={`${game.isHome === false ? "@ " : "vs. "}${
        game.opponent || "Opponent"
      }`}
      title="Lineup"
      onBack={back}
      actions={
        canEdit ? (
          <Link
            to={`/schedule/game/${game.id}`}
            className="text-xs bg-surface border border-line text-ink py-2.5 px-5 flex items-center gap-2 font-extrabold uppercase tracking-wider hover:bg-surface-2 transition-colors rounded-xl shadow-sm whitespace-nowrap"
          >
            <Icons.Edit className="w-4 h-4" /> Edit
          </Link>
        ) : undefined
      }
    >
      <div className="cc-card overflow-hidden">
        <div className="p-5 border-b border-line flex flex-col lg:flex-row lg:items-center justify-between gap-4 print:hidden">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-chip bg-surface-2 text-ink-2 px-2.5 py-1 rounded-md border border-line-strong text-[10px] font-black uppercase tracking-wider">
                View only
              </span>
              {isFinal && (
                <span className="t-chip bg-surface-2 text-ink-2 px-2.5 py-1 rounded-md border border-line-strong text-[10px] font-black uppercase tracking-wider tabular-nums">
                  Final {String(game.teamScore)}-{String(game.opponentScore)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-2">
              <Icons.Clock className="w-3.5 h-3.5 shrink-0 text-ink-3" />
              <span className="font-bold">
                {formatGameDateDisplay(game.date)}
                {startTime && <> · {startTime}</>}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-2">
              <Icons.FileText className="w-3.5 h-3.5 shrink-0 text-ink-3" />
              <span className="font-bold">
                {leagueRuleSetLabel(
                  (game.leagueRuleSet as string) || team.leagueRuleSet,
                )}
                {" · "}
                {game.pitchingFormat || team.pitchingFormat}
              </span>
            </div>
            {game.location && (
              <div className="flex items-start gap-2 text-xs text-ink-2">
                <Icons.MapPin className="w-3.5 h-3.5 shrink-0 text-ink-3 mt-0.5" />
                <span className="font-bold">
                  {String(game.location).split("\n")[0]}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3 items-center shrink-0">
            <button
              type="button"
              onClick={() =>
                downloadLineupPdf({
                  game,
                  team,
                  formatDate: formatGameDateDisplay,
                  toast,
                })
              }
              title="Download lineup as a PDF for emailing or texting"
              className="text-xs bg-surface border border-line text-ink py-2.5 px-5 flex items-center gap-2 font-extrabold uppercase tracking-wider hover:bg-surface-2 transition-colors rounded-xl shadow-sm"
            >
              <Icons.FileText className="w-4 h-4" /> PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="text-xs bg-surface border border-line text-ink py-2.5 px-5 flex items-center gap-2 font-extrabold uppercase tracking-wider hover:bg-surface-2 transition-colors rounded-xl shadow-sm"
            >
              <Icons.Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </div>

        {/* No onCellClick — the grid renders itself inert. */}
        <LineupGrid
          lineup={lineup}
          positions={positions}
          swapSelection={null}
        />

        {/* Innings past the first are the generator's projection until they're
            played: a pitching change in the live game re-flows the rest. Say so
            here rather than letting a coach read inning 4 as settled. */}
        {lineup.length > 1 && notStarted && (
          <p className="px-6 py-4 border-t border-line/80 text-[11px] font-bold text-ink-3 print:hidden">
            Innings after the first are a projection — an in-game pitching
            change re-flows them.
          </p>
        )}

        {battingLineup.length > 0 && (
          <div className="p-6 border-t border-line/80 bg-transparent">
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-line/50">
              <div className="p-2 rounded-full bg-surface border border-line shadow-sm">
                <Icons.Bat className="w-5 h-5 text-ink-2" />
              </div>
              <h3 className="t-h3">Batting Order</h3>
            </div>
            <ol className="flex flex-col gap-2 max-w-2xl">
              {battingLineup.map((p, idx) => (
                <li
                  key={p?.id ?? `batter_${idx}`}
                  className="bg-surface border border-line p-2.5 shadow-sm rounded-xl flex items-center gap-4"
                >
                  <span
                    className="w-10 h-10 shrink-0 flex items-center justify-center font-black text-sm rounded-lg shadow-inner"
                    style={{
                      backgroundColor: "var(--team-primary-15)",
                      color: "var(--team-ink)",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <PlayerNameLink
                    playerId={p?.id}
                    className="flex-1 text-sm font-black text-ink truncate"
                  >
                    {p?.name}
                  </PlayerNameLink>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </PageShell>
  );
});
