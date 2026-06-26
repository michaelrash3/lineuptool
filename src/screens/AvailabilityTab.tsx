import React, { memo, useEffect, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useToast } from "../contexts";
import { QRCodeImg } from "../components/QRCodeImg";
import {
  AvailabilityCalendar,
  type AvailabilityCalendarEvent,
} from "../components/AvailabilityCalendar";
import {
  buildMonthGrid,
  countAvailableOnDate,
  isDepartedPlayer,
  playersOutOnDate,
} from "../utils/helpers";

const formatShort = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso;
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  ).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

// Collapsible share card for the public Availability form. Reuses the team's
// standing share id on the /availability-portal/ path.
const ShareCard = memo(({ team }: any) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const shareId = team?.tryoutShareId;
  const url =
    shareId && typeof window !== "undefined"
      ? `${window.location.origin}/availability-portal/${shareId}`
      : null;
  return (
    <div className="bg-transparent border border-line rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors"
        aria-expanded={open}
      >
        <div
          className="p-2 rounded-full shrink-0"
          style={{ backgroundColor: "var(--team-primary-15)" }}
        >
          <Icons.Calendar
            className="w-4 h-4"
            style={{ color: "var(--team-primary)" }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="t-button text-ink">Availability Form</div>
          <p className="text-[11px] text-ink-3 font-medium">
            Send to parents to collect the dates their kid is unavailable.
          </p>
        </div>
        <Icons.ChevronDown
          className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line space-y-3">
          {url ? (
            <>
              <code className="block text-[11px] text-ink break-all font-mono bg-app border border-line rounded-md p-2">
                {url}
              </code>
              <div className="flex items-start gap-3 flex-wrap">
                <QRCodeImg
                  value={url}
                  size={120}
                  downloadable
                  filename={`${team?.name || "team"}-availability-qr`}
                />
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(url);
                        toast.push({ kind: "success", title: "Link copied" });
                      }
                    }}
                    className="self-start px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
                  >
                    Copy
                  </button>
                  <p className="text-[10px] font-medium text-ink-3 leading-snug">
                    A unique name + birthdate match auto-fills that player's
                    absences; anything unclear waits in the match queue below.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-ink-3 font-medium leading-snug">
              Generate your team's share link first in{" "}
              <strong className="text-ink">Settings → Tryouts</strong>. The
              Availability form reuses that same link.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

export const AvailabilityTab = memo(() => {
  const {
    team,
    currentRole,
    applyAvailabilityToPlayer,
    deleteAvailabilitySubmission,
    autoApplyAvailability,
  } = useTeam();
  const isHead = currentRole !== "assistant";

  const players = useMemo(
    () => (Array.isArray(team?.players) ? team.players : []),
    [team?.players],
  );
  const activePlayers = useMemo(
    () => players.filter((p: any) => !isDepartedPlayer(p)),
    [players],
  );
  const defenseSize = (team as any)?.defenseSize;
  const minPlayers = useMemo(() => {
    const n = parseInt(defenseSize, 10);
    return Number.isFinite(n) && n > 0 ? n : 9;
  }, [defenseSize]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, AvailabilityCalendarEvent[]>();
    const add = (date: any, event: AvailabilityCalendarEvent) => {
      const iso = String(date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      map.set(iso, [...(map.get(iso) || []), event]);
    };
    for (const g of team?.games || []) {
      add(g?.date, {
        id: String(g?.id || `game-${g?.date}-${g?.opponent || ""}`),
        date: String(g?.date || "").slice(0, 10),
        type: "game",
        title: `${g?.isScrimmage ? "Scrimmage" : "Game"}${g?.opponent ? ` vs ${g.opponent}` : ""}`,
        meta: g?.status === "final" ? "Final" : g?.status || "Scheduled",
      });
    }
    for (const p of team?.practices || []) {
      add(p?.date, {
        id: String(p?.id || `practice-${p?.date}`),
        date: String(p?.date || "").slice(0, 10),
        type: "practice",
        title: p?.location ? `Practice · ${p.location}` : "Practice",
        meta: p?.environment || p?.status || "Scheduled",
      });
    }
    return map;
  }, [team?.games, team?.practices]);

  const submissions = useMemo(
    () => team?.availabilitySubmissions || [],
    [team?.availabilitySubmissions],
  );
  const pending = useMemo(
    () => submissions.filter((s: any) => !s.appliedToPlayerId),
    [submissions],
  );

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const now = new Date();
  const [visibleMonth, setVisibleMonth] = useState({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth(),
  });
  const [matchById, setMatchById] = useState<Record<string, string>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Auto-apply confident (unique name+DOB) matches whenever submissions change.
  // Idempotent: applied entries get appliedToPlayerId so re-runs are no-ops.
  useEffect(() => {
    if (isHead) autoApplyAvailability?.();
  }, [isHead, autoApplyAvailability]);

  const guessMatch = (sub: any): string => {
    const norm = (v: any) =>
      String(v ?? "")
        .trim()
        .toLowerCase();
    const dob = String(sub.dob || "").trim();
    if (dob) {
      const byDob = activePlayers.filter(
        (p: any) => String(p.dob || "").trim() === dob,
      );
      if (byDob.length === 1) return byDob[0].id;
    }
    const full = `${sub.firstName || ""} ${sub.lastName || ""}`
      .trim()
      .toLowerCase();
    const hit = activePlayers.find((p: any) => norm(p.name) === full);
    return hit?.id || "";
  };

  const outOnSelected = useMemo(
    () => (selectedDate ? playersOutOnDate(players, selectedDate) : []),
    [players, selectedDate],
  );
  const selectedEvents = useMemo(
    () => (selectedDate ? eventsByDate.get(selectedDate) || [] : []),
    [eventsByDate, selectedDate],
  );

  const selectedAvailable = selectedDate
    ? activePlayers.length - outOnSelected.length
    : 0;
  const selectedShortBy = Math.max(0, minPlayers - selectedAvailable);

  const monthInsights = useMemo(() => {
    const days = buildMonthGrid(visibleMonth.year, visibleMonth.month).filter(
      Boolean,
    ) as string[];
    let shortHandedDays = 0;
    let gameConflicts = 0;
    let practiceConflicts = 0;
    let worstDay: { iso: string; available: number } | null = null;

    for (const iso of days) {
      const available = countAvailableOnDate(players, iso);
      const out = playersOutOnDate(players, iso).length;
      const events = eventsByDate.get(iso) || [];
      if (available < minPlayers) shortHandedDays += 1;
      if (out > 0 && events.some((event) => event.type === "game")) {
        gameConflicts += 1;
      }
      if (out > 0 && events.some((event) => event.type === "practice")) {
        practiceConflicts += 1;
      }
      if (!worstDay || available < worstDay.available) {
        worstDay = { iso, available };
      }
    }

    return { shortHandedDays, gameConflicts, practiceConflicts, worstDay };
  }, [eventsByDate, minPlayers, players, visibleMonth]);

  const selectedDateLabel = selectedDate
    ? new Date(
        Date.UTC(
          Number(selectedDate.slice(0, 4)),
          Number(selectedDate.slice(5, 7)) - 1,
          Number(selectedDate.slice(8, 10)),
        ),
      ).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

  if (!isHead) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-ink-3 italic">
        Availability is only visible to the head coach.
      </div>
    );
  }

  const submittedCount = activePlayers.filter(
    (p: any) => p.availabilitySubmittedAt,
  ).length;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="border-b border-line pb-5">
        <h2 className="t-h2 flex items-center gap-3">
          <Icons.Calendar className="w-6 h-6" /> Availability
        </h2>
        <p className="text-xs text-ink-2 font-medium mt-1.5">
          Days are blocked out when fewer than {minPlayers} players are
          available (your team's defense size). Parents submit unavailable dates
          on the Availability form; confident matches auto-apply.
        </p>
      </div>

      <ShareCard team={team} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:items-start space-y-6 lg:space-y-0">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="bg-transparent border border-line rounded-xl p-3 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">
                Short-handed days
              </div>
              <div className="mt-1 text-2xl font-black text-ink">
                {monthInsights.shortHandedDays}
              </div>
            </div>
            <div className="bg-transparent border border-line rounded-xl p-3 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">
                Game conflicts
              </div>
              <div className="mt-1 text-2xl font-black text-ink">
                {monthInsights.gameConflicts}
              </div>
            </div>
            <div className="bg-transparent border border-line rounded-xl p-3 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">
                Practice conflicts
              </div>
              <div className="mt-1 text-2xl font-black text-ink">
                {monthInsights.practiceConflicts}
              </div>
            </div>
            <div className="bg-transparent border border-line rounded-xl p-3 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">
                Worst availability
              </div>
              <div className="mt-1 text-sm font-black text-ink truncate">
                {monthInsights.worstDay
                  ? `${formatShort(monthInsights.worstDay.iso)} · ${monthInsights.worstDay.available}/${activePlayers.length}`
                  : "No dates"}
              </div>
            </div>
          </div>

          <AvailabilityCalendar
            players={players}
            eventsByDate={eventsByDate}
            minPlayers={minPlayers}
            selectedDate={selectedDate}
            onMonthChange={setVisibleMonth}
            onSelectDate={(iso) =>
              setSelectedDate((prev) => (prev === iso ? null : iso))
            }
          />
        </div>

        <aside className="bg-transparent border border-line rounded-2xl p-4 shadow-card lg:sticky lg:top-6">
          {!selectedDate ? (
            <div className="py-10 text-center">
              <Icons.Calendar className="w-8 h-8 mx-auto text-ink-3 mb-3" />
              <h3 className="t-h3">Select a date</h3>
              <p className="text-sm font-medium text-ink-3 mt-1">
                Select a date to see who is out.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="t-h3">{selectedDateLabel}</h3>
                  <div className="text-sm font-bold text-ink mt-1">
                    {selectedAvailable} of {activePlayers.length} available
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="p-1 text-ink-3 hover:text-ink"
                  aria-label="Close"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </div>

              {selectedShortBy > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-loss bg-loss-bg p-3 text-loss">
                  <Icons.Alert className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="text-sm font-black">
                    Short by {selectedShortBy} for a {minPlayers}-player
                    defense.
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-2">
                  Scheduled
                </div>
                {selectedEvents.length === 0 ? (
                  <p className="t-meta text-ink-3">No games or practices.</p>
                ) : (
                  <div className="grid gap-2">
                    {selectedEvents.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-lg border border-line bg-app px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${
                              event.type === "game"
                                ? "text-white bg-[var(--team-primary)]"
                                : "bg-win-bg text-win border border-win/40"
                            }`}
                          >
                            {event.type}
                          </span>
                          {event.meta && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">
                              {event.meta}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-sm font-bold text-ink">
                          {event.title}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-2">
                  Unavailable players
                </div>
                {outOnSelected.length === 0 ? (
                  <p className="t-meta text-ink-3">Everyone is available.</p>
                ) : (
                  <div className="grid gap-1.5">
                    {outOnSelected.map((player: any) => (
                      <span
                        key={player.id}
                        className="px-2 py-1.5 rounded-md text-sm font-bold bg-loss-bg text-loss border border-loss"
                      >
                        {player.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Completed parent forms — full submission details for coach review. */}
      <div className="space-y-2">
        <h3 className="t-h3 flex items-center gap-2">
          <Icons.Clipboard className="w-4 h-4" /> Submitted forms
          <span className="text-[11px] font-bold text-ink-3">
            {submissions.length}
          </span>
        </h3>
        {submissions.length === 0 ? (
          <p className="t-meta text-ink-3 bg-transparent border border-line rounded-xl p-4">
            No parent Availability forms have been submitted yet.
          </p>
        ) : (
          <div className="grid gap-2">
            {[...submissions]
              .sort(
                (a: any, b: any) =>
                  new Date(b.submittedAt || 0).getTime() -
                  new Date(a.submittedAt || 0).getTime(),
              )
              .map((sub: any) => {
                const matched = activePlayers.find(
                  (p: any) => p.id === sub.appliedToPlayerId,
                );
                return (
                  <div
                    key={sub.id}
                    className="bg-transparent border border-line rounded-xl p-3 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-black uppercase tracking-tight text-ink">
                          {sub.firstName} {sub.lastName}
                        </div>
                        <div className="text-[11px] font-medium text-ink-3">
                          {sub.parentName || "Parent/guardian not listed"}
                          {sub.email ? ` · ${sub.email}` : ""}
                          {sub.phone ? ` · ${sub.phone}` : ""}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${
                          sub.appliedToPlayerId
                            ? "bg-win-bg text-win border border-win/40"
                            : "bg-loss-bg text-loss border border-loss"
                        }`}
                      >
                        {sub.appliedToPlayerId
                          ? `Applied${matched?.name ? ` to ${matched.name}` : ""}`
                          : "Needs match"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(sub.dates || []).length === 0 ? (
                        <span className="text-[11px] font-bold text-ink-3">
                          No unavailable dates selected.
                        </span>
                      ) : (
                        (sub.dates || []).map((date: string) => (
                          <button
                            key={`${sub.id}-${date}`}
                            type="button"
                            onClick={() => setSelectedDate(date)}
                            className="px-2 py-1 rounded-md text-[11px] font-bold bg-app text-ink border border-line hover:border-[var(--team-primary)]"
                          >
                            {formatShort(date)}
                          </button>
                        ))
                      )}
                    </div>
                    <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-ink-3">
                      Submitted{" "}
                      {formatShort(String(sub.submittedAt || "").slice(0, 10))}
                      {sub.dob ? ` · DOB ${sub.dob}` : ""}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Match queue — submissions that couldn't auto-match. */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="t-h3 flex items-center gap-2">
            <Icons.Alert className="w-4 h-4" /> Needs matching ({pending.length}
            )
          </h3>
          {pending.map((sub: any) => {
            const armed = pendingDeleteId === sub.id;
            const matchId =
              sub.id in matchById ? matchById[sub.id] : guessMatch(sub);
            return (
              <div
                key={sub.id}
                className="bg-transparent border border-line rounded-xl p-3 flex flex-col gap-2 sm:flex-row sm:items-start shadow-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-black uppercase tracking-tight text-ink">
                    {sub.firstName} {sub.lastName}
                    {sub.dob && (
                      <span className="ml-2 text-[10px] font-bold text-ink-3">
                        DOB {sub.dob}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-3 font-medium mt-0.5">
                    {(sub.dates || []).length} date
                    {(sub.dates || []).length === 1 ? "" : "s"}:{" "}
                    {(sub.dates || []).slice(0, 6).map(formatShort).join(", ")}
                    {(sub.dates || []).length > 6 ? "…" : ""}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0 sm:w-44">
                  <select
                    value={matchId}
                    onChange={(e) =>
                      setMatchById((m) => ({ ...m, [sub.id]: e.target.value }))
                    }
                    className="px-2 py-1.5 text-[11px] font-bold bg-surface border border-line rounded-md outline-none focus:ring-2"
                    style={
                      {
                        "--tw-ring-color": "var(--team-primary)",
                      } as React.CSSProperties
                    }
                    aria-label="Match to roster player"
                  >
                    <option value="">Match to player…</option>
                    {activePlayers.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!matchId}
                    onClick={() => applyAvailabilityToPlayer?.(sub.id, matchId)}
                    className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white rounded-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ backgroundColor: "var(--team-primary)" }}
                  >
                    Apply Dates
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (armed) {
                        deleteAvailabilitySubmission?.(sub.id);
                        setPendingDeleteId(null);
                      } else {
                        setPendingDeleteId(sub.id);
                      }
                    }}
                    onBlur={() => {
                      if (armed) setPendingDeleteId(null);
                    }}
                    className={`flex items-center justify-center gap-1 rounded-md transition-colors ${
                      armed
                        ? "px-2 py-1 bg-loss-bg text-loss ring-2 ring-loss"
                        : "px-2 py-1 text-ink-3 hover:text-loss hover:bg-loss-bg border border-line"
                    }`}
                    title={armed ? "Tap again to delete" : "Delete"}
                  >
                    <Icons.Trash className="w-3.5 h-3.5" />
                    {armed && (
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        Confirm
                      </span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Completion tracker — who has / hasn't submitted. */}
      <div className="space-y-2">
        <h3 className="t-h3 flex items-center gap-2">
          <Icons.Clipboard className="w-4 h-4" /> Form completion
          <span className="text-[11px] font-bold text-ink-3">
            {submittedCount} / {activePlayers.length}
          </span>
        </h3>
        {activePlayers.length === 0 ? (
          <p className="t-meta text-ink-3">No active players on the roster.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {[...activePlayers]
              .sort((a: any, b: any) => {
                const aDone = a.availabilitySubmittedAt ? 1 : 0;
                const bDone = b.availabilitySubmittedAt ? 1 : 0;
                if (aDone !== bDone) return aDone - bDone; // missing first
                return String(a.name || "").localeCompare(String(b.name || ""));
              })
              .map((p: any) => {
                const done = !!p.availabilitySubmittedAt;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 bg-transparent border border-line rounded-lg px-3 py-2"
                  >
                    <span
                      className={`w-5 h-5 rounded-full grid place-items-center shrink-0 ${
                        done ? "bg-win-bg text-win" : "bg-loss-bg text-loss"
                      }`}
                    >
                      {done ? (
                        <Icons.Check className="w-3 h-3" />
                      ) : (
                        <Icons.X className="w-3 h-3" />
                      )}
                    </span>
                    <span className="text-sm font-bold text-ink flex-1 min-w-0 truncate">
                      {p.name}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">
                      {done
                        ? `Submitted ${formatShort(String(p.availabilitySubmittedAt).slice(0, 10))}`
                        : "Not yet"}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
});
