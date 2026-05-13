import React, { memo, useState } from "react";
import { Icons } from "../icons";

/**
 * LineupGrid — renders the inning-by-inning lineup grid for the active game.
 *
 * Two presentations sharing the same tap targets and same handleCellClick API:
 *
 *   • Desktop (sm+ breakpoint): the full position-rows × inning-columns table
 *     with sticky position column and bench row at the bottom. Identical to
 *     the pre-refactor layout.
 *
 *   • Mobile (below sm): single-inning view with an inning tab strip on top.
 *     Each position is a full-width row (44px+ tap target). Bench list below.
 *     Coaches stop having to pinch-zoom or scroll a tiny grid sideways at
 *     the field — the most-used screen finally fits a phone.
 *
 * `swapSelection` is the currently-armed cell (one tap arms, second tap
 * swaps). When set, the matching cell gets a yellow ring on both views.
 */
export const LineupGrid = memo(
  ({ lineup, positions, swapSelection, onCellClick }) => {
    const totalInnings = lineup.length;
    const [mobileInning, setMobileInning] = useState(0);
    const safeMobileInning = Math.min(mobileInning, totalInnings - 1);
    const inn = lineup[safeMobileInning];

    const cellIsSelected = (innIdx, pos, playerId) => {
      if (!swapSelection) return false;
      if (swapSelection.innIdx !== innIdx) return false;
      if (pos === "BENCH") {
        return (
          swapSelection.pos === "BENCH" &&
          swapSelection.player?.id === playerId
        );
      }
      return swapSelection.pos === pos;
    };

    return (
      <>
        {/* ----- Mobile single-inning view (below sm breakpoint) ----- */}
        <div className="sm:hidden print:hidden">
          {/* Inning tab strip */}
          <div className="px-3 pt-3 pb-2 bg-white/40 border-b border-slate-200/50">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mr-1 shrink-0">
                Inning
              </span>
              {lineup.map((_, idx) => (
                <button
                  key={`m-inn-${idx}`}
                  onClick={() => setMobileInning(idx)}
                  className={`px-3.5 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all shrink-0 ${
                    idx === safeMobileInning
                      ? "bg-slate-900 text-white shadow-md"
                      : "bg-white/70 text-slate-600 hover:bg-white border border-slate-200"
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>

          {/* Position rows for the selected inning */}
          <div className="px-3 py-3 bg-white/20">
            <div className="flex flex-col gap-2">
              {positions.map((pos) => {
                const pAtPos = inn?.[pos];
                const sel = cellIsSelected(safeMobileInning, pos);
                return (
                  <button
                    key={`m-${pos}`}
                    onClick={() => onCellClick(safeMobileInning, pos, pAtPos)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-all min-h-[56px] ${
                      sel
                        ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 shadow-md"
                        : pAtPos
                        ? "bg-white border-slate-200 text-slate-800 active:bg-slate-50"
                        : "bg-white/30 border-dashed border-slate-300 text-slate-400 active:bg-white/60"
                    }`}
                  >
                    <span className="inline-flex items-center justify-center w-12 h-9 rounded-lg bg-slate-100 text-slate-700 font-black text-sm tracking-tight shrink-0">
                      {pos}
                    </span>
                    <span className="text-base font-bold truncate flex-1">
                      {pAtPos ? (
                        pAtPos.name
                      ) : (
                        <span className="italic font-medium text-slate-400">
                          Tap to assign
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Bench section */}
            <div className="mt-5 pt-4 border-t border-slate-200/60">
              <div className="flex items-center gap-2 mb-3">
                <Icons.Users className="w-4 h-4 text-slate-500" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Bench
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {inn?.BENCH?.length ? (
                  inn.BENCH.map((p) => {
                    const sel = cellIsSelected(safeMobileInning, "BENCH", p.id);
                    return (
                      <button
                        key={`m-bench-${p.id}`}
                        onClick={() =>
                          onCellClick(safeMobileInning, "BENCH", p)
                        }
                        className={`px-3 py-2 text-sm font-bold border rounded-lg transition-all min-h-[40px] ${
                          sel
                            ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 shadow-md"
                            : "bg-white border-slate-200 text-slate-700 active:bg-slate-50"
                        }`}
                      >
                        {p.name}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs font-bold text-slate-400 italic">
                    No one benched this inning
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ----- Desktop grid (sm+) — unchanged shape ----- */}
        <div className="hidden sm:block overflow-x-auto print:overflow-visible print:block">
          <table className="w-full text-left border-collapse print:text-xs">
            <thead>
              <tr className="bg-white/40 border-b border-slate-200/50 print:bg-slate-200">
                <th className="p-4 print:p-2 font-black text-[11px] uppercase tracking-widest text-center w-20 print:w-12 sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none text-slate-500 bg-white/60 print:bg-slate-200 print:text-slate-900 border-r border-slate-200/50">
                  Pos
                </th>
                {lineup.map((_, idx) => (
                  <th
                    key={`inn-${idx}-${lineup.length}`}
                    className="p-4 print:p-2 border-r border-slate-200/50 font-black text-[11px] uppercase tracking-widest text-center min-w-[140px] print:min-w-0 text-slate-700"
                  >
                    Inn {idx + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr
                  key={pos}
                  className="border-b border-slate-200/50 hover:bg-white/50 break-inside-avoid transition-colors"
                >
                  <td className="p-3 print:p-1.5 font-black text-sm border-r border-slate-200/50 sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none text-center bg-white/80 print:bg-transparent text-slate-800">
                    {pos}
                  </td>
                  {lineup.map((inning, idx) => {
                    const pAtPos = inning[pos];
                    const isSelected = cellIsSelected(idx, pos);
                    return (
                      <td
                        key={`${pos}-${idx}-${lineup.length}`}
                        className="p-2 print:p-1 border-r border-slate-200/50 relative"
                      >
                        <div
                          onClick={() => onCellClick(idx, pos, pAtPos)}
                          className={`w-full p-3 text-xs font-bold text-center rounded-lg cursor-pointer transition-all border ${
                            isSelected
                              ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 shadow-md scale-105 z-20 relative"
                              : pAtPos
                              ? "bg-white/80 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300"
                              : "bg-white/30 border-dashed border-slate-300 text-slate-400 hover:bg-white/80"
                          }`}
                        >
                          {pAtPos ? (
                            pAtPos.name
                          ) : (
                            <span className="italic font-medium">Assign</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="break-inside-avoid border-t-2 border-slate-200/80 bg-white/20">
                <td className="p-3 print:p-1.5 font-black text-[10px] sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none uppercase tracking-widest text-center text-slate-500 bg-white/60 print:bg-transparent border-r border-slate-200/50">
                  Bench
                </td>
                {lineup.map((inning, idx) => (
                  <td
                    key={`bench-${idx}-${lineup.length}`}
                    className="p-3 print:p-1 align-top border-r border-slate-200/50 min-w-[140px] print:min-w-0"
                  >
                    <div className="flex flex-col gap-2 items-center">
                      {inning.BENCH?.map((p) => {
                        const isSelected = cellIsSelected(idx, "BENCH", p.id);
                        return (
                          <div
                            key={p.id}
                            onClick={() => onCellClick(idx, "BENCH", p)}
                            className={`text-[11px] print:p-0 px-3 py-2 border font-bold w-full text-center truncate rounded-lg shadow-sm transition-all cursor-pointer ${
                              isSelected
                                ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 scale-105 z-20 relative"
                                : "bg-white/90 border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300"
                            }`}
                          >
                            {p.name}
                          </div>
                        );
                      })}
                      {(!inning.BENCH || inning.BENCH.length === 0) && (
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400/50 py-2">
                          Empty
                        </div>
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  }
);
