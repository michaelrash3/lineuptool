import React, { memo, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam, useUI } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { headEvalRounds } from "../../utils/helpers";
import { formatRoundName, type EvalRound } from "../../utils/evalScoring";

// /evaluation/rounds — every saved round with Select (jump to review/edit)
// and a two-tap-armed delete. Converted from the "Manage Rounds" A11yDialog
// per the app-wide modals→pages rule. Head-only: rounds here are the head's
// own saves.
export const EvalRoundsPage = memo(() => {
  const navigate = useNavigate();
  const { team, user, deleteEvaluation, currentRole } = useTeam();
  const { selectedRoundId, setSelectedRoundId } = useUI();
  const back = useBackOrFallback("/evaluation");
  // Per-row armed-state id for the two-tap delete confirm.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const myRounds = useMemo(
    () =>
      headEvalRounds((team.evaluationEvents || []) as EvalRound[], user?.uid),
    [team.evaluationEvents, user?.uid],
  );

  if (currentRole === "assistant") {
    return <Navigate to="/evaluation" replace />;
  }

  return (
    <PageShell eyebrow="Evaluation" title="Your Saved Rounds" onBack={back}>
      <p className="text-[12px] text-ink-3 font-medium -mt-3 mb-4">
        Select a round to review or edit, or delete one saved by mistake.
      </p>
      <div className="cc-card p-4 sm:p-5">
        {myRounds.length === 0 ? (
          <div className="text-sm font-bold text-ink-3 italic text-center py-8">
            No saved rounds yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {myRounds.map((r: EvalRound) => {
              const armed = pendingDeleteId === r.id;
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
                        setPendingDeleteId(null);
                        navigate("/evaluation");
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
                        setPendingDeleteId(null);
                        // Deleting the round being edited: the workspace
                        // re-derives its selection (latest round) on return.
                        if (r.id === selectedRoundId) setSelectedRoundId(null);
                      } else {
                        setPendingDeleteId(r.id);
                      }
                    }}
                    onBlur={() => {
                      if (armed) setPendingDeleteId(null);
                    }}
                    className={`shrink-0 flex items-center gap-1 rounded-md transition-colors ${
                      armed
                        ? "px-2 py-1 bg-loss-bg text-loss ring-2 ring-[var(--loss)]"
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
    </PageShell>
  );
});
