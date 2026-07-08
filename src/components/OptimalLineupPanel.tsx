import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { generateLineup, buildCompetitiveLineup } from "../lineupEngine";
import { isGameFinalized, formatGameDateDisplay } from "../utils/helpers";
import { getLocalDateString, leagueRuleSetLabel } from "../constants/ui";

// Roster-side preview of the recommended lineup for the next game, built from
// the players currently marked PRESENT on the roster. It runs the same engine
// the Schedule screen uses (competitive for Tournament games, fairness for Rec),
// for the next game's DATE — so the starting pitcher it picks is one who's
// rested under the age rules (last-thrown date + pitches thrown). Head-coach only.
export const OptimalLineupPanel = memo(() => {
  const { team, currentRole } = useTeam();
  const { openPlayerProfile } = useUI();
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
  } = team;

  const nextGame = useMemo(() => {
    const today = getLocalDateString();
    return (games || [])
      .filter((g: any) => (g.status || "scheduled") !== "postponed")
      .filter((g: any) => !isGameFinalized(g))
      .filter((g: any) => g.date && g.date >= today)
      .sort((a: any, b: any) => a.date.localeCompare(b.date))[0];
  }, [games]);

  // Present = roster's own present/absent marking (what the coach toggles here).
  const present = useMemo(
    () => (players || []).filter((p: any) => p.present !== false),
    [players],
  );

  const result = useMemo(() => {
    if (!nextGame || present.length < 7) return null;
    const ruleSet = nextGame.leagueRuleSet || leagueRuleSet;
    const input: any = {
      activePlayers: present,
      allPlayers: players,
      games,
      evaluationEvents,
      currentGame: nextGame,
      totalInnings: parseInt(nextGame.inningsCount || inningsCount, 10) || 6,
      leagueRuleSet: ruleSet,
      teamAge,
      defenseSize: nextGame.defenseSize || defenseSize,
      positionLock: nextGame.positionLock || positionLock,
      battingSize: nextGame.battingSize || battingSize,
      pitchingFormat: nextGame.pitchingFormat || pitchingFormat,
      catcherMaxInnings,
      catcherConsecutive,
      seed: 7, // stable so the preview doesn't reshuffle on every render
    };
    return ruleSet === "USSSA"
      ? buildCompetitiveLineup(input)
      : generateLineup(input);
    // All inputs are listed so a mid-session team-setting change (catcher cap,
    // pitching format, innings, etc.) re-runs the preview. They're primitives /
    // stable snapshot arrays, so the memo still only recomputes when one
    // genuinely changes; the seed keeps the output stable across renders.
  }, [
    nextGame,
    present,
    players,
    games,
    evaluationEvents,
    leagueRuleSet,
    inningsCount,
    teamAge,
    defenseSize,
    positionLock,
    battingSize,
    pitchingFormat,
    catcherMaxInnings,
    catcherConsecutive,
  ]);

  if (currentRole !== "head" || !nextGame) return null;

  // Map each player to their first-inning defensive position.
  const inn0 = (result?.lineup && result.lineup[0]) || {};
  const posOf = new Map<string, string>();
  for (const pos in inn0) {
    if (pos === "BENCH") continue;
    const p = (inn0 as any)[pos];
    if (p?.id) posOf.set(p.id, pos);
  }

  const ruleLabel = leagueRuleSetLabel(nextGame.leagueRuleSet || leagueRuleSet);

  return (
    <div className="cc-card mb-6">
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
      <div className="p-5 border-b border-line bg-surface flex items-center gap-3">
        <div
          className="p-2 rounded-full"
          style={{ backgroundColor: "var(--team-primary-15)" }}
        >
          <Icons.Bat className="w-5 h-5" style={{ color: "var(--team-ink)" }} />
        </div>
        <div className="min-w-0">
          <h2 className="t-h2">Optimal Lineup — Next Game</h2>
          <p className="t-eyebrow text-ink-3 mt-0.5 truncate">
            {nextGame.opponent ? `vs ${nextGame.opponent} · ` : ""}
            {formatGameDateDisplay(nextGame.date)} · {ruleLabel} ·{" "}
            {present.length} present
          </p>
        </div>
      </div>

      {present.length < 7 ? (
        <div className="p-5 text-xs font-bold text-ink-3">
          Mark at least 7 players present to preview a lineup.
        </div>
      ) : result?.error ? (
        <div className="p-5 text-xs font-bold text-loss">{result.error}</div>
      ) : !result?.battingLineup ? (
        <div className="p-5 text-xs font-bold text-ink-3">
          Couldn't build a lineup with the present players.
        </div>
      ) : (
        <>
          <div className="divide-y divide-line">
            {result.battingLineup.map((b: any, idx: number) => {
              const pos = posOf.get(b.id) || "Bench";
              const isPitcher = pos === "P";
              return (
                <div
                  key={b.id || idx}
                  className="flex items-center gap-3 px-4 sm:px-5 py-2"
                >
                  <span className="w-6 text-center font-black tabular-nums text-ink-3 shrink-0">
                    {idx + 1}
                  </span>
                  <span
                    className={`t-chip px-2 py-0.5 rounded-md border shrink-0 w-14 text-center ${
                      pos === "Bench"
                        ? "bg-surface-2 border-line text-ink-3"
                        : isPitcher
                          ? "bg-win-bg border-line text-win"
                          : "bg-surface border-line-strong text-ink"
                    }`}
                  >
                    {pos}
                  </span>
                  <button
                    type="button"
                    onClick={() => openPlayerProfile(b.id)}
                    className="font-bold text-ink hover:text-team-primary transition-colors text-left truncate"
                  >
                    {b.number ? `#${b.number} ` : ""}
                    {b.name}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="px-5 py-3 text-[11px] text-ink-3 font-medium border-t border-line">
            <Icons.Pitch className="w-3.5 h-3.5 inline mr-1 align-text-bottom" />
            Starting pitcher is chosen from arms rested for{" "}
            {formatGameDateDisplay(nextGame.date)} (last outing + pitch count vs
            age rest rules). Update who's present above to re-plan.
          </p>
        </>
      )}
    </div>
  );
});
