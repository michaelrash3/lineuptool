// Which guided tours this device has finished. Per-device localStorage, same
// pattern as the reminder prefs (useScheduleReminders) and the onboarding
// flag — no Firestore writes, no rules changes.

const KEY = "lineuptool.help.completedTours.v1";

export const getCompletedTours = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};

export const markTourComplete = (tourId: string): void => {
  try {
    const done = getCompletedTours();
    if (done.includes(tourId)) return;
    localStorage.setItem(KEY, JSON.stringify([...done, tourId]));
  } catch {
    // Private-mode / storage-disabled: completion just won't persist.
  }
};
