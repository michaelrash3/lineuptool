import { memo, useMemo } from "react";

import { Icons } from "../../icons";
import { calculateBaseballAge, evalRoundRecency } from "../../utils/helpers";
import {
  getEvalCategoriesForPlayer,
  leftHandedPitcherRosterPremium,
} from "../../constants/ui";
import { calculateTotalScore } from "../../lineupEngine";
import { currentEvaluationScore100 } from "../../utils/evaluationScore";
import { useTeam, useUI } from "../../contexts";
import {
  asGradeMap,
  DEFAULT_GRADES,
  pitcherPremium,
  type DecisionBucket,
  type DecisionRow,
  type EvalRound,
} from "../../utils/evalScoring";
import type { Player } from "../../types";

export const RosterDecisionsPanel = memo(() => {
  const { team, user } = useTeam();
  const { setEvalTrendPlayerId } = useUI();
  const { players, primaryColor, evaluationEvents, teamAge, currentSeason } =
    team;

  const decisions = useMemo(() => {
    if (!players || players.length === 0) return null;

    // Eval rounds for this user, oldest first
    const myEvals = ((evaluationEvents || []) as EvalRound[])
      .filter(
        (e: EvalRound) =>
          !e.tryoutSignupId &&
          !e.tryoutSessionId &&
          e.coachRole === "Head" &&
          (!user || e.evaluatorId === user.uid),
      )
      .sort((a: EvalRound, b: EvalRound) => evalRoundRecency(b, a));

    // Compute team-wide stat averages for current season (used as baseline
    // for "below team average" performance signal)
    const statsAvg = (() => {
      const fields = ["ops", "avg", "obp"];
      const sums: Record<string, number> = Object.create(null);
      const counts: Record<string, number> = Object.create(null);
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
      const out: Record<string, number> = Object.create(null);
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

    const decisionRows: DecisionRow[] = players.map((player: Player) => {
      // ---- Latest eval grade (average across categories) ----
      let latestEvalAvg: number | null = null;
      const playerCats = getEvalCategoriesForPlayer(
        team?.pitchingFormat,
        player,
      );
      const evalsForPlayer = myEvals
        .map((ev: EvalRound) => {
          const g = ev.grades?.[player.id];
          if (!g) return null;
          const score = currentEvaluationScore100(
            asGradeMap(g),
            player,
            team?.teamAge,
          );
          if (score == null) return null;
          return {
            date: ev.date,
            label: ev.label || ev.date,
            avg: score,
          };
        })
        .filter((e): e is { date: string; label: string; avg: number } => !!e);

      if (evalsForPlayer.length > 0) {
        latestEvalAvg = evalsForPlayer[evalsForPlayer.length - 1].avg;
      }

      // ---- Eval trend (first vs latest) ----
      let evalTrend: "improving" | "declining" | "flat" | null = null;
      let evalDelta: number | null = null;
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
      const ops = Number(stats.ops);
      let statsPctVsAvg: number | null = null;
      let statsRatio: number | null = null;
      if (Number.isFinite(ops) && ops > 0 && statsAvg.ops > 0) {
        statsPctVsAvg = (ops / statsAvg.ops - 1) * 100;
        statsRatio = ops / statsAvg.ops; // 1.0 = team avg
      }

      // ---- Total Score (out of 100) ----
      // The same number the grading cards already produce — universal score
      // blended from grades + imported stats, plus pitcher premiums (including
      // the small scarcity bump for left-handed pitchers). This
      // is the headline "eval number" for roster decisions, judged RELATIVE
      // to the team's own average below (a 54 means something different on a
      // team averaging 70 than one averaging 55).
      const latestRoundForPlayer = [...myEvals]
        .reverse()
        .find((ev: EvalRound) => ev.grades?.[player.id]);
      const savedGrades = latestRoundForPlayer?.grades?.[player.id] || {};
      const totalScore = Math.min(
        100,
        calculateTotalScore(
          asGradeMap({ ...DEFAULT_GRADES, ...savedGrades }),
          player.stats,
        ) + pitcherPremium(savedGrades, player, teamAge),
      );
      // Hidden decision standing: left-handed pitcher scarcity matters for the
      // coach's roster advisory, but it is intentionally not shown in the
      // score badge so handedness cannot be reverse-engineered as extra points.
      const decisionScore = Math.min(
        100,
        totalScore + leftHandedPitcherRosterPremium(player),
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

      let bucket: DecisionBucket = "watch"; // proposal — Strong Fit earned, watch tempered below
      const rationale: string[] = [];

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
              `Stats ${Math.round((1 - (statsRatio as number)) * 100)}% below team OPS avg`,
            );
          }
          rationale.push(
            `Playing up at age ${baseballAge} — better matched to a younger division`,
          );
        }
      }

      // 2) Strong Fit — earn it with positive signal across the board.
      if (bucket !== "younger") {
        const noNegatives =
          !evalBelowBar &&
          !statsBelowBar &&
          evalTrend !== "declining" &&
          // With machine/coach-pitch batting stats available, do not call a
          // below-team bat a Strong Fit solely because subjective evals are
          // good. They can still be a Fit, but Strong is for clear standouts.
          (statsRatio == null || statsRatio >= 1.0);
        const positiveSignal =
          stronglyImproving || (statsRatio != null && statsRatio >= 1.0);
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
              `Stats +${Math.round(((statsRatio as number) - 1) * 100)}% vs team OPS avg`,
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
              `Stats ${Math.round((1 - (statsRatio as number)) * 100)}% below team OPS avg`,
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
        decisionScore,
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
    const compositeOf = (d: DecisionRow): number | null =>
      d.latestEvalAvg == null && d.statsRatio == null
        ? null
        : d.decisionScore / 100;
    const withComp = decisionRows.map((d: DecisionRow) => ({
      d,
      c: compositeOf(d),
    }));
    const scored = withComp
      .map((x) => x.c)
      .filter((c): c is number => c != null);
    const mean = scored.length
      ? scored.reduce((a, b) => a + b, 0) / scored.length
      : 0;
    const sd = scored.length
      ? Math.sqrt(
          scored.reduce((a, b) => a + (b - mean) ** 2, 0) / scored.length,
        )
      : 0;
    const belowLine = mean - sd;
    const visibleScores = decisionRows
      .filter((d) => d.latestEvalAvg != null || d.statsRatio != null)
      .map((d) => d.totalScore);
    const teamAvgScore = visibleScores.length
      ? Math.round(
          visibleScores.reduce((a, b) => a + b, 0) / visibleScores.length,
        )
      : Math.round(mean * 100);
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
            (x.d.scoreVsTeam ?? 0) > 0 ? "+" : ""
          }${x.d.scoreVsTeam}) — more than a standard deviation back`,
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
  }, [
    players,
    evaluationEvents,
    user,
    teamAge,
    currentSeason,
    team?.pitchingFormat,
    team?.teamAge,
  ]);

  if (!decisions || decisions.length === 0) return null;

  const byBucket = {
    strong: decisions.filter((d) => d.bucket === "strong"),
    fit: decisions.filter((d) => d.bucket === "fit"),
    watch: decisions.filter((d) => d.bucket === "watch"),
    younger: decisions.filter((d) => d.bucket === "younger"),
  };

  // Best-standing first for the healthy groups (Strong Fit / Fit); weakest
  // first for the groups that need a decision (Cut Candidates / Cut-Drop).
  byBucket.strong.sort((a, b) => (b.perfScore ?? 0) - (a.perfScore ?? 0));
  byBucket.fit.sort((a, b) => (b.perfScore ?? 0) - (a.perfScore ?? 0));
  byBucket.watch.sort((a, b) => (a.perfScore ?? 0) - (b.perfScore ?? 0));
  byBucket.younger.sort((a, b) => (a.perfScore ?? 0) - (b.perfScore ?? 0));

  const renderCard = (d: DecisionRow) => (
    <button
      key={d.player.id}
      type="button"
      onClick={() => setEvalTrendPlayerId(d.player.id)}
      className="w-full text-left border-b border-line px-1 py-2.5 hover:bg-surface transition-colors"
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
    <div className="border-t border-line pt-6">
      <div className="pb-5 border-b border-line">
        <div className="flex items-center gap-4">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Users className="w-6 h-6" style={{ color: primaryColor }} />
          </div>
          <div>
            <h2 className="t-h2">Roster Decisions</h2>
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

      <div className="py-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Strong Fit — earned positive signal across eval + stats */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-win mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-win" />
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
            <span className="w-2 h-2 rounded-full bg-warnfg" />
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
            <span className="w-2 h-2 rounded-full bg-loss" />
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

      <div className="pb-4 text-[10px] text-ink-3 italic font-medium">
        Tap any card to see that player&apos;s full evaluation trend.
      </div>
    </div>
  );
});

/* ============================================================================
   SECTION 13b · EvaluationTab
============================================================================ */
// ---------- Insights helpers ----------

// Average a player's universal coach grades for round-over-round flags.
