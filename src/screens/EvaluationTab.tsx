import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icons } from "../icons";
import {
  calculateBaseballAge,
  evalStatHint,
  evalRoundRecency,
} from "../utils/helpers";
import {
  EVAL_CATEGORIES,
  EVAL_GROUPS_UNIVERSAL,
  EVAL_GROUPS_KID_PITCH_ADDONS,
  getEvalCategoriesForTeam,
  getEvalCategoriesForPlayer,
  playerIsPitcher,
  pitcherRosterPremium,
  isKidPitchFormat,
  EVAL_SCALE_LABELS,
  EVAL_SCALE_MAX,
  EVAL_SCALE_DEFAULT,
} from "../constants/ui";
import {
  calculateTotalScore,
  calcPitcherScore,
  PITCHER_SCORE_WEIGHTS,
} from "../lineupEngine";
import { useTeam, useUI } from "../contexts";
import { A11yDialog } from "../components/shared";
import { evalPromptStatus } from "../utils/helpers";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartFrame, ChartTooltip } from "../components/charts/primitives";

const PITCH_WEIGHT_SUM = Object.values(PITCHER_SCORE_WEIGHTS).reduce(
  (a, b) => a + b,
  0
);

// Roster-decision premium: pitching WELL puts a kid a leg up when comparing
// players. Additive on top of the universal Total Score (never subtracts), so a
// strong pitcher out-ranks an equal non-pitcher and non-pitchers are unchanged.
// Rewards only ABOVE-neutral pitching — and since Velocity/Strikes/Off-Speed
// are stats-graded (schema v9), the premium now reflects the imported pitching
// stats plus the coach's Composure grade. neutralFill keeps a partial stat
// line comparable against the all-categories neutral baseline; zero-signal
// pitching still earns nothing.
const pitcherPremium = (savedGrades: any, player: any, teamAge?: string): number => {
  if (!playerIsPitcher(player)) return 0;
  const stats = player?.stats || null;
  const score = calcPitcherScore(savedGrades, stats, {
    topMph: stats?.pTopMph ?? player?.pitching?.topMph,
    teamAge,
    neutralFill: true,
  });
  return pitcherRosterPremium(score, PITCH_WEIGHT_SUM);
};

// 11 standard positions surfaced as a per-player chip row so the coach
// can flag spots they think this kid should play. Stored on the eval
// round as `grades[playerId].suggestedPositions`. Same vocabulary as
// AssistantEvalModal so head + assistant inputs share a shape.
// Canonical 3-outfielder model — evaluations never split center into LCF/RCF;
// the lineup engine maps a CF-graded player onto those field slots when a
// 10-fielder game is played.
const SUGGESTED_POSITIONS = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
];

const DEFAULT_GRADES = EVAL_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.id]: EVAL_SCALE_DEFAULT }),
  {}
);

// Display name for a round: prefer the coach's denormalized last name
// (written at save time so reads work without an extra auth roundtrip);
// fall back to the legacy free-text label, then to a date-only label
// for ancient rounds with neither field set.
const formatRoundName = (round: any) => {
  if (!round) return "";
  if (round.evaluatorName) {
    return `${round.evaluatorName} · ${round.date}`;
  }
  if (round.label) return round.label;
  return `Eval (${round.date})`;
};

