import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import {
  formatGameDateDisplay,
  evalPromptStatus,
  buildSeasonBenchImbalance,
  isGameFinalized,
  countsTowardStats,
  recordWinningPercentage,
  latestGameLineMovement,
} from "../utils/helpers";
import { isoInstantToLocalTime } from "../utils/icsParse";
import { leagueRuleSetLabel } from "../constants/ui";
import { useTeam, useUI } from "../contexts";
import { LeaderboardCard, EmptyState } from "../components/shared";
import {
  StaggerList,
  StaggerItem,
  AnimatedNumber,
} from "../components/motion";
import { checkPitchEligibility } from "../lineupEngine";

// Dismissible banner that nudges the current coach to submit an eval round
// when the cadence (preseason or biweekly) is active.
const EvalPromptBanner = memo(
  ({ kind, isHead, primaryColor, onStart, dueDate }: any) => {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;
    const dueLabel = dueDate ? formatGameDateDisplay(dueDate) : "";
    const headline =
      kind === "preseason"
        ? "Preseason evaluation due"
        : "Biweekly evaluation due";
    // Spell out the due date so the coach knows exactly which round this
    // reminder is for. Filing an eval inside its window clears the banner.
    const sub = `${dueLabel ? `Due ${dueLabel}. ` : ""}${
      isHead
        ? "Open Evaluation and start a fresh round to clear this."
        : "Send your grades to the head coach to clear this."
    }`;
    return (
      <div
        className="rounded-2xl border border-line shadow-card p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4"
        style={{ backgroundColor: "var(--team-primary-15)" }}
      >
        <div
          className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: primaryColor, color: "white" }}
        >
          <Icons.Clipboard className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="t-eyebrow text-ink-2">{kind}</div>
          <div className="t-card-title text-ink mt-0.5">{headline}</div>
          <p className="text-xs text-ink-2 font-medium mt-1">{sub}</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={onStart}
            className="flex-1 sm:flex-none px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg shadow-md text-white"
            style={{ backgroundColor: primaryColor }}
          >
            Start Now
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="px-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-ink-3 hover:text-ink hover:bg-surface-2 rounded-lg"
          >
            Snooze
          </button>
        </div>
      </div>
    );
  }
);

/* ============================================================================
   Dashboard overhaul — info-rich, intuitive command center.
   Sections:
     1. UpcomingGameCard — same selection logic, day-state-aware CTAs
     2. Team Header Card — team meta + record + roster/games tiles
     3. Insight Tiles Row — pitcher availability / recent movement / eval
        momentum / team trend (only rendered when data is present)
     4. Leaderboards — compressed 3-up by default, expandable to full set
     5. Empty states — when no players or no games are on the team yet
   ============================================================================ */

const HITTING_STATS = [
  { title: "Batting Avg", statKey: "avg", formatStr: true, asc: false },
  { title: "On Base Pct", statKey: "obp", formatStr: true, asc: false },
  { title: "OPS Rating", statKey: "ops", formatStr: true, asc: false },
  { title: "Hits", statKey: "h", formatStr: false, asc: false },
  { title: "Doubles", statKey: "doubles", formatStr: false, asc: false },
  { title: "Triples", statKey: "triples", formatStr: false, asc: false },
  { title: "Home Runs", statKey: "hr", formatStr: false, asc: false },
  { title: "RBI", statKey: "rbi", formatStr: false, asc: false },
  { title: "Stolen Bases", statKey: "sb", formatStr: false, asc: false },
  { title: "Strikeouts", statKey: "k", formatStr: false, asc: true },
];

const FIELDING_STATS = [
  { title: "Fielding Pct", statKey: "fpct", formatStr: true, asc: false },
  { title: "Total Chances", statKey: "tc", formatStr: false, asc: false },
  { title: "Putouts", statKey: "po", formatStr: false, asc: false },
  { title: "Assists", statKey: "a", formatStr: false, asc: false },
];

const PITCHING_STATS = [
  { title: "ERA", statKey: "era", formatStr: true, asc: true },
  { title: "Innings Pitched", statKey: "ip", formatStr: true, asc: false },
];

