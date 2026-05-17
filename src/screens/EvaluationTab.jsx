import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icons } from "../icons";
import { calculateBaseballAge } from "../utils/helpers";
import {
  EVAL_CATEGORIES,
  EVAL_GROUPS_UNIVERSAL,
  EVAL_GROUPS_KID_PITCH_ADDONS,
  getEvalCategoriesForTeam,
  isKidPitchFormat,
  EVAL_SCALE_LABELS,
  EVAL_SCALE_MAX,
  EVAL_SCALE_DEFAULT,
} from "../constants/ui";
import { calculateTotalScore } from "../lineupEngine";
import { useTeam, useUI } from "../contexts.js";
import { evalPromptStatus } from "../utils/helpers";

// 11 standard positions surfaced as a per-player chip row so the coach
// can flag spots they think this kid should play. Stored on the eval
// round as `grades[playerId].suggestedPositions`. Same vocabulary as
// AssistantEvalModal so head + assistant inputs share a shape.
const SUGGESTED_POSITIONS = [
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

const DEFAULT_GRADES = EVAL_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.id]: EVAL_SCALE_DEFAULT }),
  {}
);

const draftKey = (teamId, userUid) =>
  `lineuptool.evalDraft.${teamId || "unknown"}.${userUid || "anon"}`;

