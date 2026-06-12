// Thin context module so screen files can import the consumer hooks
// (useToast, useTeam, useUI) without dragging in the providers — those
// stay in App.jsx where the state lives.

import { createContext, useContext } from "react";
import type {
  ToastContextValue,
  TeamContextValue,
  UIContextValue,
  ConfirmContextValue,
} from "./types";

export const ToastContext = createContext<ToastContextValue>({
  push: () => {},
  dismiss: () => {},
});
export const useToast = (): ToastContextValue => useContext(ToastContext);

export const TeamContext = createContext<TeamContextValue | null>(null);
export const useTeam = (): TeamContextValue => {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used inside <TeamProvider>");
  return ctx;
};

// Defaults fall back to the native dialogs so a tree rendered without
// <ConfirmProvider> (isolated tests, the public portal) keeps working.
export const ConfirmContext = createContext<ConfirmContextValue>({
  confirm: async (opts) =>
    typeof window !== "undefined"
      ? window.confirm(
          [opts.title, opts.message].filter(Boolean).join("\n\n")
        )
      : false,
  promptText: async (opts) =>
    typeof window !== "undefined"
      ? window.prompt(opts.title, opts.defaultValue || "")
      : null,
});
export const useConfirm = (): ConfirmContextValue =>
  useContext(ConfirmContext);

export const UIContext = createContext<UIContextValue | null>(null);
export const useUI = (): UIContextValue => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
};
