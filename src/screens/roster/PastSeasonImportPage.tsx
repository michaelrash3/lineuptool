import React, { memo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTeam, useToast } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { AGE_TIERS } from "../../constants/ui";
import type { CsvImportRow } from "../../types";

// The parsed-CSV payload SettingsTab hands over via navigation state. Rows
// never ride the URL (they're a file's worth of data), so a refresh or cold
// deep link has no payload — the page bounces back to Settings, where the
// file input lives.
interface ImportPayload {
  rows: CsvImportRow[];
  season: string;
  ageGroup: string;
  pitchingFormat: string;
  assignments: Record<string, string>;
}

// /settings/import/past-season — review a parsed GameChanger season CSV and
// assign each row to a roster player before committing. Converted from
// PastSeasonImportModal per the app-wide modals→pages rule; the CSV is
// parsed in Settings, which navigates here with the rows as state.
export const PastSeasonImportPage = memo(() => {
  const { team, bulkAddPastSeasons, currentRole } = useTeam();
  const toast = useToast();
  const location = useLocation();
  const back = useBackOrFallback("/settings");
  const payload = (location.state || null) as ImportPayload | null;

  const [season, setSeason] = useState(payload?.season || "");
  const [ageGroup, setAgeGroup] = useState(payload?.ageGroup || "");
  const [pitchingFormat, setPitchingFormat] = useState(
    payload?.pitchingFormat || "Kid Pitch",
  );
  const [assignments, setAssignments] = useState<Record<string, string>>(
    payload?.assignments || {},
  );

  if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0) {
    return <Navigate to="/settings" replace />;
  }
  if (currentRole === "assistant") {
    return <Navigate to="/" replace />;
  }

  const { rows } = payload;
  const { players, primaryColor, tertiaryColor } = team;

  const setAssignment = (csvName: string, value: string) =>
    setAssignments((cur) => ({ ...cur, [csvName]: value }));

  // Players already assigned, so we can de-duplicate dropdowns
  const usedPlayerIds = new Set<string>();
  for (const v of Object.values(assignments)) {
    if (v && v !== "skip" && v !== "new") usedPlayerIds.add(v);
  }

  const assignedCount = Object.values(assignments).filter(
    (v) => v && v !== "skip",
  ).length;
  const skipCount = Object.values(assignments).filter(
    (v) => v === "skip",
  ).length;

  const canCommit =
    season.trim() && ageGroup && pitchingFormat && assignedCount > 0;

  const commit = () => {
    if (!canCommit) return;
    const toAdd = [];
    for (const row of rows) {
      const a = assignments[row.csvName];
      if (!a || a === "skip") continue;
      if (a === "new") {
        toast.push({
          kind: "warn",
          title: `Skipped "${row.csvName}"`,
          message: "Add the player first via the Roster tab, then re-import.",
        });
        continue;
      }
      toAdd.push({
        playerId: a,
        season: season.trim(),
        ageGroup,
        pitchingFormat,
        stats: row.stats,
      });
    }
    if (toAdd.length === 0) {
      toast.push({
        kind: "warn",
        title: "Nothing to import",
        message: "No rows are matched to a player.",
      });
      return;
    }
    bulkAddPastSeasons(toAdd);
    toast.push({
      kind: "success",
      title: `Past season imported`,
      message: `${toAdd.length} player${
        toAdd.length === 1 ? "" : "s"
      } updated for ${season}.`,
    });
    back();
  };

  return (
    <PageShell
      eyebrow="Roster"
      title="Import Past Season Stats"
      onBack={back}
      backLabel="Settings"
    >
      <p className="text-xs text-ink-3 font-medium -mt-3 mb-4">
        Review and confirm which player each row belongs to.
      </p>

      <div className="cc-card p-5 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="past-season-label"
              className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
            >
              Season *
            </label>
            <input
              id="past-season-label"
              type="text"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="e.g., Spring 2025"
              className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner"
            />
          </div>
          <div>
            <label
              htmlFor="past-season-age"
              className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
            >
              Age Group *
            </label>
            <select
              id="past-season-age"
              value={ageGroup}
              onChange={(e) => setAgeGroup(e.target.value)}
              className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
            >
              <option value="">Select…</option>
              {AGE_TIERS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="past-season-format"
              className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
            >
              Pitching Format *
            </label>
            <select
              id="past-season-format"
              value={pitchingFormat}
              onChange={(e) => setPitchingFormat(e.target.value)}
              className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
            >
              <option value="Kid Pitch">Kid Pitch</option>
              <option value="Coach/Machine">Coach / Machine</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 grid grid-cols-12 gap-3 px-3 pb-1">
          <div className="col-span-5">From CSV</div>
          <div className="col-span-7">Assign To</div>
        </div>
        {rows.map((row: any) => {
          const value = assignments[row.csvName] || "skip";
          const isSkip = value === "skip";
          return (
            <div
              key={row.csvName}
              className={`grid grid-cols-12 gap-3 items-center bg-surface border rounded-xl p-3 shadow-sm ${
                isSkip ? "opacity-60" : "border-line"
              }`}
            >
              <div className="col-span-5">
                <div className="text-sm font-black text-ink truncate">
                  {row.csvName}
                </div>
                {row.number && (
                  <div className="text-[10px] font-bold text-ink-3 uppercase tracking-widest">
                    #{row.number}
                  </div>
                )}
              </div>
              <div className="col-span-7">
                <select
                  value={value}
                  onChange={(e) => setAssignment(row.csvName, e.target.value)}
                  aria-label={`Assign ${row.csvName}`}
                  className="w-full p-2 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
                >
                  <option value="skip">Skip this row</option>
                  <optgroup label="Match to existing player">
                    {(players || []).map((p: any) => {
                      // Allow the current selection plus any unassigned player
                      const taken = usedPlayerIds.has(p.id) && p.id !== value;
                      return (
                        <option key={p.id} value={p.id} disabled={taken}>
                          {p.name}
                          {p.number ? ` (#${p.number})` : ""}
                          {taken ? " (already matched)" : ""}
                        </option>
                      );
                    })}
                  </optgroup>
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-widest">
          {assignedCount} matched · {skipCount} skipped
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={back}
            className="text-[11px] font-black uppercase tracking-widest px-5 py-2.5 bg-surface border border-line text-ink rounded-xl hover:bg-surface-2 transition-colors shadow-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCommit}
            onClick={commit}
            className="text-[11px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl shadow-md transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            Import
          </button>
        </div>
      </div>
    </PageShell>
  );
});
