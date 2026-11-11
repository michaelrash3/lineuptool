import React, { memo, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Icons } from "../../icons";
import { type GcEvent } from "../../utils/icsParse";
import {
  fetchGcEvents,
  gcEventGames,
  gcEventKind,
  gcPracticesVsFeed,
  mergeGcEventsIntoGames,
  mergeGcEventsIntoPractices,
  practiceHasLoggedWork,
} from "../../utils/gcSync";
import { useTeam, useToast } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import type { Game, Practice } from "../../types";

// /schedule/import/gamechanger — import / sync the schedule from the team's
// GameChanger .ics calendar feed. A routed page per the app-wide
// modals→pages rule (deep-linkable, refresh-safe, real Back). Flow: paste the feed
// URL → Preview (fetched through /api/gc-schedule, which proxies the
// CORS-less calendar host) → review the parsed games → Import. Games match
// existing ones by the feed's stable UID (game.gcUid), so re-syncing updates
// dates/opponents in place instead of duplicating, and never touches scores
// or lineups on games already played. Practices sync the same way and also
// prune: one the coach deleted in GameChanger is deleted here too, played or
// not. The preview names every practice the import would delete — flagging any
// whose attendance or drill log goes with it — and names the ones it is
// leaving alone because they fall outside the span this feed publishes (see
// gcPracticesVsFeed). Feed entries that aren't games or practices (a
// tournament placeholder, team photos) are listed as skipped, and any an
// earlier sync wrongly made into a game is named before it is removed (see
// gcEventKind / gcEventGames).

interface Candidate {
  event: GcEvent;
  date: string; // local YYYY-MM-DD
  isExisting: boolean;
}

