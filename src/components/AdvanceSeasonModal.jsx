import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { Button, Eyebrow } from "./shared.jsx";

// Two-step "Advance to next season" wizard. Replaces the previous flow
// where the head had to mark each player Returning / Released on the
// Settings panel BEFORE pressing the button — coaches found it confusing
// because the toggles were always visible whether or not they intended
// to advance. Now the button opens this modal, the head marks every
// player in one pass (with bulk "All Returning" / "All Released"
// affordances), and a final summary + confirm step kicks off the actual
// advanceSeason() write.
//
// Tryout "accepted" players show as a locked-in badge — they're already
// committed to the new roster by accepting their tryout offer, so they
// can't be toggled here.

const STATUS_RETURNING = "returning";
const STATUS_RELEASED = "released";
const STATUS_ACCEPTED = "accepted";

const isAccepted = (p) => p?.playerStatus === STATUS_ACCEPTED;

const effectiveStatus = (p) => {
  if (isAccepted(p)) return STATUS_ACCEPTED;
  return p?.playerStatus === STATUS_RELEASED ? STATUS_RELEASED : STATUS_RETURNING;
};

export const AdvanceSeasonModal = memo(
  ({
    open,
    players = [],
    tryoutSignups = [],
    currentSeason,
    nextSeasonLabel,
    onClose,
    onConfirm,
    setPlayerStatus,
  }) => {
    const [busy, setBusy] = useState(false);
    // Tryout signups the HC has decided to bring forward into the new
    // roster. Default: none (zero-knowledge — the HC has to explicitly
    // opt each tryout in, which matches what they're doing on the
    // Tryouts tab pre-advance anyway).
    const [promoteIds, setPromoteIds] = useState(() => new Set());

    const partition = useMemo(() => {
      const accepted = [];
      const returning = [];
      const released = [];
      for (const p of players) {
        const s = effectiveStatus(p);
        if (s === STATUS_ACCEPTED) accepted.push(p);
        else if (s === STATUS_RELEASED) released.push(p);
        else returning.push(p);
      }
      return { accepted, returning, released };
    }, [players]);

    const togglablePlayers = useMemo(
      () => players.filter((p) => !isAccepted(p)),
      [players]
    );

    // Sort signups by tryout number (if assigned), then by name.
    const sortedSignups = useMemo(() => {
      return [...tryoutSignups].sort((a, b) => {
        const numA = parseInt(a.tryoutNumber, 10);
        const numB = parseInt(b.tryoutNumber, 10);
        const aValid = Number.isFinite(numA);
        const bValid = Number.isFinite(numB);
        if (aValid && bValid) {
          if (numA !== numB) return numA - numB;
        } else if (aValid) return -1;
        else if (bValid) return 1;
        return (`${a.firstName} ${a.lastName}`).localeCompare(
          `${b.firstName} ${b.lastName}`
        );
      });
    }, [tryoutSignups]);

    if (!open) return null;

    const setAll = (status) => {
      for (const p of togglablePlayers) {
        if (effectiveStatus(p) !== status) {
          setPlayerStatus?.(p.id, status);
        }
      }
    };

    const toggleSignup = (id) => {
      setPromoteIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const setAllSignups = (on) => {
      setPromoteIds(
        on ? new Set(sortedSignups.map((s) => s.id)) : new Set()
      );
    };

    const handleConfirm = async () => {
      if (busy) return;
      setBusy(true);
      try {
        await onConfirm?.({ tryoutsToPromote: Array.from(promoteIds) });
      } finally {
        setBusy(false);
      }
    };

    return (
      <div
        className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
        onClick={busy ? undefined : onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white/95 max-w-2xl w-full max-h-[90vh] rounded-2xl shadow-2xl border border-white/60 overflow-hidden flex flex-col"
        >
          <div
            className="h-1.5 w-full"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          <div className="p-6 sm:p-7 pb-3 flex items-start gap-3">
            <div
              className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: "var(--team-primary-15)" }}
            >
              <Icons.Forward
                className="w-6 h-6"
                style={{ color: "var(--team-primary)" }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Eyebrow>Advance Season</Eyebrow>
              <h2 className="t-card-title mt-1.5 break-words">
                {currentSeason || "Current Season"} →{" "}
                {nextSeasonLabel || "Next Season"}
              </h2>
              <p className="t-body mt-2 leading-relaxed">
                Mark each player as Returning or Released for the next season.
                Released players are dropped from the roster (their stats stay
                in season history). Tryout accepts ride into the new roster
                automatically.
              </p>
            </div>
            {!busy && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Cancel"
                className="shrink-0 -mr-2 -mt-1 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="px-6 sm:px-7 flex flex-wrap items-center gap-2 pb-3">
            <span className="t-meta text-slate-400 mr-1">Bulk:</span>
            <button
              type="button"
              onClick={() => setAll(STATUS_RETURNING)}
              className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-emerald-300/80 bg-emerald-50/40 text-emerald-800 hover:bg-emerald-50"
            >
              All Returning
            </button>
            <button
              type="button"
              onClick={() => setAll(STATUS_RELEASED)}
              className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              All Released
            </button>
            <span
              className="ml-auto text-[10px] font-black uppercase tracking-widest text-slate-500 tabular-nums whitespace-nowrap"
              aria-live="polite"
            >
              {partition.returning.length} returning · {partition.released.length}{" "}
              released · {partition.accepted.length} tryout
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-6 sm:px-7 pb-4 space-y-5">
            {togglablePlayers.length === 0 && partition.accepted.length === 0 ? (
              <p className="t-body text-center py-6 italic text-slate-400">
                No players on the roster yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {players.map((p) => {
                  const status = effectiveStatus(p);
                  const accepted = status === STATUS_ACCEPTED;
                  const returning = status === STATUS_RETURNING;
                  const released = status === STATUS_RELEASED;
                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="text-xs font-extrabold text-slate-800 uppercase tracking-tight truncate">
                          {p.name}
                        </span>
                        {p.number && (
                          <span className="text-[10px] font-bold text-slate-400 tabular-nums shrink-0">
                            #{p.number}
                          </span>
                        )}
                      </div>
                      {accepted ? (
                        <span
                          className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border shrink-0"
                          style={{
                            backgroundColor: "var(--team-primary-15)",
                            borderColor: "var(--team-primary)",
                            color: "var(--team-primary)",
                          }}
                        >
                          Tryout Accept
                        </span>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setPlayerStatus?.(p.id, STATUS_RETURNING)
                            }
                            aria-pressed={returning}
                            className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border transition-colors ${
                              returning
                                ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            Returning
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPlayerStatus?.(p.id, STATUS_RELEASED)
                            }
                            aria-pressed={released}
                            className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border transition-colors ${
                              released
                                ? "bg-slate-200 border-slate-300 text-slate-700"
                                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            Released
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {sortedSignups.length > 0 && (
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                  <div>
                    <h3 className="t-h3 flex items-center gap-2">
                      <Icons.Plus className="w-4 h-4" /> Tryout Signups
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Check the kids you're bringing onto the new roster.
                      Unchecked signups (and all signups not promoted) are
                      cleared when the season advances.
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAllSignups(true)}
                      className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border border-emerald-300/80 bg-emerald-50/40 text-emerald-800 hover:bg-emerald-50"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllSignups(false)}
                      className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      None
                    </button>
                  </div>
                </div>
                <ul className="space-y-2">
                  {sortedSignups.map((s) => {
                    const checked = promoteIds.has(s.id);
                    return (
                      <li
                        key={s.id}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 shadow-sm transition-colors ${
                          checked
                            ? "bg-emerald-50/40 border-emerald-300"
                            : "bg-white border-slate-200"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSignup(s.id)}
                          className="shrink-0 w-4 h-4 accent-emerald-600 cursor-pointer"
                          aria-label={`Promote ${s.firstName} ${s.lastName} to next season`}
                        />
                        <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                          {s.tryoutNumber && (
                            <span className="text-[10px] font-bold text-slate-400 tabular-nums shrink-0">
                              #{s.tryoutNumber}
                            </span>
                          )}
                          <span className="text-xs font-extrabold text-slate-800 uppercase tracking-tight truncate">
                            {s.firstName} {s.lastName}
                          </span>
                          {s.status && (
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 shrink-0">
                              {s.status}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 tabular-nums mt-2 text-right">
                  {promoteIds.size} of {sortedSignups.length} selected
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 px-6 sm:px-7 py-4 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end bg-white/80">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onClose}
              disabled={busy}
              style={busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleConfirm}
              disabled={busy}
              style={busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              {busy ? (
                <>
                  <Icons.Refresh className="w-4 h-4 animate-spin" /> Advancing…
                </>
              ) : (
                <>
                  <Icons.Forward className="w-4 h-4" /> Confirm Advance Season
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }
);
