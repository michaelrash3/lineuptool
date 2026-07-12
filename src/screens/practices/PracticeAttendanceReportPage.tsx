import React, { memo, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam, useToast } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { dateToIsoLocal, isDepartedPlayer } from "../../utils/helpers";
import { statusOf } from "../PracticesTab";

// /practices/attendance-report — season attendance across COMPLETED
// practices where attendance was actually taken: how many each player has
// missed. Converted from the Attendance Report modal per the app-wide
// modals→pages rule. A practice that hasn't happened yet never counts, even
// if attendance was pre-marked; only explicit "out" marks are misses —
// present (the default) and excused absences are not.
export const PracticeAttendanceReportPage = memo(() => {
  const { team, currentRole } = useTeam();
  const toast = useToast();
  const back = useBackOrFallback("/practices");

  const players = useMemo(
    () =>
      (team.players || []).filter(
        (p: any) => p && p.inactive !== true && !isDepartedPlayer(p),
      ),
    [team.players],
  );

  const attendanceReport = useMemo(() => {
    const today = dateToIsoLocal(new Date());
    const counted = (team.practices || []).filter(
      (p: any) =>
        p.status !== "cancelled" &&
        p.attendance &&
        Object.keys(p.attendance).length > 0 &&
        !(p.date && String(p.date) > today),
    );
    const rows = players
      .map((p: any) => {
        const missed = counted.filter(
          (pr: any) => statusOf(pr.attendance[p.id]) === "absent",
        ).length;
        return { player: p, missed, attended: counted.length - missed };
      })
      .sort(
        (a: any, b: any) =>
          b.missed - a.missed ||
          String(a.player.name || "").localeCompare(
            String(b.player.name || ""),
          ),
      );
    return { total: counted.length, rows };
  }, [team.practices, players]);

  if (currentRole === "assistant") {
    return <Navigate to="/practices" replace />;
  }

  // Plain-text CSV export so the coach can "pull" the attendance report.
  const downloadAttendanceCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Player", "Practices Missed", "Attended", "Total Counted"].join(","),
    ];
    attendanceReport.rows.forEach((r: any) => {
      lines.push(
        [
          esc(r.player.name || "Unnamed Player"),
          r.missed,
          r.attended,
          attendanceReport.total,
        ].join(","),
      );
    });
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${team?.name || "team"}-practice-attendance.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.push({ kind: "success", title: "Attendance report downloaded" });
  };

  return (
    <PageShell eyebrow="Practices" title="Attendance Report" onBack={back}>
      <div className="cc-card p-5">
        <p className="t-meta text-ink-3 mb-4">
          {attendanceReport.total === 0
            ? "No completed practices with attendance taken yet. Take attendance on a past practice and misses show up here."
            : `Across ${attendanceReport.total} completed ${
                attendanceReport.total === 1 ? "practice" : "practices"
              } with attendance taken. Upcoming practices are not counted.`}
        </p>
        {attendanceReport.total > 0 && (
          <>
            <div className="border border-line">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 border-b border-line bg-surface-2 t-eyebrow text-ink-3">
                <span>Player</span>
                <span className="text-right tabular-nums">Missed</span>
                <span className="text-right tabular-nums">Attended</span>
              </div>
              <div className="divide-y divide-line">
                {attendanceReport.rows.map((r: any) => (
                  <div
                    key={r.player.id}
                    className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 items-center text-sm"
                  >
                    <span className="font-bold text-ink truncate">
                      {r.player.name || "Unnamed Player"}
                    </span>
                    <span
                      className={`text-right tabular-nums font-black ${
                        r.missed > 0 ? "text-loss" : "text-ink-3"
                      }`}
                    >
                      {r.missed}
                    </span>
                    <span className="text-right tabular-nums text-ink-2">
                      {r.attended}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={downloadAttendanceCsv}
                className="px-4 py-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-ink bg-surface border border-line-strong rounded-xl hover:bg-surface-2 transition-colors"
              >
                <Icons.Download className="w-4 h-4" /> Download CSV
              </button>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
});
