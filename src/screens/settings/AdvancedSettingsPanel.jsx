import React from "react";

export const StorageUsagePanel = ({ team }) => {
  const FIRESTORE_LIMIT = 1048576; // 1 MB in bytes
  let docSize = 0;
  try {
    docSize = new TextEncoder().encode(JSON.stringify(team || {})).length;
  } catch {
    docSize = 0;
  }
  const pct = Math.min(100, (docSize / FIRESTORE_LIMIT) * 100);
  const sizeKb = Math.round(docSize / 1024);
  const limitKb = Math.round(FIRESTORE_LIMIT / 1024);
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  const label =
    pct >= 90
      ? "Critical — saves may fail soon"
      : pct >= 70
      ? "Watch — getting close to the limit"
      : "Healthy";

  return (
    <div className="pt-6 border-t border-slate-200/50">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-bold text-slate-800 text-sm">Storage Usage</h4>
        <span className="text-xs font-black tabular-nums text-slate-700">
          {sizeKb} KB / {limitKb} KB
        </span>
      </div>
      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-500 mt-1.5 font-medium">
        {label} ({pct.toFixed(0)}%). Saves are limited to 1 MB per team. Data resets at season rollover.
      </p>
    </div>
  );
};

export const TeamManagementPanel = ({ teams, leaveTeamCmd, deleteTeamCmd }) => (
  <div className="pt-6 border-t border-slate-200/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
    <div>
      <h4 className="font-bold text-slate-800 text-sm">Team Management</h4>
      <p className="text-xs text-slate-500 mt-1 font-medium">Leave this team or permanently delete it.</p>
    </div>
    <div className="flex gap-3">
      <button
        onClick={leaveTeamCmd}
        disabled={teams.length <= 1}
        className="px-6 py-3 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm whitespace-nowrap"
      >
        Leave Team
      </button>
      <button
        onClick={deleteTeamCmd}
        disabled={teams.length <= 1}
        className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm whitespace-nowrap"
      >
        Delete Team
      </button>
    </div>
  </div>
);
