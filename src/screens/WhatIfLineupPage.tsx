import React, { memo, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTeam } from "../contexts";
import { PageShell } from "../components/PageShell";
import { useBackOrFallback } from "../hooks/usePageNav";
import { Icons } from "../icons";
import { generateLineup, buildCompetitiveLineup } from "../lineupEngine";
import { isGameFinalized, formatGameDateDisplay } from "../utils/helpers";
import { getLocalDateString, leagueRuleSetLabel } from "../constants/ui";
import { isActiveRosterPlayer } from "../utils/rosterIntegrity";
import {
  summarizeScenario,
  buildRationale,
  diffScenarios,
  type ScenarioSummary,
} from "../utils/lineupWhatIf";

// /lineup/what-if — a non-persisting lineup sandbox. The coach picks an upcoming
// game, toggles who's available, and the SAME engine the real lineup uses
// regenerates live. A "Baseline" (everyone available) runs alongside so the two
// can be compared, and each shows the engine's own rationale. Nothing here is
// ever saved — it's a scratch pad for "what if?". Head-coach only.
export const WhatIfLineupPage = memo(() => {
  const { team, currentRole } = useTeam();
  const back = useBackOrFallback("/roster");
  const {
    players,
    games,
    evaluationEvents,
    teamAge,
    leagueRuleSet,
    defenseSize,
    positionLock,
    battingSize,
    pitchingFormat,
    inningsCount,
    catcherMaxInnings,
    catcherConsecutive,
  } = team as any;

  const roster = useMemo(
    () => (players || []).filter(isActiveRosterPlayer),
    [players],
  );

  const upcoming = useMemo(() => {
    const today = getLocalDateString();
    return (games || [])
      .filter((g: any) => (g.status || "scheduled") !== "postponed")
      .filter((g: any) => !isGameFinalized(g))
      .filter((g: any) => g.date && g.date >= today)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [games]);

  const [gameId, setGameId] = useState<string>(() => upcoming[0]?.id || "");
  const [outIds, setOutIds] = useState<Set<string>>(() => new Set());

  const game = useMemo(
    () => upcoming.find((g: any) => g.id === gameId) || upcoming[0],
    [upcoming, gameId],
  );

  const runFor = useMemo(() => {
    if (!game) return null;
    const buildInput = (activePlayers: any[]) => {
      const ruleSet = game.leagueRuleSet || leagueRuleSet;
      return {
        input: {
          activePlayers,
          allPlayers: players,
          games,
          evaluationEvents,
          currentGame: game,
          totalInnings: parseInt(game.inningsCount || inningsCount, 10) || 6,
          leagueRuleSet: ruleSet,
          teamAge,
          defenseSize: game.defenseSize || defenseSize,
          positionLock: game.positionLock || positionLock,
          battingSize: game.battingSize || battingSize,
          pitchingFormat: game.pitchingFormat || pitchingFormat,
          catcherMaxInnings,
          catcherConsecutive,
          seed: 7,
        },
        ruleSet,
      };
    };
    const exec = (activePlayers: any[]) => {
      const { input, ruleSet } = buildInput(activePlayers);
      return ruleSet === "USSSA"
        ? buildCompetitiveLineup(input as any)
        : generateLineup(input as any);
    };
    return exec;
  }, [
    game,
    players,
    games,
    evaluationEvents,
    teamAge,
    leagueRuleSet,
    defenseSize,
    positionLock,
    battingSize,
    pitchingFormat,
    inningsCount,
    catcherMaxInnings,
    catcherConsecutive,
  ]);

  const scenarioPlayers = useMemo(
    () => roster.filter((p: any) => !outIds.has(p.id)),
    [roster, outIds],
  );

  const baseline = useMemo<ScenarioSummary | null>(
    () => (runFor ? summarizeScenario(runFor(roster), roster) : null),
    [runFor, roster],
  );
  const scenario = useMemo<ScenarioSummary | null>(
    () =>
      runFor
        ? summarizeScenario(runFor(scenarioPlayers), scenarioPlayers)
        : null,
    [runFor, scenarioPlayers],
  );

  const diff = useMemo(
    () => (baseline && scenario ? diffScenarios(baseline, scenario) : null),
    [baseline, scenario],
  );

  if (currentRole === "assistant") {
    return <Navigate to="/roster" replace />;
  }

  const toggleOut = (id: string) =>
    setOutIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <PageShell eyebrow="Lineup" title="What-If Sandbox" onBack={back}>
      {upcoming.length === 0 || !game ? (
        <div className="cc-card p-6 text-sm font-bold text-ink-3">
          Add an upcoming game on the Schedule to explore lineups here.
        </div>
      ) : (
        <div className="space-y-5 max-w-4xl">
          <p className="text-xs font-medium text-ink-3 leading-snug">
            Explore lineups without saving anything. Mark players out to see how
            the fair-play engine reshuffles the defense, and compare against the
            baseline where everyone's available.
          </p>

          {/* Game picker */}
          <div className="cc-card p-4">
            <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
              Game
            </label>
            <select
              value={game.id}
              onChange={(e) => setGameId(e.target.value)}
              className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
            >
              {upcoming.map((g: any) => (
                <option key={g.id} value={g.id}>
                  {formatGameDateDisplay(g.date)} ·{" "}
                  {g.isHome === false ? "@ " : "vs "}
                  {g.opponent || "TBD"} ·{" "}
                  {leagueRuleSetLabel(g.leagueRuleSet || leagueRuleSet)}
                </option>
              ))}
            </select>
          </div>

          {/* Availability toggles */}
          <div className="cc-card p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="t-eyebrow flex items-center gap-2">
                <Icons.Users className="w-4 h-4" /> Available (
                {scenarioPlayers.length}/{roster.length})
              </h3>
              {outIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setOutIds(new Set())}
                  className="t-chip px-2.5 py-1 rounded-md border border-line-strong hover:bg-surface-2"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {roster.map((p: any) => {
                const out = outIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleOut(p.id)}
                    className={`t-chip px-2.5 py-1 rounded-md border transition-colors ${
                      out
                        ? "bg-surface-2 border-line text-ink-3 line-through"
                        : "bg-surface border-line-strong text-ink"
                    }`}
                  >
                    {p.number ? `#${p.number} ` : ""}
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* A/B diff banner */}
          {diff && diff.bothOk && diff.penaltyDelta != null && (
            <div
              className={`cc-card p-4 text-xs font-bold flex items-start gap-2 ${
                diff.penaltyDelta > 0
                  ? "text-loss"
                  : diff.penaltyDelta < 0
                    ? "text-win"
                    : "text-ink-2"
              }`}
            >
              <Icons.Bat className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {diff.penaltyDelta === 0
                  ? "Same fair-play cost as the baseline."
                  : diff.penaltyDelta > 0
                    ? `This scenario is less balanced than the baseline (fair-play cost +${diff.penaltyDelta}).`
                    : `This scenario is more balanced than the baseline (fair-play cost ${diff.penaltyDelta}).`}
              </span>
            </div>
          )}

          {/* Side-by-side scenarios */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ScenarioColumn
              title="Baseline — everyone available"
              summary={baseline}
            />
            <ScenarioColumn
              title={
                outIds.size === 0
                  ? "What-If (mark players out above)"
                  : `What-If — ${outIds.size} out`
              }
              summary={scenario}
              highlight
            />
          </div>
        </div>
      )}
    </PageShell>
  );
});

const ScenarioColumn = memo(
  ({
    title,
    summary,
    highlight,
  }: {
    title: string;
    summary: ScenarioSummary | null;
    highlight?: boolean;
  }) => {
    if (!summary) return null;
    const rationale = buildRationale(summary);
    return (
      <div
        className={`cc-card p-4 ${highlight ? "ring-1 ring-[var(--team-primary)]" : ""}`}
      >
        <h3 className="t-eyebrow mb-2">{title}</h3>
        {!summary.ok ? (
          <p className="text-xs font-bold text-loss flex items-start gap-1.5">
            <Icons.Alert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {summary.error || "Couldn't build a lineup."}
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {summary.perPlayer
                .slice()
                .sort((a, b) => b.benchInnings - a.benchInnings)
                .map((p) => (
                  <span
                    key={p.id}
                    className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface-2 text-ink-2"
                    title={`${p.distinctPositions} position${p.distinctPositions === 1 ? "" : "s"}: ${p.positions.join(", ")}`}
                  >
                    {p.name}
                    {p.benchInnings > 0 ? ` · sits ${p.benchInnings}` : ""}
                  </span>
                ))}
            </div>
            <div className="border-t border-line pt-2 space-y-1">
              <p className="t-eyebrow text-ink-3 flex items-center gap-1.5">
                <Icons.Help className="w-3.5 h-3.5" /> Why
              </p>
              {rationale.map((line, i) => (
                <p key={i} className="text-[11px] font-medium text-ink-2">
                  {line}
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    );
  },
);
