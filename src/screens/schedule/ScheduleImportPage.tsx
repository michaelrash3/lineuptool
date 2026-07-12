import React, { memo } from "react";
import { Link, Navigate } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";

// /schedule/import — the schedule-import chooser, converted from the old
// ScheduleTab modal. Two ways in: the GameChanger feed sync (its own page)
// or a one-shot CSV upload handled right here.
export const ScheduleImportPage = memo(() => {
  const { currentRole, uploadScheduleCsv } = useTeam();
  const back = useBackOrFallback("/schedule");

  // Import is a head-coach action, same gate as the button that links here.
  if (currentRole === "assistant") return <Navigate to="/schedule" replace />;

  return (
    <PageShell eyebrow="Schedule" title="Import Schedule" onBack={back}>
      <div className="space-y-3">
        <Link
          to="/schedule/import/gamechanger"
          className="w-full flex items-center gap-3 p-4 text-left rounded-xl border border-line-strong bg-surface hover:bg-surface-2 transition-colors"
        >
          <Icons.Calendar className="w-5 h-5 text-team-primary shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-black uppercase tracking-wider text-ink">
              From GameChanger
            </span>
            <span className="block text-xs text-ink-3 mt-0.5">
              Sync games from your team's GameChanger schedule link.
            </span>
          </span>
        </Link>
        <label
          htmlFor="schedule-import-csv"
          className="w-full flex items-center gap-3 p-4 text-left rounded-xl border border-line-strong bg-surface hover:bg-surface-2 transition-colors cursor-pointer"
        >
          <Icons.Upload className="w-5 h-5 text-team-primary shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-black uppercase tracking-wider text-ink">
              Upload CSV
            </span>
            <span className="block text-xs text-ink-3 mt-0.5">
              Schedule CSV (date, opponent, location).
            </span>
          </span>
          <input
            id="schedule-import-csv"
            type="file"
            className="sr-only"
            accept=".csv,text/csv,application/csv,application/vnd.ms-excel,text/plain"
            onChange={(e) => {
              uploadScheduleCsv(e);
              back();
            }}
          />
        </label>
      </div>
    </PageShell>
  );
});
