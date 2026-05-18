import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { formatGameDateDisplay, evalPromptStatus } from "../utils/helpers";
import { useTeam, useUI } from "../contexts.js";
import { LeaderboardCard, RecordBadge } from "../components/shared.jsx";
import { checkPitchEligibility } from "../lineupEngine";

// Dismissible banner that nudges the current coach to submit an eval round
// when the cadence (preseason or biweekly) is active.
const EvalPromptBanner = memo(
  ({ kind, isHead, primaryColor, onStart }) => {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;
    const headline =
      kind === "preseason"
        ? "Preseason evaluation due"
        : "Biweekly evaluation due";
    const sub = isHead
      ? "Open Evaluation and start a fresh round."
      : "Send your grades to the head coach.";
    return (
      <div
        className="rounded-2xl border border-white/50 shadow-card p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4"
        style={{ backgroundColor: "var(--team-primary-15)" }}
      >
        <div
          className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: primaryColor, color: "white" }}
        >
          <Icons.Clipboard className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="t-eyebrow text-slate-600">{kind}</div>
          <div className="t-card-title text-slate-900 mt-0.5">{headline}</div>
          <p className="text-xs text-slate-600 font-medium mt-1">{sub}</p>
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
            className="px-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 hover:bg-white/50 rounded-lg"
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
const UpcomingGameCard = memo(({ primaryColor, tertiaryColor }) => {
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
  } = useUI();

  const { games, leagueRuleSet, pitchingFormat } = team;

  const todayStr = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
  }, []);

  const upcoming = useMemo(() => {
    const eligible = (games || [])
      .filter((g) => (g.status || "scheduled") !== "postponed")
      .filter((g) => g.date && g.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (eligible.length === 0) return null;
    const next = eligible[0];
    const dayDiff = Math.round(
      (new Date(next.date) - new Date(todayStr)) / 86400000
    );
    if (dayDiff > 7) return null;
    const sameDayCount = eligible.filter((g) => g.date === next.date).length;
    return { game: next, dayDiff, sameDayCount };
  }, [games, todayStr]);

  if (!upcoming) return null;

  const { game, dayDiff, sameDayCount } = upcoming;
  const status = game.status || "scheduled";
  const isFinal =
    status === "final" &&
    Number.isFinite(game.teamScore) &&
    Number.isFinite(game.opponentScore);

  let whenLabel;
  if (dayDiff === 0) whenLabel = "Today";
  else if (dayDiff === 1) whenLabel = "Tomorrow";
  else {
    const [y, m, d] = game.date.split("-");
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    whenLabel = dateObj.toLocaleDateString(undefined, { weekday: "long" });
  }
  const fullDate = formatGameDateDisplay(game.date);

  const openInSchedule = () => {
    setSelectedGameId(game.id);
    setOpponentName(game.opponent);
    setLineup(game.lineup || null);
    setBattingLineup(game.battingLineup || null);
    setCurrentGameAttendance(game.attendance || {});
    setActiveTab("schedule");
  };
  const openScoreEditor = () => {
    setScoringGameId(game.id);
    setActiveTab("schedule");
  };
  const result = isFinal
    ? game.teamScore > game.opponentScore
      ? "win"
      : game.teamScore < game.opponentScore
      ? "loss"
      : "tie"
    : null;

  return (
    <div className="rounded-2xl shadow-card border border-white/50 overflow-hidden bg-white/40">
      <div className="h-1.5" style={{ backgroundColor: primaryColor }} />
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4 sm:gap-5">
          <div
            className="hidden sm:flex w-14 h-14 rounded-2xl items-center justify-center shrink-0 shadow-inner"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Calendar
              className="w-7 h-7"
              style={{ color: primaryColor }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                      ? "bg-green-50 text-green-800 border-green-200"
                      : result === "loss"
                      ? "bg-red-50 text-red-800 border-red-200"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}
                >
                  {result === "win" ? "W" : result === "loss" ? "L" : "T"}{" "}
                  {game.teamScore}-{game.opponentScore}
                </span>
              )}
              {!isFinal && game.lineup && (
                <span className="bg-green-50 text-green-700 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-green-200">
                  Lineup Ready
                </span>
              )}
              {!isFinal && !game.lineup && (
                <span className="bg-amber-50 text-amber-700 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-amber-200">
                  Lineup Needed
                </span>
              )}
            </div>
            <h3 className="font-black text-xl sm:text-2xl text-slate-900 uppercase tracking-tight leading-tight">
              {game.isBigGame && (
                <span
                  className="inline-block mr-1.5 text-yellow-500"
                  title="Big Game"
                  aria-label="Big Game"
                >
                  ⭐
                </span>
              )}
              VS. {game.opponent}
            </h3>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1 flex items-center gap-2 flex-wrap">
              <Icons.Clock className="w-3.5 h-3.5" /> {fullDate}
              <span className="text-slate-300">|</span>
              <span>
                {game.leagueRuleSet || leagueRuleSet}{" "}
                {game.pitchingFormat || pitchingFormat}
              </span>
              {sameDayCount > 1 && (
                <>
                  <span className="text-slate-300">|</span>
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
          {dayDiff === 0 && !isFinal && game.lineup && (
            <button
              onClick={() => {
                setInGameId(game.id);
                setInGameInning(0);
                setInGameSelection(null);
                setInGameUndoStack([]);
              }}
              className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-lg bg-green-600 text-white hover:bg-green-700"
            >
              <Icons.Refresh className="w-4 h-4" /> In-Game
            </button>
          )}
          {isAssistant ? (
            game.lineup && (
              <button
                onClick={openInSchedule}
                className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
                style={{ backgroundColor: primaryColor, color: tertiaryColor }}
              >
                <Icons.Clipboard className="w-4 h-4" /> Gameplan
              </button>
            )
          ) : (
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
          {dayDiff === 0 && !isFinal && (
            <button
              onClick={openScoreEditor}
              className="flex-1 sm:flex-none text-xs px-5 py-3 bg-white/80 text-slate-800 border border-slate-200 font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white transition-colors rounded-xl shadow-sm"
            >
              <Icons.FileText className="w-4 h-4" /> Final Score
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
  ({ icon: Icon, title, accent = "slate", onClick, ctaLabel, children }) => {
    const ACCENT_STYLES = {
      primary: { halo: "var(--team-primary-15)", text: "var(--team-primary)" },
      success: { halo: "#dcfce7", text: "#15803d" },
      warn: { halo: "#fef3c7", text: "#b45309" },
      danger: { halo: "#fee2e2", text: "#b91c1c" },
      info: { halo: "#dbeafe", text: "#1d4ed8" },
      slate: { halo: "#e2e8f0", text: "#475569" },
    };
    const styles = ACCENT_STYLES[accent] || ACCENT_STYLES.slate;
    return (
      <div className="bg-white/60 rounded-2xl shadow-card border border-white/60 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-white/50 bg-white/40 flex items-center gap-3">
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
              className="t-button text-slate-500 hover:text-slate-800 flex items-center gap-0.5 shrink-0"
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
const PitcherAvailabilityTile = memo(({ players, teamAge, todayStr, onOpenRoster }) => {
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
        <div className="t-stat-num text-slate-900">{stats.eligible}</div>
        <div className="t-eyebrow">eligible today</div>
      </div>
      {stats.resters.length === 0 ? (
        <p className="text-[11px] text-slate-500 font-medium">
          Full bullpen available — no rest or pitch-limit holds.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {stats.resters.slice(0, 4).map((r, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md t-chip border ${
                r.label === "limit"
                  ? "bg-rose-50 border-rose-200 text-rose-700"
                  : "bg-amber-50 border-amber-200 text-amber-800"
              }`}
              title={`${r.recent} recent pitches`}
            >
              {r.name}
            </span>
          ))}
          {stats.resters.length > 4 && (
            <span className="t-chip px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-600">
              +{stats.resters.length - 4}
            </span>
          )}
        </div>
      )}
    </InsightTile>
  );
});

/* ===========================================================================
   RecentMovementTile — uses player.statsHistory (per PR #37). Surfaces the
   top mover and top regressor across the roster's most recent transitions.
=========================================================================== */
const RecentMovementTile = memo(({ players, onPlayerClick }) => {
  const movers = useMemo(() => {
    const all = [];
    for (const p of players || []) {
      const history = Array.isArray(p?.statsHistory) ? p.statsHistory : [];
      if (history.length === 0) continue;
      const prior = history[history.length - 1]?.stats || {};
      const cur = p.stats || {};
      const priorOps = Number(prior.ops) || 0;
      const curOps = Number(cur.ops) || 0;
      if (priorOps === 0 && curOps === 0) continue;
      const delta = curOps - priorOps;
      if (Math.abs(delta) < 0.005) continue;
      all.push({ player: p, delta, priorOps, curOps });
    }
    all.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const topMover = all.find((m) => m.delta > 0) || null;
    const topRegressor = all.find((m) => m.delta < 0) || null;
    return { topMover, topRegressor, total: all.length };
  }, [players]);

  if (!movers.topMover && !movers.topRegressor) {
    return (
      <InsightTile icon={Icons.Refresh} title="Recent Movement" accent="info">
        <p className="text-[11px] text-slate-500 font-medium italic">
          Upload another CSV to start tracking game-to-game stat movement.
        </p>
      </InsightTile>
    );
  }

  const fmt = (n) => (n >= 0 ? "+" : "") + n.toFixed(3).replace(/^([-]?)0\./, "$1.");

  return (
    <InsightTile icon={Icons.Refresh} title="Recent Movement" accent="info">
      <div className="space-y-2">
        {movers.topMover && (
          <button
            type="button"
            onClick={() => onPlayerClick?.(movers.topMover.player.id)}
            className="w-full text-left flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 hover:bg-emerald-50 transition-colors"
          >
            <span className="t-body-bold text-emerald-900 truncate">
              {movers.topMover.player.name}
            </span>
            <span className="t-stat-num-sm text-emerald-700 tabular-nums shrink-0">
              ↑ OPS {fmt(movers.topMover.delta)}
            </span>
          </button>
        )}
        {movers.topRegressor && (
          <button
            type="button"
            onClick={() => onPlayerClick?.(movers.topRegressor.player.id)}
            className="w-full text-left flex items-center justify-between gap-2 p-2 rounded-lg bg-rose-50/70 border border-rose-200 hover:bg-rose-50 transition-colors"
          >
            <span className="t-body-bold text-rose-900 truncate">
              {movers.topRegressor.player.name}
            </span>
            <span className="t-stat-num-sm text-rose-700 tabular-nums shrink-0">
              ↓ OPS {fmt(movers.topRegressor.delta)}
            </span>
          </button>
        )}
      </div>
    </InsightTile>
  );
});

/* ===========================================================================
   EvalMomentumTile — auto-flags top standouts/regressions between the two
   most recent evaluation rounds. Mirrors InsightsPanel logic from
   EvaluationTab without rendering the heavy round-comparison UI.
=========================================================================== */
const EvalMomentumTile = memo(({ players, evaluationEvents, onOpenEval }) => {
  const flags = useMemo(() => {
    if (!Array.isArray(evaluationEvents) || evaluationEvents.length < 2) {
      return { top: null, bottom: null };
    }
    const sorted = [...evaluationEvents].sort((a, b) =>
      String(b.date).localeCompare(String(a.date))
    );
    const latest = sorted[0];
    const prev = sorted[1];
    const avgUniversal = (g) => {
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

  const fmt = (n) => (n >= 0 ? "+" : "") + n.toFixed(1);

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
            <span className="t-body-bold text-slate-800 truncate">
              {flags.top.player.name}
            </span>
            <span className="t-stat-num-sm text-emerald-700 tabular-nums shrink-0">
              ↑ {fmt(flags.top.delta)}
            </span>
          </div>
        )}
        {flags.bottom && (
          <div className="flex items-center justify-between gap-2">
            <span className="t-body-bold text-slate-800 truncate">
              {flags.bottom.player.name}
            </span>
            <span className="t-stat-num-sm text-rose-700 tabular-nums shrink-0">
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
const TeamTrendTile = memo(({ games }) => {
  const data = useMemo(() => {
    const finals = (games || [])
      .filter(
        (g) =>
          g.status === "final" &&
          Number.isFinite(g.teamScore) &&
          Number.isFinite(g.opponentScore)
      )
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const last5 = finals.slice(-5);
    const results = last5.map((g) => {
      if (g.teamScore > g.opponentScore) return "W";
      if (g.teamScore < g.opponentScore) return "L";
      return "T";
    });
    const diff = last5.reduce(
      (acc, g) => acc + (g.teamScore - g.opponentScore),
      0
    );
    return { results, diff, count: last5.length };
  }, [games]);

  if (data.count === 0) return null;

  return (
    <InsightTile icon={Icons.Bat} title="Last 5 Games" accent="primary">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="t-stat-num text-slate-900">
          {data.results.filter((r) => r === "W").length}
          <span className="text-slate-300 text-2xl">-</span>
          {data.results.filter((r) => r === "L").length}
          {data.results.filter((r) => r === "T").length > 0 && (
            <>
              <span className="text-slate-300 text-2xl">-</span>
              {data.results.filter((r) => r === "T").length}
            </>
          )}
        </span>
        <span
          className={`t-eyebrow tabular-nums ${
            data.diff > 0
              ? "text-emerald-700"
              : data.diff < 0
              ? "text-rose-700"
              : "text-slate-500"
          }`}
        >
          {data.diff >= 0 ? "+" : ""}
          {data.diff} run diff
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {data.results.map((r, i) => (
          <span
            key={i}
            className={`flex-1 h-7 rounded-md grid place-items-center t-button text-white ${
              r === "W"
                ? "bg-emerald-500"
                : r === "L"
                ? "bg-rose-500"
                : "bg-amber-500"
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

/* ===========================================================================
   Empty-state CTAs surfaced when the roster or schedule is blank.
=========================================================================== */
const EmptyStateBanner = memo(({ icon: Icon, title, body, action, onAction }) => (
  <div className="rounded-2xl bg-white/60 border border-white/60 shadow-card p-8 text-center">
    <div className="inline-flex p-3 rounded-2xl bg-slate-100 mb-4">
      <Icon className="w-7 h-7 text-slate-400" />
    </div>
    <h3 className="t-h3 mb-2">{title}</h3>
    <p className="t-body max-w-md mx-auto mb-5">{body}</p>
    {action && (
      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-2 t-button px-5 py-2.5 rounded-xl shadow-md text-white"
        style={{ backgroundColor: "var(--team-primary)" }}
      >
        {action}
      </button>
    )}
  </div>
));

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
  const activeTeamName =
    teams.find((t) => t.id === activeTeamId)?.name || "TEAM";
  const headCoaches = coaches.filter((c) => c.role === "Head Coach");
  const assistantCoaches = coaches.filter((c) => c.role === "Assistant Coach");

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

  return (
    <div className="space-y-8">
      {promptStatus.active && (
        <EvalPromptBanner
          kind={promptStatus.kind}
          isHead={isHead}
          primaryColor={primaryColor}
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
        <EmptyStateBanner
          icon={Icons.Calendar}
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

      <div className="bg-white/30 shadow-card border border-white/50 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row justify-between items-start gap-8">
        <div>
          <h2 className="font-black text-3xl sm:text-4xl uppercase tracking-tight text-slate-900 mb-3">
            {activeTeamName}
          </h2>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] sm:text-xs font-black text-slate-600 uppercase tracking-widest mb-4">
            <span className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {currentSeason}
            </span>
            <span className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {teamAge}
            </span>
            <span className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {leagueRuleSet}
            </span>
            <span className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {pitchingFormat}
            </span>
          </div>
          {(record.wins > 0 || record.losses > 0 || record.ties > 0) && (
            <div className="mb-6">
              <RecordBadge record={record} variant="full" />
            </div>
          )}
          {(headCoaches.length > 0 || assistantCoaches.length > 0) && (
            <div className="space-y-3 bg-white/60 p-5 rounded-xl border border-slate-200 shadow-sm inline-block min-w-full sm:min-w-[320px]">
              {headCoaches.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400 sm:w-32 shrink-0 sm:pt-0.5">
                    Head Coach:
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {headCoaches.map((c) => c.name).join(", ")}
                  </span>
                </div>
              )}
              {assistantCoaches.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400 sm:w-32 shrink-0 sm:pt-0.5">
                    Assistant Coaches:
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {assistantCoaches.map((c) => c.name).join(", ")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <div className="flex-1 md:flex-none bg-white/60 px-6 py-5 border border-slate-200 text-center shadow-sm rounded-xl">
            <span className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Roster Size
            </span>
            <span className="block text-3xl font-black text-slate-900">
              {players.length}
            </span>
          </div>
          <div className="flex-1 md:flex-none bg-white/60 px-6 py-5 border border-slate-200 text-center shadow-sm rounded-xl">
            <span className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Games
            </span>
            <span className="block text-3xl font-black text-slate-900">
              {games.length}
            </span>
          </div>
        </div>
      </div>

      {/* Insight tiles row — only renders when there's a player to show */}
      {hasPlayers && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {isKidPitch && (
            <PitcherAvailabilityTile
              players={players}
              teamAge={teamAge}
              todayStr={todayStr}
              onOpenRoster={() => setActiveTab("roster")}
            />
          )}
          <RecentMovementTile
            players={players}
            onPlayerClick={openPlayerProfile}
          />
          <EvalMomentumTile
            players={players}
            evaluationEvents={evaluationEvents}
            onOpenEval={() => setActiveTab("evaluation")}
          />
          <TeamTrendTile games={games} />
        </div>
      )}

      {!hasPlayers ? (
        <EmptyStateBanner
          icon={Icons.Users}
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
        />
      )}
    </div>
  );
});

// Tabbed leaderboard section. All stats render within each tab (no
// hidden subsets) but the card density is tight so the whole section
// stays compact.
const LeaderboardsSection = memo(
  ({ players, isKidPitch, primaryColor, tertiaryColor, onPlayerClick }) => {
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
        (p) => Number(p.stats?.ip) > 0 || Number(p.stats?.totalPitches) > 0
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
      <div className="bg-white/30 rounded-xl shadow-card border border-white/50 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <h2 className="text-sm font-black uppercase tracking-tight text-slate-800">
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
                      : "text-slate-500 hover:bg-white/60"
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {visibleTab?.stats.map((stat, i) => (
            <LeaderboardCard
              key={`${visibleTab.id}-${stat.statKey}-${i}`}
              {...stat}
              icon={visibleTab.icon}
              players={players}
              primaryColor={primaryColor}
              tertiaryColor={tertiaryColor}
              onPlayerClick={onPlayerClick}
            />
          ))}
        </div>
      </div>
    );
  }
);
