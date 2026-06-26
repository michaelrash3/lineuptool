import React, { useMemo, useState } from "react";
import { Icons } from "../icons";
import {
  buildMonthGrid,
  countAvailableOnDate,
  eventWindowForDate,
  isDepartedPlayer,
} from "../utils/helpers";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface AvailabilityCalendarProps {
  players: any[];
  // Scheduled games/practices — drive the event dot AND time-aware counting
  // (a timed block only subtracts on a day whose event overlaps it).
  games?: any[];
  practices?: any[];
  // ISO yyyy-mm-dd dates that already have a scheduled game/practice.
  eventDates: Set<string>;
  // Minimum players needed to field a defense (team.defenseSize, 9 or 10).
  minPlayers: number;
  // Optional team logo for the branded watermark.
  logoUrl?: string;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
}

// Month calendar for the coach's Availability tab. Each day shows how many
// non-departed players are available; days below `minPlayers` are blocked out
// in the loss color with a ⚠. A dot marks days with a scheduled game/practice.
// Counting is time-aware — a timed unavailability only reduces the count on a
// day whose game/practice overlaps it; a no-time event counts as all-day.
export const AvailabilityCalendar = ({
  players,
  games = [],
  practices = [],
  eventDates,
  minPlayers,
  logoUrl,
  selectedDate,
  onSelectDate,
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
    <div className="bg-surface border border-line overflow-hidden">
      {/* Branded header band */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          background:
            "linear-gradient(90deg, var(--team-primary-15), transparent)",
          borderBottom: "2px solid var(--team-primary)",
        }}
      >
        <button
          type="button"
          onClick={() => step(-1)}
          className="p-2 text-ink-2 hover:bg-surface-2"
          aria-label="Previous month"
        >
          <Icons.ChevronDown className="w-5 h-5 rotate-90" />
        </button>
        <div className="flex items-center gap-2.5">
          {logoUrl && (
            <img
              src={logoUrl}
              alt=""
              aria-hidden
              className="w-7 h-7 object-contain"
            />
          )}
          <span className="text-lg font-black uppercase tracking-wide text-ink">
            {monthLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => step(1)}
          className="p-2 text-ink-2 hover:bg-surface-2"
          aria-label="Next month"
        >
          <Icons.ChevronDown className="w-5 h-5 -rotate-90" />
        </button>
      </div>

      <div className="relative p-3 sm:p-4">
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto w-1/2 max-w-[260px] opacity-[0.04] grayscale"
          />
        )}
        <div className="relative grid grid-cols-7 gap-1.5 mb-1.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="text-center text-[11px] font-black uppercase tracking-widest text-ink-3"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="relative grid grid-cols-7 gap-1.5">
          {cells.map((iso, i) => {
            if (!iso) return <div key={i} className="aspect-square" />;
            const window = eventWindowForDate(games, practices, iso);
            const available = countAvailableOnDate(players, iso, window);
            const short = available < minPlayers;
            const hasEvent = eventDates.has(iso);
            const isSelected = iso === selectedDate;
            const day = Number(iso.slice(8, 10));
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelectDate(iso)}
                aria-label={`${iso}: ${available} of ${activeCount} available${short ? ", short-handed" : ""}`}
                className={`aspect-square p-1.5 flex flex-col items-center justify-center border-2 transition-colors ${
                  isSelected
                    ? "ring-2 ring-[var(--team-primary)] ring-offset-1 ring-offset-surface"
                    : ""
                } ${
                  short
                    ? "bg-loss-bg border-loss text-loss"
                    : "bg-surface border-line text-ink hover:bg-surface-2"
                }`}
              >
                <span className="text-base font-black leading-none">{day}</span>
                <span className="mt-1 text-[11px] font-bold tabular-nums leading-none inline-flex items-center gap-0.5">
                  {short && <Icons.Alert className="w-3 h-3" />}
                  {available}
                </span>
                {hasEvent && (
                  <span
                    className="mt-1 w-2 h-2"
                    style={{ backgroundColor: "var(--team-primary)" }}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-line text-[10px] font-bold uppercase tracking-widest text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 bg-loss-bg border border-loss" />
          Short-handed (&lt; {minPlayers})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-2 h-2"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          Game / practice
        </span>
        <span className="ml-auto normal-case tracking-normal">
          {activeCount} active players · need {minPlayers}
        </span>
      </div>
    </div>
  );
};
