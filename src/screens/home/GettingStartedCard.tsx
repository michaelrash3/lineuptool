import React, { useState } from "react";
import { Icons } from "../../icons";
import { rosterOnly } from "../../utils/subPlayers";

// A new head coach's setup path, kept on Home until it's done. It replaces
// the 15-step tour that used to open by itself on first sign-in (and closed
// for good the moment its first button was tapped) — the full orientation is
// still in Help. Disappears once players, a game and a lineup exist, or when
// the coach dismisses it (remembered per team on this device).
const dismissKey = (teamId: string) =>
  `bench.gettingStarted.dismissed.${teamId}`;
const readDismissed = (teamId: string) => {
  try {
    return window.localStorage.getItem(dismissKey(teamId)) === "1";
  } catch {
    return false;
  }
};

export const GettingStartedCard = ({
  team,
  teamId,
  isHead,
  onAddPlayers,
  onAddGame,
  onOpenSchedule,
  onInviteCoaches,
}: {
  team: any;
  teamId: string | null | undefined;
  isHead: boolean;
  onAddPlayers: () => void;
  onAddGame: () => void;
  onOpenSchedule: () => void;
  onInviteCoaches: () => void;
}) => {
  const [dismissed, setDismissed] = useState(() =>
    teamId ? readDismissed(teamId) : false,
  );
  if (!isHead || !teamId || dismissed) return null;

  const players = rosterOnly(team?.players || []);
  const games = team?.games || [];
  const steps = [
    {
      id: "players",
      title: "Add your players",
      hint: "Paste your roster as a list, or add them one by one.",
      done: players.length > 0,
      cta: "Add players",
      run: onAddPlayers,
    },
    {
      id: "game",
      title: "Add a game",
      hint: "Date and opponent are enough to start.",
      done: games.length > 0,
      cta: "Add a game",
      run: onAddGame,
    },
    {
      id: "lineup",
      title: "Build your first lineup",
      hint: "Open the game and tap Build — it saves itself.",
      done: games.some((g: any) => Array.isArray(g?.lineup) && g.lineup.length),
      cta: "Open the schedule",
      run: onOpenSchedule,
    },
    {
      id: "coaches",
      title: "Invite your coaches",
      hint: "Share the team code from Settings.",
      done: Array.isArray(team?.members) && team.members.length > 1,
      cta: "Get the team code",
      run: onInviteCoaches,
    },
  ];
  // The three steps every team needs; inviting coaches is optional.
  if (steps.slice(0, 3).every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(teamId), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <section aria-label="Getting started" className="cc-card p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="t-card-title">Getting started</h2>
          <p className="t-body text-xs text-ink-3 mt-0.5">
            {doneCount} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2"
          aria-label="Hide getting started"
        >
          <Icons.X className="w-4 h-4" />
        </button>
      </div>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 p-3 rounded-xl border border-line bg-surface"
          >
            <span
              className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                s.done ? "bg-win text-white" : "border-2 border-line"
              }`}
              aria-hidden="true"
            >
              {s.done && <Icons.Check className="w-3.5 h-3.5" />}
            </span>
            <div className="flex-1 min-w-0">
              <div
                className={`text-sm font-black ${s.done ? "text-ink-3 line-through" : "text-ink"}`}
              >
                {s.title}
                <span className="sr-only">{s.done ? " (done)" : ""}</span>
              </div>
              {!s.done && (
                <div className="text-xs text-ink-3 font-medium">{s.hint}</div>
              )}
            </div>
            {!s.done && (
              <button
                type="button"
                onClick={s.run}
                className="shrink-0 min-h-[44px] px-3 rounded-xl text-xs font-black uppercase tracking-wider"
                style={{
                  backgroundColor: "var(--team-primary)",
                  color: "var(--team-on-primary)",
                }}
              >
                {s.cta}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};
