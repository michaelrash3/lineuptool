import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useToast, useUI } from "../contexts";
import { isDepartedPlayer } from "../utils/helpers";
import {
  buildPlayingTimeReportData,
  downloadPlayingTimeReportPdf,
} from "../stats/playingTimeReportPdf";

// Stats-tab playing-time card — the receipts for "is my kid playing enough?".
//
// Head coach only, and hidden until at least one finalized, non-scrimmage game
// has a saved lineup. Every number is the SAME number the rotation engine used
// when it built those lineups (utils/playingTime reads the engine's own season
// ledger), and the card renders the exact rows and sentences the printable
// report prints — a parent looking at the coach's phone and a parent holding
// the PDF are looking at the same document.
//
// Read-only: nothing here writes.
export const PlayingTimePanel = memo(() => {
  const { team, currentRole } = useTeam();
  const { openPlayerProfile } = useUI();
  const toast = useToast();
  const { players, games } = team as {
    players?: Array<{ id?: string; name?: string; number?: string | number }>;
    games?: never[];
  };
  const [busy, setBusy] = useState(false);

  // Departed players are excluded everywhere but the Roster tab.
  const roster = useMemo(
    () => (players || []).filter((p) => !isDepartedPlayer(p)),
    [players],
  );

  const eligible = currentRole === "head";
  const data = useMemo(
    () => (eligible ? buildPlayingTimeReportData(games || [], roster) : null),
    [eligible, games, roster],
  );

  if (!eligible || !data) return null;

  return (
    <div className="cc-card mb-6">
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
      <div className="p-5 border-b border-line bg-surface flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="p-2 rounded-full shrink-0"
            style={{ backgroundColor: "var(--team-primary-15)" }}
            aria-hidden
          >
            <Icons.Glove
              className="w-5 h-5"
              style={{ color: "var(--team-ink)" }}
            />
          </div>
          <div className="min-w-0">
            <h2 className="t-h2">Playing Time</h2>
            <p className="t-eyebrow text-ink-3 mt-0.5">
              Innings, positions &amp; bench time, kid by kid
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadPlayingTimeReportPdf({
                team: team as never,
                games: games || [],
                players: roster,
                toast,
              });
            } finally {
              setBusy(false);
            }
          }}
          aria-label="Download playing time report PDF"
          className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest border border-line text-ink-3 hover:text-ink transition-colors inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          <Icons.Download className="w-4 h-4" aria-hidden />
          {busy ? "Building…" : "Print / PDF"}
        </button>
      </div>

      {/* Exactly which games are behind every number below. */}
      <p className="px-5 py-2.5 text-[11px] font-bold text-ink-3 border-b border-line bg-surface-2">
        {data.countingNote}
      </p>

      <ul className="px-5 py-3 border-b border-line space-y-1">
        {data.teamNotes.map((note) => (
          <li key={note} className="text-[12px] font-bold text-ink-2">
            {note}
          </li>
        ))}
        {data.notYetPlayedNote && (
          <li className="text-[12px] font-bold text-ink-3">
            {data.notYetPlayedNote}
          </li>
        )}
      </ul>

      <div className="divide-y divide-line">
        {data.rows.map((r) => (
          <div key={r.id} className="p-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <button
                type="button"
                onClick={() => openPlayerProfile?.(r.id)}
                className="font-extrabold text-ink hover:text-team-primary text-left"
              >
                {r.label}
              </button>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {data.columns.map((col, i) => (
                  <span
                    key={col}
                    className="t-chip px-1.5 py-0.5 rounded-md border border-line bg-surface-2 text-ink-2 text-[10px] font-black tabular-nums whitespace-nowrap"
                  >
                    {col} {r.cells[i]}
                  </span>
                ))}
              </div>
            </div>
            {/* The line a coach can read aloud, word for word off the PDF. */}
            <p className="text-[12px] font-bold text-ink-2 mt-1.5">
              {r.sentence}
            </p>
            {r.positionsLabel && (
              <p className="text-[11px] font-bold text-ink-3 mt-0.5 tabular-nums">
                Where those innings went: {r.positionsLabel}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
