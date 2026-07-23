// Thin context module so screen files can import the consumer hooks
// (useToast, useTeam, useUI) without dragging in the providers — those
// stay in App.jsx where the state lives.

import { createContext, useContext, useMemo } from "react";
import type {
  ToastContextValue,
  TeamContextValue,
  UIContextValue,
  ConfirmContextValue,
} from "./types";

export const ToastContext = createContext<ToastContextValue>({
  push: () => 0,
  dismiss: () => {},
});
export const useToast = (): ToastContextValue => useContext(ToastContext);

// Team state is split across two contexts so command-only consumers don't
// re-render on every Firestore snapshot. TeamContext carries the
// snapshot-changing half (team, teams, user, role, loading…) — the name is
// kept so nullable direct reads (EmptyState's logo watermark, the public
// portals) and legacy test trees keep working unchanged. TeamActionsContext
// carries the ~90 stable command callbacks.
export const TeamContext = createContext<TeamContextValue | null>(null);
export const TeamActionsContext = createContext<TeamContextValue | null>(null);

// The historical single-object API — every screen destructures data and
// actions from one call. Merges both halves; when only TeamContext is
// provided (tests that mount a single provider with a mock carrying
// everything), it is returned as-is.
export const useTeam = (): TeamContextValue => {
  const data = useContext(TeamContext);
  const actions = useContext(TeamActionsContext);
  if (!data) throw new Error("useTeam must be used inside <TeamProvider>");
  return useMemo(
    () => (actions ? ({ ...actions, ...data } as TeamContextValue) : data),
    [data, actions],
  );
};

// Just the stable command half: consumers that only dispatch (an export
// button, a delete control) subscribe here and skip the per-snapshot
// re-render entirely. Deliberately does NOT read TeamContext as a fallback —
// that read would subscribe the consumer to the data half and defeat the
// split. renderWithProviders mounts both contexts, so tests are covered.
export const useTeamActions = (): TeamContextValue => {
  const actions = useContext(TeamActionsContext);
  if (!actions)
    throw new Error("useTeamActions must be used inside <TeamProvider>");
  return actions;
};

// Defaults fall back to the native dialogs so a tree rendered without
// <ConfirmProvider> (isolated tests, the public portal) keeps working.
export const ConfirmContext = createContext<ConfirmContextValue>({
  confirm: async (opts) =>
    typeof window !== "undefined"
      ? window.confirm([opts.title, opts.message].filter(Boolean).join("\n\n"))
      : false,
  promptText: async (opts) =>
    typeof window !== "undefined"
      ? window.prompt(opts.title, opts.defaultValue || "")
      : null,
});
export const useConfirm = (): ConfirmContextValue => useContext(ConfirmContext);

export const UIContext = createContext<UIContextValue | null>(null);
export const useUI = (): UIContextValue => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
};
