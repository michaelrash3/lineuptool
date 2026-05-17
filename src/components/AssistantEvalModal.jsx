import React, { memo, useState, useEffect, useMemo, useCallback } from "react";
import { Icons } from "../icons";
import { useTeam, useUI, useToast } from "../contexts.js";
import {
  EVAL_GROUPS_UNIVERSAL,
  EVAL_GROUPS_KID_PITCH_ADDONS,
  getEvalCategoriesForTeam,
  isKidPitchFormat,
  getLocalDateString,
  EVAL_SCALE_LABELS,
  EVAL_SCALE_DEFAULT,
} from "../constants/ui";
import { evalPromptStatus } from "../utils/helpers";

const DEFAULT_GRADE = EVAL_SCALE_DEFAULT;

const buildEmptyGrades = (players, categories) => {
  const out = {};
  for (const p of players || []) {
    out[p.id] = {};
    for (const c of categories) out[p.id][c.id] = DEFAULT_GRADE;
  }
  return out;
};

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

export const AssistantEvalModal = memo(() => {
  const { team, user, saveAssistantEvaluation, currentRole } = useTeam();
  const { assistantEvalOpen, setAssistantEvalOpen } = useUI();
  const toast = useToast();
  const { players, pitchingFormat, evaluationEvents } = team;

  // Gate: outside an active prompt window the assistant can't submit. Close
  // back out with a toast if something opens us when no prompt is active.
  const promptStatus = useMemo(
    () => evalPromptStatus(team, user?.uid, "Assistant"),
    [team, user]
  );
  useEffect(() => {
    if (!assistantEvalOpen) return;
    if (currentRole !== "assistant") return;
    if (promptStatus.active) return;
    setAssistantEvalOpen(false);
    toast.push({
      kind: "info",
      title: "No evaluation due right now",
      message: promptStatus.daysUntilDue
        ? `Next eval due in ${promptStatus.daysUntilDue} day${promptStatus.daysUntilDue === 1 ? "" : "s"}.`
        : "We'll prompt you when the next window opens.",
    });
  }, [
    assistantEvalOpen,
    currentRole,
    promptStatus,
    setAssistantEvalOpen,
    toast,
  ]);

  const activeCategories = useMemo(
    () => getEvalCategoriesForTeam(pitchingFormat),
    [pitchingFormat]
  );
  const includeKidPitchAddons = useMemo(
    () => isKidPitchFormat(pitchingFormat),
    [pitchingFormat]
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

  const [grades, setGrades] = useState({});
  const [activeGroup, setActiveGroup] = useState("Hitting");
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);

  // When opening, seed from this assistant's most recent round (or defaults).
  useEffect(() => {
    if (!assistantEvalOpen) return;
    if (!user) return;
    const today = getLocalDateString();
    const mine = (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Assistant" && e.evaluatorId === user.uid
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const todayRound = mine.find((e) => e.date === today);
    const seed = todayRound?.grades || mine[0]?.grades || null;
    if (seed) {
      // Make sure every player has every category seeded.
      const next = {};
      for (const p of players || []) {
        next[p.id] = { ...(seed[p.id] || {}) };
        for (const c of activeCategories) {
          if (next[p.id][c.id] == null) next[p.id][c.id] = DEFAULT_GRADE;
        }
        if (seed[p.id]?.notes) next[p.id].notes = seed[p.id].notes;
      }
      setGrades(next);
    } else {
      setGrades(buildEmptyGrades(players, activeCategories));
    }
  }, [assistantEvalOpen, user, players, activeCategories, evaluationEvents]);

  const setPlayerGrade = useCallback((playerId, categoryId, value) => {
    setGrades((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), [categoryId]: value },
    }));
  }, []);

  const setPlayerNotes = useCallback((playerId, notes) => {
    setGrades((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), notes },
    }));
  }, []);

  const handleSave = useCallback(() => {
    saveAssistantEvaluation?.(grades);
    setAssistantEvalOpen(false);
  }, [saveAssistantEvaluation, grades, setAssistantEvalOpen]);

  // The head coach shouldn't see this modal even if something opens it by
  // mistake — render nothing.
  if (currentRole !== "assistant") return null;
  if (!assistantEvalOpen) return null;

  const activeCats = groupCategories[activeGroup] || [];
  const orderedPlayers = (players || [])
    .filter((p) => p.present !== false)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Submit your evaluation"
    >
      <div className="bg-slate-50 w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">
              Submit Your Evaluation
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Your grades go to the head coach for review. You won&apos;t see
              other coaches&apos; grades.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAssistantEvalOpen(false)}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
            aria-label="Close"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </header>

        <div className="px-5 py-3 bg-white border-b border-slate-200 flex gap-2 overflow-x-auto scrollbar-hide">
          {visibleGroups.map((g) => {
            const isActive = activeGroup === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setActiveGroup(g)}
                className={`py-1.5 px-3.5 text-[11px] font-black uppercase tracking-wider rounded-full transition-all whitespace-nowrap ${
                  isActive
                    ? "shadow-sm border"
                    : "text-slate-500 hover:bg-slate-100 border border-transparent"
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: "var(--team-secondary)",
                        color: "var(--team-primary)",
                        borderColor: "var(--team-primary)",
                      }
                    : {}
                }
              >
                {g}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
          {orderedPlayers.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm font-medium">
              No active players to evaluate.
            </div>
          ) : (
            orderedPlayers.map((p) => {
              const playerGrades = grades[p.id] || {};
              const expanded = expandedPlayerId === p.id;
              return (
                <div
                  key={p.id}
                  className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
                >
                  <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-100">
                    <div className="min-w-0">
                      <div className="text-sm font-black uppercase tracking-tight text-slate-900 truncate">
                        {p.name}
                      </div>
                      {p.number != null && p.number !== "" && (
                        <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                          #{p.number}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedPlayerId(expanded ? null : p.id)
                      }
                      className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 px-2 py-1 rounded"
                    >
                      {expanded ? "Hide Notes" : "Notes"}
                    </button>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    {activeCats.map((cat) => (
                      <div key={cat.id}>
                        <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                          {cat.label}
                        </div>
                        <GradeChipRow
                          value={playerGrades[cat.id] ?? DEFAULT_GRADE}
                          onChange={(v) => setPlayerGrade(p.id, cat.id, v)}
                          ariaLabel={`${p.name} ${cat.label}`}
                        />
                      </div>
                    ))}
                    {expanded && (
                      <div>
                        <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                          Notes
                        </div>
                        <textarea
                          value={playerGrades.notes || ""}
                          onChange={(e) => setPlayerNotes(p.id, e.target.value)}
                          rows={3}
                          placeholder="What stood out this round?"
                          className="w-full p-2.5 text-xs border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setAssistantEvalOpen(false)}
            className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={orderedPlayers.length === 0}
            className="px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--team-primary)" }}
          >
            Save Evaluation
          </button>
        </footer>
      </div>
    </div>
  );
});
