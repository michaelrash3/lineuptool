import React, { memo, useId, useState } from "react";
import { Icons } from "../../icons";
import { useConfirm, useTeam, useToast } from "../../contexts";
import type { Game } from "../../types";
import { isGameFinalized } from "../../utils/helpers";
import { downloadScheduleIcs } from "../../utils/ics";
import { copyTextToClipboard } from "../../utils/clipboard";
import {
  CALENDAR_FEED_TOKEN_RE,
  calendarFeedUrl,
  calendarFeedWebcalUrl,
} from "../../utils/calendarFeed";

const BUTTON =
  "w-full sm:w-auto py-2.5 px-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider rounded-xl shadow-sm whitespace-nowrap bg-surface border border-line-strong text-ink hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

// The schedule on the coach's own calendar, at the foot of the game list
// (the header is already four buttons deep on a phone). In-app reminders only
// fire while the app is open; a calendar entry alerts on its own.
//
// Two ways in. The download is a one-time copy. The subscription link is a
// URL a calendar app keeps re-checking, so a rescheduled game moves by itself
// — the head coach creates it, any coach can copy it, and turning it off
// stops it for everyone following it. See src/utils/calendarFeed.ts.
export const ScheduleCalendarCard = memo(({ games }: { games: Game[] }) => {
  const {
    team,
    activeTeamId,
    currentRole,
    enableCalendarFeed,
    disableCalendarFeed,
  } = useTeam();
  const toast = useToast();
  const { confirm } = useConfirm();
  const linkFieldId = useId();
  const [turningOff, setTurningOff] = useState(false);

  const stored = String(team?.calendarFeedToken || "");
  const token = CALENDAR_FEED_TOKEN_RE.test(stored) ? stored : "";
  const hasUpcoming = games.some(
    (g) => !isGameFinalized(g) && (g.status || "scheduled") !== "postponed",
  );
  // Still shown with nothing upcoming while a link exists, so it can always
  // be found and turned off.
  if (!hasUpcoming && !token) return null;

  const isHead = currentRole === "head";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const linked = !!token && !!activeTeamId;
  const url = linked ? calendarFeedUrl(activeTeamId, token, origin) : "";

  const turnOff = async () => {
    const ok = await confirm({
      title: "Turn off the calendar link?",
      message:
        "It stops working for everyone who subscribed, and their calendars stop updating. A new link you create later will be a different one.",
      confirmLabel: "Turn off",
      danger: true,
    });
    if (!ok) return;
    setTurningOff(true);
    const done = await disableCalendarFeed();
    setTurningOff(false);
    if (done)
      toast.push({ kind: "success", title: "Calendar link turned off" });
  };

  return (
    // mb-16 below lg: this is the last thing on the page, and without room to
    // scroll past it the floating Help button sits on its bottom-right button.
    <div className="mt-6 mb-16 lg:mb-0 border border-line rounded-xl bg-surface p-4 print:hidden divide-y divide-line">
      {hasUpcoming && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-xs font-black uppercase tracking-widest text-ink">
              Add games to your calendar
            </p>
            <p className="text-[11px] font-medium text-ink-3 mt-1">
              Downloads every upcoming game as a calendar file, so your phone
              can remind you even when this app is closed. A game with a start
              time gets a two-hour slot; one without is an all-day entry.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              downloadScheduleIcs(games, team?.name);
              toast.push({
                kind: "success",
                title: "Calendar file downloaded",
                message:
                  "Open it to add the games. Download again after the schedule changes.",
              });
            }}
            className={BUTTON}
          >
            <Icons.Calendar className="w-4 h-4" /> Download calendar
          </button>
        </div>
      )}

      <div className={hasUpcoming ? "pt-4" : ""}>
        <p className="text-xs font-black uppercase tracking-widest text-ink">
          Calendar link that stays current
        </p>
        {linked ? (
          <>
            <p className="text-[11px] font-medium text-ink-3 mt-1">
              A calendar that subscribes to this link follows the schedule: a
              game you move or add shows up on its own, usually within a few
              hours. Anyone with the link can see opponents, times and fields —
              nothing about players.
            </p>
            <label
              htmlFor={linkFieldId}
              className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mt-3 mb-1.5"
            >
              Subscription link
            </label>
            <input
              id={linkFieldId}
              type="text"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full p-2.5 bg-app border border-line rounded-lg text-[11px] font-mono text-ink outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
            />
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyTextToClipboard(url);
                  toast.push(
                    ok
                      ? { kind: "success", title: "Link copied" }
                      : {
                          kind: "error",
                          title: "Couldn't copy",
                          message: "Select the link text and copy it manually.",
                        },
                  );
                }}
                className={BUTTON}
              >
                <Icons.Clipboard className="w-4 h-4" /> Copy link
              </button>
              {/* webcal:// is what makes a phone offer "Subscribe" instead of
                  downloading the file once. */}
              <a
                href={calendarFeedWebcalUrl(activeTeamId, token, origin)}
                className={BUTTON}
              >
                <Icons.Calendar className="w-4 h-4" /> Subscribe on this device
              </a>
              {isHead && (
                <button
                  type="button"
                  onClick={turnOff}
                  disabled={turningOff}
                  className={`${BUTTON} sm:ml-auto text-loss`}
                >
                  {turningOff ? "Turning off…" : "Turn off link"}
                </button>
              )}
            </div>
          </>
        ) : isHead ? (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
            <p className="min-w-0 flex-1 basis-64 text-[11px] font-medium text-ink-3">
              Create one link for coaches and families to subscribe to. Their
              calendars then follow the schedule on their own — a game you move
              or add shows up without anyone downloading again. Anyone with the
              link can see opponents, times and fields — nothing about players —
              and you can turn it off at any time.
            </p>
            <button
              type="button"
              onClick={() => {
                enableCalendarFeed();
                toast.push({
                  kind: "success",
                  title: "Calendar link created",
                  message: "Copy it, or subscribe on this device.",
                });
              }}
              className={BUTTON}
            >
              <Icons.Link className="w-4 h-4" /> Create calendar link
            </button>
          </div>
        ) : (
          <p className="text-[11px] font-medium text-ink-3 mt-1">
            Your head coach can create a link that calendars subscribe to, so a
            rescheduled game updates on its own.
          </p>
        )}
      </div>
    </div>
  );
});
