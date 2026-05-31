// Thin context module so screen files can import the consumer hooks
// (useToast, useTeam, useUI) without dragging in the providers — those
// stay in App.jsx where the state lives.

import { createContext, useContext } from "react";
import type {
  ToastContextValue,
  TeamContextValue,
  UIContextValue,
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

export const UIContext = createContext<UIContextValue | null>(null);
export const useUI = (): UIContextValue => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
};