const sanitizeGrades = (g: any) => {
  const out: Record<string, any> = { ...DEFAULT_GRADES };
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
        (e: any) => e.coachRole === "Head" && (!user || e.evaluatorId === user.uid)
      )
      .sort((a: any, b: any) => evalRoundRecency(b, a));

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

    const decisionRows = players.map((player: any) => {
      // ---- Latest eval grade (average across categories) ----
      let latestEvalAvg = null;
      const playerCats = getEvalCategoriesForPlayer(team?.pitchingFormat, player);
      const evalsForPlayer = myEvals
        .map((ev: any) => {
          const g = ev.grades?.[player.id];
          if (!g) return null;
          // Average only over categories that apply to THIS player, so a
          // non-catcher/non-pitcher isn't dragged down by specialties they
          // were never meant to be graded on.
          const vals = playerCats
            .map((c) => +g[c.id])
            .filter((v) => Number.isFinite(v));
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

      // ---- Total Score (out of 100) ----
      // The same number the grading cards already produce — universal score
      // blended from grades + imported stats, plus the pitcher premium. This
      // is the headline "eval number" for roster decisions, judged RELATIVE
      // to the team's own average below (a 54 means something different on a
      // team averaging 70 than one averaging 55).
      const latestRoundForPlayer = [...myEvals]
        .reverse()
        .find((ev: any) => ev.grades?.[player.id]);
      const savedGrades = latestRoundForPlayer?.grades?.[player.id] || {};
      const totalScore = Math.min(
        100,
        calculateTotalScore({ ...DEFAULT_GRADES, ...savedGrades }, player.stats) +
          pitcherPremium(savedGrades, player, teamAge)
      );

      // ---- Age eligibility ----
      const baseballAge = calculateBaseballAge(player.dob, currentSeason);
      const playingUp =
        Number.isFinite(baseballAge) &&
        teamAgeNum != null &&
        (baseballAge as number) < teamAgeNum;

      // ---- Bucket assignment (per-player PROPOSAL) ----
      // This pass only *proposes* a bucket from absolute cutoffs; the
      // relative pass after the .map (see "Relative cut line")
      // tempers the proposed watch list against the team's own spread so
      // average kids on an average team are never flagged. Default here is
      // **watch** — a kid earns Strong Fit with positive signal across the
      // board, otherwise the relative pass decides whether they stay flagged.
      //
      // Scale calibration (internal only — eval 1–5; stats expressed as OPS
      // ratio vs team OPS avg, 1.00 = at team avg):
      //   Strong : eval ≥ 3.3  AND  not below the watch line on stats
      //                       AND  not declining
      //   Younger: playing up AND (eval ≤ 2.5 OR stats ratio ≤ 0.6)
      //                       AND not strongly improving
      //   Watch  : everything else (proposal only — tempered below)
      // The user-facing rationale never surfaces these 1–5 cutoffs: cards
      // lead with the Total Score (out of 100) badge and the vs-team delta,
      // so the explanation text stays qualitative.

      let bucket = "watch"; // proposal — Strong Fit earned, watch tempered below
      const rationale = [];

      const stronglyImproving =
        evalTrend === "improving" && evalDelta != null && evalDelta >= 0.5;
      const evalAboveBar = latestEvalAvg != null && latestEvalAvg >= 3.3;
      const evalBelowBar = latestEvalAvg != null && latestEvalAvg < 2.8;
      const evalDeepBelowBar = latestEvalAvg != null && latestEvalAvg <= 2.5;
      const statsBelowBar = statsRatio != null && statsRatio < 0.8;
      const statsWayBelowBar = statsRatio != null && statsRatio <= 0.6;
      const statsAbsent = statsRatio == null;
      const evalAbsent = latestEvalAvg == null;

      // 1) Cut / Drop a Division — playing up + clear struggle signal + not
      //    on the rise. Age-driven: only kids younger than the team's tier
      //    are eligible, and only when eval/stats say they're over-matched.
      if (playingUp && !stronglyImproving) {
        if (evalDeepBelowBar || statsWayBelowBar) {
          bucket = "younger";
          if (evalDeepBelowBar) {
            rationale.push("Eval grades well below this tier — over-matched");
          }
          if (statsWayBelowBar) {
            rationale.push(
              `Stats ${Math.round((1 - (statsRatio as number)) * 100)}% below team OPS avg`
            );
          }
          rationale.push(
            `Playing up at age ${baseballAge} — better matched to a younger division`
          );
        }
      }

      // 2) Strong Fit — earn it with positive signal across the board.
      if (bucket !== "younger") {
        const noNegatives = !evalBelowBar && !statsBelowBar && evalTrend !== "declining";
        const positiveSignal = evalAboveBar || stronglyImproving || (statsRatio != null && statsRatio >= 1.0);
        if (noNegatives && positiveSignal && !(evalAbsent && statsAbsent)) {
          bucket = "strong";
          if (evalAboveBar) {
            rationale.push("Eval grades above average");
          }
          if (stronglyImproving) {
            rationale.push("Evals trending up round-over-round");
          }
          if (statsRatio != null && statsRatio >= 1.0) {
            rationale.push(
              `Stats +${Math.round(((statsRatio as number) - 1) * 100)}% vs team OPS avg`
            );
          }
        }
      }

      // 3) Watch proposal — anything that didn't earn Strong, with the
      //    dominant signal called out. The relative pass after the .map
      //    decides which of these actually stay flagged.
      if (bucket === "watch") {
        if (evalAbsent && statsAbsent) {
          rationale.push("No eval or stats yet — needs review");
        } else {
          if (evalTrend === "declining") {
            rationale.push("Eval trend declining since first round");
          }
          if (evalBelowBar) {
            rationale.push("Eval grades below the team line");
          } else if (evalAbsent) {
            rationale.push("No eval yet — needs a round");
          }
          if (statsBelowBar) {
            rationale.push(
              `Stats ${Math.round((1 - (statsRatio as number)) * 100)}% below team OPS avg`
            );
          } else if (statsAbsent) {
            rationale.push("No stats yet");
          }
          if (rationale.length === 0) {
            // Edge case: at-level evals + at-level stats with no positive
            // edge — neither flagged nor strong. Make it explicit.
            rationale.push("At the team line — no margin either way");
          }
        }
      }

      return {
        player,
        baseballAge,
        playingUp,
        latestEvalAvg,
        totalScore,
        evalTrend,
        evalDelta,
        evalCount: evalsForPlayer.length,
        statsPctVsAvg,
        statsRatio,
        bucket,
        rationale,
      };
    });

    // ---- Relative cut line (no fixed cap) ----
    // The per-player pass above only *proposes* a "watch" bucket from
    // absolute cutoffs, which over-flags a roster that's simply young or
    // early in the season -- it once put 7 of 12 kids on the list. Temper it
    // against the team's OWN spread instead: a player stays flagged as a Cut
    // Candidate only if their Total Score (out of 100 — the same number the
    // grading cards produce, blending eval grades and imported stats) is more
    // than one standard deviation below the team mean. There is NO hard cap
    // -- the distribution itself decides, so a tightly-bunched team can flag
    // nobody and only genuine outliers ever surface. Anyone tempered off
    // becomes a "fit" (solid standing — they hold the team line without
    // standing out); the earned "strong" tier and the age-based "younger"
    // (Cut / Drop a Division) bucket are untouched.
    //
    // Null standing when we have no eval AND no stats for the kid -- can't
    // call them low without data.
    const compositeOf = (d: any) =>
      d.latestEvalAvg == null && d.statsRatio == null
        ? null
        : d.totalScore / 100;
    const withComp = decisionRows.map((d: any) => ({ d, c: compositeOf(d) }));
    const scored = withComp.map((x: any) => x.c).filter((c: any) => c != null);
    const mean = scored.length
      ? scored.reduce((a: any, b: any) => a + b, 0) / scored.length
      : 0;
    const sd = scored.length
      ? Math.sqrt(
          scored.reduce((a: any, b: any) => a + (b - mean) ** 2, 0) / scored.length
        )
      : 0;
    const belowLine = mean - sd;
    const teamAvgScore = Math.round(mean * 100);
    for (const x of withComp) {
      // perfScore drives the within-bucket card sort below (was never set).
      x.d.perfScore = x.c != null ? x.c : mean;
      x.d.teamAvgScore = teamAvgScore;
      x.d.scoreVsTeam =
        x.c != null ? Math.round(x.d.totalScore - teamAvgScore) : null;
      if (x.d.bucket !== "watch") continue;
      // Stays a Cut Candidate only if genuinely below the team line AND we
      // have data. Everyone else is a solid "Fit" — Strong Fit is earned
      // above, so the middle of the roster lands here.
      if (x.c != null && x.c < belowLine) {
        x.d.rationale.unshift(
          `Score ${x.d.totalScore} vs team avg ${teamAvgScore} (${
            x.d.scoreVsTeam > 0 ? "+" : ""
          }${x.d.scoreVsTeam}) — more than a standard deviation back`
        );
        continue;
      }
      x.d.bucket = "fit";
      if (x.c != null) {
        x.d.rationale = [
          x.c >= mean
            ? "Solid contributor — at or above the team line"
            : "Holding the team line — steady, just not a standout",
        ];
      }
    }

    return decisionRows;
  }, [players, evaluationEvents, user, teamAge, currentSeason, team?.pitchingFormat]);

  if (!decisions || decisions.length === 0) return null;

  const byBucket = {
    strong: decisions.filter((d: any) => d.bucket === "strong"),
    fit: decisions.filter((d: any) => d.bucket === "fit"),
    watch: decisions.filter((d: any) => d.bucket === "watch"),
    younger: decisions.filter((d: any) => d.bucket === "younger"),
  };

  // Best-standing first for the healthy groups (Strong Fit / Fit); weakest
  // first for the groups that need a decision (Cut Candidates / Cut-Drop).
  byBucket.strong.sort((a: any, b: any) => (b.perfScore ?? 0) - (a.perfScore ?? 0));
  byBucket.fit.sort((a: any, b: any) => (b.perfScore ?? 0) - (a.perfScore ?? 0));
  byBucket.watch.sort((a: any, b: any) => (a.perfScore ?? 0) - (b.perfScore ?? 0));
  byBucket.younger.sort((a: any, b: any) => (a.perfScore ?? 0) - (b.perfScore ?? 0));

  const renderCard = (d: any) => (
    <button
      key={d.player.id}
      type="button"
      onClick={() => setEvalTrendPlayerId(d.player.id)}
      className="w-full text-left bg-surface border border-line rounded-lg p-3 hover:border-line-strong hover:shadow-sm transition-all"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="font-black text-sm uppercase tracking-tight text-ink truncate">
          {d.player.name}
        </div>
        {Number.isFinite(d.baseballAge) && (
          <div className="text-[9px] font-bold text-ink-3 shrink-0">
            Age {d.baseballAge}
            {d.playingUp ? " ↑" : ""}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-xs font-black tabular-nums px-2 py-0.5 rounded-md shrink-0"
          style={{
            backgroundColor: "var(--team-primary)",
            color: "var(--team-tertiary)",
          }}
          title="Total Score (out of 100)"
        >
          {d.totalScore}
        </span>
        {d.scoreVsTeam != null && (
          <span
            className={`text-[10px] font-black tabular-nums ${
              d.scoreVsTeam > 0
                ? "text-win"
                : d.scoreVsTeam < 0
                ? "text-loss"
                : "text-ink-3"
            }`}
            title={`vs team average score ${d.teamAvgScore}`}
          >
            {d.scoreVsTeam > 0 ? "+" : ""}
            {d.scoreVsTeam} vs team
          </span>
        )}
        {d.evalTrend && (
          <span
            className={`text-[10px] font-black tabular-nums ${
              d.evalTrend === "improving"
                ? "text-win"
                : d.evalTrend === "declining"
                ? "text-loss"
                : "text-ink-3"
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
                ? "text-win"
                : d.statsPctVsAvg < -5
                ? "text-loss"
                : "text-ink-3"
            }`}
          >
            {d.statsPctVsAvg > 0 ? "+" : ""}
            {d.statsPctVsAvg.toFixed(0)}% OPS
          </span>
        )}
      </div>
      <div className="text-[10px] text-ink-3 italic font-medium">
        {d.rationale.join(" · ")}
      </div>
    </button>
  );

  return (
    <div className="bg-surface shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-line rounded-2xl overflow-hidden">
      <div className="p-5 bg-surface border-b border-line">
        <div className="flex items-center gap-4">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Users className="w-6 h-6" style={{ color: primaryColor }} />
          </div>
          <div>
            <h2 className="text-xl font-black text-ink uppercase tracking-wider">
              Roster Decisions
            </h2>
            {decisions[0]?.teamAvgScore != null && (
              <p className="text-[11px] font-bold text-ink-3 mt-0.5">
                Team average score:{" "}
                <span className="tabular-nums text-ink-2">
                  {decisions[0].teamAvgScore}
                </span>{" "}
                / 100 — each kid is judged against this line, not a fixed bar.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Strong Fit — earned positive signal across eval + stats */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-win mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Strong Fit ({byBucket.strong.length})
          </div>
          {byBucket.strong.length === 0 ? (
            <p className="text-[11px] text-ink-3 italic font-medium px-1">
              No standouts flagged yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.strong.map(renderCard)}
            </div>
          )}
        </div>

        {/* Fit — solid contributors holding the team line, not standouts */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-ink-2 mb-2 flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: primaryColor }}
            />
            Fit ({byBucket.fit.length})
          </div>
          {byBucket.fit.length === 0 ? (
            <p className="text-[11px] text-ink-3 italic font-medium px-1">
              No players in this group yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.fit.map(renderCard)}
            </div>
          )}
        </div>

        {/* Cut Candidates — genuinely below the team's own line. Named for
            what the bucket actually is: kids whose score sits more than a
            standard deviation under the team average. */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-warnfg mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Cut Candidates ({byBucket.watch.length})
          </div>
          {byBucket.watch.length === 0 ? (
            <p className="text-[11px] text-ink-3 italic font-medium px-1">
              Nobody is meaningfully below the team line right now.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.watch.map(renderCard)}
            </div>
          )}
        </div>

        {/* Cut / Drop a Division — playing up + over-matched for their age */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-loss mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Cut / Drop a Division ({byBucket.younger.length})
          </div>
          {byBucket.younger.length === 0 ? (
            <p className="text-[11px] text-ink-3 italic font-medium px-1">
              No candidates eligible for this recommendation.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.younger.map(renderCard)}
            </div>
          )}
        </div>
      </div>

      <div className="px-5 pb-4 text-[10px] text-ink-3 italic font-medium">
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
const avgUniversal = (gradeRecord: any) => {
  if (!gradeRecord) return null;
  const vals = EVAL_CATEGORIES.filter((c) => !c.addOn)
    .map((c) => +gradeRecord[c.id])
    .filter((v) => Number.isFinite(v) && v >= 1 && v <= EVAL_SCALE_MAX);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

// Compute the list of automatic flags from the most-recent two rounds.
// Standouts: average grade up by ≥ 0.75 round-over-round
// Regressions: average grade down by ≥ 0.75 round-over-round
// Per-category alerts: any single category dropped 2+ points round-over-round
const computeFlags = (rounds: any, players: any, activeCategories: any) => {
  if (!rounds || rounds.length < 2) {
    return { standouts: [], regressions: [], categoryDrops: [] };
  }
  const [latest, previous] = rounds;
  const standouts: any[] = [];
  const regressions: any[] = [];
  const categoryDrops: any[] = [];
  players.forEach((p: any) => {
    const latestG = latest.grades?.[p.id];
    const prevG = previous.grades?.[p.id];
    if (!latestG || !prevG) return;
    const a = avgUniversal(latestG);
    const b = avgUniversal(prevG);
    if (a == null || b == null) return;
    const delta = a - b;
    if (delta >= 0.75) standouts.push({ player: p, delta });
    if (delta <= -0.75) regressions.push({ player: p, delta });
    activeCategories.forEach((cat: any) => {
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

const fmtDelta = (d: any) =>
  `${d >= 0 ? "+" : ""}${d.toFixed(1)}`.replace(/\.0$/, "");

const InsightsPanel = memo(({ rounds, players, activeCategories, onPlayerClick }: any) => {
  const flags = useMemo(
    () => computeFlags(rounds, players, activeCategories),
    [rounds, players, activeCategories]
  );
  if (rounds.length < 2) return null;
  const hasAny =
    flags.standouts.length || flags.regressions.length || flags.categoryDrops.length;
  if (!hasAny) return null;
  return (
    <div className="px-5 py-4 bg-surface border-b border-line/50 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="t-eyebrow">Round-Over-Round Insights</span>
        <span className="text-[10px] font-bold text-ink-3">
          {rounds[0].label || rounds[0].date} vs {rounds[1].label || rounds[1].date}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {flags.standouts.length > 0 && (
          <div className="bg-win-bg border border-line rounded-2xl px-4 py-3.5 shadow-sm">
            <div className="t-eyebrow text-win mb-2.5 flex items-center gap-1.5">
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
                    className="t-body-bold text-win hover:underline text-left truncate"
                  >
                    {s.player.name}
                  </button>
                  <span className="t-stat-num-sm text-win tabular-nums">
                    {fmtDelta(s.delta)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {flags.regressions.length > 0 && (
          <div className="bg-loss-bg border border-line rounded-2xl px-4 py-3.5 shadow-sm">
            <div className="t-eyebrow text-loss mb-2.5 flex items-center gap-1.5">
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
                    className="t-body-bold text-loss hover:underline text-left truncate"
                  >
                    {r.player.name}
                  </button>
                  <span className="t-stat-num-sm text-loss tabular-nums">
                    {fmtDelta(r.delta)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {flags.categoryDrops.length > 0 && (
        <div className="bg-warn-bg border border-line rounded-2xl px-4 py-3.5 shadow-sm">
          <div className="t-eyebrow text-warnfg mb-2.5 flex items-center gap-1.5">
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
                    className="t-body-bold text-warnfg hover:underline text-left truncate"
                  >
                    {d.player.name}
                  </button>
                  <span className="t-eyebrow text-warnfg">
                    {d.category.label}
                  </span>
                </span>
                <span className="t-stat-num-sm text-warnfg tabular-nums">
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
  ({ rounds, players, activeCategories, onPlayerClick, onClose, primaryColor }: any) => {
    const [leftId, setLeftId] = useState(rounds[1]?.id || "");
    const [rightId, setRightId] = useState(rounds[0]?.id || "");
    const left = rounds.find((r: any) => r.id === leftId);
    const right = rounds.find((r: any) => r.id === rightId);
    return (
      <div
        className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-sm p-4 flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        <A11yDialog
          label="Round comparison"
          onClose={onClose}
          className="bg-surface rounded-t-2xl sm:rounded-2xl max-w-5xl w-full max-h-[92vh] shadow-2xl overflow-hidden flex flex-col"
        >
          <div
            className="h-1.5"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
            <div>
              <div className="t-eyebrow">Round Comparison</div>
              <h3 className="t-card-title">Side By Side</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-ink-3 hover:text-ink hover:bg-surface-2 rounded-lg"
              aria-label="Close round comparison"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>
          <div className="px-6 py-3 border-b border-line flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="t-eyebrow shrink-0">From:</span>
              <select
                value={leftId}
                onChange={(e) => setLeftId(e.target.value)}
                className="flex-1 text-xs font-bold border border-line bg-surface text-ink px-3 py-2 rounded-lg cursor-pointer outline-none"
              >
                {rounds.map((r: any) => (
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
                className="flex-1 text-xs font-bold border border-line bg-surface text-ink px-3 py-2 rounded-lg cursor-pointer outline-none"
              >
                {rounds.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.label || r.date} — {r.date}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
              <thead className="bg-app sticky top-0 z-10">
                <tr>
                  <th className="p-3 t-eyebrow text-left w-48 sticky left-0 bg-app z-20 border-r border-line">
                    Player
                  </th>
                  {activeCategories.map((cat: any) => (
                    <th key={cat.id} className="p-3 t-eyebrow text-center">
                      {cat.label}
                    </th>
                  ))}
                  <th className="p-3 t-eyebrow text-center bg-surface-2 border-l border-line">
                    Avg Δ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {players.map((p: any) => {
                  const lg = left?.grades?.[p.id];
                  const rg = right?.grades?.[p.id];
                  const la = avgUniversal(lg);
                  const ra = avgUniversal(rg);
                  const avgDelta =
                    la != null && ra != null ? ra - la : null;
                  return (
                    <tr key={p.id} className="hover:bg-surface-2">
                      <td className="p-3 sticky left-0 bg-surface z-10 border-r border-line max-w-[200px]">
                        <button
                          type="button"
                          onClick={() => onPlayerClick(p.id)}
                          className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate"
                        >
                          {p.name}
                        </button>
                      </td>
                      {activeCategories.map((cat: any) => {
                        const v1 = +lg?.[cat.id];
                        const v2 = +rg?.[cat.id];
                        const has1 = Number.isFinite(v1);
                        const has2 = Number.isFinite(v2);
                        const delta = has1 && has2 ? v2 - v1 : null;
                        return (
                          <td key={cat.id} className="p-2 text-center">
                            <div className="flex flex-col items-center leading-none gap-0.5">
                              <span className="text-sm font-black text-ink tabular-nums">
                                {has2 ? v2 : "—"}
                              </span>
                              {delta != null && delta !== 0 && (
                                <span
                                  className={`text-[10px] font-black tabular-nums ${
                                    delta > 0
                                      ? "text-win"
                                      : "text-loss"
                                  }`}
                                >
                                  {fmtDelta(delta)}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="p-2 text-center bg-app border-l border-line">
                        <span
                          className={`text-sm font-black tabular-nums ${
                            avgDelta == null
                              ? "text-ink-3"
                              : avgDelta > 0
                              ? "text-win"
                              : avgDelta < 0
                              ? "text-loss"
                              : "text-ink-3"
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
        </A11yDialog>
      </div>
    );
  }
);

// Head-only read-only view of every assistant's most recent submission.
// Shows each assistant's suggested-positions + notes per player. Skips
// the per-category grade chips here — those already feed into the
// combined grade rendered in the main grading area.
const AssistantSubmissionsPanel = memo(
  ({ evaluationEvents, players, onDelete }: any) => {
  // Two-tap confirm for delete: first tap arms the row, second commits.
  // Replaces a blocking window.confirm — keeps the head coach in flow.
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  // Pick the most recent eval per assistant (by date).
  const latestByAssistant = useMemo(() => {
    const m = new Map();
    for (const e of evaluationEvents || []) {
      if (e.coachRole !== "Assistant" || !e.evaluatorId) continue;
      const cur = m.get(e.evaluatorId);
      if (!cur || evalRoundRecency(e, cur) < 0) {
        m.set(e.evaluatorId, e);
      }
    }
    return [...m.values()].sort(evalRoundRecency);
  }, [evaluationEvents]);

  if (latestByAssistant.length === 0) return null;

  return (
    <div className="px-5 py-4 bg-warn-bg border-b border-line">
      <div className="flex items-center justify-between mb-3">
        <h3 className="t-h3">Assistant Submissions</h3>
        <span className="t-eyebrow text-ink-3">
          {latestByAssistant.length} assistant
          {latestByAssistant.length === 1 ? "" : "s"} ·{" "}
          {Math.round(50)}% weight (split equally with your eval)
        </span>
      </div>
      <div className="space-y-3">
        {latestByAssistant.map((ev) => {
          const playersWithSignal = (players || []).filter((p: any) => {
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
              className="bg-surface border border-line rounded-xl p-3 shadow-sm"
            >
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="text-[11px] font-extrabold uppercase tracking-widest text-ink-2 truncate">
                  Assistant · {ev.evaluatorName || ev.evaluatorId?.slice(0, 8) || "—"}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-[10px] font-bold text-ink-3">
                    {ev.date}
                  </div>
                  {onDelete && (() => {
                    const armed = pendingDeleteId === ev.id;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          if (armed) {
                            onDelete(ev.id);
                            setPendingDeleteId(null);
                          } else {
                            setPendingDeleteId(ev.id);
                          }
                        }}
                        onBlur={() => {
                          if (armed) setPendingDeleteId(null);
                        }}
                        className={`flex items-center gap-1 rounded-md transition-colors ${
                          armed
                            ? "px-2 py-1 bg-loss-bg text-loss ring-2 ring-red-300"
                            : "p-1 text-ink-3 hover:text-loss hover:bg-loss-bg"
                        }`}
                        title={
                          armed
                            ? "Tap again to delete"
                            : "Delete this assistant's eval round"
                        }
                        aria-label={
                          armed
                            ? "Confirm delete assistant eval round"
                            : "Delete assistant eval round"
                        }
                      >
                        <Icons.Trash className="w-3.5 h-3.5" />
                        {armed && (
                          <span className="text-[10px] font-black uppercase tracking-widest">
                            Confirm
                          </span>
                        )}
                      </button>
                    );
                  })()}
                </div>
              </div>
              {playersWithSignal.length === 0 ? (
                <p className="text-[11px] text-ink-3 font-medium italic">
                  Grades submitted — no positions or notes flagged.
                </p>
              ) : (
                <div className="space-y-2">
                  {playersWithSignal.map((p: any) => {
                    const g = ev.grades?.[p.id] || {};
                    return (
                      <div
                        key={p.id}
                        className="border-t border-line pt-2 first:border-t-0 first:pt-0"
                      >
                        <div className="text-[12px] font-black uppercase tracking-tight text-ink mb-1">
                          {p.name}
                        </div>
                        {Array.isArray(g.suggestedPositions) &&
                          g.suggestedPositions.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {g.suggestedPositions.map((pos: any) => (
                                <span
                                  key={pos}
                                  className="text-[10px] font-black px-1.5 py-0.5 rounded-md border bg-warn-bg border-line text-warnfg"
                                >
                                  {pos}
                                </span>
                              ))}
                            </div>
                          )}
                        {g.notes && g.notes.trim() && (
                          <p className="text-[11px] text-ink italic leading-snug">
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

// Read-only inline readout of every assistant's most-recent grades + notes for
// ONE player, rendered right inside that player's head-coach grading card. This
// is the "see it all together" view — the head reads their own (editable) grades
// and each assistant's submission side by side without thumbing through a
// separate screen. Only assistants who actually graded this player appear.
const PlayerAssistantEvals = memo(
  ({ player, playerCats, assistantRounds }: any) => {
    const relevant = (assistantRounds || []).filter(
      (ev: any) => ev.grades?.[player.id]
    );
    if (relevant.length === 0) return null;
    return (
      <div className="pt-2 border-t border-line">
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1.5">
          Assistant Evaluations ({relevant.length})
        </div>
        <div className="space-y-2">
          {relevant.map((ev: any) => {
            const g = ev.grades?.[player.id] || {};
            const positions = Array.isArray(g.suggestedPositions)
              ? g.suggestedPositions
              : [];
            return (
              <div
                key={ev.id}
                className="bg-app border border-line rounded-lg p-2.5"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-[11px] font-extrabold uppercase tracking-widest text-ink-2 truncate">
                    Assistant ·{" "}
                    {ev.evaluatorName || ev.evaluatorId?.slice(0, 8) || "—"}
                  </span>
                  <span className="text-[10px] font-bold text-ink-3 shrink-0">
                    {ev.date}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 mb-1">
                  {playerCats.map((cat: any) => {
                    const v = +g[cat.id];
                    return (
                      <div
                        key={cat.id}
                        className="flex items-center justify-between gap-1.5"
                      >
                        <span className="text-[10px] font-bold text-ink-3 uppercase tracking-wide truncate">
                          {cat.label}
                        </span>
                        <span className="text-xs font-black tabular-nums text-ink shrink-0">
                          {Number.isFinite(v) ? v : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {positions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {positions.map((pos: any) => (
                      <span
                        key={pos}
                        className="text-[10px] font-black px-1.5 py-0.5 rounded border bg-surface border-line text-ink-2"
                      >
                        {pos}
                      </span>
                    ))}
                  </div>
                )}
                {g.notes && g.notes.trim() && (
                  <p className="text-[11px] text-ink italic leading-snug mt-1.5">
                    &ldquo;{g.notes}&rdquo;
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

const GradeChipRow = memo(({ value, onChange, ariaLabel }: any) => (
  <div
    className="flex items-center gap-1"
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
          className="flex items-center justify-center w-8 h-8 rounded-md border text-xs font-black tabular-nums transition-all"
          style={
            isActive
              ? {
                  backgroundColor: "var(--team-primary)",
                  color: "var(--team-tertiary)",
                  borderColor: "var(--team-primary)",
                }
              : {
                  backgroundColor: "var(--surface)",
                  color: "var(--ink-2)",
                  borderColor: "var(--line)",
                }
          }
        >
          {n}
        </button>
      );
    })}
  </div>
));

export const EvaluationTab = memo(() => {
  const { team, user, saveTeamEvaluation, deleteEvaluation, currentRole } =
    useTeam();
  const isAssistant = currentRole === "assistant";
  const {
    teamEvalGrades,
    setTeamEvalGrades,
    selectedRoundId,
    setSelectedRoundId,
    evalTrendPlayerId,
    setEvalTrendPlayerId,
  } = useUI();
  const { players: rawPlayers, primaryColor, evaluationEvents } = team;
  // Sort eval cards by jersey number so the head can scan in the same
  // order coaches call kids on the field. Numeric sort; unnumbered
  // players sink to the bottom with name as the tie-break.
  const players = useMemo(() => {
    return (rawPlayers || []).slice().sort((a: any, b: any) => {
      const na = parseInt(a.number, 10);
      const nb = parseInt(b.number, 10);
      const aValid = Number.isFinite(na);
      const bValid = Number.isFinite(nb);
      if (aValid && bValid) {
        if (na !== nb) return na - nb;
      } else if (aValid) return -1;
      else if (bValid) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [rawPlayers]);

  // Eval cadence: "Start new Eval" is gated until a preseason / biweekly
  // window opens for this head coach. Past rounds stay viewable + editable.
  const promptStatus = useMemo(
    () => evalPromptStatus(team, user?.uid, "Head"),
    [team, user]
  );

  const [saveState, setSaveState] = useState("idle");
  const [activeGroup, setActiveGroup] = useState("Hitting");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  // Two-tap confirm for the head's own round delete — arms the trash
  // button on first tap, commits on second. Replaces window.confirm.
  const [pendingRoundDelete, setPendingRoundDelete] = useState(false);
  // Two-tap confirm for overwriting an existing round — first tap names the
  // round being written, second tap commits. Creating a new round skips this.
  const [pendingUpdateConfirm, setPendingUpdateConfirm] = useState(false);
  // Manage Rounds modal: lists every saved round so the head can switch
  // or delete any of them without first selecting from the dropdown.
  // `pendingModalDeleteId` is the per-row armed-state id for the
  // modal's two-tap confirm.
  const [manageOpen, setManageOpen] = useState(false);
  const [pendingModalDeleteId, setPendingModalDeleteId] = useState(null);
  // Player cards are collapsed by default — the eval grid was too tall
  // to scan a 12-kid roster without scrolling for days. Each card now
  // shows a single header row (name + jersey + total + chevron); tap
  // to expand the grading UI. Multi-expand allowed so coaches can
  // compare two kids side-by-side mid-grading.
  const [expandedPlayerIds, setExpandedPlayerIds] = useState(() => new Set());
  const togglePlayerExpanded = useCallback((playerId: any) => {
    setExpandedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);
  const lastSavedRef = useRef("");

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
  // If a group disappears (e.g. user changed pitchingFormat away from Kid Pitch
  // while viewing the Pitching tab), bounce back to Hitting.
  useEffect(() => {
    if (!visibleGroups.includes(activeGroup as any)) setActiveGroup("Hitting");
  }, [visibleGroups, activeGroup]);

  // Clear any armed-for-delete state when the user switches rounds —
  // otherwise the trash button stays "primed" for a different target
  // than what they're now viewing.
  useEffect(() => {
    setPendingRoundDelete(false);
  }, [selectedRoundId]);

  // Eval rounds belonging to this head coach, newest first (createdAt breaks
  // same-date ties so the genuinely newest round leads).
  const myRounds = useMemo(() => {
    return (evaluationEvents || [])
      .filter(
        (e: any) => e.coachRole === "Head" && (!user || e.evaluatorId === user.uid)
      )
      .sort(evalRoundRecency);
  }, [evaluationEvents, user]);

  // Each assistant's most-recent submission (newest first), surfaced inline
  // under every player so the head sees their grades + all assistant grades
  // together. Same selection rule getCombinedGrades uses: latest per evaluator.
  const assistantRounds = useMemo(() => {
    const m = new Map();
    for (const e of evaluationEvents || []) {
      if (e.coachRole !== "Assistant" || !e.evaluatorId) continue;
      const cur = m.get(e.evaluatorId);
      if (!cur || evalRoundRecency(e, cur) < 0) m.set(e.evaluatorId, e);
    }
    return [...m.values()].sort(evalRoundRecency);
  }, [evaluationEvents]);

  // What Save actually does is driven purely by whether a saved round is
  // selected — NOT by the cadence window:
  //   • no round selected  → CREATE a brand-new round (pre-filled from the
  //                           latest as a baseline)
  //   • a round selected   → UPDATE (overwrite) that exact round
  // The old flow hid this: outside a cadence window it showed "Update Eval"
  // while a save with no round selected silently created a *new* round. We make
  // the split explicit instead. promptStatus only gates WHEN a new round is
  // offered, not what the button does.
  const isCreatingNew = !selectedRoundId;
  const activeRound = selectedRoundId
    ? myRounds.find((r: any) => r.id === selectedRoundId)
    : null;
  const activeRoundName = activeRound ? formatRoundName(activeRound) : "";

  // The coach can explicitly start a new round at ANY time (the cadence prompt
  // is a nudge, never a gate). This flag records that explicit choice so the
  // auto-select below doesn't immediately snap back to the latest round.
  const [explicitNew, setExplicitNew] = useState(false);
  const startNewRound = useCallback(() => {
    setExplicitNew(true);
    setSelectedRoundId(null);
  }, [setSelectedRoundId]);

  // Outside a new-eval window, default to the most recent round so the screen
  // is squarely *editing* it (Save = Update, matching the "Editing …" label) —
  // unless the coach explicitly chose "Start a new Eval". Inside a window,
  // leaving it unselected means "new round".
  useEffect(() => {
    if (
      !explicitNew &&
      !promptStatus.active &&
      !selectedRoundId &&
      myRounds.length > 0
    ) {
      setSelectedRoundId(myRounds[0].id);
    }
  }, [explicitNew, promptStatus.active, selectedRoundId, myRounds, setSelectedRoundId]);

  // Track unsaved changes against the last persisted snapshot so the
  // header can show a single, honest "Unsaved changes" indicator until
  // the coach clicks Save. The localStorage draft + auto-restore that
  // used to live here was removed — it made it look like grades were
  // saving on their own, when in fact nothing committed until Save.
  // For both new rounds and existing-round edits the rule is the same:
  // typing flips state to "dirty"; Save flips it to "saved".
  useEffect(() => {
    const snapshot = JSON.stringify(teamEvalGrades);
    if (snapshot === lastSavedRef.current) return;
    if (lastSavedRef.current === "") {
      // First snapshot after mounting / switching rounds — initialize
      // the baseline without flagging dirty.
      lastSavedRef.current = snapshot;
      return;
    }
    setSaveState("dirty");
  }, [teamEvalGrades]);

  // Warn the coach before they close / navigate away with unsaved
  // grades. Modern browsers ignore the custom string but render their
  // own "Leave site?" prompt as long as the handler calls
  // preventDefault + sets returnValue.
  useEffect(() => {
    if (saveState !== "dirty") return;
    const onBeforeUnload = (e: any) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  // Reset save baseline + any armed overwrite confirm when switching rounds.
  useEffect(() => {
    lastSavedRef.current = "";
    setSaveState("idle");
    setPendingUpdateConfirm(false);
  }, [selectedRoundId]);

  const doSave = useCallback(() => {
    const savedRoundId = saveTeamEvaluation();
    // After creating a new round, lock onto it so the next save updates it.
    if (isCreatingNew && savedRoundId) {
      setSelectedRoundId(savedRoundId);
    }
    setExplicitNew(false);
    lastSavedRef.current = JSON.stringify(teamEvalGrades);
    setSaveState("saved");
    setPendingUpdateConfirm(false);
  }, [saveTeamEvaluation, isCreatingNew, setSelectedRoundId, teamEvalGrades]);

  const handleSaveClick = useCallback(() => {
    // Creating a new round is low-risk — save straight through. Overwriting a
    // saved round is a two-tap confirm so it's unmistakable which round (file)
    // is being written.
    if (isCreatingNew) {
      doSave();
      return;
    }
    if (pendingUpdateConfirm) {
      doSave();
      return;
    }
    setPendingUpdateConfirm(true);
  }, [isCreatingNew, pendingUpdateConfirm, doSave]);

  const setGrade = useCallback(
    (playerId: any, categoryId: any, value: any) => {
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
    (playerId: any, notesValue: any) => {
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
    (playerId: any, pos: any) => {
      const cur = teamEvalGrades[playerId] || {};
      const list = Array.isArray(cur.suggestedPositions)
        ? cur.suggestedPositions
        : [];
      const next = list.includes(pos)
        ? list.filter((p: any) => p !== pos)
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
    const next: Record<string, any> = {};
    players.forEach((p: any) => {
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
    const next: Record<string, any> = {};
    players.forEach((p: any) => {
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
        <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface border-b border-line">
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
              {saveState === "dirty" && (
                <>
                  <Icons.Alert className="w-3 h-3 text-warnfg" />
                  Unsaved changes
                </>
              )}
              {!isCreatingNew && saveState === "saved" && (
                <>
                  <Icons.Check className="w-3 h-3 text-win" />
                  Saved
                </>
              )}
            </span>
            <button
              type="button"
              onClick={handleSaveClick}
              onBlur={() => setPendingUpdateConfirm(false)}
              className={`flex-1 sm:flex-none t-button px-6 py-3 rounded-xl shadow-md hover:-translate-y-0.5 transition-transform flex items-center justify-center gap-2 ${
                pendingUpdateConfirm ? "ring-2 ring-amber-300" : ""
              }`}
              style={{
                backgroundColor: "var(--team-primary)",
                color: "var(--team-tertiary)",
              }}
              title={
                isCreatingNew
                  ? "Save a brand-new eval round"
                  : pendingUpdateConfirm
                  ? `Tap again to overwrite the saved round "${activeRoundName}"`
                  : `Overwrite the saved round "${activeRoundName}"`
              }
            >
              <Icons.Save className="w-4 h-4" />
              {isCreatingNew
                ? "Save as New Round"
                : pendingUpdateConfirm
                ? `Overwrite “${activeRoundName}”?`
                : "Update This Round"}
            </button>
          </div>
        </div>

        {/* Round selection bar */}
        <div className="px-5 py-3 bg-warn-bg border-b border-line flex flex-col sm:flex-row gap-3 sm:items-center">
          <label className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-2 shrink-0">
              Eval:
            </span>
            <select
              value={selectedRoundId || "__new"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new") {
                  startNewRound();
                } else {
                  setExplicitNew(false);
                  setSelectedRoundId(v || null);
                }
              }}
              className="flex-1 min-w-0 text-xs font-bold border border-line bg-surface text-ink px-3 py-2 outline-none rounded-lg cursor-pointer hover:bg-surface transition-colors"
            >
              {/* Starting a new round is ALWAYS available — the cadence prompt
                  only decorates the label. Gating it forced coaches into
                  overwriting their previous round between windows. */}
              <option value="__new">
                + Start a new Eval
                {promptStatus.active
                  ? promptStatus.kind === "preseason"
                    ? " (preseason due)"
                    : " (biweekly due)"
                  : promptStatus.daysUntilDue != null
                  ? ` (next due in ${promptStatus.daysUntilDue}d)`
                  : ""}
              </option>
              {myRounds.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {formatRoundName(r)}
                </option>
              ))}
            </select>
          </label>
          {selectedRoundId && (
            <button
              type="button"
              onClick={() => {
                if (pendingRoundDelete) {
                  deleteEvaluation?.(selectedRoundId);
                  setSelectedRoundId(null);
                  lastSavedRef.current = "";
                  setSaveState("idle");
                  setPendingRoundDelete(false);
                } else {
                  setPendingRoundDelete(true);
                }
              }}
              onBlur={() => setPendingRoundDelete(false)}
              className={`shrink-0 flex items-center gap-1.5 border rounded-lg transition-colors ${
                pendingRoundDelete
                  ? "px-2.5 py-2 bg-loss-bg text-loss border-line ring-2 ring-red-200"
                  : "p-2 text-ink-3 hover:text-loss hover:bg-loss-bg border-line hover:border-line"
              }`}
              title={
                pendingRoundDelete
                  ? "Tap again to delete this eval round"
                  : "Delete this eval round"
              }
              aria-label={
                pendingRoundDelete
                  ? "Confirm delete selected eval round"
                  : "Delete selected eval round"
              }
            >
              <Icons.Trash className="w-4 h-4" />
              {pendingRoundDelete && (
                <span className="text-[10px] font-black uppercase tracking-widest">
                  Confirm
                </span>
              )}
            </button>
          )}
          {!isCreatingNew && activeRound && (
            <span className="text-[10px] font-bold text-ink-3 italic">
              Editing &quot;{formatRoundName(activeRound)}&quot;
            </span>
          )}
          {/* Explicit escape hatch: while editing a saved round, branch off
              into a brand-new round instead of overwriting. Available at ALL
              times — the cadence prompt is a reminder, not a gate. */}
          {!isCreatingNew && (
            <button
              type="button"
              onClick={startNewRound}
              className="shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-lg hover:bg-surface-2 transition-colors flex items-center gap-1.5"
              title="Start a brand-new eval round instead of overwriting this one"
            >
              <Icons.Plus className="w-3.5 h-3.5" />
              Start New Round
            </button>
          )}
          {myRounds.length > 0 && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-lg hover:bg-surface-2 transition-colors flex items-center gap-1.5"
              title="View, switch between, and delete saved rounds"
              aria-label="Manage saved eval rounds"
            >
              <Icons.Clipboard className="w-3.5 h-3.5" />
              Manage
            </button>
          )}
          {myRounds.length >= 2 && (
            <button
              type="button"
              onClick={() => setComparisonOpen(true)}
              className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2 flex items-center gap-1.5 shrink-0"
              title="Compare any two saved rounds side by side"
            >
              <Icons.Forward className="w-3.5 h-3.5" /> Compare Rounds
            </button>
          )}
        </div>

        {/* Spells out exactly what Save will do right now — the fix for "is
            this updating a file or starting a new eval?" */}
        <div className="px-5 py-2 bg-surface border-b border-line">
          <p className="text-[11px] font-medium text-ink-2 flex items-center gap-1.5">
            <Icons.Save className="w-3 h-3 text-ink-3 shrink-0" />
            {isCreatingNew ? (
              <>
                Save creates a{" "}
                <strong className="font-black text-ink">new eval round</strong>
                {promptStatus.active
                  ? promptStatus.kind === "preseason"
                    ? " (preseason)."
                    : " (biweekly)."
                  : myRounds.length > 0
                  ? ", pre-filled from your latest round."
                  : "."}
              </>
            ) : (
              <>
                Save{" "}
                <strong className="font-black text-ink">
                  overwrites the saved round
                </strong>{" "}
                &ldquo;{activeRoundName}&rdquo; — it does not create a new one.
              </>
            )}
          </p>
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
          onDelete={deleteEvaluation}
        />

        {/* Quick-set toolbar */}
        <div className="px-5 py-3 bg-surface border-b border-line flex flex-wrap items-center gap-2">
          <span className="t-eyebrow mr-1">Quick Set:</span>
          <button
            type="button"
            onClick={copyFromLastRound}
            disabled={!hasLastRound}
            className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
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
            className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2 flex items-center gap-1.5"
            title="Set every category for every player to 3"
          >
            <Icons.Refresh className="w-3.5 h-3.5" /> All Average (3)
          </button>
          <button
            type="button"
            onClick={() => setTeamEvalGrades({})}
            className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-loss-bg hover:border-line hover:text-loss flex items-center gap-1.5"
            title="Clear all in-progress grades"
          >
            <Icons.X className="w-3.5 h-3.5" /> Clear
          </button>
        </div>

        {/* Per-player grading cards. One column on mobile, two on lg+
            screens. Replaces the legacy desktop table — same chip rows
            as the assistant flow so head + assistant inputs match. */}
        <div className="p-3 bg-surface space-y-2">
          {players.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <span className="t-eyebrow text-ink-3">
                {expandedPlayerIds.size} of {players.length} open
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedPlayerIds(new Set(players.map((p: any) => p.id)))
                  }
                  className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border border-line bg-surface text-ink-2 hover:bg-surface-2"
                >
                  Expand All
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedPlayerIds(new Set())}
                  className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border border-line bg-surface text-ink-2 hover:bg-surface-2"
                >
                  Collapse All
                </button>
              </div>
            </div>
          )}
          {players.length === 0 ? (
            <div className="text-center py-10 t-body">
              <div className="text-4xl leading-none mb-3 opacity-80" aria-hidden>
                ⭐
              </div>
              No players on the roster yet.
            </div>
          ) : (
            players.map((player: any) => {
              const savedGrades = teamEvalGrades[player.id] || {};
              const grades = {
                ...DEFAULT_GRADES,
                ...savedGrades,
              };
              // Only the categories that apply to this kid (universal + their
              // pitching/catching specialty), so non-pitchers/non-catchers
              // aren't shown — or scored on — spots that don't apply to them.
              const playerCats = getEvalCategoriesForPlayer(
                team?.pitchingFormat,
                player
              );
              // Roster-decision value: universal Total Score plus a pitching
              // premium for pitchers (additive — never penalizes non-pitchers).
              const totalScore = Math.min(
                100,
                calculateTotalScore(grades, player.stats) +
                  pitcherPremium(savedGrades, player, team?.teamAge)
              );
              const expanded = expandedPlayerIds.has(player.id);
              // Count how many categories the coach has graded (any non-default
              // chip click) so the collapsed row can show progress at a glance.
              const gradedCount = playerCats.filter(
                (c) => Number.isFinite(grades[c.id]) && grades[c.id] > 0
              ).length;
              return (
                <div
                  key={`mc-${player.id}`}
                  className="bg-surface rounded-xl border border-line shadow-sm overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => togglePlayerExpanded(player.id)}
                    aria-expanded={expanded}
                    className="w-full px-3 py-2 flex items-center gap-3 hover:bg-surface-2 transition-colors text-left"
                  >
                    <Icons.ChevronRight
                      className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${
                        expanded ? "rotate-90" : ""
                      }`}
                    />
                    {player.number && (
                      <span className="text-[11px] font-bold text-ink-3 tabular-nums shrink-0 w-7 text-center">
                        #{player.number}
                      </span>
                    )}
                    <span className="flex-1 min-w-0 text-sm font-black uppercase tracking-tight text-ink truncate">
                      {player.name}
                    </span>
                    <span className="text-[10px] font-bold text-ink-3 shrink-0 tabular-nums">
                      {gradedCount}/{playerCats.length}
                    </span>
                    <span
                      className="text-xs font-black tabular-nums px-2 py-0.5 rounded-md shrink-0"
                      style={{
                        backgroundColor: "var(--team-primary)",
                        color: "var(--team-tertiary)",
                      }}
                      title="Total Score (out of 100)"
                    >
                      {totalScore}
                    </span>
                  </button>
                  {expanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-line space-y-2.5">
                      <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 pt-0.5">
                        Your Evaluation
                      </div>
                      {playerCats.map((cat) => (
                        <div
                          key={cat.id}
                          className="flex items-start justify-between gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-extrabold uppercase tracking-widest text-ink-2 flex items-center gap-1.5 flex-wrap">
                              {cat.label}
                              {(() => {
                                const hint = evalStatHint(
                                  cat.id,
                                  player.stats,
                                  player.pitching
                                );
                                return hint ? (
                                  <span className="text-[10px] font-black tabular-nums text-ink-2 bg-surface-2 border border-line rounded px-1.5 py-0.5 normal-case tracking-normal">
                                    {hint}
                                  </span>
                                ) : null;
                              })()}
                            </span>
                            {cat.description && (
                              <span className="text-[10px] font-medium text-ink-3 leading-tight block mt-0.5">
                                {cat.description}
                              </span>
                            )}
                          </div>
                          <GradeChipRow
                            value={grades[cat.id]}
                            onChange={(v: any) =>
                              setGrade(player.id, cat.id, v)
                            }
                            ariaLabel={`${player.name} ${cat.label}`}
                          />
                        </div>
                      ))}
                      <div className="pt-1.5 border-t border-line">
                        <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1.5">
                          Suggested Positions
                        </div>
                        <div className="flex flex-wrap gap-1">
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
                                className="px-1.5 py-0.5 text-[10px] font-black rounded border transition-all"
                                style={
                                  active
                                    ? {
                                        backgroundColor: "var(--team-primary)",
                                        color: "var(--team-tertiary)",
                                        borderColor: "var(--team-primary)",
                                      }
                                    : {
                                        backgroundColor: "var(--surface)",
                                        color: "var(--ink-2)",
                                        borderColor: "var(--line)",
                                      }
                                }
                              >
                                {pos}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <textarea
                        value={grades.notes || ""}
                        onChange={(e) => setNotes(player.id, e.target.value)}
                        placeholder="Notes"
                        rows={1}
                        className="w-full text-xs font-medium border border-line bg-surface text-ink px-2 py-1.5 outline-none rounded-md focus:ring-2 focus:ring-[var(--team-primary)] resize-y"
                      />
                      <PlayerAssistantEvals
                        player={player}
                        playerCats={playerCats}
                        assistantRounds={assistantRounds}
                      />
                      <button
                        type="button"
                        onClick={() => setEvalTrendPlayerId(player.id)}
                        className="text-[10px] font-black uppercase tracking-widest text-ink-3 hover:text-ink underline"
                      >
                        View trend →
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

      </div>

      {/* Roster Decisions panel — advisory recommendations based on
          eval trends, current performance, and age eligibility.
          Head-coach-only; assistants don't make roster decisions. */}
      {!isAssistant && <RosterDecisionsPanel />}

      {/* Side-by-side round comparison modal */}
      {comparisonOpen && (
        <RoundComparisonView
          rounds={myRounds}
          players={players}
          activeCategories={activeCategories}
          primaryColor={primaryColor}
          onPlayerClick={(id: any) => {
            setComparisonOpen(false);
            setEvalTrendPlayerId(id);
          }}
          onClose={() => setComparisonOpen(false)}
        />
      )}

      {/* Trend modal — opens when a player name is clicked */}
      {evalTrendPlayerId && (
        <EvalTrendModal
          player={players.find((p: any) => p.id === evalTrendPlayerId)}
          evaluationEvents={evaluationEvents}
          userUid={user?.uid}
          primaryColor={primaryColor}
          onClose={() => setEvalTrendPlayerId(null)}
        />
      )}

      {/* Manage Rounds modal — lists every saved round with per-row
          delete (two-tap armed) and a Select link. Lets the head jump
          to or remove any round without first selecting it from the
          dropdown. */}
      {manageOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm"
          onClick={() => {
            setManageOpen(false);
            setPendingModalDeleteId(null);
          }}
        >
          <A11yDialog
            label="Your saved rounds"
            onClose={() => {
              setManageOpen(false);
              setPendingModalDeleteId(null);
            }}
            className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
            <div className="p-5 sm:p-6 border-b border-line flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight text-ink">
                  Your Saved Rounds
                </h3>
                <p className="text-[12px] text-ink-3 font-medium mt-1">
                  Select a round to review or edit, or delete one saved
                  by mistake.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setManageOpen(false);
                  setPendingModalDeleteId(null);
                }}
                className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
                aria-label="Close"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              {myRounds.length === 0 ? (
                <div className="text-sm font-bold text-ink-3 italic text-center py-8">
                  No saved rounds yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {myRounds.map((r: any) => {
                    const armed = pendingModalDeleteId === r.id;
                    const isActive = r.id === selectedRoundId;
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
                          isActive
                            ? "bg-app border-line-strong"
                            : "bg-surface border-line"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-black text-ink truncate">
                            {formatRoundName(r)}
                          </div>
                          {isActive && (
                            <div className="text-[9px] font-extrabold uppercase tracking-widest text-ink-3 mt-0.5">
                              Currently editing
                            </div>
                          )}
                        </div>
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRoundId(r.id);
                              setManageOpen(false);
                              setPendingModalDeleteId(null);
                            }}
                            className="shrink-0 text-[10px] font-black uppercase tracking-widest text-ink hover:text-ink px-2 py-1 rounded hover:bg-surface-2 transition-colors"
                          >
                            Select
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (armed) {
                              deleteEvaluation?.(r.id);
                              setPendingModalDeleteId(null);
                              if (r.id === selectedRoundId) {
                                setSelectedRoundId(null);
                                lastSavedRef.current = "";
                                setSaveState("idle");
                              }
                            } else {
                              setPendingModalDeleteId(r.id);
                            }
                          }}
                          onBlur={() => {
                            if (armed) setPendingModalDeleteId(null);
                          }}
                          className={`shrink-0 flex items-center gap-1 rounded-md transition-colors ${
                            armed
                              ? "px-2 py-1 bg-loss-bg text-loss ring-2 ring-red-300"
                              : "p-1.5 text-ink-3 hover:text-loss hover:bg-loss-bg"
                          }`}
                          title={
                            armed
                              ? "Tap again to delete this round"
                              : "Delete this round"
                          }
                          aria-label={
                            armed
                              ? `Confirm delete ${formatRoundName(r)}`
                              : `Delete ${formatRoundName(r)}`
                          }
                        >
                          <Icons.Trash className="w-3.5 h-3.5" />
                          {armed && (
                            <span className="text-[10px] font-black uppercase tracking-widest">
                              Confirm
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </A11yDialog>
        </div>
      )}
    </div>
  );
});
export const EvalTrendModal = memo(
  ({ player, evaluationEvents, userUid, primaryColor, onClose }: any) => {
    if (!player) return null;

    // Collect this user's head-coach evals, oldest first
    const myEvals = (evaluationEvents || [])
      .filter(
        (e: any) => e.coachRole === "Head" && (!userUid || e.evaluatorId === userUid)
      )
      .sort((a: any, b: any) => evalRoundRecency(b, a));

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
    const xLabels: any[] = [];
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

    // Pivot into one row per eval round, keyed by category id, so each
    // category renders as its own <Line dataKey>. Points match by eval date
    // (same matching the old hand-rolled chart used).
    const chartRows = xLabels.map((x) => {
      const row: Record<string, any> = { id: x.id, label: x.label };
      for (const cs of categorySeries) {
        const p = cs.points.find((pt) => pt.date === x.date);
        if (p) row[cs.id] = p.value;
      }
      return row;
    });
    const shortLabel = (label: string) =>
      label.length > 18 ? `${label.slice(0, 16)}…` : label;
    const labelById = new Map(xLabels.map((x) => [x.id, x.label]));

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
        <A11yDialog
          label="Evaluation trend"
          onClose={onClose}
          className="bg-surface rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        >
          <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
          <div className="p-5 sm:p-6 border-b border-line flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-0.5">
                {player.name}
              </div>
              <h3 className="text-2xl font-black uppercase tracking-tight text-ink">
                Evaluation Trend
              </h3>
              <p className="text-[11px] text-ink-3 font-medium mt-0.5">
                {evalCount === 0
                  ? "No eval data yet."
                  : evalCount === 1
                  ? "1 eval recorded — add more to see trends."
                  : `${evalCount} evals over time`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 sm:p-7 overflow-y-auto custom-scrollbar flex-1">
            {evalCount === 0 ? (
              <div className="bg-app border border-line rounded-xl p-12 text-center">
                <Icons.Clipboard className="w-10 h-10 text-ink-3 mx-auto mb-3" />
                <p className="text-sm font-black uppercase tracking-widest text-ink-3 mb-1">
                  No Evals Recorded
                </p>
                <p className="text-xs text-ink-3 font-medium">
                  Save an eval round to start tracking this player&apos;s trends.
                </p>
              </div>
            ) : evalCount === 1 ? (
              <div className="bg-app border border-line rounded-xl p-8 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-2">
                  {xLabels[0].label}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                  {categorySeries.map((cs, idx) => (
                    <div
                      key={cs.id}
                      className="bg-surface border border-line rounded-lg p-3"
                    >
                      <div
                        className="text-[10px] font-black uppercase tracking-widest mb-1"
                        style={{ color: palette[idx % palette.length] }}
                      >
                        {cs.label}
                      </div>
                      <div className="text-2xl font-black tabular-nums text-ink">
                        {cs.points[0]?.value ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ink-3 font-medium mt-4">
                  Add more eval rounds to see trends.
                </p>
              </div>
            ) : (
              <>
                {/* Chart */}
                <div className="bg-app border border-line rounded-xl p-4 mb-4">
                  <ChartFrame label="Evaluation trend by category" height={320}>
                    <LineChart
                      data={chartRows}
                      margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--line)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="id"
                        interval={0}
                        height={evalCount > 4 ? 56 : 30}
                        tickLine={false}
                        axisLine={{ stroke: "var(--line)" }}
                        tickFormatter={(id: string) =>
                          shortLabel(labelById.get(id) || "")
                        }
                        tick={{
                          fontSize: 10,
                          fontWeight: 700,
                          fill: "var(--ink-3)",
                          ...(evalCount > 4
                            ? { angle: -30, textAnchor: "end" }
                            : {}),
                        }}
                      />
                      <YAxis
                        domain={[1, 5]}
                        ticks={[1, 2, 3, 4, 5]}
                        width={32}
                        tickLine={false}
                        axisLine={false}
                        tick={{
                          fontSize: 11,
                          fontWeight: 700,
                          fill: "var(--ink-3)",
                          fontFamily: "ui-monospace, monospace",
                        }}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            labelFormatter={(id) =>
                              labelById.get(String(id)) || String(id)
                            }
                          />
                        }
                        cursor={{
                          stroke: "var(--line-strong)",
                          strokeDasharray: "3 3",
                        }}
                      />
                      {categorySeries.map((cs, idx) => {
                        if (cs.points.length === 0) return null;
                        const color = palette[idx % palette.length];
                        return (
                          <Line
                            key={cs.id}
                            dataKey={cs.id}
                            name={cs.label}
                            type="monotone"
                            connectNulls
                            stroke={color}
                            strokeWidth={2.5}
                            dot={{
                              r: 3.5,
                              fill: color,
                              stroke: "var(--surface)",
                              strokeWidth: 1.5,
                            }}
                            activeDot={{ r: 5 }}
                            animationDuration={600}
                          />
                        );
                      })}
                    </LineChart>
                  </ChartFrame>
                </div>

                {/* Legend with trend summary */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {categorySeries.map((cs, idx) => {
                    const trend = trends[idx];
                    const color = palette[idx % palette.length];
                    return (
                      <div
                        key={cs.id}
                        className="bg-surface border border-line rounded-lg p-2.5 flex items-center gap-2"
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-widest text-ink truncate">
                            {cs.label}
                          </div>
                          {trend && (
                            <div
                              className={`text-[10px] font-black tabular-nums ${
                                trend.change > 0
                                  ? "text-win"
                                  : trend.change < 0
                                  ? "text-loss"
                                  : "text-ink-3"
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
        </A11yDialog>
      </div>
    );
  }
);