/* ===========================================================================
   UpcomingGameCard — kept mostly intact; minor visual fixes:
   - Use --team-* CSS vars so it retints with team theme
   - Bigger date+opponent line, clearer day-state chip
=========================================================================== */
const UpcomingGameCard = memo(({ primaryColor, tertiaryColor }: any) => {
  const { team, currentRole } = useTeam();
  // Assistants can't author a lineup, so swap the dual-state CTA for a
  // single read-only "Gameplan" view-button that only appears once the
  // head has set the lineup. When no lineup exists yet, hide the CTA
  // entirely — pointing them at a Schedule screen they can't act on
  // would be misleading.
  const isAssistant = currentRole === "assistant";
  const {
    setActiveTab,
    setSelectedGameId,
    setOpponentName,
    setLineup,
    setBattingLineup,
    setCurrentGameAttendance,
    setScoringGameId,
    setInGameId,
    setInGameInning,
    setInGameSelection,
    setInGameUndoStack,
    setIsAddingGame,
  } = useUI();

  const { games, leagueRuleSet, pitchingFormat } = team;

  const todayStr = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
  }, []);

  // Deep-link to a specific game's editor in the Schedule tab (mirrors the
  // hero card's CTA, reused by the compact "no game this week" state).
  const goToGame = (g: any) => {
    setSelectedGameId(g.id);
    setOpponentName(g.opponent);
    setLineup(g.lineup || null);
    setBattingLineup(g.battingLineup || null);
    setCurrentGameAttendance(g.attendance || {});
    setActiveTab("schedule");
  };

  // Compact fallback card — keeps the "Next Game" slot anchored (never blank)
  // when there's no game inside the prep window. Same chrome as the hero card.
  const renderCompact = ({ title, subtitle, cta }: any) => (
    <div className="relative rounded-2xl shadow-card border border-line overflow-hidden bg-surface">
      <div
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: primaryColor }}
      />
      <div className="p-5 sm:p-6 pl-6 sm:pl-7 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className="p-3 rounded-xl shrink-0"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Calendar className="w-6 h-6" style={{ color: primaryColor }} />
          </div>
          <div className="min-w-0">
            <div className="text-[9px] font-extrabold uppercase tracking-widest text-ink-3 mb-0.5">
              Next Game
            </div>
            <h3 className="font-black text-lg sm:text-xl text-ink uppercase tracking-tight leading-tight">
              {title}
            </h3>
            <p className="text-[11px] font-bold text-ink-3 uppercase tracking-widest mt-1">
              {subtitle}
            </p>
          </div>
        </div>
        {cta}
      </div>
    </div>
  );

  const addGameBtn = !isAssistant ? (
    <button
      onClick={() => {
        setActiveTab("schedule");
        setIsAddingGame(true);
      }}
      className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
      style={{ backgroundColor: primaryColor, color: tertiaryColor }}
    >
      <Icons.Plus className="w-4 h-4" /> Add Game
    </button>
  ) : null;

  const upcoming = useMemo(() => {
    const eligible = (games || [])
      .filter((g: any) => (g.status || "scheduled") !== "postponed")
      // Once a score is entered the game is "in the books" — drop it so the
      // card advances to the next game to prep, however far out it is.
      .filter((g: any) => !isGameFinalized(g))
      .filter((g: any) => g.date && g.date >= todayStr)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    if (eligible.length === 0) return null;
    const next = eligible[0];
    const dayDiff = Math.round(
      (new Date(next.date).getTime() - new Date(todayStr).getTime()) / 86400000
    );
    const sameDayCount = eligible.filter((g: any) => g.date === next.date).length;
    return { game: next, dayDiff, sameDayCount };
  }, [games, todayStr]);

  // No upcoming game (every scheduled game has a score, or none are ahead).
  // Keep the Dashboard anchored with a compact prompt instead of vanishing.
  if (!upcoming) {
    return renderCompact({
      title: "No upcoming games",
      subtitle: "Every scheduled game is in the books.",
      cta: addGameBtn,
    });
  }

  const { game, dayDiff, sameDayCount } = upcoming;

  // Outside the one-week prep window the "Next Game" hero would be premature,
  // so show a compact line with the matchup + date instead (never blank).
  if (dayDiff > 7) {
    return renderCompact({
      title: "No game this week",
      subtitle: `Next: vs ${game.opponent} · ${formatGameDateDisplay(
        game.date
      )} · in ${dayDiff} days`,
      // Mirror the Schedule list's `(canEdit || game.lineup)` guard: an
      // assistant can only open a game once the head has set a lineup.
      // Without this, the View CTA would deep-link them into the game
      // editor's ungated setup controls before any lineup exists.
      cta:
        !isAssistant || game.lineup ? (
          <button
            onClick={() => goToGame(game)}
            className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            <Icons.Clipboard className="w-4 h-4" /> View
          </button>
        ) : null,
    });
  }

  const isFinal = isGameFinalized(game);

  // At-a-glance attendance state for the next game, so the coach doesn't build
  // a lineup before confirming who's coming. `attendance` maps playerId→bool;
  // an empty map means nobody's been marked yet (everyone defaults present).
  const attMap = game.attendance || {};
  const attMarked = Object.keys(attMap).length;
  const attOut = Object.values(attMap).filter((v) => v === false).length;

  let whenLabel;
  if (dayDiff === 0) whenLabel = "Today";
  else if (dayDiff === 1) whenLabel = "Tomorrow";
  else if (dayDiff <= 6) {
    const [y, m, d] = game.date.split("-");
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    whenLabel = dateObj.toLocaleDateString(undefined, { weekday: "long" });
  } else {
    // More than a week out — a weekday name alone is ambiguous, so show the
    // distance. The full date still appears on the line below.
    whenLabel = `In ${dayDiff} days`;
  }
  const fullDate = formatGameDateDisplay(game.date);
  // Scoreboard-style date block (MON / DD).
  const [gy, gm, gd] = (game.date || "").split("-");
  const dateBlockObj = gy
    ? new Date(Number(gy), Number(gm) - 1, Number(gd))
    : null;
  const monthAbbr = dateBlockObj
    ? dateBlockObj.toLocaleDateString(undefined, { month: "short" }).toUpperCase()
    : "";
  const dayNum = gd ? String(Number(gd)) : "";

  const openInSchedule = () => goToGame(game);
  const openScoreEditor = () => {
    setScoringGameId(game.id);
    setActiveTab("schedule");
  };
  // Drop straight into live In-Game mode from the dashboard — the one-tap
  // gameday action once a lineup exists.
  const startGame = () => {
    setInGameId(game.id);
    setInGameInning(0);
    setInGameSelection(null);
    setInGameUndoStack([]);
  };
  // On gameday the dashboard flips into "Start Game" mode: the live in-game
  // launch becomes the headline CTA and lineup/score edits drop to secondary
  // outline chips. Until a lineup exists you can't start, so "Plan Lineup"
  // takes the headline slot instead.
  const isGameDay = dayDiff === 0 && !isFinal;
  const result = isFinal
    ? game.teamScore > game.opponentScore
      ? "win"
      : game.teamScore < game.opponentScore
      ? "loss"
      : "tie"
    : null;

  return (
    <div className="relative rounded-2xl shadow-card border border-line overflow-hidden bg-surface">
      <div
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: primaryColor }}
      />
      <div className="p-5 sm:p-6 pl-6 sm:pl-7 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4 sm:gap-5 min-w-0">
          {/* Scoreboard-style date block */}
          <div
            className="shrink-0 w-16 text-center rounded-xl border overflow-hidden shadow-sm"
            style={{ borderColor: `${primaryColor}55` }}
          >
            <div
              className="text-[9px] font-black uppercase tracking-widest py-1"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              {monthAbbr}
            </div>
            <div className="text-3xl font-black tabular-nums text-ink py-1.5">
              {dayNum}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-ink-3">
                Next Game
              </span>
              <span
                className="text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-md"
                style={{ backgroundColor: primaryColor, color: tertiaryColor }}
              >
                {whenLabel}
              </span>
              {isFinal && (
                <span
                  className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border tabular-nums ${
                    result === "win"
                      ? "bg-win-bg text-win border-line"
                      : result === "loss"
                      ? "bg-loss-bg text-loss border-line"
                      : "bg-warn-bg text-warnfg border-line"
                  }`}
                >
                  {result === "win" ? "W" : result === "loss" ? "L" : "T"}{" "}
                  {game.teamScore}-{game.opponentScore}
                </span>
              )}
              {!isFinal && game.lineup && (
                <span className="bg-win-bg text-win text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-line">
                  Lineup Ready
                </span>
              )}
              {!isFinal && !game.lineup && (
                <span className="bg-warn-bg text-warnfg text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-line">
                  Lineup Needed
                </span>
              )}
              {/* Attendance state. Shows who's out at a glance; nudges the
                  coach to set attendance during prep (only when none marked
                  and there's no lineup yet, to avoid nagging coaches who
                  don't track it). */}
              {!isFinal && attOut > 0 && (
                <span className="bg-warn-bg text-warnfg text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-line tabular-nums">
                  {attOut} Out
                </span>
              )}
              {!isFinal && attMarked > 0 && attOut === 0 && (
                <span className="bg-win-bg text-win text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-line">
                  All In
                </span>
              )}
              {!isFinal && attMarked === 0 && !game.lineup && (
                <span className="bg-surface-2 text-ink-3 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-line">
                  Set Attendance
                </span>
              )}
            </div>
            <h3 className="font-black text-xl sm:text-2xl text-ink uppercase tracking-tight leading-tight">
              {game.isHome === false ? "@ " : "VS. "}
              {game.opponent}
            </h3>
            <p className="text-[11px] font-bold text-ink-3 uppercase tracking-widest mt-1 flex items-center gap-2 flex-wrap">
              <Icons.Clock className="w-3.5 h-3.5" /> {fullDate}
              {isoInstantToLocalTime(game.startUtc) && (
                <>
                  <span className="text-ink-3">·</span>
                  <span>{isoInstantToLocalTime(game.startUtc)}</span>
                </>
              )}
              <span className="text-ink-3">|</span>
              <span>
                {leagueRuleSetLabel(game.leagueRuleSet || leagueRuleSet)}{" "}
                {game.pitchingFormat || pitchingFormat}
              </span>
              {game.location && (
                <>
                  <span className="text-ink-3">|</span>
                  <span className="normal-case tracking-normal">
                    {String(game.location).split("\n")[0]}
                  </span>
                </>
              )}
              {sameDayCount > 1 && (
                <>
                  <span className="text-ink-3">|</span>
                  <span className="text-team-primary">
                    +{sameDayCount - 1} more{" "}
                    {whenLabel.toLowerCase() === "today" ? "today" : "this day"}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
          {isAssistant ? (
            // Assistants can't author or run a game — only peek at the plan.
            game.lineup && (
              <button
                onClick={openInSchedule}
                className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
                style={{ backgroundColor: primaryColor, color: tertiaryColor }}
              >
                <Icons.Clipboard className="w-4 h-4" /> Gameplan
              </button>
            )
          ) : isGameDay ? (
            <>
              {game.lineup ? (
                // Headline gameday CTA — straight into live In-Game mode.
                <button
                  onClick={startGame}
                  className="flex-1 sm:flex-none text-sm px-7 py-3.5 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-lg bg-green-600 text-white hover:bg-green-700"
                >
                  <Icons.Forward className="w-4 h-4" /> Start Game
                </button>
              ) : (
                // No lineup yet — you can't start, so making one is the
                // headline action.
                <button
                  onClick={openInSchedule}
                  className="flex-1 sm:flex-none text-sm px-7 py-3.5 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-lg"
                  style={{ backgroundColor: primaryColor, color: tertiaryColor }}
                >
                  <Icons.Clipboard className="w-4 h-4" /> Plan Lineup
                </button>
              )}
              {/* Secondary gameday actions — demoted to outline chips so the
                  headline CTA stays the obvious one-tap. */}
              {game.lineup && (
                <button
                  onClick={openInSchedule}
                  className="flex-1 sm:flex-none text-xs px-4 py-2.5 bg-surface text-ink border border-line font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-2 transition-colors rounded-xl shadow-sm"
                >
                  <Icons.Edit className="w-4 h-4" /> Edit Lineup
                </button>
              )}
              <button
                onClick={openScoreEditor}
                className="flex-1 sm:flex-none text-xs px-4 py-2.5 bg-surface text-ink border border-line font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-2 transition-colors rounded-xl shadow-sm"
              >
                <Icons.FileText className="w-4 h-4" /> Final Score
              </button>
            </>
          ) : (
            // Prep mode (game is still days out) — building the lineup is the
            // primary action.
            <button
              onClick={openInSchedule}
              className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              {game.lineup ? (
                <>
                  <Icons.Edit className="w-4 h-4" /> Edit Lineup
                </>
              ) : (
                <>
                  <Icons.Clipboard className="w-4 h-4" /> Plan Lineup
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

/* ===========================================================================
   InsightTile — small, presentational shell shared by every tile in the
   row. Header has an icon halo + title + optional CTA chip; body slot is
   freeform for each tile's content.
=========================================================================== */
const InsightTile = memo(
  ({ icon: Icon, title, accent = "slate", onClick, ctaLabel, children }: any) => {
    // Semantic-lane tokens flip with [data-theme] so the halos don't glare
    // in dark mode.
    const ACCENT_STYLES = {
      primary: { halo: "var(--team-primary-15)", text: "var(--team-primary)" },
      success: { halo: "var(--win-bg)", text: "var(--win)" },
      warn: { halo: "var(--warn-bg)", text: "var(--warn-fg)" },
      danger: { halo: "var(--loss-bg)", text: "var(--loss)" },
      info: { halo: "var(--info-bg)", text: "var(--info-fg)" },
      slate: { halo: "var(--surface-2)", text: "var(--ink-2)" },
    };
    const styles = (ACCENT_STYLES as any)[accent] || ACCENT_STYLES.slate;
    return (
      <div className="bg-surface rounded-2xl shadow-card border border-line overflow-hidden flex flex-col h-full">
        <div className="px-4 py-3 border-b border-line bg-surface flex items-center gap-3">
          <div
            className="p-2 rounded-lg shrink-0"
            style={{ backgroundColor: styles.halo }}
          >
            <Icon className="w-4 h-4" style={{ color: styles.text }} />
          </div>
          <h4 className="t-eyebrow flex-1 truncate">{title}</h4>
          {onClick && ctaLabel && (
            <button
              type="button"
              onClick={onClick}
              className="t-button text-ink-3 hover:text-ink flex items-center gap-0.5 shrink-0"
            >
              {ctaLabel}
              <Icons.ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="p-4 flex-1 min-h-[80px]">{children}</div>
      </div>
    );
  }
);

/* ===========================================================================
   PitcherAvailabilityTile — Kid Pitch only. Counts how many rostered
   pitchers are eligible today by the engine's checkPitchEligibility rules.
=========================================================================== */
const PitcherAvailabilityTile = memo(({ players, teamAge, todayStr, onOpenRoster }: any) => {
  const stats = useMemo(() => {
    let eligible = 0;
    let resting = 0;
    let maxed = 0;
    const resters = [];
    for (const p of players || []) {
      if (!p) continue;
      // Only kids the coach considers candidates: not explicitly restricted from P.
      const restricted = Array.isArray(p.restrictions) && p.restrictions.includes("P");
      if (restricted) continue;
      const isEligible = checkPitchEligibility(p, todayStr, teamAge);
      const recent = p.pitching?.recentPitches || 0;
      if (isEligible && recent === 0) {
        eligible++;
      } else if (isEligible) {
        // Has recent activity but rest days satisfied
        eligible++;
      } else if (recent >= 50) {
        // Heuristic: 50+ recent pitches = "at the limit" until more rest
        maxed++;
        resters.push({ name: p.name, recent, label: "limit" });
      } else {
        resting++;
        resters.push({ name: p.name, recent, label: "rest" });
      }
    }
    return { eligible, resting, maxed, resters };
  }, [players, teamAge, todayStr]);

  return (
    <InsightTile
      icon={Icons.Pitch}
      title="Pitcher Availability"
      accent="success"
      ctaLabel="See Roster"
      onClick={onOpenRoster}
    >
      <div className="flex items-baseline gap-3 mb-3">
        <div className="t-stat-num text-ink">{stats.eligible}</div>
        <div className="t-eyebrow">eligible today</div>
      </div>
      {stats.resters.length === 0 ? (
        <p className="text-[11px] text-ink-3 font-medium">
          Full bullpen available — no rest or pitch-limit holds.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {stats.resters.slice(0, 4).map((r, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md t-chip border ${
                r.label === "limit"
                  ? "bg-loss-bg border-line text-loss"
                  : "bg-warn-bg border-line text-warnfg"
              }`}
              title={`${r.recent} recent pitches`}
            >
              {r.name}
            </span>
          ))}
          {stats.resters.length > 4 && (
            <span className="t-chip px-2 py-1 rounded-md bg-surface-2 border border-line text-ink-2">
              +{stats.resters.length - 4}
            </span>
          )}
        </div>
      )}
    </InsightTile>
  );
});

