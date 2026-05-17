import React, { memo } from "react";
import { EVAL_SCALE_LABELS, EVAL_SCALE_DEFAULT } from "../constants/ui";

const DEFAULT_GRADE = EVAL_SCALE_DEFAULT;
// 11 standard positions surfaced as a chip row per player so a coach can
// flag any spots they think this kid should play. Stored on the eval
// round as `grades[playerId].suggestedPositions`. Used by both the
// assistant and head-coach grading flows so the shape stays identical.
export const EVAL_SUGGESTED_POSITIONS = [
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

// The 1–5 chip row reused everywhere a coach picks a grade.
export const GradeChipRow = memo(({ value, onChange, ariaLabel }) => (
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

// Per-player card used in the assistant eval tab + head EvaluationTab grid.
// All write callbacks are optional; when omitted the card renders read-only
// (used for showing past assistant submissions to the head coach).
export const EvalGradeCard = memo(
  ({
    player,
    grades,
    activeCategories,
    onGradeChange,
    onPositionToggle,
    onNotesChange,
    readOnly = false,
    rightSlot = null,
    // Defense-size-aware position list. Defaults to the legacy 11-position
    // superset for back-compat; callers that know team.defenseSize should
    // pass `getActivePositionList(team.defenseSize)` from lineupEngine.
    positions = EVAL_SUGGESTED_POSITIONS,
  }) => {
    const playerGrades = grades || {};
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-100">
          <div className="min-w-0">
            <div className="text-sm font-black uppercase tracking-tight text-slate-900 truncate">
              {player.name}
            </div>
            {player.number != null && player.number !== "" && (
              <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                #{player.number}
              </div>
            )}
          </div>
          {rightSlot}
        </div>
        <div className="px-4 py-3 space-y-3">
          {activeCategories.map((cat) => {
            const value = playerGrades[cat.id] ?? DEFAULT_GRADE;
            return (
              <div key={cat.id}>
                <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                  {cat.label}
                </div>
                {readOnly ? (
                  <div className="text-xl font-black tabular-nums text-slate-900">
                    {value}
                    <span className="text-[10px] text-slate-400 font-bold ml-1">
                      / 5
                    </span>
                  </div>
                ) : (
                  <GradeChipRow
                    value={value}
                    onChange={(v) => onGradeChange?.(player.id, cat.id, v)}
                    ariaLabel={`${player.name} ${cat.label}`}
                  />
                )}
              </div>
            );
          })}
          <div>
            <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Suggested Positions
            </div>
            <div className="flex flex-wrap gap-1.5">
              {positions.map((pos) => {
                const active = (
                  playerGrades.suggestedPositions || []
                ).includes(pos);
                return (
                  <button
                    key={pos}
                    type="button"
                    disabled={readOnly}
                    onClick={() => onPositionToggle?.(player.id, pos)}
                    className="px-2 py-1 text-[11px] font-black rounded-md border transition-all disabled:opacity-90 disabled:cursor-default"
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
            <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Notes
            </div>
            {readOnly ? (
              <p className="text-xs text-slate-700 italic leading-snug min-h-[1.25rem]">
                {playerGrades.notes || (
                  <span className="text-slate-400 not-italic">—</span>
                )}
              </p>
            ) : (
              <textarea
                value={playerGrades.notes || ""}
                onChange={(e) => onNotesChange?.(player.id, e.target.value)}
                rows={2}
                placeholder="Anything worth flagging?"
                className="w-full p-2.5 text-xs border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            )}
          </div>
        </div>
      </div>
    );
  }
);
