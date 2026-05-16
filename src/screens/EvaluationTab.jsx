import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { calculateBaseballAge } from "../utils/helpers";
import { EVAL_CATEGORIES } from "../constants/ui";
import { getOffensiveScore, calculateTotalScore } from "../lineupEngine.js";
import { useTeam, useUI } from "../contexts.js";

export const RosterDecisionsPanel = memo(() => {
  const { team, user } = useTeam();
  const { setEvalTrendPlayerId } = useUI();
  const {
    players,
    primaryColor,
    evaluationEvents,
    teamAge,
    currentSeason,
  } = team;

  const decisions = useMemo(() => {
    if (!players || players.length === 0) return null;

    // Eval rounds for this user, oldest first
    const myEvals = (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Head" && (!user || e.evaluatorId === user.uid)
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Compute team-wide stat averages for current season (used as baseline
    // for "below team average" performance signal)
    const statsAvg = (() => {
      const fields = ["ops", "avg", "obp"];
      const sums = Object.create(null);
      const counts = Object.create(null);
      for (const f of fields) {
        sums[f] = 0;
        counts[f] = 0;
      }
      for (const p of players) {
        const s = p.stats || {};
        for (const f of fields) {
          const v = +s[f];
          if (Number.isFinite(v) && v > 0) {
            sums[f] += v;
            counts[f] += 1;
          }
        }
      }
      const out = Object.create(null);
      for (const f of fields) {
        out[f] = counts[f] > 0 ? sums[f] / counts[f] : 0;
      }
      return out;
    })();

    // Determine team's age tier as a number (e.g., "8U" -> 8, "11U to 12U" -> 12)
    const teamAgeNum = (() => {
      if (!teamAge) return null;
      const m = String(teamAge).match(/(\d+)/g);
      if (!m) return null;
      // For ranges like "11U to 12U", use the upper bound (the team's max)
      return parseInt(m[m.length - 1], 10);
    })();

    return players.map((player) => {
      // ---- Latest eval grade (average across categories) ----
      let latestEvalAvg = null;
      const evalsForPlayer = myEvals
        .map((ev) => {
          const g = ev.grades?.[player.id];
          if (!g) return null;
          const vals = EVAL_CATEGORIES.map((c) => +g[c.id]).filter((v) =>
            Number.isFinite(v)
          );
          if (vals.length === 0) return null;
          return {
            date: ev.date,
            label: ev.label || ev.date,
            avg: vals.reduce((a, b) => a + b, 0) / vals.length,
          };
        })
        .filter(Boolean);

      if (evalsForPlayer.length > 0) {
        latestEvalAvg = evalsForPlayer[evalsForPlayer.length - 1].avg;
      }

      // ---- Eval trend (first vs latest) ----
      let evalTrend = null; // "improving" | "declining" | "flat" | null
      let evalDelta = null;
      if (evalsForPlayer.length >= 2) {
        const first = evalsForPlayer[0].avg;
        const last = evalsForPlayer[evalsForPlayer.length - 1].avg;
        evalDelta = last - first;
        if (Math.abs(evalDelta) < 0.4) evalTrend = "flat";
        else if (evalDelta > 0) evalTrend = "improving";
        else evalTrend = "declining";
      }

      // ---- Stats vs team average ----
      const stats = player.stats || {};
      let statsPctVsAvg = null;
      let statsRatio = null;
      if (Number.isFinite(+stats.ops) && +stats.ops > 0 && statsAvg.ops > 0) {
        statsPctVsAvg = (+stats.ops / statsAvg.ops - 1) * 100;
        statsRatio = +stats.ops / statsAvg.ops; // 1.0 = team avg
      }

      // ---- Age eligibility ----
      const baseballAge = calculateBaseballAge(player.dob, currentSeason);
      const playingUp =
        Number.isFinite(baseballAge) &&
        teamAgeNum != null &&
        baseballAge < teamAgeNum;

      // ---- Bucket assignment ----
      // Eval scale used here: 6-7 = average for the age tier, 8-10 = above avg,
      // 5-6 = a little below, <5 = notably struggling, <4 = genuinely struggling.
      // Stats: ratio of player OPS to team avg OPS. 1.0 = team avg.
      //
      // Buckets:
      //   "younger" — playing up + eval avg <5 + not strongly improving
      //               (kid is genuinely struggling at the higher tier)
      //   "watch"   — declining eval trend, OR eval avg <5 (struggling),
      //               OR stats are notably below team baseline
      //   "strong"  — default: average-or-better at the level

      let bucket = "strong"; // default
      const rationale = [];

      // Strongest signal first: declining trend always means review
      if (evalTrend === "declining") {
        bucket = "watch";
        rationale.push(
          `Eval trend declining (${evalDelta.toFixed(1)} from first eval)`
        );
      }

      // Notable struggle at this level
      if (latestEvalAvg != null && latestEvalAvg < 5) {
        // Strongly improving = give them another eval before flagging
        const stronglyImproving =
          evalTrend === "improving" && evalDelta != null && evalDelta >= 1.0;
        if (playingUp && !stronglyImproving) {
          bucket = "younger";
          rationale.length = 0; // override
          rationale.push(
            `Eval avg ${latestEvalAvg.toFixed(1)} below the team's age tier baseline`
          );
          rationale.push(`Eligible for younger group (age ${baseballAge})`);
        } else if (!stronglyImproving) {
          bucket = "watch";
          if (
            !rationale.some((r) => r.startsWith("Eval trend"))
          ) {
            rationale.push(
              `Eval avg ${latestEvalAvg.toFixed(1)} below the level's baseline (avg ~6-7)`
            );
          }
        } else if (stronglyImproving) {
          // Strongly improving but still <5 — still watch, but with positive note
          bucket = "watch";
          rationale.push(
            `Eval avg ${latestEvalAvg.toFixed(1)} but improving fast (+${evalDelta.toFixed(1)})`
          );
        }
      }

      // Stats well below team avg are a watch signal (only if not already in younger)
      if (
        bucket !== "younger" &&
        statsRatio != null &&
        statsRatio < 0.7 &&
        evalTrend !== "improving"
      ) {
        if (bucket !== "watch") {
          bucket = "watch";
        }
        rationale.push(
          `Stats ${Math.round((1 - statsRatio) * 100)}% below team OPS avg`
        );
      }

      // Strong Fit positive notes (only if currently default-strong)
      if (bucket === "strong") {
        if (latestEvalAvg != null && latestEvalAvg >= 7.5) {
          rationale.push(`Eval ${latestEvalAvg.toFixed(1)} — above average`);
        } else if (latestEvalAvg != null) {
          rationale.push(`Eval ${latestEvalAvg.toFixed(1)} — at level`);
        }
        if (evalTrend === "improving") rationale.push("Improving");
        if (statsRatio != null && statsRatio >= 1.15) {
          rationale.push(
            `Stats +${Math.round((statsRatio - 1) * 100)}% vs team OPS avg`
          );
        }
        if (rationale.length === 0) {
          rationale.push("Steady contributor");
        }
      }

      return {
        player,
        baseballAge,
        playingUp,
        latestEvalAvg,
        evalTrend,
        evalDelta,
        evalCount: evalsForPlayer.length,
        statsPctVsAvg,
        statsRatio,
        bucket,
        rationale,
      };
    });
  }, [players, evaluationEvents, user, teamAge, currentSeason]);

  if (!decisions || decisions.length === 0) return null;

  const byBucket = {
    strong: decisions.filter((d) => d.bucket === "strong"),
    watch: decisions.filter((d) => d.bucket === "watch"),
    younger: decisions.filter((d) => d.bucket === "younger"),
  };

  // Sort each bucket by perfScore descending (strong) or ascending (watch/younger)
  byBucket.strong.sort((a, b) => (b.perfScore ?? 0) - (a.perfScore ?? 0));
  byBucket.watch.sort((a, b) => (a.perfScore ?? 0) - (b.perfScore ?? 0));
  byBucket.younger.sort((a, b) => (a.perfScore ?? 0) - (b.perfScore ?? 0));

  const renderCard = (d) => (
    <button
      key={d.player.id}
      type="button"
      onClick={() => setEvalTrendPlayerId(d.player.id)}
      className="w-full text-left bg-white border border-slate-200 rounded-lg p-3 hover:border-slate-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">
          {d.player.name}
        </div>
        {Number.isFinite(d.baseballAge) && (
          <div className="text-[9px] font-bold text-slate-400 shrink-0">
            Age {d.baseballAge}
            {d.playingUp ? " ↑" : ""}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        {d.latestEvalAvg != null && (
          <span className="text-[10px] font-bold text-slate-600 tabular-nums">
            Eval {d.latestEvalAvg.toFixed(1)}
          </span>
        )}
        {d.evalTrend && (
          <span
            className={`text-[10px] font-black tabular-nums ${
              d.evalTrend === "improving"
                ? "text-green-700"
                : d.evalTrend === "declining"
                ? "text-red-700"
                : "text-slate-500"
            }`}
          >
            {d.evalTrend === "improving"
              ? "↑"
              : d.evalTrend === "declining"
              ? "↓"
              : "—"}
          </span>
        )}
        {d.statsPctVsAvg != null && (
          <span
            className={`text-[10px] font-bold tabular-nums ${
              d.statsPctVsAvg > 5
                ? "text-green-700"
                : d.statsPctVsAvg < -5
                ? "text-red-700"
                : "text-slate-500"
            }`}
          >
            {d.statsPctVsAvg > 0 ? "+" : ""}
            {d.statsPctVsAvg.toFixed(0)}% OPS
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-500 italic font-medium">
        {d.rationale.join(" · ")}
      </div>
    </button>
  );

  return (
    <div className="bg-white/30 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 rounded-2xl overflow-hidden">
      <div className="p-5 bg-white/40 border-b border-white/40">
        <div className="flex items-center gap-4">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Users className="w-6 h-6" style={{ color: primaryColor }} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-wider">
              Roster Decisions
            </h2>
            <p className="text-[10px] font-extrabold uppercase tracking-widest mt-1 text-slate-500">
              Advisory only — uses eval trends, stats, and age
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Strong Fit */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-emerald-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Strong Fit ({byBucket.strong.length})
          </div>
          {byBucket.strong.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic font-medium px-1">
              No players in this group yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.strong.map(renderCard)}
            </div>
          )}
        </div>

        {/* Watchlist */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-amber-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Watchlist ({byBucket.watch.length})
          </div>
          {byBucket.watch.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic font-medium px-1">
              No players need a closer look right now.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.watch.map(renderCard)}
            </div>
          )}
        </div>

        {/* Better Suited for Younger Group */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-600 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            Better Suited for Younger ({byBucket.younger.length})
          </div>
          {byBucket.younger.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic font-medium px-1">
              No candidates eligible for this recommendation.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.younger.map(renderCard)}
            </div>
          )}
        </div>
      </div>

      <div className="px-5 pb-4 text-[10px] text-slate-500 italic font-medium">
        Tap any card to see that player&apos;s full evaluation trend.
      </div>
    </div>
  );
});

/* ============================================================================
   SECTION 13b · EvaluationTab
============================================================================ */
export const EvaluationTab = memo(() => {
  const { team, user, saveTeamEvaluation } = useTeam();
  const {
    teamEvalGrades,
    setTeamEvalGrades,
    selectedRoundId,
    setSelectedRoundId,
    newRoundLabel,
    setNewRoundLabel,
    evalTrendPlayerId,
    setEvalTrendPlayerId,
  } = useUI();
  const { players, primaryColor, evaluationEvents } = team;

  // Eval rounds belonging to this head coach, newest first
  const myRounds = useMemo(() => {
    return (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Head" && (!user || e.evaluatorId === user.uid)
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [evaluationEvents, user]);

  const isNewRound = !selectedRoundId;
  const activeRound = selectedRoundId
    ? myRounds.find((r) => r.id === selectedRoundId)
    : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="glass-card">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/40 border-b border-white/40">
          <div className="flex items-center gap-4">
            <div
              className="p-2.5 rounded-full"
              style={{ backgroundColor: "var(--team-primary-15)" }}
            >
              <Icons.Clipboard
                className="w-6 h-6"
                style={{ color: "var(--team-primary)" }}
              />
            </div>
            <div>
              <h2 className="t-h2 flex items-center gap-3">
                Player Evaluation
              </h2>
              <p className="t-eyebrow mt-1">Head Coach Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
            <button
              onClick={() => {
                saveTeamEvaluation();
                if (isNewRound) setNewRoundLabel("");
              }}
              className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md text-white"
              style={{ backgroundColor: primaryColor }}
            >
              <Icons.Save className="w-4 h-4" />{" "}
              {isNewRound ? "Save New Eval" : "Update Eval"}
            </button>
          </div>
        </div>

        {/* Round selection bar */}
        <div className="px-5 py-3 bg-amber-50/40 border-b border-amber-100 flex flex-col sm:flex-row gap-3 sm:items-center">
          <label className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600 shrink-0">
              Eval:
            </span>
            <select
              value={selectedRoundId || "__new"}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedRoundId(v === "__new" ? null : v);
              }}
              className="flex-1 min-w-0 text-xs font-bold border border-slate-200 bg-white text-slate-700 px-3 py-2 outline-none rounded-lg cursor-pointer hover:bg-white/90 transition-colors"
            >
              <option value="__new">+ Start a new Eval</option>
              {myRounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || `Eval (${r.date})`} — {r.date}
                </option>
              ))}
            </select>
          </label>
          {isNewRound && (
            <label className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600 shrink-0">
                Label:
              </span>
              <input
                type="text"
                value={newRoundLabel}
                onChange={(e) => setNewRoundLabel(e.target.value)}
                placeholder="e.g., Preseason 2026, Midseason, Tryouts"
                className="flex-1 min-w-0 text-xs font-bold border border-slate-200 bg-white text-slate-700 px-3 py-2 outline-none rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </label>
          )}
          {!isNewRound && activeRound && (
            <span className="text-[10px] font-bold text-slate-500 italic">
              Editing &quot;{activeRound.label || activeRound.date}&quot;
            </span>
          )}
        </div>
        <div className="p-0 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-white/40 border-b border-slate-200/50">
                <th className="p-5 font-black text-slate-500 text-xs uppercase tracking-widest sticky left-0 bg-white/60 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.03)] w-64 border-r border-slate-200/50">
                  Player Name
                </th>
                {EVAL_CATEGORIES.map((cat) => (
                  <th
                    key={cat.id}
                    className="p-5 t-eyebrow text-center"
                  >
                    {cat.label}
                  </th>
                ))}
                <th className="p-5 font-black text-slate-800 text-[10px] uppercase tracking-widest text-center border-l border-slate-200/50">
                  Offense (Stats)
                </th>
                <th className="p-5 font-black text-slate-800 text-[10px] uppercase tracking-widest text-center bg-white/50 border-l border-slate-200/50 shadow-inner">
                  Total Score
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/50">
              {players.map((player) => {
                const grades = teamEvalGrades[player.id] || {
                  fielding: 5,
                  armStrength: 5,
                  armAccuracy: 5,
                  speedAgility: 5,
                  baseballIQ: 5,
                  coachability: 5,
                };
                const offScore = getOffensiveScore(player.stats);
                const totalScore = calculateTotalScore(grades, player.stats);
                return (
                  <tr
                    key={player.id}
                    className="hover:bg-white/60 transition-colors"
                  >
                    <td className="p-4 font-black text-sm text-slate-800 sticky left-0 bg-white/90 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)] truncate max-w-[250px] uppercase border-r border-slate-100/50">
                      <button
                        type="button"
                        onClick={() => setEvalTrendPlayerId(player.id)}
                        className="text-left hover:text-blue-700 hover:underline transition-colors flex items-center gap-1.5"
                        title="View evaluation trend"
                      >
                        {player.name}
                        <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      </button>
                    </td>
                    {EVAL_CATEGORIES.map((cat) => (
                      <td key={cat.id} className="p-3 text-center">
                        <select
                          value={grades[cat.id]}
                          onChange={(e) => {
                            setTeamEvalGrades({
                              ...teamEvalGrades,
                              [player.id]: {
                                ...grades,
                                [cat.id]: parseInt(e.target.value, 10),
                              },
                            });
                          }}
                          className="text-sm font-black border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500 w-20 text-center shadow-sm transition-colors bg-white/80 border-slate-200 text-slate-700 cursor-pointer hover:bg-white"
                        >
                          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((num) => (
                            <option key={num} value={num}>
                              {num}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td className="p-4 font-black text-lg text-center text-slate-800 bg-white/40 border-l border-slate-200/50">
                      {offScore}
                    </td>
                    <td className="p-4 font-black text-xl text-center bg-white/60 border-l border-slate-200/50 text-slate-900 shadow-inner">
                      {totalScore}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Roster Decisions panel — advisory recommendations based on
          eval trends, current performance, and age eligibility */}
      <RosterDecisionsPanel />

      {/* Trend modal — opens when a player name is clicked */}
      {evalTrendPlayerId && (
        <EvalTrendModal
          player={players.find((p) => p.id === evalTrendPlayerId)}
          evaluationEvents={evaluationEvents}
          userUid={user?.uid}
          primaryColor={primaryColor}
          onClose={() => setEvalTrendPlayerId(null)}
        />
      )}
    </div>
  );
});
export const EvalTrendModal = memo(
  ({ player, evaluationEvents, userUid, primaryColor, onClose }) => {
    if (!player) return null;

    // Collect this user's head-coach evals, oldest first
    const myEvals = (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Head" && (!userUid || e.evaluatorId === userUid)
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Each category gets its own line. Build series of {label, date, value}
    // entries per category, only including evals where the player has a grade.
    const categorySeries = EVAL_CATEGORIES.map((cat) => {
      const points = [];
      for (const ev of myEvals) {
        const grade = ev.grades?.[player.id]?.[cat.id];
        if (Number.isFinite(grade)) {
          points.push({
            label: ev.label || `Eval (${ev.date})`,
            date: ev.date,
            value: grade,
          });
        }
      }
      return { ...cat, points };
    });

    // X-axis evals (use the union of all dates that have any data)
    const xLabels = [];
    const seenIds = new Set();
    for (const ev of myEvals) {
      // Only include this eval if at least one category has a value
      const hasAny = EVAL_CATEGORIES.some((cat) =>
        Number.isFinite(ev.grades?.[player.id]?.[cat.id])
      );
      if (hasAny && !seenIds.has(ev.id)) {
        seenIds.add(ev.id);
        xLabels.push({ id: ev.id, label: ev.label || `(${ev.date})`, date: ev.date });
      }
    }
    const evalCount = xLabels.length;

    // Geometry — same scheme as StatTrendModal for visual consistency
    const W = 600,
      H = 320;
    const ML = 50,
      MR = 24,
      MT = 24,
      MB = 64;
    const innerW = W - ML - MR;
    const innerH = H - MT - MB;
    // Y range is fixed: 1-10 (the grade scale)
    const yMin = 1,
      yMax = 10;
    const xPos = (i) =>
      evalCount === 1 ? ML + innerW / 2 : ML + (i / (evalCount - 1)) * innerW;
    const yPos = (v) => MT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    const yTicks = [1, 3, 5, 7, 10];

    // Color palette for the 6 categories — distinct, accessible
    const palette = [
      "#2563eb", // blue (Fielding)
      "#9333ea", // purple (Baseball IQ)
      "#dc2626", // red (Arm Strength)
      "#ea580c", // orange (Arm Accuracy)
      "#16a34a", // green (Speed & Agility)
      "#0891b2", // teal (Coachability)
    ];

    // Trend summary per category: first vs last
    const trends = categorySeries.map((cs, idx) => {
      if (cs.points.length < 2) return null;
      const first = cs.points[0].value;
      const last = cs.points[cs.points.length - 1].value;
      const change = last - first;
      return {
        label: cs.label,
        change,
        color: palette[idx % palette.length],
      };
    });

    return (
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
          <div className="p-5 sm:p-6 border-b border-slate-200 flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-0.5">
                {player.name}
              </div>
              <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900">
                Evaluation Trend
              </h3>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                {evalCount === 0
                  ? "No eval data yet."
                  : evalCount === 1
                  ? "1 eval recorded — add more to see trends."
                  : `${evalCount} evals over time`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-xl transition-colors -mt-1 -mr-2"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 sm:p-7 overflow-y-auto custom-scrollbar flex-1">
            {evalCount === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-12 text-center">
                <Icons.Clipboard className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-black uppercase tracking-widest text-slate-500 mb-1">
                  No Evals Recorded
                </p>
                <p className="text-xs text-slate-500 font-medium">
                  Save an eval round to start tracking this player&apos;s trends.
                </p>
              </div>
            ) : evalCount === 1 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-2">
                  {xLabels[0].label}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                  {categorySeries.map((cs, idx) => (
                    <div
                      key={cs.id}
                      className="bg-white border border-slate-200 rounded-lg p-3"
                    >
                      <div
                        className="text-[10px] font-black uppercase tracking-widest mb-1"
                        style={{ color: palette[idx % palette.length] }}
                      >
                        {cs.label}
                      </div>
                      <div className="text-2xl font-black tabular-nums text-slate-900">
                        {cs.points[0]?.value ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 font-medium mt-4">
                  Add more eval rounds to see trends.
                </p>
              </div>
            ) : (
              <>
                {/* Chart */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    className="w-full h-auto"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Y-axis grid + labels */}
                    {yTicks.map((v, i) => (
                      <g key={`y-${i}`}>
                        <line
                          x1={ML}
                          y1={yPos(v)}
                          x2={ML + innerW}
                          y2={yPos(v)}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                          strokeDasharray={
                            i === 0 || i === yTicks.length - 1 ? "0" : "3,3"
                          }
                        />
                        <text
                          x={ML - 8}
                          y={yPos(v) + 4}
                          textAnchor="end"
                          className="text-[11px]"
                          fill="#64748b"
                          style={{
                            fontWeight: 700,
                            fontFamily: "ui-monospace, monospace",
                          }}
                        >
                          {v}
                        </text>
                      </g>
                    ))}

                    {/* X-axis labels (eval names, rotated for fit) */}
                    {xLabels.map((s, i) => (
                      <g key={`x-${i}`}>
                        <text
                          x={xPos(i)}
                          y={MT + innerH + 18}
                          textAnchor="middle"
                          className="text-[10px]"
                          fill="#64748b"
                          style={{ fontWeight: 700 }}
                          transform={
                            evalCount > 4
                              ? `rotate(-30 ${xPos(i)} ${MT + innerH + 18})`
                              : undefined
                          }
                        >
                          {s.label.length > 18
                            ? `${s.label.slice(0, 16)}…`
                            : s.label}
                        </text>
                      </g>
                    ))}

                    {/* Lines per category */}
                    {categorySeries.map((cs, idx) => {
                      if (cs.points.length === 0) return null;
                      const color = palette[idx % palette.length];
                      // Map each point to its X position based on its eval id
                      const pts = cs.points
                        .map((p) => {
                          const xLabel = xLabels.findIndex(
                            (x) => x.date === p.date
                          );
                          if (xLabel === -1) return null;
                          return { x: xPos(xLabel), y: yPos(p.value), value: p.value };
                        })
                        .filter(Boolean);
                      if (pts.length === 0) return null;
                      const path = pts
                        .map(
                          (p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`
                        )
                        .join(" ");
                      return (
                        <g key={`line-${cs.id}`}>
                          <path
                            d={path}
                            fill="none"
                            stroke={color}
                            strokeWidth="2.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {pts.map((p, i) => (
                            <circle
                              key={i}
                              cx={p.x}
                              cy={p.y}
                              r="3.5"
                              fill={color}
                              stroke="white"
                              strokeWidth="1.5"
                            />
                          ))}
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Legend with trend summary */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {categorySeries.map((cs, idx) => {
                    const trend = trends[idx];
                    const color = palette[idx % palette.length];
                    return (
                      <div
                        key={cs.id}
                        className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center gap-2"
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-700 truncate">
                            {cs.label}
                          </div>
                          {trend && (
                            <div
                              className={`text-[10px] font-black tabular-nums ${
                                trend.change > 0
                                  ? "text-green-700"
                                  : trend.change < 0
                                  ? "text-red-700"
                                  : "text-slate-500"
                              }`}
                            >
                              {trend.change > 0 ? "↑" : trend.change < 0 ? "↓" : "—"}
                              {trend.change !== 0 ? ` ${Math.abs(trend.change)}` : " flat"}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);