/* ===========================================================================
   RecentMovementTile — OPS movement since the previous stat update. Two
   sources, per player: the statsHistory snapshot a CSV import writes, or
   (when no snapshot exists — coaches who import stats per game) a
   before/after derivation of their game lines via latestGameLineMovement.
   With per-game imports everyone's season line moves every game, so the
   tile keeps only the headline: the 2 biggest risers and 2 biggest fallers.
=========================================================================== */
const RECENT_MOVEMENT_PER_DIRECTION = 2;

const RecentMovementTile = memo(({ players, games, onPlayerClick }: any) => {
  const movers = useMemo(() => {
    const all: Array<{ player: any; delta: number }> = [];
    for (const p of players || []) {
      const history = Array.isArray(p?.statsHistory) ? p.statsHistory : [];
      let priorOps: number | null = null;
      let curOps = Number(p.stats?.ops) || 0;
      if (history.length > 0) {
        priorOps = Number(history[history.length - 1]?.stats?.ops) || 0;
      } else {
        const move = latestGameLineMovement(games, p.id);
        if (move) {
          priorOps = Number(move.prior.ops) || 0;
          curOps = Number(move.current.ops) || curOps;
        }
      }
      if (priorOps == null) continue;
      if (priorOps === 0 && curOps === 0) continue;
      const delta = curOps - priorOps;
      if (Math.abs(delta) < 0.005) continue;
      all.push({ player: p, delta });
    }
    // Risers first (biggest jump on top), then fallers (biggest drop last).
    all.sort((a, b) => b.delta - a.delta);
    return all;
  }, [players, games]);

  if (movers.length === 0) {
    return (
      <InsightTile icon={Icons.Refresh} title="Recent Movement" accent="info">
        <p className="text-[11px] text-ink-3 font-medium italic">
          Import stats again after your next game to track movement — it
          shows once a player has two stat updates to compare.
        </p>
      </InsightTile>
    );
  }

  const fmt = (n: any) => (n >= 0 ? "+" : "") + n.toFixed(3).replace(/^([-]?)0\./, "$1.");
  // movers is sorted by delta desc, so the biggest jumps lead and the
  // biggest drops close the list.
  const shown = [
    ...movers.filter((m) => m.delta > 0).slice(0, RECENT_MOVEMENT_PER_DIRECTION),
    ...movers.filter((m) => m.delta < 0).slice(-RECENT_MOVEMENT_PER_DIRECTION),
  ];

  return (
    <InsightTile icon={Icons.Refresh} title="Recent Movement" accent="info">
      <div className="space-y-1.5">
        {shown.map(({ player, delta }) => (
          <button
            key={player.id}
            type="button"
            onClick={() => onPlayerClick?.(player.id)}
            className={`w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border border-line/80 transition-colors shadow-sm ${
              delta > 0
                ? "bg-win-bg/40 hover:bg-win-bg"
                : "bg-loss-bg/40 hover:bg-loss-bg"
            }`}
          >
            <span
              className={`t-body-bold truncate ${
                delta > 0 ? "text-emerald-900" : "text-rose-900"
              }`}
            >
              {player.name}
            </span>
            <span
              className={`t-stat-num-sm tabular-nums shrink-0 ${
                delta > 0 ? "text-win" : "text-loss"
              }`}
            >
              {delta > 0 ? "↑" : "↓"} OPS {fmt(delta)}
            </span>
          </button>
        ))}
      </div>
    </InsightTile>
  );
});

