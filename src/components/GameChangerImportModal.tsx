import React, { useMemo, useState } from "react";
import { Icons } from "../icons";
import { type GcEvent } from "../utils/icsParse";
import {
  fetchGcEvents,
  mergeGcEventsIntoGames,
  mergeGcEventsIntoPractices,
} from "../utils/gcSync";
import { A11yDialog } from "./shared";

// Import / sync a team's schedule from its GameChanger .ics calendar feed.
// Flow: paste the feed URL -> Preview (fetched through /api/gc-schedule, which
// proxies the CORS-less calendar host) -> review the parsed games -> Import.
// Games are matched to existing ones by the feed's stable UID (game.gcUid), so
// re-syncing updates dates/opponents in place instead of creating duplicates,
// and never touches scores/lineups on games already played.

interface Candidate {
  event: GcEvent;
  date: string; // local YYYY-MM-DD
  isExisting: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  team: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: { push: (t: any) => void };
}

export const GameChangerImportModal: React.FC<Props> = ({
  open,
  onClose,
  team,
  updateTeam,
  toast,
}) => {
  const existingGames: any[] = useMemo(
    () => (Array.isArray(team?.games) ? team.games : []),
    [team?.games],
  );
  const [url, setUrl] = useState<string>(team?.gcCalendarUrl || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  const existingByUid = useMemo(() => {
    const m = new Map<string, any>();
    for (const g of existingGames) if (g?.gcUid) m.set(g.gcUid, g);
    return m;
  }, [existingGames]);

  if (!open) return null;

  const preview = async () => {
    setLoading(true);
    setError(null);
    setCandidates(null);
    try {
      const events = await fetchGcEvents(url);
      if (events.length === 0) {
        throw new Error("No games found in that calendar feed.");
      }
      const mapped: Candidate[] = events
        .map((event) => ({
          event,
          date: event.startDate,
          isExisting: !!event.uid && existingByUid.has(event.uid),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      setCandidates(mapped);
    } catch (e: any) {
      setError(e?.message || "Couldn't load the feed.");
    } finally {
      setLoading(false);
    }
  };

  const doImport = () => {
    if (!candidates) return;
    const events = candidates.map((c) => c.event);
    const {
      games: nextGames,
      added: gamesAdded,
      updated: gamesUpdated,
    } = mergeGcEventsIntoGames(existingGames, events, {
      leagueRuleSet: team.leagueRuleSet,
      pitchingFormat: team.pitchingFormat,
      defenseSize: team.defenseSize,
      battingSize: team.battingSize,
      positionLock: team.positionLock,
    });
    const existingPractices: any[] = Array.isArray(team?.practices)
      ? team.practices
      : [];
    const {
      practices: nextPractices,
      added: practicesAdded,
      updated: practicesUpdated,
    } = mergeGcEventsIntoPractices(existingPractices, events);

    updateTeam({
      games: nextGames,
      practices: nextPractices,
      gcCalendarUrl: url.trim(),
    });
    const addedTotal = gamesAdded + practicesAdded;
    const updatedTotal = gamesUpdated + practicesUpdated;
    toast.push({
      kind: "success",
      title: "Schedule imported",
      message:
        `${gamesAdded} game${gamesAdded === 1 ? "" : "s"}, ` +
        `${practicesAdded} practice${practicesAdded === 1 ? "" : "s"} added` +
        (updatedTotal > 0 ? ` · ${updatedTotal} updated` : "") +
        ` from GameChanger.`,
    });
    void addedTotal;
    onClose();
  };

  // Drop the saved feed without needing a replacement link. Useful right after
  // a season rollover, when GameChanger hasn't issued the new season's feed
  // yet: clearing it stops the Schedule tab auto-syncing the dead URL and
  // leaves the field blank for the new link whenever it arrives.
  const hasSavedFeed = !!String(team?.gcCalendarUrl || "").trim();
  const removeFeed = () => {
    updateTeam({ gcCalendarUrl: "" });
    setUrl("");
    setCandidates(null);
    setError(null);
    toast.push({
      kind: "success",
      title: "GameChanger feed removed",
      message: "Paste this season's calendar link when you have it.",
    });
  };

  const newCount = candidates?.filter((c) => !c.isExisting).length ?? 0;
  const dupCount = candidates?.filter((c) => c.isExisting).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <A11yDialog
        label="Import from GameChanger"
        onClose={onClose}
        className="bg-app border border-line rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h3 className="text-lg font-black text-ink uppercase tracking-wider flex items-center gap-2">
            <Icons.Calendar className="w-5 h-5" /> Import from GameChanger
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 hover:text-ink"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-ink-3">
              Calendar feed URL
            </label>
            <p className="text-xs text-ink-3 mt-1 mb-2">
              In GameChanger: Schedule → Schedule Sync → Sync to Your Calendar,
              then copy the subscription link (starts with{" "}
              <code>webcal://</code> or <code>https://</code>).
            </p>
            <textarea
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              rows={2}
              placeholder="webcal://api.team-manager.gc.com/..."
              className="w-full p-2.5 bg-surface border border-line rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-[var(--team-primary)] break-all"
            />
          </div>

          <button
            onClick={preview}
            disabled={loading || !url.trim()}
            className="w-full py-2.5 px-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider rounded-xl bg-surface border border-line-strong text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Preview games"}
          </button>

          {hasSavedFeed && (
            <button
              onClick={removeFeed}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-ink-3 hover:text-rose-600"
            >
              <Icons.Trash className="w-3.5 h-3.5" /> Remove saved feed
            </button>
          )}

          {error && (
            <div className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">
              {error}
            </div>
          )}

          {candidates && (
            <div className="space-y-2">
              <div className="text-[11px] font-black uppercase tracking-widest text-ink-3">
                {candidates.length} game{candidates.length === 1 ? "" : "s"} ·{" "}
                {newCount} new · {dupCount} already imported
              </div>
              <div className="border border-line rounded-xl divide-y divide-line max-h-64 overflow-y-auto">
                {candidates.map((c) => (
                  <div
                    key={c.event.uid || c.event.summary}
                    className="flex items-center gap-3 p-2.5 text-sm"
                  >
                    <span className="tabular-nums text-ink-3 w-24 shrink-0">
                      {c.date}
                    </span>
                    <span
                      className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0 ${
                        c.event.isHome === false
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-emerald-50 border-emerald-200 text-emerald-700"
                      }`}
                    >
                      {c.event.isHome === false
                        ? "@ Away"
                        : c.event.isHome
                          ? "vs Home"
                          : "—"}
                    </span>
                    <span className="font-bold text-ink flex-1 min-w-0 truncate">
                      {c.event.opponent}
                    </span>
                    {c.isExisting && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-ink-3 shrink-0">
                        synced
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {candidates && (
          <div className="p-5 border-t border-line flex justify-end gap-3">
            <button
              onClick={onClose}
              className="py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-xl border border-line text-ink hover:bg-surface"
            >
              Cancel
            </button>
            <button
              onClick={doImport}
              className="py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-xl bg-[var(--team-primary)] text-white hover:-translate-y-0.5 transition-transform"
            >
              Import {candidates.length} game
              {candidates.length === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </A11yDialog>
    </div>
  );
};
