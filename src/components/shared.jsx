// Small reusable presentational components extracted from App.jsx Section 8.
// All consumers go through useTeam/useUI from ../contexts.js.

import React, { memo, useMemo } from "react";
import { formatStat } from "../utils/helpers";
import { useTeam, useUI } from "../contexts.js";

export const LeaderboardCard = memo(
  ({
    title,
    icon: Icon,
    statKey,
    formatStr,
    asc,
    players,
    primaryColor,
    tertiaryColor,
    onPlayerClick,
  }) => {
    const sorted = useMemo(() => {
      return [...players]
        .filter((p) => {
          const val = p.stats?.[statKey];
          if (asc && statKey === "era" && (!p.stats?.ip || p.stats.ip === 0))
            return false;
          if (
            !asc &&
            (val === undefined || val === null || val === 0 || val === "0")
          )
            return false;
          return true;
        })
        .sort((a, b) => {
          const valA = a.stats?.[statKey] || 0;
          const valB = b.stats?.[statKey] || 0;
          return asc ? valA - valB : valB - valA;
        })
        .slice(0, 3);
    }, [players, statKey, asc]);

    return (
      <div className="bg-white/30 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 overflow-hidden hover:-translate-y-1 transition-transform duration-300">
        <div className="p-5 border-b border-white/40 flex items-center gap-4 bg-white/20">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icon className="w-5 h-5" style={{ color: primaryColor }} />
          </div>
          <h4 className="font-extrabold text-[11px] uppercase tracking-widest text-slate-700">
            {title}
          </h4>
        </div>
        <div className="p-5 space-y-4">
          {sorted.length > 0 ? (
            sorted.map((p, i) => (
              <div
                key={p.id}
                className="flex justify-between items-center group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-black text-slate-500 w-4 shrink-0">
                    {i + 1}.
                  </span>
                  <button
                    type="button"
                    onClick={() => onPlayerClick && onPlayerClick(p.id)}
                    className="text-sm font-extrabold text-slate-800 truncate text-left hover:text-blue-600 transition-colors cursor-pointer"
                  >
                    {p.name}
                  </button>
                </div>
                <span
                  className="text-sm font-black tabular-nums px-3 py-1 rounded-lg shadow-sm border border-white/50 shrink-0 ml-2"
                  style={{
                    backgroundColor: primaryColor,
                    color: tertiaryColor,
                  }}
                >
                  {formatStr
                    ? formatStat(p.stats[statKey])
                    : (p.stats[statKey] || 0).toString()}
                </span>
              </div>
            ))
          ) : (
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center py-6">
              Data Void
            </div>
          )}
        </div>
      </div>
    );
  }
);

/* Compact W-L record. `variant`: "compact" (header) | "full" (home/schedule). */
export const RecordBadge = memo(
  ({ record, variant = "compact", primaryColor, tertiaryColor }) => {
    const { wins, losses, ties, runsScored, runsAllowed } = record || {
      wins: 0,
      losses: 0,
    };
    if (!record || (wins === 0 && losses === 0 && ties === 0)) return null;
    const wl = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    if (variant === "compact") {
      return (
        <span
          className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-lg shadow-sm border border-white/50 tabular-nums"
          style={{ backgroundColor: primaryColor, color: tertiaryColor }}
        >
          {wl}
        </span>
      );
    }
    return (
      <div className="inline-flex items-center gap-3 bg-white/80 px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          Record
        </span>
        <span className="text-base font-black tabular-nums text-slate-900">
          {wl}
        </span>
        <span className="h-4 w-px bg-slate-300" />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          RS
        </span>
        <span className="text-sm font-black tabular-nums text-slate-900">
          {runsScored}
        </span>
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          RA
        </span>
        <span className="text-sm font-black tabular-nums text-slate-900">
          {runsAllowed}
        </span>
      </div>
    );
  }
);

export const SharedModals = memo(() => {
  const { modal, setModal } = useUI();
  const { team } = useTeam();
  if (!modal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden border border-white/50">
        <div className="p-1.5" style={{ backgroundColor: team.primaryColor }} />
        <div className="p-6 bg-white">
          <h3 className="text-xl font-black text-slate-900 mb-2 tracking-tight">
            {modal.title}
          </h3>
          <p className="text-slate-600 font-medium mb-8 text-sm leading-relaxed whitespace-pre-line">
            {modal.message}
          </p>
          <div className="flex gap-3 justify-end">
            {modal.type === "confirm" && (
              <button
                onClick={() => setModal({ ...modal, isOpen: false })}
                className="px-5 py-2.5 bg-slate-50 border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-colors shadow-sm"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => {
                if (modal.onConfirm) modal.onConfirm();
                setModal({ ...modal, isOpen: false });
              }}
              className="px-5 py-2.5 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md"
              style={{
                backgroundColor: team.primaryColor,
                color: team.tertiaryColor,
              }}
            >
              {modal.type === "confirm" ? "Confirm" : "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