/* ===========================================================================
   EvalMomentumTile — auto-flags top standouts/regressions between the two
   most recent evaluation rounds. Mirrors InsightsPanel logic from
   EvaluationTab without rendering the heavy round-comparison UI.
=========================================================================== */
const EvalMomentumTile = memo(({ players, evaluationEvents, onOpenEval }: any) => {
  const flags = useMemo(() => {
    if (!Array.isArray(evaluationEvents) || evaluationEvents.length < 2) {
      return { top: null, bottom: null };
    }
    const sorted = [...evaluationEvents].sort((a, b) =>
      String(b.date).localeCompare(String(a.date))
    );
    const latest = sorted[0];
    const prev = sorted[1];
    const avgUniversal = (g: any) => {
      if (!g) return null;
      const keys = [
        "contact",
        "power",
        "plateDiscipline",
        "approach",
        "glove",
        "range",
        "armStrength",
        "armAccuracy",
        "speed",
        "baserunning",
        "baseballIQ",
        "coachability",
      ];
      const vals = keys
        .map((k) => Number(g[k]))
        .filter((v) => Number.isFinite(v) && v >= 1 && v <= 10);
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    let top = null;
    let bottom = null;
    for (const p of players || []) {
      const a = avgUniversal(latest.grades?.[p.id]);
      const b = avgUniversal(prev.grades?.[p.id]);
      if (a == null || b == null) continue;
      const delta = a - b;
      if (Math.abs(delta) < 0.4) continue;
      if (delta > 0 && (!top || delta > top.delta)) top = { player: p, delta };
      if (delta < 0 && (!bottom || delta < bottom.delta))
        bottom = { player: p, delta };
    }
    return { top, bottom };
  }, [players, evaluationEvents]);

  if (!flags.top && !flags.bottom) return null;

  const fmt = (n: any) => (n >= 0 ? "+" : "") + n.toFixed(1);

  return (
    <InsightTile
      icon={Icons.Clipboard}
      title="Eval Momentum"
      accent="warn"
      ctaLabel="See Trends"
      onClick={onOpenEval}
    >
      <div className="space-y-2">
        {flags.top && (
          <div className="flex items-center justify-between gap-2">
            <span className="t-body-bold text-ink truncate">
              {flags.top.player.name}
            </span>
            <span className="t-stat-num-sm text-win tabular-nums shrink-0">
              ↑ {fmt(flags.top.delta)}
            </span>
          </div>
        )}
        {flags.bottom && (
          <div className="flex items-center justify-between gap-2">
            <span className="t-body-bold text-ink truncate">
              {flags.bottom.player.name}
            </span>
            <span className="t-stat-num-sm text-loss tabular-nums shrink-0">
              ↓ {fmt(flags.bottom.delta)}
            </span>
          </div>
        )}
      </div>
    </InsightTile>
  );
});

/* ===========================================================================
   TeamTrendTile — last-5 W/L sparkline + run differential, derived from
   finalized games in `team.games`.
=========================================================================== */
const TeamTrendTile = memo(({ games }: any) => {
  const data = useMemo(() => {
    const finals = (games || [])
      .filter(countsTowardStats)
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    const last5 = finals.slice(-5);
    const results = last5.map((g: any) => {
      if (g.teamScore > g.opponentScore) return "W";
      if (g.teamScore < g.opponentScore) return "L";
      return "T";
    });
    const diff = last5.reduce(
      (acc: any, g: any) => acc + (g.teamScore - g.opponentScore),
      0
    );
    return { results, diff, count: last5.length };
  }, [games]);

  if (data.count === 0) return null;

  return (
    <InsightTile icon={Icons.Bat} title="Last 5 Games" accent="primary">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="t-stat-num text-ink">
          {data.results.filter((r: any) => r === "W").length}
          <span className="text-ink-3 text-2xl">-</span>
          {data.results.filter((r: any) => r === "L").length}
          {data.results.filter((r: any) => r === "T").length > 0 && (
            <>
              <span className="text-ink-3 text-2xl">-</span>
              {data.results.filter((r: any) => r === "T").length}
            </>
          )}
        </span>
        <span
          className={`t-eyebrow tabular-nums ${
            data.diff > 0
              ? "text-win"
              : data.diff < 0
              ? "text-loss"
              : "text-ink-3"
          }`}
        >
          {data.diff >= 0 ? "+" : ""}
          {data.diff} run diff
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {data.results.map((r: any, i: any) => (
          <span
            key={i}
            className={`flex-1 h-7 rounded-md grid place-items-center t-button text-white ${
              r === "W"
                ? "bg-win-bg0"
                : r === "L"
                ? "bg-loss-bg0"
                : "bg-warn-bg0"
            }`}
            title={`Game ${i + 1}: ${r}`}
          >
            {r}
          </span>
        ))}
      </div>
    </InsightTile>
  );
});

/* Empty-state CTAs (No Games / No Players) use the shared EmptyState. */

/* ===========================================================================
   BenchEquityTile — season-wide reminder of who's been over- or under-played.
   Uses the same buildSeasonBenchImbalance helper already powering the
   ScheduleTab per-game imbalance card, but rolled up across every finalized
   game. The engine already biases lineups for fairness via priorRatio; this
   tile just makes the running deficit visible at a glance so the coach can
   spot kids who keep falling behind and decide whether to nudge it (e.g.
   move someone to a Big Game position for a game).
=========================================================================== */
const BenchEquityTile = memo(({ players, games, onPlayerClick }: any) => {
  const rows = React.useMemo(() => {
    const imbalance = buildSeasonBenchImbalance(games, "", players);
    return (players || [])
      .map((p: any) => {
        const data =
          imbalance.get(p.id) || {
            totalDefense: 0,
            expectedDefense: 0,
            gamesAttended: 0,
          };
        return {
          player: p,
          delta: data.totalDefense - data.expectedDefense,
          gamesAttended: data.gamesAttended,
        };
      })
      .filter((r: any) => r.gamesAttended > 0);
  }, [players, games]);

  const anyImbalance = rows.some((r: any) => Math.abs(r.delta) >= 1);
  if (rows.length === 0) {
    return (
      <InsightTile icon={Icons.Users} title="Bench Equity" accent="slate">
        <p className="t-body text-ink-3 italic text-xs">
          No finalized games yet. Once you finalize a game, each kid's
          season-wide bench vs play balance will surface here.
        </p>
      </InsightTile>
    );
  }
  if (!anyImbalance) {
    return (
      <InsightTile icon={Icons.Users} title="Bench Equity" accent="success">
        <p className="t-body text-win text-xs font-bold">
          Everyone's within 1 inning of their fair share across the season.
          Keep it up.
        </p>
      </InsightTile>
    );
  }
  // Two ends: the kid who's been benched the LEAST (positive delta = played
  // more than fair share, red), and the kid who's been benched the MOST
  // (negative delta = played less than fair share, green-to-amber). Pull
  // the top-2 on each side so the tile stays compact.
  const sortedByDelta = [...rows].sort((a, b) => b.delta - a.delta);
  const overPlayed = sortedByDelta
    .filter((r) => r.delta >= 1)
    .slice(0, 2);
  const underPlayed = sortedByDelta
    .filter((r) => r.delta <= -1)
    .slice(-2)
    .reverse();
  const renderRow = ({ player, delta }: any) => {
    const rounded = Math.round(delta);
    const isOver = rounded > 0;
    return (
      <button
        key={player.id}
        type="button"
        onClick={() => onPlayerClick?.(player.id)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-surface-2 transition-colors text-left"
      >
        <span className="text-xs font-black uppercase tracking-tight text-ink truncate">
          {player.name}
        </span>
        <span
          className={`shrink-0 text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md border ${
            isOver
              ? "bg-loss-bg border-line text-loss"
              : "bg-win-bg border-line text-win"
          }`}
          title={
            isOver
              ? "Played more than fair share this season"
              : "Played less than fair share this season"
          }
        >
          {isOver ? "+" : ""}
          {rounded} inn
        </span>
      </button>
    );
  };
  return (
    <InsightTile icon={Icons.Users} title="Bench Equity" accent="warn">
      <div className="space-y-2">
        {underPlayed.length > 0 && (
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-win mb-0.5">
              Owed innings
            </div>
            <div className="flex flex-col">{underPlayed.map(renderRow)}</div>
          </div>
        )}
        {overPlayed.length > 0 && (
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-loss mb-0.5">
              Has played extra
            </div>
            <div className="flex flex-col">{overPlayed.map(renderRow)}</div>
          </div>
        )}
        <p className="text-[10px] font-medium text-ink-3 italic leading-snug pt-0.5">
          Engine biases new lineups to even this out, but lean on Big Game
          bench picks if a gap keeps growing.
        </p>
      </div>
    </InsightTile>
  );
});

export const HomeTab = memo(() => {
  const { team, teams, activeTeamId, record, user, currentRole } = useTeam();
  const {
    openPlayerProfile,
    setActiveTab,
    setIsAddingGame,
    setIsAddingPlayer,
  } = useUI();
  const isHead = currentRole !== "assistant";
  const promptStatus = useMemo(
    () =>
      evalPromptStatus(
        team,
        user?.uid,
        isHead ? "Head" : "Assistant"
      ),
    [team, user, isHead]
  );
  const {
    players,
    coaches,
    games,
    evaluationEvents,
    leagueRuleSet,
    teamAge,
    currentSeason,
    pitchingFormat,
    primaryColor,
    tertiaryColor,
  } = team;
  const stripped = team.statDisplay === "stripped";
  const activeTeamName =
    teams.find((t: any) => t.id === activeTeamId)?.name || "TEAM";
  const headCoaches = coaches.filter((c: any) => c.role === "Head Coach");
  const assistantCoaches = coaches.filter((c: any) => c.role === "Assistant Coach");

  const todayStr = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
  }, []);

  const isKidPitch =
    typeof pitchingFormat === "string" &&
    pitchingFormat.toLowerCase().includes("kid");

  const hasGames = (games || []).length > 0;
  const hasPlayers = (players || []).length > 0;

  // Scoreboard-hero stats: run totals, last-5 form, and win pct. Uses the
  // shared isGameFinalized() so it agrees with the record badge + trend tile.
  const seasonHero = useMemo(() => {
    const finals = (games || [])
      .filter(countsTowardStats)
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    let runsFor = 0;
    let runsAgainst = 0;
    for (const g of finals) {
      runsFor += Number(g.teamScore) || 0;
      runsAgainst += Number(g.opponentScore) || 0;
    }
    const form = finals
      .slice(-5)
      .map((g: any) =>
        g.teamScore > g.opponentScore
          ? "W"
          : g.teamScore < g.opponentScore
          ? "L"
          : "T"
      );
    const total = record.wins + record.losses + record.ties;
    const winPctStr =
      total > 0
        ? recordWinningPercentage(record).toFixed(3).replace(/^0/, "")
        : "—";
    return {
      runsFor,
      runsAgainst,
      diff: runsFor - runsAgainst,
      form,
      winPctStr,
      finalsCount: finals.length,
    };
  }, [games, record]);

  return (
    <div className="space-y-8">
      {promptStatus.active && (
        <EvalPromptBanner
          kind={promptStatus.kind}
          isHead={isHead}
          primaryColor={primaryColor}
          dueDate={promptStatus.nextDueDate}
          onStart={() => {
            setActiveTab("evaluation");
          }}
        />
      )}
      {hasGames ? (
        <UpcomingGameCard
          primaryColor={primaryColor}
          tertiaryColor={tertiaryColor}
          onPlayerClick={openPlayerProfile}
        />
      ) : (
        <EmptyState
          glyph="📅"
          title="No Games Yet"
          body="Add your first game to start planning lineups. Once a game exists, the dashboard wakes up — today's game, pitcher availability, and trend insights all flow from here."
          action={
            <>
              <Icons.Plus className="w-4 h-4" /> Add Your First Game
            </>
          }
          onAction={() => {
            setActiveTab("schedule");
            setIsAddingGame(true);
          }}
        />
      )}

      {/* ===== Scoreboard hero — record, form, run splits ===== */}
      <div
        className="relative overflow-hidden rounded-3xl shadow-xl glow-primary cc-sheen text-white"
        style={{
          background:
            "radial-gradient(120% 140% at 0% 0%, var(--team-primary-bright), var(--team-primary) 45%, var(--team-primary-2) 100%)",
        }}
      >
        <div
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: "rgba(255,255,255,0.7)" }}
        />
        <div className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] opacity-80">
                {activeTeamName}
              </div>
              <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 mt-2">
                <span className="font-black tabular-nums leading-none whitespace-nowrap text-5xl sm:text-6xl">
                  <AnimatedNumber value={record.wins} />
                  <span className="opacity-50">–</span>
                  <AnimatedNumber value={record.losses} />
                  {record.ties > 0 && (
                    <>
                      <span className="opacity-50">–</span>
                      <AnimatedNumber value={record.ties} />
                    </>
                  )}
                </span>
                {seasonHero.finalsCount > 0 && (
                  <span className="text-[11px] font-black uppercase tracking-widest opacity-85 leading-tight">
                    {seasonHero.winPctStr}
                    <br />
                    win pct
                  </span>
                )}
              </div>
              {/* Record split by pitching format — shown only when the team has
                  played BOTH (otherwise it just repeats the combined record). */}
              {!stripped && (() => {
                const bf = (record as any).byFormat;
                const has = (r: any) =>
                  r && r.wins + r.losses + r.ties > 0;
                const fmt = (r: any) =>
                  r.ties > 0
                    ? `${r.wins}–${r.losses}–${r.ties}`
                    : `${r.wins}–${r.losses}`;
                if (!bf || !has(bf.kidPitch) || !has(bf.machine)) return null;
                return (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-[10px] font-black uppercase tracking-widest tabular-nums px-2 py-1 rounded-md bg-white/15">
                      Kid Pitch {fmt(bf.kidPitch)}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest tabular-nums px-2 py-1 rounded-md bg-white/15">
                      Machine/Coach {fmt(bf.machine)}
                    </span>
                  </div>
                );
              })()}
            </div>
            <div className="text-right shrink-0">
              <div className="text-[9px] font-extrabold uppercase tracking-widest opacity-75">
                Season
              </div>
              <div className="text-sm font-black uppercase tracking-wide mt-1">
                {currentSeason}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-80 mt-1">
                {teamAge} · {leagueRuleSetLabel(leagueRuleSet)}
              </div>
            </div>
          </div>

          {!stripped && seasonHero.form.length > 0 && (
            <div className="flex items-center gap-1.5 mt-5">
              <span className="text-[9px] font-extrabold uppercase tracking-widest opacity-75 mr-1">
                Form
              </span>
              {seasonHero.form.map((r: any, i: any) => (
                <span
                  key={i}
                  className={`w-6 h-6 rounded grid place-items-center text-[10px] font-black ${
                    r === "W" ? "bg-white" : "bg-black/25"
                  }`}
                  style={
                    r === "W" ? { color: "var(--team-primary-2)" } : undefined
                  }
                >
                  {r}
                </span>
              ))}
            </div>
          )}

          {stripped ? (
            <div className="mt-4 pt-3 border-t border-white/20 text-[11px] font-black uppercase tracking-widest tabular-nums opacity-85">
              Run diff {seasonHero.diff >= 0 ? "+" : ""}
              {Math.round(seasonHero.diff)} · Roster {players.length}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/20">
              {[
                { k: "Runs For", v: seasonHero.runsFor },
                { k: "Against", v: seasonHero.runsAgainst },
                {
                  k: "Run Diff",
                  v: seasonHero.diff,
                  format: (n: number) =>
                    `${n >= 0 ? "+" : ""}${Math.round(n)}`,
                },
                { k: "Roster", v: players.length },
              ].map((s: any) => (
                <div key={s.k}>
                  <div className="text-[9px] font-extrabold uppercase tracking-widest opacity-75">
                    {s.k}
                  </div>
                  <div className="text-2xl font-black tabular-nums leading-none mt-1.5">
                    <AnimatedNumber value={s.v} format={s.format} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!stripped && pitchingFormat && (
            <div className="mt-4 inline-flex items-center text-[9px] font-extrabold uppercase tracking-widest bg-white/15 px-2.5 py-1 rounded">
              {pitchingFormat}
            </div>
          )}
        </div>
      </div>

      {/* Coaches */}
      {(headCoaches.length > 0 || assistantCoaches.length > 0) && (
        <div className="bg-surface border border-line rounded-xl shadow-card p-5 space-y-3">
          {headCoaches.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-ink-3 sm:w-32 shrink-0 sm:pt-0.5">
                Head Coach
              </span>
              <span className="text-sm font-bold text-ink">
                {headCoaches.map((c: any) => c.name).join(", ")}
              </span>
            </div>
          )}
          {assistantCoaches.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-ink-3 sm:w-32 shrink-0 sm:pt-0.5">
                Assistant Coaches
              </span>
              <span className="text-sm font-bold text-ink">
                {assistantCoaches.map((c: any) => c.name).join(", ")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Insight tiles row — only renders when there's a player to show */}
      {hasPlayers && (
        <StaggerList className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {isKidPitch && (
            <StaggerItem>
              <PitcherAvailabilityTile
                players={players}
                teamAge={teamAge}
                todayStr={todayStr}
                onOpenRoster={() => setActiveTab("roster")}
              />
            </StaggerItem>
          )}
          <StaggerItem>
            <RecentMovementTile
              players={players}
              games={games}
              onPlayerClick={openPlayerProfile}
            />
          </StaggerItem>
          <StaggerItem>
            <EvalMomentumTile
              players={players}
              evaluationEvents={evaluationEvents}
              onOpenEval={() => setActiveTab("evaluation")}
            />
          </StaggerItem>
          <StaggerItem>
            <TeamTrendTile games={games} />
          </StaggerItem>
          <StaggerItem>
            <BenchEquityTile
              players={players}
              games={games}
              onPlayerClick={openPlayerProfile}
            />
          </StaggerItem>
        </StaggerList>
      )}

      {!hasPlayers ? (
        <EmptyState
          glyph="🧢"
          title="No Players Yet"
          body="Add players to the roster or import last season's stats from a GameChanger CSV. Leaderboards and insights light up once you've got a roster in place."
          action={
            <>
              <Icons.UserPlus className="w-4 h-4" /> Add Your First Player
            </>
          }
          onAction={() => {
            setActiveTab("roster");
            setIsAddingPlayer(true);
          }}
        />
      ) : (
        <LeaderboardsSection
          players={players}
          isKidPitch={isKidPitch}
          primaryColor={primaryColor}
          tertiaryColor={tertiaryColor}
          onPlayerClick={openPlayerProfile}
          stripped={stripped}
        />
      )}
    </div>
  );
});

// Tabbed leaderboard section. All stats render within each tab (no
// hidden subsets) but the card density is tight so the whole section
// stays compact.
const LeaderboardsSection = memo(
  ({ players, isKidPitch, primaryColor, tertiaryColor, onPlayerClick, stripped = false }: any) => {
    const tabs = useMemo(() => {
      const out = [
        { id: "offense", label: "Offensive", icon: Icons.Bat, stats: HITTING_STATS },
        {
          id: "defense",
          label: "Defensive",
          icon: Icons.Glove,
          stats: FIELDING_STATS,
        },
      ];
      // Only show Pitching tab when at least one player has pitched (any IP).
      const anyPitches = (players || []).some(
        (p: any) => Number(p.stats?.ip) > 0 || Number(p.stats?.totalPitches) > 0
      );
      if (isKidPitch && anyPitches) {
        out.push({
          id: "pitching",
          label: "Pitching",
          icon: Icons.Pitch,
          stats: PITCHING_STATS,
        });
      }
      return out;
    }, [players, isKidPitch]);

    const [activeTab, setActiveTab] = useState(tabs[0]?.id || "offense");
    // Reset when tabs reshape (e.g., a pitcher gets innings).
    const visibleTab = tabs.find((t) => t.id === activeTab) || tabs[0];

    return (
      <div className="bg-surface rounded-xl shadow-card border border-line p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <h2 className="text-sm font-black uppercase tracking-tight text-ink">
            Leaderboards
          </h2>
          <div className="flex gap-1.5">
            {tabs.map((t) => {
              const isActive = t.id === visibleTab?.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md transition-colors ${
                    isActive
                      ? "shadow-sm"
                      : "text-ink-3 hover:bg-surface"
                  }`}
                  style={
                    isActive
                      ? {
                          backgroundColor: "var(--team-secondary)",
                          color: "var(--team-primary)",
                          border: "1px solid var(--team-primary)",
                        }
                      : {}
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        {stripped ? (
          <div className="rounded-lg border border-line divide-y divide-line overflow-hidden">
            {visibleTab?.stats.map((stat, i) => (
              <LeaderboardCard
                key={`${visibleTab.id}-${stat.statKey}-${i}`}
                {...stat}
                icon={visibleTab.icon}
                players={players}
                primaryColor={primaryColor}
                tertiaryColor={tertiaryColor}
                onPlayerClick={onPlayerClick}
                stripped
              />
            ))}
          </div>
        ) : (
          <StaggerList
            key={visibleTab?.id}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2"
          >
            {visibleTab?.stats.map((stat, i) => (
              <StaggerItem key={`${visibleTab.id}-${stat.statKey}-${i}`}>
                <LeaderboardCard
                  {...stat}
                  icon={visibleTab.icon}
                  players={players}
                  primaryColor={primaryColor}
                  tertiaryColor={tertiaryColor}
                  onPlayerClick={onPlayerClick}
                />
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </div>
    );
  }
);
