import React, { memo, useState } from "react";
import { Icons } from "../icons";

/**
 * LineupGrid — renders the inning-by-inning lineup grid for the active game.
 *
 * Two presentations sharing the same handleCellClick API:
 *
 *   • Desktop (sm+ breakpoint): the full position-rows × inning-columns table
 *     with sticky position column and bench row at the bottom. Identical to
 *     the pre-refactor layout, but the clickable cells/chips are now real
 *     <button> elements so keyboard-only editing works.
 *
 *   • Mobile (below sm): single-inning view with an inning tab strip on top.
 *     Each position is a full-width row (56px+ tap target). Bench list below
 *     as chips. Coaches at the field finally have a grid that doesn't
 *     require pinch-zoom or sideways scrolling.
 *
 * `swapSelection` is the currently-armed cell (one tap arms, second tap
 * swaps). When set, the matching cell gets a yellow ring on both views.
 */
export const LineupGrid = memo(
  ({ lineup, positions, swapSelection, onCellClick }: any) => {
    // When onCellClick is omitted (assistant role), cells become no-op
    // taps — visuals unchanged, swaps short-circuit.
    const safeCellClick = onCellClick || (() => {});
    const totalInnings = lineup.length;
    const [mobileInning, setMobileInning] = useState(0);
    const safeMobileInning = Math.min(mobileInning, totalInnings - 1);
    const inn = lineup[safeMobileInning];

    const cellIsSelected = (innIdx: any, pos: any, playerId?: any) => {
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
          <div className="px-3 pt-3 pb-2 bg-surface border-b border-line/50">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
              <span className="t-eyebrow mr-1 shrink-0">Inning</span>
              {lineup.map((_: any, idx: any) => {
                const isActive = idx === safeMobileInning;
                return (
                  <button
                    key={`m-inn-${idx}`}
                    type="button"
                    onClick={() => setMobileInning(idx)}
                    aria-pressed={isActive}
                    className="px-3.5 py-2 t-button rounded-lg transition-all shrink-0 border"
                    style={
                      isActive
                        ? {
                            backgroundColor: "var(--team-primary)",
                            color: "var(--team-tertiary)",
                            borderColor: "var(--team-primary)",
                            boxShadow: "var(--shadow-md)",
                          }
                        : {
                            backgroundColor: "rgba(255,255,255,0.7)",
                            color: "#475569",
                            borderColor: "#e2e8f0",
                          }
                    }
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Position rows for the selected inning */}
          <div className="px-3 py-3 bg-surface">
            <div className="flex flex-col gap-2">
              {positions.map((pos: any) => {
                const pAtPos = inn?.[pos];
                const sel = cellIsSelected(safeMobileInning, pos);
                return (
                  <button
                    key={`m-${pos}`}
                    type="button"
                    onClick={() => safeCellClick(safeMobileInning, pos, pAtPos)}
                    aria-pressed={sel}
                    aria-label={`Inning ${safeMobileInning + 1}, ${pos}: ${
                      pAtPos ? pAtPos.name : "unassigned"
                    }`}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-all min-h-[56px] ${
                      sel
                        ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 shadow-md"
                        : pAtPos
                        ? "bg-surface border-line text-ink active:bg-app"
                        : "bg-surface border-dashed border-line-strong text-ink-3 active:bg-surface"
                    }`}
                  >
                    <span
                      className="inline-flex items-center justify-center w-12 h-9 rounded-lg font-black text-sm tracking-tight shrink-0"
                      style={{
                        backgroundColor: "var(--team-primary-15)",
                        color: "var(--team-primary)",
                      }}
                    >
                      {pos}
                    </span>
                    <span className="text-base font-bold truncate flex-1">
                      {pAtPos ? (
                        pAtPos.name
                      ) : (
                        <span className="italic font-medium text-ink-3">
                          Tap to assign
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Bench section */}
            <div className="mt-5 pt-4 border-t border-line/60">
              <div className="flex items-center gap-2 mb-3">
                <Icons.Users className="w-4 h-4 text-ink-3" />
                <span className="text-[10px] font-black uppercase tracking-widest text-ink-3">
                  Bench
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {inn?.BENCH?.length ? (
                  inn.BENCH.map((p: any) => {
                    const sel = cellIsSelected(safeMobileInning, "BENCH", p.id);
                    return (
                      <button
                        key={`m-bench-${p.id}`}
                        type="button"
                        onClick={() =>
                          safeCellClick(safeMobileInning, "BENCH", p)
                        }
                        aria-pressed={sel}
                        className={`px-3 py-2 text-sm font-bold border rounded-lg transition-all min-h-[40px] ${
                          sel
                            ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 shadow-md"
                            : "bg-surface border-line text-ink active:bg-app"
                        }`}
                      >
                        {p.name}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs font-bold text-ink-3 italic">
                    No one benched this inning
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ----- Desktop grid (sm+) ----- */}
        <div className="hidden sm:block overflow-x-auto print:overflow-visible print:block">
          <table className="w-full text-left border-collapse print:text-xs">
            <thead>
              <tr className="bg-surface border-b border-line/50 print:bg-line">
                <th className="p-4 print:p-2 font-black text-[11px] uppercase tracking-widest text-center w-20 print:w-12 sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none text-ink-3 bg-surface print:bg-line print:text-ink border-r border-line/50">
                  Pos
                </th>
                {lineup.map((_: any, idx: any) => (
                  <th
                    key={`inn-${idx}-${lineup.length}`}
                    className="p-4 print:p-2 border-r border-line/50 font-black text-[11px] uppercase tracking-widest text-center min-w-[140px] print:min-w-0 text-ink"
                  >
                    Inn {idx + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((pos: any) => (
                <tr
                  key={pos}
                  className="border-b border-line/50 hover:bg-surface-2 break-inside-avoid transition-colors"
                >
                  <td className="p-3 print:p-1.5 font-black text-sm border-r border-line/50 sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none text-center bg-surface print:bg-transparent text-ink">
                    {pos}
                  </td>
                  {lineup.map((inning: any, idx: any) => {
                    const pAtPos = inning[pos];
                    const isSelected = cellIsSelected(idx, pos);
                    return (
                      <td
                        key={`${pos}-${idx}-${lineup.length}`}
                        className="p-2 print:p-1 border-r border-line/50 relative"
                      >
                        <button
                          type="button"
                          onClick={() => safeCellClick(idx, pos, pAtPos)}
                          aria-pressed={isSelected}
                          aria-label={`Inning ${idx + 1}, ${pos}: ${
                            pAtPos ? pAtPos.name : "unassigned"
                          }`}
                          className={`w-full p-3 text-xs font-bold text-center rounded-lg cursor-pointer transition-all border ${
                            isSelected
                              ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 shadow-md scale-105 z-20 relative"
                              : pAtPos
                              ? "bg-surface border-line text-ink hover:bg-surface-2 hover:border-line-strong"
                              : "bg-surface border-dashed border-line-strong text-ink-3 hover:bg-surface"
                          }`}
                        >
                          {pAtPos ? (
                            pAtPos.name
                          ) : (
                            <span className="italic font-medium">Assign</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="break-inside-avoid border-t-2 border-line/80 bg-surface">
                <td className="p-3 print:p-1.5 font-black text-[10px] sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none uppercase tracking-widest text-center text-ink-3 bg-surface print:bg-transparent border-r border-line/50">
                  Bench
                </td>
                {lineup.map((inning: any, idx: any) => (
                  <td
                    key={`bench-${idx}-${lineup.length}`}
                    className="p-3 print:p-1 align-top border-r border-line/50 min-w-[140px] print:min-w-0"
                  >
                    <div className="flex flex-col gap-2 items-center">
                      {inning.BENCH?.map((p: any) => {
                        const isSelected = cellIsSelected(idx, "BENCH", p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => safeCellClick(idx, "BENCH", p)}
                            aria-pressed={isSelected}
                            className={`text-[11px] print:p-0 px-3 py-2 border font-bold w-full text-center truncate rounded-lg shadow-sm transition-all cursor-pointer ${
                              isSelected
                                ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 scale-105 z-20 relative"
                                : "bg-surface border-line text-ink-2 hover:bg-surface-2 hover:border-line-strong"
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                      {(!inning.BENCH || inning.BENCH.length === 0) && (
                        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-3/50 py-2">
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