export const GameChangerImportPage = memo(() => {
  const {
    team,
    currentRole,
    updateTeam,
    updateTeamArrays,
    gamesServerConfirmed,
  } = useTeam();
  const toast = useToast();
  const back = useBackOrFallback("/schedule");

  const existingGames: any[] = useMemo(
    () => (Array.isArray(team?.games) ? team.games : []),
    [team?.games],
  );
  const existingPractices: any[] = useMemo(
    () => (Array.isArray(team?.practices) ? team.practices : []),
    [team?.practices],
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

  // What this import would delete, and what it would leave behind — both shown
  // before the coach presses Import rather than discovered afterwards.
  const diff = useMemo(
    () =>
      gcPracticesVsFeed(
        existingPractices,
        candidates ? candidates.map((c) => c.event) : [],
      ),
    [candidates, existingPractices],
  );

  // Games an earlier sync made out of non-game events: removed on import
  // (unless a coach logged work on one, which keeps it).
  const eventGames = useMemo(
    () =>
      gcEventGames(
        existingGames,
        candidates ? candidates.map((c) => c.event) : [],
      ),
    [candidates, existingGames],
  );

  if (currentRole === "assistant") return <Navigate to="/schedule" replace />;

  const preview = async () => {
    // Same guard as the auto-sync in ScheduleTab: the candidate list is built
    // by diffing the feed against the existing games union, and the first
    // games snapshot is cache-served (EMPTY on a device that never cached the
    // collection). Previewing off that view would label every game "new" and
    // let the coach import a duplicate schedule by hand.
    if (!gamesServerConfirmed) {
      setError(
        "Still loading this team's schedule — try again in a moment so we can tell which games you already have.",
      );
      return;
    }
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
    const defaults = {
      leagueRuleSet: team.leagueRuleSet,
      pitchingFormat: team.pitchingFormat,
      defenseSize: team.defenseSize,
      battingSize: team.battingSize,
      positionLock: team.positionLock,
    };
    // Dry-run the merges against the rendered snapshot for the toast counts;
    // the actual write re-merges against the LATEST arrays via mapEntries so
    // a concurrent edit isn't clobbered by a whole-array rewrite.
    const {
      added: gamesAdded,
      updated: gamesUpdated,
      removed: gamesRemoved,
    } = mergeGcEventsIntoGames(existingGames, events, defaults);
    const {
      added: practicesAdded,
      updated: practicesUpdated,
      removed: practicesRemoved,
    } = mergeGcEventsIntoPractices(existingPractices, events);

    updateTeamArrays([
      {
        op: "mapEntries",
        key: "games",
        map: (items: Game[]) =>
          mergeGcEventsIntoGames(items, events, defaults).games,
      },
      {
        op: "mapEntries",
        key: "practices",
        map: (items: Practice[]) =>
          mergeGcEventsIntoPractices(items, events).practices,
      },
    ]);
    updateTeam({ gcCalendarUrl: url.trim() });
    const updatedTotal = gamesUpdated + practicesUpdated;
    toast.push({
      kind: "success",
      title: "Schedule imported",
      message:
        `${gamesAdded} game${gamesAdded === 1 ? "" : "s"}, ` +
        `${practicesAdded} practice${practicesAdded === 1 ? "" : "s"} added` +
        (updatedTotal > 0 ? ` · ${updatedTotal} updated` : "") +
        (practicesRemoved > 0
          ? ` · ${practicesRemoved} practice${practicesRemoved === 1 ? "" : "s"} removed`
          : "") +
        (gamesRemoved > 0
          ? ` · ${gamesRemoved} event${gamesRemoved === 1 ? "" : "s"} taken off the schedule (not ${gamesRemoved === 1 ? "a game" : "games"})`
          : "") +
        ` from GameChanger.`,
    });
    back();
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

  // Counts are GAMES only — practices sync to Practices, events are skipped.
  const gameCandidates =
    candidates?.filter((c) => gcEventKind(c.event) === "game") ?? [];
  const newCount = gameCandidates.filter((c) => !c.isExisting).length;
  const dupCount = gameCandidates.filter((c) => c.isExisting).length;
  const practiceCount =
    candidates?.filter((c) => gcEventKind(c.event) === "practice").length ?? 0;
  const skippedCount =
    candidates?.filter((c) => gcEventKind(c.event) === "event").length ?? 0;

  return (
    <PageShell
      eyebrow="Schedule"
      title="Import from GameChanger"
      onBack={back}
      backLabel="Back"
    >
      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-ink-3">
            Calendar feed URL
          </label>
          <p className="text-xs text-ink-3 mt-1 mb-2">
            In GameChanger: Schedule → Schedule Sync → Sync to Your Calendar,
            then copy the subscription link (starts with <code>webcal://</code>{" "}
            or <code>https://</code>).
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
              {gameCandidates.length} game
              {gameCandidates.length === 1 ? "" : "s"} · {newCount} new ·{" "}
              {dupCount} already imported
              {practiceCount > 0 &&
                ` · ${practiceCount} practice${practiceCount === 1 ? "" : "s"}`}
              {skippedCount > 0 &&
                ` · ${skippedCount} other event${skippedCount === 1 ? "" : "s"} skipped`}
            </div>
            {eventGames.remove.length > 0 && (
              <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                {eventGames.remove.length === 1
                  ? "This was imported as a game, but it's a GameChanger event, not a game. It will be taken off the schedule:"
                  : `These ${eventGames.remove.length} were imported as games, but they're GameChanger events, not games. They will be taken off the schedule:`}
                <ul className="mt-1.5 font-normal list-disc pl-4 space-y-0.5">
                  {eventGames.remove.map((g: any) => (
                    <li key={g.id}>
                      <span className="tabular-nums">{g.date}</span> ·{" "}
                      {g.opponent}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {eventGames.keep.length > 0 && (
              <div className="text-xs text-ink-3 bg-surface-2 border border-line rounded-xl p-3">
                <span className="font-bold text-ink-2">
                  {eventGames.keep.length === 1
                    ? "1 event is kept as a game"
                    : `${eventGames.keep.length} events are kept as games`}
                </span>{" "}
                because a lineup, attendance or score was entered on{" "}
                {eventGames.keep.length === 1 ? "it" : "them"}. Delete{" "}
                {eventGames.keep.length === 1 ? "it" : "them"} from the schedule
                if {eventGames.keep.length === 1 ? "it isn't" : "they aren't"} a
                game:
                <ul className="mt-1.5 list-disc pl-4 space-y-0.5">
                  {eventGames.keep.map((g: any) => (
                    <li key={g.id}>
                      <span className="tabular-nums">{g.date}</span> ·{" "}
                      {g.opponent}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {diff.prune.length > 0 && (
              <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                {diff.prune.length} practice
                {diff.prune.length === 1 ? " is" : "s are"} no longer in this
                feed and will be deleted on import:
                <ul className="mt-1.5 font-normal list-disc pl-4 space-y-0.5">
                  {diff.prune.map((p: any) => (
                    <li key={p.id} className="tabular-nums">
                      {p.date}
                      {p.location
                        ? ` · ${String(p.location).split("\n")[0]}`
                        : ""}
                      {practiceHasLoggedWork(p) && (
                        <span className="font-bold">
                          {" "}
                          — attendance / drills logged, and they go with it
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {diff.outsideWindow.length > 0 && (
              <div className="text-xs text-ink-3 bg-surface-2 border border-line rounded-xl p-3">
                <span className="font-bold text-ink-2">
                  {diff.outsideWindow.length} practice
                  {diff.outsideWindow.length === 1 ? "" : "s"} kept.
                </span>{" "}
                This feed isn't in them either, but it only publishes{" "}
                <span className="tabular-nums">{diff.firstFeedDate}</span> to{" "}
                <span className="tabular-nums">{diff.lastFeedDate}</span> — it
                says nothing either way about dates it doesn't reach, so they
                stay. Delete them from the Practices tab if they're gone for
                good.
                <ul className="mt-1.5 list-disc pl-4 space-y-0.5">
                  {diff.outsideWindow.map((p: any) => (
                    <li key={p.id} className="tabular-nums">
                      {p.date}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="border border-line rounded-xl divide-y divide-line max-h-72 overflow-y-auto">
              {candidates.map((c) => (
                <div
                  key={c.event.uid || c.event.summary}
                  className="flex items-center gap-3 p-2.5 text-sm"
                >
                  <span className="tabular-nums text-ink-3 w-24 shrink-0">
                    {c.date}
                  </span>
                  {(() => {
                    const kind = gcEventKind(c.event);
                    const badge =
                      kind === "practice"
                        ? {
                            label: "Practice",
                            cls: "bg-surface-2 border-line text-ink-2",
                          }
                        : kind === "event"
                          ? {
                              label: "Event",
                              cls: "bg-surface-2 border-line text-ink-3",
                            }
                          : c.event.isHome === false
                            ? {
                                label: "@ Away",
                                cls: "bg-amber-50 border-amber-200 text-amber-700",
                              }
                            : {
                                label: "vs Home",
                                cls: "bg-emerald-50 border-emerald-200 text-emerald-700",
                              };
                    return (
                      <>
                        <span
                          className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0 ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        <span
                          className={`flex-1 min-w-0 truncate ${
                            kind === "event"
                              ? "text-ink-3"
                              : "font-bold text-ink"
                          }`}
                        >
                          {kind === "game" ? c.event.opponent : c.event.summary}
                          {kind === "event" && (
                            <span className="text-[11px] italic">
                              {" "}
                              — not a game, skipped
                            </span>
                          )}
                        </span>
                      </>
                    );
                  })()}
                  {c.isExisting && gcEventKind(c.event) === "game" && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-ink-3 shrink-0">
                      synced
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={back}
                className="py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-xl border border-line text-ink hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={doImport}
                className="py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-xl bg-[var(--team-primary)] text-white hover:-translate-y-0.5 transition-transform"
              >
                {gameCandidates.length > 0
                  ? `Import ${gameCandidates.length} game${gameCandidates.length === 1 ? "" : "s"}`
                  : "Sync with GameChanger"}
              </button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
});
