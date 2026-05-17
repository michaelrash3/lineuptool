import React, { memo, useState, useEffect, useMemo, useCallback } from "react";
import { Icons } from "../icons";
import { useTeam, useToast } from "../contexts.js";
import {
  EVAL_GROUPS_UNIVERSAL,
  EVAL_GROUPS_KID_PITCH_ADDONS,
  getEvalCategoriesForTeam,
  isKidPitchFormat,
  getLocalDateString,
  EVAL_SCALE_DEFAULT,
} from "../constants/ui";
import { EvalGradeCard } from "../components/EvalGradeCard.jsx";
import { getActivePositionList } from "../lineupEngine";

const DEFAULT_GRADE = EVAL_SCALE_DEFAULT;

const buildEmptyGrades = (players, categories) => {
  const out = {};
  for (const p of players || []) {
    out[p.id] = {};
    for (const c of categories) out[p.id][c.id] = DEFAULT_GRADE;
  }
  return out;
};

// Full-tab assistant evaluation surface. Replaces the prior modal at
// `src/components/AssistantEvalModal.jsx`. Visibility is preserved —
// assistants only ever see their own rounds in the "Your Past Rounds"
// list; head + other assistants' rounds remain hidden.
export const AssistantEvalTab = memo(() => {
  const { team, user, saveAssistantEvaluation } = useTeam();
  const toast = useToast();
  const { players, pitchingFormat, evaluationEvents, defenseSize } = team;
  const activePositions = useMemo(
    () => getActivePositionList(defenseSize),
    [defenseSize]
  );

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
  const [grades, setGrades] = useState({});
  const [activeGroup, setActiveGroup] = useState("Hitting");
  // Inline read-only view of a past round. Null = grading form is active.
  const [viewingPastRoundId, setViewingPastRoundId] = useState(null);

  // Seed grades from this assistant's most recent round on mount + when the
  // user changes. Today's round wins over any older draft so a reopen
  // continues editing rather than wiping prior input.
  useEffect(() => {
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
      const next = {};
      for (const p of players || []) {
        next[p.id] = { ...(seed[p.id] || {}) };
        for (const c of activeCategories) {
          if (next[p.id][c.id] == null) next[p.id][c.id] = DEFAULT_GRADE;
        }
        if (seed[p.id]?.notes) next[p.id].notes = seed[p.id].notes;
        if (Array.isArray(seed[p.id]?.suggestedPositions)) {
          next[p.id].suggestedPositions = [...seed[p.id].suggestedPositions];
        }
      }
      setGrades(next);
    } else {
      setGrades(buildEmptyGrades(players, activeCategories));
    }
  }, [user, players, activeCategories, evaluationEvents]);

  const myRounds = useMemo(() => {
    if (!user) return [];
    return (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Assistant" && e.evaluatorId === user.uid
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [user, evaluationEvents]);

  const viewingPastRound = useMemo(() => {
    if (!viewingPastRoundId) return null;
    return myRounds.find((r) => r.id === viewingPastRoundId) || null;
  }, [viewingPastRoundId, myRounds]);

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

  const togglePlayerPosition = useCallback((playerId, pos) => {
    setGrades((prev) => {
      const cur = prev[playerId] || {};
      const list = Array.isArray(cur.suggestedPositions)
        ? cur.suggestedPositions
        : [];
      const next = list.includes(pos)
        ? list.filter((p) => p !== pos)
        : [...list, pos];
      return {
        ...prev,
        [playerId]: { ...cur, suggestedPositions: next },
      };
    });
  }, []);

  const handleSave = useCallback(() => {
    saveAssistantEvaluation?.(grades);
    toast.push({
      kind: "success",
      title: "Evaluation saved",
      message: "Your grades are with the head coach.",
    });
  }, [saveAssistantEvaluation, grades, toast]);

  const orderedPlayers = (players || [])
    .filter((p) => p.present !== false)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // Filter categories to only the active group when rendering. Cards
  // render every category by default — we slice the list per group tab
  // so the same shared component works for both flows.
  const groupCats = useMemo(
    () => activeCategories.filter((c) => c.group === activeGroup),
    [activeCategories, activeGroup]
  );

  if (viewingPastRound) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="glass-card p-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="t-h2">Past Round</h2>
            <p className="t-eyebrow text-slate-500 mt-1">
              {viewingPastRound.date} · read-only view of your submission
            </p>
          </div>
          <button
            type="button"
            onClick={() => setViewingPastRoundId(null)}
            className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Back to Form
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {orderedPlayers.map((p) => (
            <EvalGradeCard
              key={`past-${p.id}`}
              player={p}
              grades={viewingPastRound.grades?.[p.id]}
              activeCategories={activeCategories}
              positions={activePositions}
              readOnly
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="glass-card">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 border-b border-white/40 bg-white/20">
          <h2 className="t-h2 flex items-center gap-3">
            <Icons.Clipboard className="w-6 h-6" /> Evaluation
          </h2>
          <p className="text-xs text-slate-600 font-medium mt-1.5">
            Your grades go to the head coach for review. You won&apos;t see
            other coaches&apos; grades.
          </p>
        </div>
      </div>

      {myRounds.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="t-h3">Your Past Rounds</h3>
            <span className="t-eyebrow text-slate-500">
              {myRounds.length} round{myRounds.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-1.5">
            {myRounds.slice(0, 5).map((r) => {
              const playerCount = Object.keys(r.grades || {}).length;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setViewingPastRoundId(r.id)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-left"
                >
                  <span className="text-sm font-extrabold text-slate-800 tabular-nums">
                    {r.date}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500">
                    {playerCount} player{playerCount === 1 ? "" : "s"} graded
                  </span>
                  <Icons.ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="glass-card overflow-hidden">
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

        <div className="px-3 sm:px-5 py-4 space-y-3">
          {orderedPlayers.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm font-medium">
              No active players to evaluate.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {orderedPlayers.map((p) => (
                <EvalGradeCard
                  key={p.id}
                  player={p}
                  grades={grades[p.id]}
                  activeCategories={groupCats}
                  positions={activePositions}
                  onGradeChange={setPlayerGrade}
                  onPositionToggle={togglePlayerPosition}
                  onNotesChange={setPlayerNotes}
                />
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-end gap-3 sticky bottom-0">
          <button
            type="button"
            onClick={handleSave}
            disabled={orderedPlayers.length === 0}
            className="px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--team-primary)" }}
          >
            Save Evaluation
          </button>
        </div>
      </div>
    </div>
  );
});

