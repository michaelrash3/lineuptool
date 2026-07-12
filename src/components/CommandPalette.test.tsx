import React from "react";
import { screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { renderWithProviders } from "../test-utils";
import type { TeamContextValue, UIContextValue } from "../types";

// Minimal team: enough for player/game rows without triggering departed or
// finalized filtering.
const fixtureTeam = {
  players: [
    { id: "p1", name: "Casey Jones", number: 12, primaryPosition: "SS" },
    { id: "p2", name: "Riley Ortiz", number: 7, primaryPosition: "C" },
  ],
  games: [{ id: "g1", opponent: "River Sharks", date: "2026-07-12" }],
};

const renderPalette = ({
  team,
  ui,
}: {
  team?: Partial<TeamContextValue>;
  ui?: Partial<UIContextValue>;
} = {}) => {
  const onClose = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<CommandPalette open onClose={onClose} />} />
        <Route path="/help/:topicId" element={<div>HELP ARTICLE PAGE</div>} />
      </Routes>
    </MemoryRouter>,
    {
      team: { team: fixtureTeam, ...team },
      ui: {
        openAddPlayer: jest.fn(),
        setAssistantEvalOpen: jest.fn(),
        ...ui,
      },
    },
  );
  return { onClose, ...utils };
};

const searchInput = () =>
  screen.getByLabelText("Command palette search") as HTMLInputElement;

const rowFor = (label: string) =>
  screen.getByText(label).closest("button") as HTMLButtonElement;

describe("CommandPalette", () => {
  it("shows nav items but no help rows while the query is empty", () => {
    renderPalette();
    expect(searchInput()).toBeInTheDocument();
    // Default list samples nav/action/game/player kinds…
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Roster")).toBeInTheDocument();
    expect(screen.getByText("Casey Jones")).toBeInTheDocument();
    expect(screen.getByText("vs River Sharks")).toBeInTheDocument();
    // …but never help topics (no "Help" kind badge anywhere).
    expect(screen.queryByText("Help")).not.toBeInTheDocument();
  });

  it("surfaces a help topic on query and routes to its help page", () => {
    const { onClose } = renderPalette();
    fireEvent.change(searchInput(), { target: { value: "lineup generator" } });

    const row = rowFor("How the lineup generator works");
    expect(row).not.toBeNull();
    expect(within(row).getByText("Help")).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.getByText("HELP ARTICLE PAGE")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("finds a player by name and opens their profile", () => {
    const { onClose, uiValue } = renderPalette();
    fireEvent.change(searchInput(), { target: { value: "Casey" } });

    const row = rowFor("Casey Jones");
    expect(within(row).getByText("Player")).toBeInTheDocument();

    fireEvent.click(row);
    expect(uiValue.openPlayerProfile).toHaveBeenCalledWith("p1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides headOnly help topics from assistants", () => {
    // A head coach searching the head-only article finds it…
    const head = renderPalette();
    fireEvent.change(searchInput(), {
      target: { value: "Importing a roster CSV" },
    });
    expect(screen.getByText("Importing a roster CSV")).toBeInTheDocument();
    head.unmount();

    // …an assistant never gets a help row for it.
    renderPalette({ team: { currentRole: "assistant" } });
    fireEvent.change(searchInput(), {
      target: { value: "Importing a roster CSV" },
    });
    expect(
      screen.queryByText("Importing a roster CSV"),
    ).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const { onClose } = renderPalette();
    fireEvent.keyDown(searchInput(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown then Enter runs the active row's action and closes", () => {
    const { onClose, uiValue } = renderPalette();
    // Empty query order starts with nav items: Home (0), Roster (1), …
    fireEvent.keyDown(searchInput(), { key: "ArrowDown" });
    fireEvent.keyDown(searchInput(), { key: "Enter" });
    expect(uiValue.setActiveTab).toHaveBeenCalledWith("roster");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
