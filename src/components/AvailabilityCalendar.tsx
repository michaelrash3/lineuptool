import React, { useEffect, useMemo, useState } from "react";
import { Icons } from "../icons";
import {
  buildMonthGrid,
  countAvailableOnDate,
  isDepartedPlayer,
  playersOutOnDate,
} from "../utils/helpers";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface AvailabilityCalendarEvent {
  id: string;
  date: string;
  type: "game" | "practice";
  title: string;
  meta?: string;
}

interface AvailabilityCalendarProps {
  players: any[];
  // Scheduled games/practices keyed by ISO yyyy-mm-dd so newly entered events
  // appear directly on the coach availability calendar.
  eventsByDate: Map<string, AvailabilityCalendarEvent[]>;
  // Minimum players needed to field a defense (team.defenseSize, 9 or 10).
  minPlayers: number;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
  onMonthChange?: (view: { year: number; month: number }) => void;
}

// Month calendar for the coach's Availability tab. Each day shows how many
// non-departed players are available; days below `minPlayers` are blocked out
// in the loss color with a ⚠. Event chips identify scheduled games/practices.
export const AvailabilityCalendar = ({
  players,
  eventsByDate,
  minPlayers,
  selectedDate,
  onSelectDate,
  onMonthChange,
}: AvailabilityCalendarProps) => {
  const now = new Date();
  const [view, setView] = useState({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth(),
  });
  const cells = useMemo(
    () => buildMonthGrid(view.year, view.month),
    [view.year, view.month],
  );
  const activeCount = useMemo(
    () => (players || []).filter((p) => !isDepartedPlayer(p)).length,
    [players],
  );
  useEffect(() => {
    onMonthChange?.(view);
  }, [onMonthChange, view]);

  const monthLabel = new Date(
    Date.UTC(view.year, view.month, 1),
  ).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const step = (delta: number) =>
    setView((v) => {
      const d = new Date(Date.UTC(v.year, v.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });

  return (
    <div className="bg-transparent border border-line rounded-2xl p-2.5 sm:p-5 lg:p-6 shadow-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-4 sm:mb-5">
        <button
          type="button"
          onClick={() => step(-1)}
          className="shrink-0 p-2 rounded-full text-ink-2 bg-surface-2 border border-line hover:text-ink hover:shadow-sm transition"
          aria-label="Previous month"
        >
          <Icons.ChevronDown className="w-4 h-4 rotate-90" />
        </button>
        <div className="text-center min-w-0">
          <span className="t-h3 block truncate">{monthLabel}</span>
          <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-ink-3">
            Availability + schedule
          </span>
        </div>
        <button
          type="button"
          onClick={() => step(1)}
          className="shrink-0 p-2 rounded-full text-ink-2 bg-surface-2 border border-line hover:text-ink hover:shadow-sm transition"
          aria-label="Next month"
        >
          <Icons.ChevronDown className="w-4 h-4 -rotate-90" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1.5 sm:mb-2">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-ink-3"
          >
            {/* First letter only on the tightest phones; full label from sm up. */}
            <span className="sm:hidden">{d.charAt(0)}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {cells.map((iso, i) => {
          if (!iso)
            return (
              <div
                key={i}
                className="min-h-[3.5rem] sm:min-h-[8rem] lg:min-h-[9rem]"
              />
            );
          const unavailablePlayers = playersOutOnDate(players, iso);
          const available = countAvailableOnDate(players, iso);
          const unavailable = unavailablePlayers.length;
          const shortBy = Math.max(0, minPlayers - available);
          const short = shortBy > 0;
          const dayEvents = eventsByDate.get(iso) || [];
          const isSelected = iso === selectedDate;
          const day = Number(iso.slice(8, 10));
          const eventTypes = new Set(dayEvents.map((event) => event.type));
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDate(iso)}
              aria-label={`${iso}: ${available} of ${activeCount} available, ${unavailable} out${short ? `, short by ${shortBy}` : ""}${dayEvents.length ? `, ${dayEvents.length} scheduled event${dayEvents.length === 1 ? "" : "s"}` : ""}`}
              className={`min-h-[3.5rem] sm:min-h-[8rem] lg:min-h-[9rem] rounded-2xl p-1.5 sm:p-3 flex flex-col items-stretch gap-1 sm:gap-2 border text-left overflow-hidden transition-all sm:hover:-translate-y-0.5 hover:shadow-card ${
                isSelected
                  ? "ring-2 ring-[var(--team-primary)] shadow-card"
                  : ""
              } ${
                short
                  ? "bg-loss-bg border-loss text-loss"
                  : "bg-transparent border-line text-ink hover:bg-surface-2"
              }`}
            >
              {/* Day number over availability. Stacks on phones so a 2-digit
                  day and the count each get the full column width instead of
                  colliding; side-by-side from sm up where there's room. */}
              <span className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-0.5 sm:gap-1">
                <span className="text-sm sm:text-lg font-black leading-none">
                  {day}
                </span>
                <span className="shrink-0 self-start text-[10px] sm:text-[11px] font-black tabular-nums leading-none inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-full bg-app border border-line">
                  {short && <Icons.Alert className="w-2.5 h-2.5" />}
                  {/* Just the available count fits a phone column; the full
                      fraction returns once there's room at sm and up. */}
                  <span className="sm:hidden">{available}</span>
                  <span className="hidden sm:inline">
                    {available}/{activeCount}
                  </span>
                </span>
              </span>
              <span className="hidden sm:grid gap-1 text-[10px] font-bold text-ink-3">
                <span>{unavailable} out</span>
                {short && (
                  <span className="inline-flex items-center gap-1 font-black text-loss">
                    <Icons.Alert className="w-3 h-3" /> Short by {shortBy}
                  </span>
                )}
                {unavailablePlayers.length > 0 && (
                  <span className="truncate normal-case tracking-normal text-ink-2">
                    Out:{" "}
                    {unavailablePlayers
                      .slice(0, 2)
                      .map((player: any) =>
                        String(player.name || "Player")
                          .split(" ")
                          .pop(),
                      )
                      .join(", ")}
                    {unavailablePlayers.length > 2
                      ? ` +${unavailablePlayers.length - 2}`
                      : ""}
                  </span>
                )}
              </span>
              <span className="mt-auto flex items-center gap-1 sm:flex-col sm:items-stretch sm:gap-1">
                {eventTypes.has("game") && (
                  <>
                    <span
                      aria-hidden="true"
                      className="sm:hidden w-2 h-2 rounded-full bg-[var(--team-primary)]"
                    />
                    <span className="hidden sm:block truncate rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white bg-[var(--team-primary)]">
                      Game
                    </span>
                  </>
                )}
                {eventTypes.has("practice") && (
                  <>
                    <span
                      aria-hidden="true"
                      className="sm:hidden w-2 h-2 rounded-full bg-win"
                    />
                    <span className="hidden sm:block truncate rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest bg-win-bg text-win border border-win/40">
                      Practice
                    </span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3 pt-3 border-t border-line text-[10px] font-bold uppercase tracking-widest text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-loss-bg border border-loss" />
          Short-handed (&lt; {minPlayers})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-white bg-[var(--team-primary)]">
            Game
          </span>
          <span className="px-1.5 py-0.5 rounded bg-win-bg text-win border border-win/40">
            Practice
          </span>
        </span>
        <span className="ml-auto normal-case tracking-normal">
          {activeCount} active players · need {minPlayers}
        </span>
      </div>
    </div>
  );
};
