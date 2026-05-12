// Thin context module so screen files can import the consumer hooks
// (useToast, useTeam, useUI) without dragging in the providers — those
// stay in App.jsx where the state lives.

import { createContext, useContext } from "react";

export const ToastContext = createContext({
  push: () => {},
  dismiss: () => {},
});
export const useToast = () => useContext(ToastContext);

export const TeamContext = createContext(null);
export const useTeam = () => {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used inside <TeamProvider>");
  return ctx;
};

export const UIContext = createContext(null);
export const useUI = () => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
};
