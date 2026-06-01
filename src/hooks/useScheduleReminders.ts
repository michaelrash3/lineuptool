// Client-side game-day reminders.
//
// The app has no backend scheduler (Spark plan, no Cloud Functions), so we
// can't push notifications when the app is fully closed. Instead, while a
// coach has the app open we poll the schedule on a timer and fire a local
// browser notification when a game enters the reminder window. Preferences
// and the "already notified" set live in localStorage — per device, like the
// onboarding flag — so there are no Firestore writes and no rules changes.
//
// The pure windowing logic lives in `gamesDueForReminder` (utils/helpers).
// This module owns permission, dedupe, and the Notification call.

import { useEffect, useRef } from "react";
import { useTeam } from "../contexts";
import {
  gamesDueForReminder,
  DueGameReminder,
  ReminderLeadTime,
} from "../utils/helpers";

const PREFS_KEY = "lineuptool.gameReminders.v1";
const NOTIFIED_KEY = "lineuptool.gameReminders.notified.v1";
// While the tab is open we re-check this often; coaches don't need to the
// minute, and a tighter loop just burns battery on mobile.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface ReminderPrefs {
  enabled: boolean;
  leadTime: ReminderLeadTime;
}

const DEFAULT_PREFS: ReminderPrefs = { enabled: false, leadTime: "morning_of" };

export const notificationsSupported = (): boolean =>
  typeof window !== "undefined" && "Notification" in window;

export const notificationPermission = (): NotificationPermission =>
  notificationsSupported() ? Notification.permission : "denied";

export const getReminderPrefs = (): ReminderPrefs => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      leadTime: parsed.leadTime === "day_before" ? "day_before" : "morning_of",
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

export const setReminderPrefs = (prefs: ReminderPrefs): void => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private-mode / storage-disabled: reminders just won't persist.
  }
};

export const requestNotificationPermission =
  async (): Promise<NotificationPermission> => {
    if (!notificationsSupported()) return "denied";
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  };

// Map of game id -> the game date we last notified for. Keying on the date
// means a reminder fires once per game-date: if a game is rescheduled the
// token changes and it re-arms, but it never double-fires for the same day.
type NotifiedMap = Record<string, string>;

const getNotified = (): NotifiedMap => {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const setNotified = (map: NotifiedMap): void => {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
  } catch {
    // ignore — see setReminderPrefs note.
  }
};

const todayIsoLocal = (now: Date): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const fireReminder = (reminder: DueGameReminder): void => {
  const title =
    reminder.daysUntil === 0
      ? `Game today vs ${reminder.opponent}`
      : `Game tomorrow vs ${reminder.opponent}`;
  const options: NotificationOptions & { data?: unknown } = {
    body: reminder.displayDate,
    tag: `game-${reminder.id}`,
    data: { gameId: reminder.id },
  };
  try {
    // When an active service worker controls the page, route through it so the
    // notificationclick handler can focus/deep-link the app and the notice
    // survives a backgrounded tab. Otherwise (e.g. dev, no SW) fall back to a
    // plain page-scoped Notification.
    if (
      typeof navigator !== "undefined" &&
      navigator.serviceWorker &&
      navigator.serviceWorker.controller
    ) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, options))
        .catch(() => {});
    } else {
      new Notification(title, options);
    }
  } catch {
    // A failed notification should never break the app.
  }
};

// Mount once (in MainShell). Runs the polling loop while the app is open and
// reads preferences fresh on each tick, so toggling reminders in Settings
// takes effect without a remount.
export const useScheduleReminders = (): void => {
  const teamCtx = useTeam();
  const teamRef = useRef(teamCtx);
  teamRef.current = teamCtx;

  useEffect(() => {
    if (!notificationsSupported()) return;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const prefs = getReminderPrefs();
      if (!prefs.enabled || notificationPermission() !== "granted") return;

      const team = teamRef.current && (teamRef.current as any).team;
      const games = (team && team.games) || [];
      const now = new Date();
      const due = gamesDueForReminder(games, prefs.leadTime, now);

      const notified = getNotified();
      let changed = false;

      // Drop tokens for dates that have passed so the map can't grow forever.
      const todayIso = todayIsoLocal(now);
      for (const id of Object.keys(notified)) {
        if (notified[id] < todayIso) {
          delete notified[id];
          changed = true;
        }
      }

      for (const reminder of due) {
        if (notified[reminder.id] === reminder.date) continue;
        fireReminder(reminder);
        notified[reminder.id] = reminder.date;
        changed = true;
      }

      if (changed) setNotified(notified);
    };

    tick();
    const interval = window.setInterval(tick, CHECK_INTERVAL_MS);
    // A returning coach (refocus) gets an immediate re-check.
    window.addEventListener("focus", tick);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
    };
  }, []);
};
