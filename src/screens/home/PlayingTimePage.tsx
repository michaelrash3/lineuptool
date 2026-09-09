import React, { memo, useMemo } from "react";
import { Icons } from "../../icons";
import { useTeam, useUI } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { PlayingTimePanel } from "../../components/PlayingTimePanel";
import { PositionVarietyPanel } from "../../components/PositionVarietyPanel";
import { buildSeasonBenchImbalance, isRosterPlayer } from "../../utils/helpers";
import type { BenchImbalanceEntry } from "../../utils/helpers";
import type { Game, Player } from "../../types";

// /playing-time — the fairness page: who has played, who has sat, and where
// those innings went. Split out of the Stats tab so Stats stays about
// batting / pitching / fielding performance and playing time gets the one
// place a coach opens when a parent asks "is my kid playing enough?".
//
// Read-only, and every number comes from imported box scores — actual innings,
// not planned ones. A routed page per the app-wide modals→pages rule.

interface BenchEquityRow {
  p: Player;
  e: BenchImbalanceEntry;
}

// Bench equity & attendance — who's sitting more (or less) than their fair
// share across finalized games. extraSits > 0 means benched beyond the even
// split.
const BenchEquityTable = memo(
  ({
    rows,
    onOpen,
  }: {
    rows: BenchEquityRow[];
    onOpen?: (id: string) => void;
  }) => (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
        <thead className="bg-surface-2 text-ink-2">
          <tr>
            <th className="p-2.5 t-eyebrow text-left">Player</th>
            <th className="p-2.5 t-eyebrow text-center">GP</th>
            <th className="p-2.5 t-eyebrow text-center">Def Inn</th>
            <th className="p-2.5 t-eyebrow text-center">Bench Inn</th>
            <th className="p-2.5 t-eyebrow text-center">Sits +/−</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ p, e }) => {
            const over = e.extraSits > 0.5;
            const under = e.extraSits < -0.5;
            return (
              <tr key={p.id} className="hover:bg-surface-2">
                <td className="p-2">
                  <button
                    type="button"
                    onClick={() => onOpen?.(p.id)}
                    className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate"
                  >
                    {p.name}
                  </button>
                </td>
                <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                  {e.gamesAttended}
                </td>
                <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                  {Math.round(e.totalDefense)}
                </td>
                <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                  {Math.round(e.totalBench)}
                </td>
                <td
                  className={`p-2 text-center tabular-nums font-black ${
                    over ? "text-loss" : under ? "text-win" : "text-ink-3"
                  }`}
                >
                  {e.extraSits > 0 ? "+" : ""}
                  {e.extraSits.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ),
);

export const PlayingTimePage = memo(() => {
  const { team } = useTeam();
  const { openPlayerProfile } = useUI();
  const back = useBackOrFallback("/");

  // Departed players are excluded everywhere but the Roster tab.
  const players: Player[] = useMemo(
    () => (team?.players || []).filter((p: Player) => isRosterPlayer(p)),
    [team],
  );
  const games: Game[] = useMemo(() => team?.games || [], [team]);

  const benchRows = useMemo(() => {
    const m = buildSeasonBenchImbalance(games, "", players);
    return players
      .map((p) => ({ p, e: m.get(p.id) }))
      .filter((x): x is BenchEquityRow => !!x.e && x.e.gamesAttended > 0)
      .sort((a, b) => b.e.extraSits - a.e.extraSits);
  }, [games, players]);

  const hasAnything = players.length > 0;

  return (
    <PageShell
      eyebrow="Season"
      title="Playing Time"
      onBack={back}
      backLabel="Back"
    >
      <div className="space-y-6">
        {!hasAnything ? (
          <div
            className="py-8 text-center text-ink-3 font-medium"
            role="status"
          >
            <div className="text-4xl leading-none mb-3 opacity-80" aria-hidden>
              ⏱️
            </div>
            Add players and import a game&apos;s box score to see innings, bench
            time, and position variety here.
          </div>
        ) : (
          <>
            {/* Head-coach-only receipts card; self-gating, renders nothing for
                assistants or before there's a finalized game with a lineup. */}
            <PlayingTimePanel />

            {benchRows.length > 0 && (
              <div className="border-b border-line pb-6">
                <div className="px-1 py-4 flex flex-wrap items-center gap-3">
                  <div
                    className="p-2 rounded-full shrink-0"
                    style={{ backgroundColor: "var(--team-primary-15)" }}
                    aria-hidden
                  >
                    <Icons.Clock
                      className="w-5 h-5"
                      style={{ color: "var(--team-ink)" }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="t-h2">Bench Equity &amp; Attendance</h2>
                    <p className="t-eyebrow text-ink-3 mt-0.5">
                      Innings played vs. fair share, from imported box scores
                    </p>
                  </div>
                </div>
                <BenchEquityTable rows={benchRows} onOpen={openPlayerProfile} />
              </div>
            )}

            <PositionVarietyPanel />
          </>
        )}
      </div>
    </PageShell>
  );
});
