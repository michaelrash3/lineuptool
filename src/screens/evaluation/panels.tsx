// The head-coach eval sub-panels extracted from EvaluationTab
// (docs/EVALUATIONS-AUDIT.md finding 3.4): the round insights strip, the
// two-round comparison view, and the assistant-submission displays. Each is
// a leaf component used only from EvaluationTab; grouped here to share one
// import set.
import { memo, useMemo, useState } from "react";

import { Icons } from "../../icons";
import { evalRoundRecency } from "../../utils/helpers";
import { EVAL_SCALE_LABELS, type EvalCategory } from "../../constants/ui";
import { A11yDialog } from "../../components/shared";
import {
  avgUniversal,
  computeFlags,
  fmtDelta,
  type EvalGradeRecord,
  type EvalRound,
} from "../../utils/evalScoring";
import type { Player } from "../../types";

interface InsightsPanelProps {
  rounds: EvalRound[];
  players: Player[];
  activeCategories: EvalCategory[];
  onPlayerClick: (playerId: string) => void;
}

export const InsightsPanel = memo(
  ({
    rounds,
    players,
    activeCategories,
    onPlayerClick,
  }: InsightsPanelProps) => {
    const flags = useMemo(
      () => computeFlags(rounds, players, activeCategories),
      [rounds, players, activeCategories],
    );
    if (rounds.length < 2) return null;
    const hasAny =
      flags.standouts.length ||
      flags.regressions.length ||
      flags.categoryDrops.length;
    if (!hasAny) return null;
    return (
      <div className="px-1 py-4 border-b border-line flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="t-eyebrow">Round-Over-Round Insights</span>
          <span className="text-[10px] font-bold text-ink-3">
            {rounds[0].label || rounds[0].date} vs{" "}
            {rounds[1].label || rounds[1].date}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {flags.standouts.length > 0 && (
            <div className="border-l-2 border-win pl-3 py-0.5">
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
            <div className="border-l-2 border-loss pl-3 py-0.5">
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
          <div className="border-l-2 border-warnfg pl-3 py-0.5">
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
  },
);

// Side-by-side round comparison view. Lists every player with the per-category
// delta between two saved rounds (left = older, right = newer).
interface RoundComparisonViewProps {
  rounds: EvalRound[];
  players: Player[];
  activeCategories: EvalCategory[];
  onPlayerClick: (playerId: string) => void;
  onClose: () => void;
  primaryColor?: string;
}

export const RoundComparisonView = memo(
  ({
    rounds,
    players,
    activeCategories,
    onPlayerClick,
    onClose,
  }: RoundComparisonViewProps) => {
    const [leftId, setLeftId] = useState(rounds[1]?.id || "");
    const [rightId, setRightId] = useState(rounds[0]?.id || "");
    const left = rounds.find((r: EvalRound) => r.id === leftId);
    const right = rounds.find((r: EvalRound) => r.id === rightId);
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
                {rounds.map((r: EvalRound) => (
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
                {rounds.map((r: EvalRound) => (
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
                  {activeCategories.map((cat: EvalCategory) => (
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
                {players.map((p: Player) => {
                  const lg = left?.grades?.[p.id];
                  const rg = right?.grades?.[p.id];
                  const la = avgUniversal(lg);
                  const ra = avgUniversal(rg);
                  const avgDelta = la != null && ra != null ? ra - la : null;
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
                      {activeCategories.map((cat: EvalCategory) => {
                        const v1 = Number(lg?.[cat.id]);
                        const v2 = Number(rg?.[cat.id]);
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
                                    delta > 0 ? "text-win" : "text-loss"
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
  },
);

// Head-only read-only view of every assistant's most recent submission.
// Shows each assistant's suggested-positions + notes per player. Skips
// the per-category grade chips here — those already feed into the
// combined grade rendered in the main grading area.
export const AssistantSubmissionsPanel = memo(
  ({
    evaluationEvents,
    players,
    onDelete,
  }: {
    evaluationEvents?: EvalRound[];
    players?: Player[];
    onDelete?: (roundId: string) => void;
  }) => {
    // Two-tap confirm for delete: first tap arms the row, second commits.
    // Replaces a blocking window.confirm — keeps the head coach in flow.
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    // Pick the most recent eval per assistant (by date).
    const latestByAssistant = useMemo(() => {
      const m = new Map<string, EvalRound>();
      for (const e of evaluationEvents || []) {
        if (
          e.tryoutSignupId ||
          e.tryoutSessionId ||
          e.coachRole !== "Assistant" ||
          !e.evaluatorId
        )
          continue;
        const cur = m.get(e.evaluatorId);
        if (!cur || evalRoundRecency(e, cur) < 0) {
          m.set(e.evaluatorId, e);
        }
      }
      return [...m.values()].sort(evalRoundRecency);
    }, [evaluationEvents]);

    if (latestByAssistant.length === 0) return null;

    return (
      <div className="px-1 py-4 border-b border-line">
        <div className="flex items-center justify-between mb-3">
          <h3 className="t-h3">Assistant Submissions</h3>
          <span className="t-eyebrow text-ink-3">
            {latestByAssistant.length} assistant
            {latestByAssistant.length === 1 ? "" : "s"} · {Math.round(50)}%
            weight (split equally with your eval)
          </span>
        </div>
        <div className="space-y-3">
          {latestByAssistant.map((ev) => {
            const playersWithSignal = (players || []).filter((p: Player) => {
              const g: EvalGradeRecord = ev.grades?.[p.id] || {};
              const hasPositions =
                Array.isArray(g.suggestedPositions) &&
                g.suggestedPositions.length > 0;
              const hasNotes = !!(g.notes && g.notes.trim());
              return hasPositions || hasNotes;
            });
            return (
              <div
                key={ev.id}
                className="border-b border-line pb-3 last:border-b-0 last:pb-0"
              >
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="text-[11px] font-extrabold uppercase tracking-widest text-ink-2 truncate">
                    Assistant ·{" "}
                    {ev.evaluatorName || ev.evaluatorId?.slice(0, 8) || "—"}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-[10px] font-bold text-ink-3">
                      {ev.date}
                    </div>
                    {onDelete &&
                      (() => {
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
                                ? "px-2 py-1 bg-loss-bg text-loss ring-2 ring-[var(--loss)]"
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
                    {playersWithSignal.map((p: Player) => {
                      const g: EvalGradeRecord = ev.grades?.[p.id] || {};
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
                                {g.suggestedPositions.map((pos: string) => (
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
  },
);

// Read-only inline readout of every assistant's most-recent grades + notes for
// ONE player, rendered right inside that player's head-coach grading card. This
// is the "see it all together" view — the head reads their own (editable) grades
// and each assistant's submission side by side without thumbing through a
// separate screen. Only assistants who actually graded this player appear.
export const PlayerAssistantEvals = memo(
  ({
    player,
    playerCats,
    assistantRounds,
  }: {
    player: Player;
    playerCats: EvalCategory[];
    assistantRounds?: EvalRound[];
  }) => {
    const relevant = (assistantRounds || []).filter(
      (ev: EvalRound) => ev.grades?.[player.id],
    );
    if (relevant.length === 0) return null;
    return (
      <div className="pt-2 border-t border-line">
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1.5">
          Assistant Evaluations ({relevant.length})
        </div>
        <div className="space-y-2">
          {relevant.map((ev: EvalRound) => {
            const g: EvalGradeRecord = ev.grades?.[player.id] || {};
            const positions: string[] = Array.isArray(g.suggestedPositions)
              ? g.suggestedPositions
              : [];
            return (
              <div
                key={ev.id}
                className="border-b border-line pb-2.5 last:border-b-0 last:pb-0"
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
                  {playerCats.map((cat: EvalCategory) => {
                    const v = Number(g[cat.id]);
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
                    {positions.map((pos: string) => (
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
  },
);

export const GradeChipRow = memo(
  ({
    value,
    onChange,
    ariaLabel,
  }: {
    value?: number;
    onChange: (n: number) => void;
    ariaLabel: string;
  }) => (
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
                    color: "var(--team-on-primary)",
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
  ),
);
