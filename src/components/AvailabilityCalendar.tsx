import React, { useMemo, useState } from "react";
import { Icons } from "../icons";
import {
  buildMonthGrid,
  countAvailableOnDate,
  isDepartedPlayer,
} from "../utils/helpers";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface AvailabilityCalendarProps {
  players: any[];
  // ISO yyyy-mm-dd dates that already have a scheduled game/practice.
  eventDates: Set<string>;
  // Minimum players needed to field a defense (team.defenseSize, 9 or 10).
  minPlayers: number;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
}

// Month calendar for the coach's Availability tab. Each day shows how many
// non-departed players are available; days below `minPlayers` are blocked out
// in the loss color with a ⚠. A dot marks days with a scheduled game/practice.
export const AvailabilityCalendar = ({
  players,
  eventDates,
  minPlayers,
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
    <div className="bg-surface border border-line rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => step(-1)}
          className="p-2 rounded-md text-ink-2 hover:bg-surface-2"
          aria-label="Previous month"
        >
          <Icons.ChevronDown className="w-4 h-4 rotate-90" />
        </button>
        <span className="t-h3">{monthLabel}</span>
        <button
          type="button"
          onClick={() => step(1)}
          className="p-2 rounded-md text-ink-2 hover:bg-surface-2"
          aria-label="Next month"
        >
          <Icons.ChevronDown className="w-4 h-4 -rotate-90" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-black uppercase tracking-widest text-ink-3"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} className="aspect-square" />;
          const available = countAvailableOnDate(players, iso);
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
              className={`aspect-square rounded-md p-1 flex flex-col items-center justify-center border transition-colors ${
                isSelected ? "ring-2 ring-[var(--team-primary)]" : ""
              } ${
                short
                  ? "bg-loss-bg border-loss text-loss"
                  : "bg-surface border-line text-ink hover:bg-surface-2"
              }`}
            >
              <span className="text-sm font-black leading-none">{day}</span>
              <span className="mt-0.5 text-[10px] font-bold tabular-nums leading-none inline-flex items-center gap-0.5">
                {short && <Icons.Alert className="w-2.5 h-2.5" />}
                {available}
              </span>
              {hasEvent && (
                <span
                  className="mt-0.5 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "var(--team-primary)" }}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-line text-[10px] font-bold uppercase tracking-widest text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-loss-bg border border-loss" />
          Short-handed (&lt; {minPlayers})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
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