const sanitizeGrades = (g) => {
  const out = { ...DEFAULT_GRADES };
  EVAL_CATEGORIES.forEach((c) => {
    const v = parseInt(g?.[c.id], 10);
    if (Number.isFinite(v)) out[c.id] = Math.max(1, Math.min(EVAL_SCALE_MAX, v));
  });
  if (typeof g?.notes === "string" && g.notes.trim()) out.notes = g.notes;
  return out;
};

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
        // Halved from the 1–10 era; 0.2 ≈ small change in a 1–5 scale.
        if (Math.abs(evalDelta) < 0.2) evalTrend = "flat";
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

      // Notable struggle at this level (1–5 scale: < 2.5 = below mid)
      if (latestEvalAvg != null && latestEvalAvg < 2.5) {
        // Strongly improving = give them another eval before flagging
        const stronglyImproving =
          evalTrend === "improving" && evalDelta != null && evalDelta >= 0.5;
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
              `Eval avg ${latestEvalAvg.toFixed(1)} below the level's baseline (avg ~3)`
            );
          }
        } else if (stronglyImproving) {
          // Strongly improving but still <2.5 — still watch, but with positive note
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
        if (latestEvalAvg != null && latestEvalAvg >= 3.75) {
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
// ---------- Insights helpers ----------

// Average a player's grades across all the universal categories they have a
// number for (excludes notes / non-numeric fields).
const avgUniversal = (gradeRecord) => {
  if (!gradeRecord) return null;
  const vals = EVAL_CATEGORIES.filter((c) => !c.addOn)
    .map((c) => +gradeRecord[c.id])
    .filter((v) => Number.isFinite(v) && v >= 1 && v <= 10);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

// Compute the list of automatic flags from the most-recent two rounds.
// Standouts: average grade up by ≥ 0.75 round-over-round
// Regressions: average grade down by ≥ 0.75 round-over-round
// Per-category alerts: any single category dropped 2+ points round-over-round
const computeFlags = (rounds, players, activeCategories) => {
  if (!rounds || rounds.length < 2) {
    return { standouts: [], regressions: [], categoryDrops: [] };
  }
  const [latest, previous] = rounds;
  const standouts = [];
  const regressions = [];
  const categoryDrops = [];
  players.forEach((p) => {
    const latestG = latest.grades?.[p.id];
    const prevG = previous.grades?.[p.id];
    if (!latestG || !prevG) return;
    const a = avgUniversal(latestG);
    const b = avgUniversal(prevG);
    if (a == null || b == null) return;
    const delta = a - b;
    if (delta >= 0.75) standouts.push({ player: p, delta });
    if (delta <= -0.75) regressions.push({ player: p, delta });
    activeCategories.forEach((cat) => {
      const va = +latestG[cat.id];
      const vb = +prevG[cat.id];
      if (Number.isFinite(va) && Number.isFinite(vb) && vb - va >= 2) {
        categoryDrops.push({
          player: p,
          category: cat,
          from: vb,
          to: va,
        });
      }
    });
  });
  standouts.sort((a, b) => b.delta - a.delta);
  regressions.sort((a, b) => a.delta - b.delta);
  return {
    standouts: standouts.slice(0, 3),
    regressions: regressions.slice(0, 3),
    categoryDrops: categoryDrops.slice(0, 5),
  };
};

const fmtDelta = (d) =>
  `${d >= 0 ? "+" : ""}${d.toFixed(1)}`.replace(/\.0$/, "");

const InsightsPanel = memo(({ rounds, players, activeCategories, onPlayerClick }) => {
  const flags = useMemo(
    () => computeFlags(rounds, players, activeCategories),
    [rounds, players, activeCategories]
  );
  if (rounds.length < 2) return null;
  const hasAny =
    flags.standouts.length || flags.regressions.length || flags.categoryDrops.length;
  if (!hasAny) return null;
  return (
    <div className="px-5 py-4 bg-white/40 border-b border-slate-200/50 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="t-eyebrow">Round-Over-Round Insights</span>
        <span className="text-[10px] font-bold text-slate-400">
          {rounds[0].label || rounds[0].date} vs {rounds[1].label || rounds[1].date}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {flags.standouts.length > 0 && (
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl px-4 py-3">
            <div className="t-eyebrow text-emerald-700 mb-2 flex items-center gap-1.5">
              <Icons.ChevronUp className="w-3 h-3" /> Standouts
            </div>
            <ul className="space-y-1.5">
              {flags.standouts.map((s) => (
                <li
                  key={`std-${s.player.id}`}
                  className="flex items-center justify-between text-sm"
                >
                  <button
                    type="button"
                    onClick={() => onPlayerClick(s.player.id)}
                    className="t-body-bold text-emerald-900 hover:underline text-left truncate"
                  >
                    {s.player.name}
                  </button>
                  <span className="t-stat-num-sm text-emerald-700 tabular-nums">
                    {fmtDelta(s.delta)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {flags.regressions.length > 0 && (
          <div className="bg-rose-50/70 border border-rose-200 rounded-xl px-4 py-3">
            <div className="t-eyebrow text-rose-700 mb-2 flex items-center gap-1.5">
              <Icons.ChevronDown className="w-3 h-3" /> Regressions
            </div>
            <ul className="space-y-1.5">
              {flags.regressions.map((r) => (
                <li
                  key={`reg-${r.player.id}`}
                  className="flex items-center justify-between text-sm"
                >
                  <button
                    type="button"
                    onClick={() => onPlayerClick(r.player.id)}
                    className="t-body-bold text-rose-900 hover:underline text-left truncate"
                  >
                    {r.player.name}
                  </button>
                  <span className="t-stat-num-sm text-rose-700 tabular-nums">
                    {fmtDelta(r.delta)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {flags.categoryDrops.length > 0 && (
        <div className="bg-amber-50/60 border border-amber-200 rounded-xl px-4 py-3">
          <div className="t-eyebrow text-amber-700 mb-2 flex items-center gap-1.5">
            <Icons.Alert className="w-3 h-3" /> Category Drops (-2 or more)
          </div>
          <ul className="space-y-1.5">
            {flags.categoryDrops.map((d, i) => (
              <li
                key={`drop-${d.player.id}-${d.category.id}-${i}`}
                className="flex items-center justify-between text-sm flex-wrap gap-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => onPlayerClick(d.player.id)}
                    className="t-body-bold text-amber-900 hover:underline text-left truncate"
                  >
                    {d.player.name}
                  </button>
                  <span className="t-eyebrow text-amber-700">
                    {d.category.label}
                  </span>
                </span>
                <span className="t-stat-num-sm text-amber-700 tabular-nums">
                  {d.from} → {d.to}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

// Side-by-side round comparison view. Lists every player with the per-category
// delta between two saved rounds (left = older, right = newer).
const RoundComparisonView = memo(
  ({ rounds, players, activeCategories, onPlayerClick, onClose, primaryColor }) => {
    const [leftId, setLeftId] = useState(rounds[1]?.id || "");
    const [rightId, setRightId] = useState(rounds[0]?.id || "");
    const left = rounds.find((r) => r.id === leftId);
    const right = rounds.find((r) => r.id === rightId);
    return (
      <div
        className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-sm p-4 flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-t-2xl sm:rounded-2xl max-w-5xl w-full max-h-[92vh] shadow-2xl overflow-hidden flex flex-col"
        >
          <div
            className="h-1.5"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <div className="t-eyebrow">Round Comparison</div>
              <h3 className="t-card-title">Side By Side</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
              aria-label="Close round comparison"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>
          <div className="px-6 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="t-eyebrow shrink-0">From:</span>
              <select
                value={leftId}
                onChange={(e) => setLeftId(e.target.value)}
                className="flex-1 text-xs font-bold border border-slate-200 bg-white text-slate-700 px-3 py-2 rounded-lg cursor-pointer outline-none"
              >
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label || r.date} — {r.date}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="t-eyebrow shrink-0">To:</span>
              <select
                value={rightId}
                onChange={(e) => setRightId(e.target.value)}
                className="flex-1 text-xs font-bold border border-slate-200 bg-white text-slate-700 px-3 py-2 rounded-lg cursor-pointer outline-none"
              >
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label || r.date} — {r.date}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="p-3 t-eyebrow text-left w-48 sticky left-0 bg-slate-50 z-20 border-r border-slate-200">
                    Player
                  </th>
                  {activeCategories.map((cat) => (
                    <th key={cat.id} className="p-3 t-eyebrow text-center">
                      {cat.label}
                    </th>
                  ))}
                  <th className="p-3 t-eyebrow text-center bg-slate-100 border-l border-slate-200">
                    Avg Δ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {players.map((p) => {
                  const lg = left?.grades?.[p.id];
                  const rg = right?.grades?.[p.id];
                  const la = avgUniversal(lg);
                  const ra = avgUniversal(rg);
                  const avgDelta =
                    la != null && ra != null ? ra - la : null;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="p-3 sticky left-0 bg-white z-10 border-r border-slate-100 max-w-[200px]">
                        <button
                          type="button"
                          onClick={() => onPlayerClick(p.id)}
                          className="t-body-bold text-slate-900 hover:text-team-primary uppercase tracking-tight text-left truncate"
                        >
                          {p.name}
                        </button>
                      </td>
                      {activeCategories.map((cat) => {
                        const v1 = +lg?.[cat.id];
                        const v2 = +rg?.[cat.id];
                        const has1 = Number.isFinite(v1);
                        const has2 = Number.isFinite(v2);
                        const delta = has1 && has2 ? v2 - v1 : null;
                        return (
                          <td key={cat.id} className="p-2 text-center">
                            <div className="flex flex-col items-center leading-none gap-0.5">
                              <span className="text-sm font-black text-slate-900 tabular-nums">
                                {has2 ? v2 : "—"}
                              </span>
                              {delta != null && delta !== 0 && (
                                <span
                                  className={`text-[10px] font-black tabular-nums ${
                                    delta > 0
                                      ? "text-emerald-600"
                                      : "text-rose-600"
                                  }`}
                                >
                                  {fmtDelta(delta)}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="p-2 text-center bg-slate-50 border-l border-slate-200">
                        <span
                          className={`text-sm font-black tabular-nums ${
                            avgDelta == null
                              ? "text-slate-400"
                              : avgDelta > 0
                              ? "text-emerald-600"
                              : avgDelta < 0
                              ? "text-rose-600"
                              : "text-slate-500"
                          }`}
                        >
                          {avgDelta != null ? fmtDelta(avgDelta) : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
);

// Head-only read-only view of every assistant's most recent submission.
// Shows each assistant's suggested-positions + notes per player. Skips
// the per-category grade chips here — those already feed into the
// combined grade rendered in the main grading area.
const AssistantSubmissionsPanel = memo(({ evaluationEvents, players }) => {
  // Pick the most recent eval per assistant (by date).
  const latestByAssistant = useMemo(() => {
    const m = new Map();
    for (const e of evaluationEvents || []) {
      if (e.coachRole !== "Assistant" || !e.evaluatorId) continue;
      const cur = m.get(e.evaluatorId);
      if (!cur || new Date(e.date) > new Date(cur.date)) {
        m.set(e.evaluatorId, e);
      }
    }
    return [...m.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [evaluationEvents]);

  if (latestByAssistant.length === 0) return null;

  return (
    <div className="px-5 py-4 bg-amber-50/40 border-b border-amber-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="t-h3">Assistant Submissions</h3>
        <span className="t-eyebrow text-slate-500">
          {latestByAssistant.length} assistant
          {latestByAssistant.length === 1 ? "" : "s"} ·{" "}
          {Math.round(50)}% weight (split equally with your eval)
        </span>
      </div>
      <div className="space-y-3">
        {latestByAssistant.map((ev) => {
          const playersWithSignal = (players || []).filter((p) => {
            const g = ev.grades?.[p.id] || {};
            const hasPositions =
              Array.isArray(g.suggestedPositions) &&
              g.suggestedPositions.length > 0;
            const hasNotes = !!(g.notes && g.notes.trim());
            return hasPositions || hasNotes;
          });
          return (
            <div
              key={ev.id}
              className="bg-white border border-amber-200 rounded-xl p-3 shadow-sm"
            >
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="text-[11px] font-extrabold uppercase tracking-widest text-slate-600 truncate">
                  Assistant · {ev.evaluatorId?.slice(0, 8) || "—"}
                </div>
                <div className="text-[10px] font-bold text-slate-500">
                  {ev.date}
                </div>
              </div>
              {playersWithSignal.length === 0 ? (
                <p className="text-[11px] text-slate-500 font-medium italic">
                  Grades submitted — no positions or notes flagged.
                </p>
              ) : (
                <div className="space-y-2">
                  {playersWithSignal.map((p) => {
                    const g = ev.grades?.[p.id] || {};
                    return (
                      <div
                        key={p.id}
                        className="border-t border-amber-100 pt-2 first:border-t-0 first:pt-0"
                      >
                        <div className="text-[12px] font-black uppercase tracking-tight text-slate-800 mb-1">
                          {p.name}
                        </div>
                        {Array.isArray(g.suggestedPositions) &&
                          g.suggestedPositions.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {g.suggestedPositions.map((pos) => (
                                <span
                                  key={pos}
                                  className="text-[10px] font-black px-1.5 py-0.5 rounded-md border bg-amber-100 border-amber-200 text-amber-900"
                                >
                                  {pos}
                                </span>
                              ))}
                            </div>
                          )}
                        {g.notes && g.notes.trim() && (
                          <p className="text-[11px] text-slate-700 italic leading-snug">
                            {g.notes}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

const GradeChipRow = memo(({ value, onChange, ariaLabel }) => (
  <div
    className="flex items-center gap-1.5 flex-wrap"
    role="radiogroup"
    aria-label={ariaLabel}
  >
    {[1, 2, 3, 4, 5].map((n) => {
      const isActive = n === value;
      const label = EVAL_SCALE_LABELS[n - 1];
      return (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={isActive}
          onClick={() => onChange(n)}
          title={`${n} — ${label}`}
          aria-label={`${ariaLabel}: ${n} — ${label}`}
          className="flex flex-col items-center justify-center min-w-[58px] h-12 px-2 rounded-lg border transition-all"
          style={
            isActive
              ? {
                  backgroundColor: "var(--team-primary)",
                  color: "var(--team-tertiary)",
                  borderColor: "var(--team-primary)",
                  boxShadow: "var(--shadow-md)",
                }
              : {
                  backgroundColor: "rgba(255,255,255,0.7)",
                  color: "#475569",
                  borderColor: "#e2e8f0",
                }
          }
        >
          <span className="text-sm font-black tabular-nums leading-none">
            {n}
          </span>
          <span className="text-[9px] font-extrabold uppercase tracking-widest leading-none mt-1 opacity-90">
            {label}
          </span>
        </button>
      );
    })}
  </div>
));

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

  // Eval cadence: "Start new Eval" is gated until a preseason / biweekly
  // window opens for this head coach. Past rounds stay viewable + editable.
  const promptStatus = useMemo(
    () => evalPromptStatus(team, user?.uid, "Head"),
    [team, user]
  );

  const [saveState, setSaveState] = useState("idle");
  const [activeGroup, setActiveGroup] = useState("Hitting");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const lastSavedRef = useRef("");
  const draftRestoredRef = useRef(false);

  const activeCategories = useMemo(
    () => getEvalCategoriesForTeam(team?.pitchingFormat),
    [team?.pitchingFormat]
  );
  const includeKidPitchAddons = useMemo(
    () => isKidPitchFormat(team?.pitchingFormat),
    [team?.pitchingFormat]
  );
  const visibleGroups = useMemo(() => {
    const base = [...EVAL_GROUPS_UNIVERSAL];
    if (includeKidPitchAddons) base.push(...EVAL_GROUPS_KID_PITCH_ADDONS);
    return base;
  }, [includeKidPitchAddons]);
  const groupCategories = useMemo(() => {
    const byGroup = {};
    activeCategories.forEach((c) => {
      if (!byGroup[c.group]) byGroup[c.group] = [];
      byGroup[c.group].push(c);
    });
    return byGroup;
  }, [activeCategories]);
  // If a group disappears (e.g. user changed pitchingFormat away from Kid Pitch
  // while viewing the Pitching tab), bounce back to Hitting.
  useEffect(() => {
    if (!visibleGroups.includes(activeGroup)) setActiveGroup("Hitting");
  }, [visibleGroups, activeGroup]);

  // Eval rounds belonging to this head coach, newest first
  const myRounds = useMemo(() => {
    return (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Head" && (!user || e.evaluatorId === user.uid)
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [evaluationEvents, user]);

  // "New round" mode is gated to active prompt windows. Outside them we
  // default to viewing the most recent existing round.
  const isNewRound = !selectedRoundId && promptStatus.active;
  const activeRound = selectedRoundId
    ? myRounds.find((r) => r.id === selectedRoundId)
    : !promptStatus.active && myRounds.length > 0
    ? myRounds[0]
    : null;

  const teamId = team?.id;
  const userUid = user?.uid;

  // Restore draft for new rounds on first mount/team change.
  useEffect(() => {
    if (!isNewRound || draftRestoredRef.current) return;
    if (Object.keys(teamEvalGrades || {}).length > 0) {
      draftRestoredRef.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem(draftKey(teamId, userUid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setTeamEvalGrades(parsed.grades || {});
          if (parsed.label) setNewRoundLabel(parsed.label);
          setSaveState("draft-restored");
        }
      }
    } catch {
      /* ignore corrupt draft */
    }
    draftRestoredRef.current = true;
  }, [isNewRound, teamId, userUid, teamEvalGrades, setTeamEvalGrades, setNewRoundLabel]);

  // Persist new-round drafts to localStorage on every change.
  useEffect(() => {
    if (!isNewRound) return;
    try {
      window.localStorage.setItem(
        draftKey(teamId, userUid),
        JSON.stringify({ grades: teamEvalGrades, label: newRoundLabel })
      );
      setSaveState((s) =>
        s === "saved" || s === "saving" ? s : "draft"
      );
    } catch {
      /* quota exceeded — silent */
    }
  }, [isNewRound, teamEvalGrades, newRoundLabel, teamId, userUid]);

  // Auto-save existing rounds with a 1.5s debounce.
  useEffect(() => {
    if (isNewRound) return;
    const snapshot = JSON.stringify(teamEvalGrades);
    if (snapshot === lastSavedRef.current) return;
    if (lastSavedRef.current === "") {
      // First snapshot after switching to this round — initialize without saving.
      lastSavedRef.current = snapshot;
      return;
    }
    setSaveState("saving");
    const handle = setTimeout(() => {
      saveTeamEvaluation();
      lastSavedRef.current = snapshot;
      setSaveState("saved");
    }, 1500);
    return () => clearTimeout(handle);
  }, [isNewRound, teamEvalGrades, saveTeamEvaluation]);

  // Reset save baseline when switching between rounds.
  useEffect(() => {
    lastSavedRef.current = "";
    setSaveState("idle");
  }, [selectedRoundId]);

  const handleSaveClick = useCallback(() => {
    saveTeamEvaluation();
    if (isNewRound) {
      setNewRoundLabel("");
      try {
        window.localStorage.removeItem(draftKey(teamId, userUid));
      } catch {
        /* ignore */
      }
    }
    lastSavedRef.current = JSON.stringify(teamEvalGrades);
    setSaveState("saved");
  }, [
    saveTeamEvaluation,
    isNewRound,
    setNewRoundLabel,
    teamId,
    userUid,
    teamEvalGrades,
  ]);

  const setGrade = useCallback(
    (playerId, categoryId, value) => {
      setTeamEvalGrades({
        ...teamEvalGrades,
        [playerId]: {
          ...DEFAULT_GRADES,
          ...(teamEvalGrades[playerId] || {}),
          [categoryId]: value,
        },
      });
    },
    [teamEvalGrades, setTeamEvalGrades]
  );

  const setNotes = useCallback(
    (playerId, notesValue) => {
      setTeamEvalGrades({
        ...teamEvalGrades,
        [playerId]: {
          ...DEFAULT_GRADES,
          ...(teamEvalGrades[playerId] || {}),
          notes: notesValue,
        },
      });
    },
    [teamEvalGrades, setTeamEvalGrades]
  );

  const toggleSuggestedPosition = useCallback(
    (playerId, pos) => {
      const cur = teamEvalGrades[playerId] || {};
      const list = Array.isArray(cur.suggestedPositions)
        ? cur.suggestedPositions
        : [];
      const next = list.includes(pos)
        ? list.filter((p) => p !== pos)
        : [...list, pos];
      setTeamEvalGrades({
        ...teamEvalGrades,
        [playerId]: {
          ...DEFAULT_GRADES,
          ...cur,
          suggestedPositions: next,
        },
      });
    },
    [teamEvalGrades, setTeamEvalGrades]
  );

  const applyAllAverage = useCallback(() => {
    const next = {};
    players.forEach((p) => {
      next[p.id] = {
        ...DEFAULT_GRADES,
        notes: teamEvalGrades[p.id]?.notes || "",
      };
    });
    setTeamEvalGrades(next);
  }, [players, teamEvalGrades, setTeamEvalGrades]);

  const copyFromLastRound = useCallback(() => {
    const last = myRounds[0];
    if (!last) return;
    const next = {};
    players.forEach((p) => {
      next[p.id] = sanitizeGrades({
        ...DEFAULT_GRADES,
        ...(last.grades?.[p.id] || {}),
        notes: teamEvalGrades[p.id]?.notes || "",
      });
    });
    setTeamEvalGrades(next);
  }, [myRounds, players, teamEvalGrades, setTeamEvalGrades]);

  const hasLastRound = myRounds.length > 0;

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
            <span
              className="t-eyebrow flex items-center gap-1.5"
              aria-live="polite"
            >
              {!isNewRound && saveState === "saving" && (
                <>
                  <Icons.Refresh className="w-3 h-3 animate-spin text-blue-500" />
                  Saving…
                </>
              )}
              {!isNewRound && saveState === "saved" && (
                <>
                  <Icons.Check className="w-3 h-3 text-emerald-600" />
                  Saved
                </>
              )}
              {isNewRound && saveState === "draft" && (
                <>
                  <Icons.Cloud className="w-3 h-3 text-slate-400" />
                  Draft saved locally
                </>
              )}
              {isNewRound && saveState === "draft-restored" && (
                <>
                  <Icons.Refresh className="w-3 h-3 text-amber-500" />
                  Draft restored
                </>
              )}
            </span>
            <button
              type="button"
              onClick={handleSaveClick}
              className="flex-1 sm:flex-none t-button px-6 py-3 rounded-xl shadow-md hover:-translate-y-0.5 transition-transform flex items-center justify-center gap-2"
              style={{
                backgroundColor: "var(--team-primary)",
                color: "var(--team-tertiary)",
              }}
            >
              <Icons.Save className="w-4 h-4" />
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
              value={
                selectedRoundId || (promptStatus.active ? "__new" : "")
              }
              onChange={(e) => {
                const v = e.target.value;
                setSelectedRoundId(v === "__new" || v === "" ? null : v);
              }}
              className="flex-1 min-w-0 text-xs font-bold border border-slate-200 bg-white text-slate-700 px-3 py-2 outline-none rounded-lg cursor-pointer hover:bg-white/90 transition-colors"
            >
              {promptStatus.active ? (
                <option value="__new">
                  + Start a new Eval
                  {promptStatus.kind === "preseason"
                    ? " (preseason due)"
                    : " (biweekly due)"}
                </option>
              ) : (
                <option value="" disabled>
                  No new eval due
                  {promptStatus.daysUntilDue != null
                    ? ` — ${promptStatus.daysUntilDue}d`
                    : ""}
                </option>
              )}
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
          {myRounds.length >= 2 && (
            <button
              type="button"
              onClick={() => setComparisonOpen(true)}
              className="t-button px-3 py-2 rounded-lg border bg-white/80 border-slate-200 text-slate-700 hover:bg-white flex items-center gap-1.5 shrink-0"
              title="Compare any two saved rounds side by side"
            >
              <Icons.Forward className="w-3.5 h-3.5" /> Compare Rounds
            </button>
          )}
        </div>

        {/* Round-over-round auto-flags (standouts / regressions / category drops) */}
        <InsightsPanel
          rounds={myRounds}
          players={players}
          activeCategories={activeCategories}
          onPlayerClick={setEvalTrendPlayerId}
        />

        {/* Head-only: read-only view of every assistant's most recent eval
            submission so the head can see their suggested positions + notes
            alongside the combined grade. */}
        <AssistantSubmissionsPanel
          evaluationEvents={evaluationEvents}
          players={players}
        />

        {/* Quick-set toolbar */}
        <div className="px-5 py-3 bg-white/40 border-b border-white/40 flex flex-wrap items-center gap-2">
          <span className="t-eyebrow mr-1">Quick Set:</span>
          <button
            type="button"
            onClick={copyFromLastRound}
            disabled={!hasLastRound}
            className="t-button px-3 py-2 rounded-lg border bg-white/80 border-slate-200 text-slate-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            title={
              hasLastRound
                ? "Copy grades from your most recent saved eval"
                : "No previous eval to copy from"
            }
          >
            <Icons.Forward className="w-3.5 h-3.5" /> Copy From Last Round
          </button>
          <button
            type="button"
            onClick={applyAllAverage}
            className="t-button px-3 py-2 rounded-lg border bg-white/80 border-slate-200 text-slate-700 hover:bg-white flex items-center gap-1.5"
            title="Set every category for every player to 3"
          >
            <Icons.Refresh className="w-3.5 h-3.5" /> All Average (3)
          </button>
          <button
            type="button"
            onClick={() => setTeamEvalGrades({})}
            className="t-button px-3 py-2 rounded-lg border bg-white/80 border-slate-200 text-slate-700 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 flex items-center gap-1.5"
            title="Clear all in-progress grades"
          >
            <Icons.X className="w-3.5 h-3.5" /> Clear
          </button>
        </div>

        {/* Per-player grading cards. One column on mobile, two on lg+
            screens. Replaces the legacy desktop table — same chip rows
            as the assistant flow so head + assistant inputs match. */}
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3 bg-white/20">
          {players.length === 0 ? (
            <div className="text-center py-10 t-body">
              No players on the roster yet.
            </div>
          ) : (
            players.map((player) => {
              const grades = {
                ...DEFAULT_GRADES,
                ...(teamEvalGrades[player.id] || {}),
              };
              const totalScore = calculateTotalScore(grades, player.stats);
              return (
                <div
                  key={`mc-${player.id}`}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => setEvalTrendPlayerId(player.id)}
                      className="flex items-center gap-2 t-body-bold uppercase tracking-tight text-slate-900 hover:text-team-primary text-left"
                    >
                      {player.name}
                      <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>
                    <span
                      className="t-stat-num-sm px-3 py-1 rounded-lg shadow-sm"
                      style={{
                        backgroundColor: "var(--team-primary)",
                        color: "var(--team-tertiary)",
                      }}
                      title="Total Score (out of 100)"
                    >
                      {totalScore}
                      <span className="opacity-70 text-[10px] font-bold">
                        /100
                      </span>
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-4">
                    {visibleGroups.map((group) => {
                      const cats = groupCategories[group] || [];
                      if (cats.length === 0) return null;
                      return (
                        <div key={group}>
                          <div className="t-h3 mb-2 pb-1 border-b border-slate-100">
                            {group}
                          </div>
                          <div className="space-y-3">
                            {cats.map((cat) => (
                              <div key={cat.id}>
                                <div className="t-eyebrow mb-1.5">{cat.label}</div>
                                <GradeChipRow
                                  value={grades[cat.id]}
                                  onChange={(v) =>
                                    setGrade(player.id, cat.id, v)
                                  }
                                  ariaLabel={`${player.name} ${cat.label}`}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <div>
                      <div className="t-eyebrow mb-1.5">
                        Suggested Positions
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {SUGGESTED_POSITIONS.map((pos) => {
                          const active = (
                            grades.suggestedPositions || []
                          ).includes(pos);
                          return (
                            <button
                              key={pos}
                              type="button"
                              onClick={() =>
                                toggleSuggestedPosition(player.id, pos)
                              }
                              className="px-2 py-1 text-[11px] font-black rounded-md border transition-all"
                              style={
                                active
                                  ? {
                                      backgroundColor: "var(--team-primary)",
                                      color: "var(--team-tertiary)",
                                      borderColor: "var(--team-primary)",
                                    }
                                  : {
                                      backgroundColor: "white",
                                      color: "#475569",
                                      borderColor: "#e2e8f0",
                                    }
                              }
                            >
                              {pos}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="t-eyebrow mb-1.5">Notes</div>
                      <textarea
                        value={grades.notes || ""}
                        onChange={(e) => setNotes(player.id, e.target.value)}
                        placeholder="What stood out this round?"
                        rows={2}
                        className="w-full text-sm font-medium border border-slate-200 bg-white text-slate-700 px-3 py-2 outline-none rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>

      {/* Roster Decisions panel — advisory recommendations based on
          eval trends, current performance, and age eligibility */}
      <RosterDecisionsPanel />

      {/* Side-by-side round comparison modal */}
      {comparisonOpen && (
        <RoundComparisonView
          rounds={myRounds}
          players={players}
          activeCategories={activeCategories}
          primaryColor={primaryColor}
          onPlayerClick={(id) => {
            setComparisonOpen(false);
            setEvalTrendPlayerId(id);
          }}
          onClose={() => setComparisonOpen(false)}
        />
      )}

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
    // Y range is fixed: 1-5 (the grade scale)
    const yMin = 1,
      yMax = 5;
    const xPos = (i) =>
      evalCount === 1 ? ML + innerW / 2 : ML + (i / (evalCount - 1)) * innerW;
    const yPos = (v) => MT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    const yTicks = [1, 2, 3, 4, 5];

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

