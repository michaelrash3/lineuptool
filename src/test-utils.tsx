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
import {
  applyTeamArrayUpdate,
  type TeamArrayUpdate,
} from "./utils/teamArrayUpdates";

// Fold the op(s) a hook emitted through updateTeamArrays over a fixture team,
// yielding the resulting team state (sanitized exactly as it would be stored).
// Lets tests keep asserting on outcomes — the shape the old whole-array
// updateTeam patches exposed directly — instead of on op internals.
export const applyTeamOps = (
  team: any,
  input: TeamArrayUpdate | TeamArrayUpdate[],
): any =>
  (Array.isArray(input) ? input : [input]).reduce(
    (acc: any, u: TeamArrayUpdate) => applyTeamArrayUpdate(acc, u),
    team,
  );

export const makeToast = (
  overrides: Partial<ToastContextValue> = {},
): ToastContextValue => ({
  push: jest.fn(),
  dismiss: jest.fn(),
  ...overrides,
});

// Mock for the injected `confirm` dependency (see ConfirmProvider /
// useConfirm). Defaults to accepting; flip per-call with
// `confirm.mockResolvedValueOnce(false)`.
export const makeConfirm = (accept = true): jest.Mock =>
  jest.fn().mockResolvedValue(accept);

export const makeTeam = (
  overrides: Partial<TeamContextValue> = {},
): TeamContextValue =>
  ({
    currentRole: "head",
    realRole: "head",
    updateTeam: jest.fn(),
    updateFinances: jest.fn(),
    updateTeamArrays: jest.fn(),
    switchTeam: jest.fn(),
    createTeam: jest.fn(),
    team: { players: [], games: [] },
    teams: [],
    ...overrides,
  }) as TeamContextValue;

const makeUI = (overrides: Partial<UIContextValue> = {}): UIContextValue =>
  ({
    activeTab: "home",
    setActiveTab: jest.fn(),
    selectedGameId: null,
    setSelectedGameId: jest.fn(),
    openPlayerProfile: jest.fn(),
    openAddPlayer: jest.fn(),
    ...overrides,
  }) as UIContextValue;

interface ProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  toast?: Partial<ToastContextValue>;
  team?: Partial<TeamContextValue>;
  ui?: Partial<UIContextValue>;
}

export const renderWithProviders = (
  ui: ReactElement,
  { toast, team, ui: uiOverrides, ...rest }: ProvidersOptions = {},
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
