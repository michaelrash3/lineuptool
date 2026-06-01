// Test helpers for rendering components that consume the app's contexts
// (Toast / Team / UI). Screens import the consumer hooks from contexts.ts, so
// a test only needs to wrap the tree in the matching providers with mock
// values. `renderWithProviders` does that and returns the mock context values
// alongside the usual RTL result so assertions can check, e.g., that an action
// called `updateTeam` or pushed a toast.

import React, { ReactElement, ReactNode } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { ToastContext, TeamContext, UIContext } from "./contexts";
import type {
  ToastContextValue,
  TeamContextValue,
  UIContextValue,
} from "./types";

export const makeToast = (
  overrides: Partial<ToastContextValue> = {}
): ToastContextValue => ({
  push: jest.fn(),
  dismiss: jest.fn(),
  ...overrides,
});

export const makeTeam = (
  overrides: Partial<TeamContextValue> = {}
): TeamContextValue =>
  ({
    currentRole: "head",
    realRole: "head",
    updateTeam: jest.fn(),
    switchTeam: jest.fn(),
    createTeam: jest.fn(),
    team: { players: [], games: [] },
    teams: [],
    ...overrides,
  } as TeamContextValue);

export const makeUI = (
  overrides: Partial<UIContextValue> = {}
): UIContextValue =>
  ({
    activeTab: "home",
    setActiveTab: jest.fn(),
    selectedGameId: null,
    setSelectedGameId: jest.fn(),
    openPlayerProfile: jest.fn(),
    ...overrides,
  } as UIContextValue);

interface ProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  toast?: Partial<ToastContextValue>;
  team?: Partial<TeamContextValue>;
  ui?: Partial<UIContextValue>;
}

export const renderWithProviders = (
  ui: ReactElement,
  { toast, team, ui: uiOverrides, ...rest }: ProvidersOptions = {}
) => {
  const toastValue = makeToast(toast);
  const teamValue = makeTeam(team);
  const uiValue = makeUI(uiOverrides);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ToastContext.Provider value={toastValue}>
      <TeamContext.Provider value={teamValue}>
        <UIContext.Provider value={uiValue}>{children}</UIContext.Provider>
      </TeamContext.Provider>
    </ToastContext.Provider>
  );
  return {
    toastValue,
    teamValue,
    uiValue,
    ...render(ui, { wrapper: Wrapper, ...rest }),
  };
};
