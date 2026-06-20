import { renderHook, act } from "@testing-library/react";
import React, { ReactNode } from "react";
import { TeamContext } from "../contexts";
import { makeTeam } from "../test-utils";
import {
  useScheduleReminders,
  getReminderPrefs,
  setReminderPrefs,
  notificationsSupported,
  notificationPermission,
} from "./useScheduleReminders";

const PREFS_KEY = "lineuptool.gameReminders.v1";
const NOTIFIED_KEY = "lineuptool.gameReminders.notified.v1";

// Local-calendar YYYY-MM-DD for `now`, matching the hook's own day math.
const localIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

beforeEach(() => {
  localStorage.clear();
  // jsdom has no Notification; install a controllable mock constructor.
  const NotificationMock: any = jest.fn();
  NotificationMock.permission = "granted";
  NotificationMock.requestPermission = jest.fn().mockResolvedValue("granted");
  (global as any).Notification = NotificationMock;
});

afterEach(() => {
  delete (global as any).Notification;
  jest.useRealTimers();
});

describe("reminder preferences", () => {
  it("defaults to disabled / morning_of when nothing is stored", () => {
    expect(getReminderPrefs()).toEqual({
      enabled: false,
      leadTime: "morning_of",
    });
  });

  it("round-trips through setReminderPrefs", () => {
    setReminderPrefs({ enabled: true, leadTime: "day_before" });
    expect(getReminderPrefs()).toEqual({
      enabled: true,
      leadTime: "day_before",
    });
  });

  it("coerces unknown leadTime values and survives malformed JSON", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ enabled: 1, leadTime: "weekly" }),
    );
    expect(getReminderPrefs()).toEqual({
      enabled: true,
      leadTime: "morning_of",
    });
    localStorage.setItem(PREFS_KEY, "{not json");
    expect(getReminderPrefs()).toEqual({
      enabled: false,
      leadTime: "morning_of",
    });
  });

  it("reports support + permission from the Notification API", () => {
    expect(notificationsSupported()).toBe(true);
    expect(notificationPermission()).toBe("granted");
  });
});

describe("useScheduleReminders", () => {
  const wrapperFor = (games: any[]) => {
    const value = makeTeam({ team: { games } as any });
    return ({ children }: { children: ReactNode }) => (
      <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
    );
  };

  it("fires one notification for a game today, then doesn't repeat", () => {
    setReminderPrefs({ enabled: true, leadTime: "morning_of" });
    const today = localIso(new Date());
    const wrapper = wrapperFor([
      { id: "g-today", date: today, opponent: "Rays" },
    ]);

    const { rerender } = renderHook(() => useScheduleReminders(), { wrapper });
    // The mount tick fires synchronously.
    expect((global as any).Notification).toHaveBeenCalledTimes(1);
    const [title] = (global as any).Notification.mock.calls[0];
    expect(title).toContain("Rays");

    // A re-render / re-check must not re-fire the same game-date.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    rerender();
    expect((global as any).Notification).toHaveBeenCalledTimes(1);

    // The dedupe token is persisted keyed on the game id.
    const notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}");
    expect(notified["g-today"]).toBe(today);
  });

  it("does nothing when reminders are disabled", () => {
    setReminderPrefs({ enabled: false, leadTime: "morning_of" });
    const today = localIso(new Date());
    const wrapper = wrapperFor([{ id: "g", date: today }]);
    renderHook(() => useScheduleReminders(), { wrapper });
    expect((global as any).Notification).not.toHaveBeenCalled();
  });

  it("does not fire for permission != granted", () => {
    (global as any).Notification.permission = "default";
    setReminderPrefs({ enabled: true, leadTime: "morning_of" });
    const today = localIso(new Date());
    const wrapper = wrapperFor([{ id: "g", date: today }]);
    renderHook(() => useScheduleReminders(), { wrapper });
    expect((global as any).Notification).not.toHaveBeenCalled();
  });
});
