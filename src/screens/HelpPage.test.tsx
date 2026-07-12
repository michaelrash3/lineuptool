import React from "react";
import { screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelpPage } from "./HelpPage";
import { getCompletedTours } from "../help/helpPrefs";
import { renderWithProviders } from "../test-utils";
import type { TeamContextValue, UIContextValue } from "../types";

const renderHelp = ({
  path = "/help" as string | { pathname: string; state?: unknown },
  ui,
  team,
}: {
  path?: string | { pathname: string; state?: unknown };
  ui?: Partial<UIContextValue>;
  team?: Partial<TeamContextValue>;
} = {}) => {
  const onOpenTutorial = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>HOME PAGE</div>} />
        <Route
          path="/help"
          element={<HelpPage onOpenTutorial={onOpenTutorial} />}
        />
        <Route
          path="/help/:topicId"
          element={<HelpPage onOpenTutorial={onOpenTutorial} />}
        />
      </Routes>
    </MemoryRouter>,
    {
      ui: {
        setIsAddingPlayer: jest.fn(),
        setIsAddingGame: jest.fn(),
        ...ui,
      },
      team,
    },
  );
  return { onOpenTutorial, ...utils };
};

const searchBox = () =>
  screen.getByLabelText("Search help articles") as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
});

describe("HelpPage", () => {
  it("renders visible categories and the pinned Guided Tours rail", () => {
    renderHelp();
    expect(screen.getByText("Guided Tours")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Replay the orientation" }),
    ).toBeInTheDocument();
    // Head coach with everything on sees all four tours.
    for (const title of [
      "Build your first lineup",
      "Run a tryout",
      "Import stats from GameChanger",
      "Advance to a new season",
    ]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
    for (const label of ["Getting Started", "Roster", "Finances", "Glossary"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("heading", { name: "Getting Started" }),
    ).toBeInTheDocument();
  });

  it("Replay the orientation opens the orientation guide over the page", () => {
    const { onOpenTutorial } = renderHelp();
    fireEvent.click(
      screen.getByRole("button", { name: "Replay the orientation" }),
    );
    expect(onOpenTutorial).toHaveBeenCalledTimes(1);
  });

  it("clicking a category lists its topics", () => {
    renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    expect(screen.getByRole("heading", { name: "Roster" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Adding players/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Importing a roster CSV/ }),
    ).toBeInTheDocument();
    // Another category's topics stay out of the list.
    expect(
      screen.queryByRole("button", { name: /Adding games/ }),
    ).not.toBeInTheDocument();
  });

  it("clicking a topic routes to its article with breadcrumb and sections", () => {
    renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Positions, the catcher flag/ }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Positions, the catcher flag, and primary/secondary",
      }),
    ).toBeInTheDocument();
    // Breadcrumb repeats the category label next to the rail button.
    expect(screen.getAllByRole("button", { name: "Roster" })).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Catcher flag" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only flagged players enter the catching rotation/),
    ).toBeInTheDocument();
  });

  it("a related-topic chip navigates to that article", () => {
    renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    fireEvent.click(screen.getByRole("button", { name: /Adding players/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Importing a roster CSV" }),
    );
    expect(
      screen.getByRole("heading", { name: "Importing a roster CSV" }),
    ).toBeInTheDocument();
  });

  it("an article CTA switches tabs and runs its uiAction", () => {
    const { uiValue } = renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    fireEvent.click(screen.getByRole("button", { name: /Adding players/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add a player" }));
    expect(uiValue.setActiveTab).toHaveBeenCalledWith("roster");
    expect(uiValue.setIsAddingPlayer).toHaveBeenCalledWith(true);
  });

  it("assistant CTAs navigate but never flip head-only editor flags", () => {
    const { uiValue } = renderHelp({ team: { currentRole: "assistant" } });
    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    fireEvent.click(screen.getByRole("button", { name: /Adding players/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add a player" }));
    expect(uiValue.setActiveTab).toHaveBeenCalledWith("roster");
    expect(uiValue.setIsAddingPlayer).not.toHaveBeenCalled();
  });

  it("search ranks a title match above a body-only match", () => {
    const { container } = renderHelp();
    fireEvent.change(searchBox(), { target: { value: "batting order" } });
    const rows = Array.from(
      container.querySelectorAll("[data-help-result]"),
    ).map((r) => r.textContent || "");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Title hit first (with its category label as the eyebrow) …
    expect(rows[0]).toContain("Batting order");
    expect(rows[0]).toContain("Lineups");
    // … body-only hit ("batting order plus the inning-by-inning grid") after.
    const bodyOnly = rows.findIndex((t) =>
      t.includes("Printing the lineup card"),
    );
    expect(bodyOnly).toBeGreaterThan(0);
  });

  it("shows a friendly empty state when nothing matches", () => {
    renderHelp();
    fireEvent.change(searchBox(), { target: { value: "qqqq" } });
    expect(screen.getByText("No matching articles")).toBeInTheDocument();
  });

  it("deep-links straight to an article at /help/:topicId", () => {
    renderHelp({ path: "/help/lineup-generator" });
    expect(
      screen.getByRole("heading", { name: "How the lineup generator works" }),
    ).toBeInTheDocument();
    // Its category is selected in the rail (the breadcrumb repeats the
    // label, so match on whichever button carries aria-current).
    const lineups = screen.getAllByRole("button", { name: "Lineups" });
    expect(lineups.some((b) => b.getAttribute("aria-current") === "true")).toBe(
      true,
    );
  });

  it("an unknown topic id lands on the browse view", () => {
    renderHelp({ path: "/help/not-a-real-topic" });
    expect(
      screen.getByRole("heading", { name: "Getting Started" }),
    ).toBeInTheDocument();
  });

  it("opens on a contextual category when the origin tab rides navigation state", () => {
    renderHelp({ path: { pathname: "/help", state: { from: "roster" } } });
    expect(screen.getByRole("heading", { name: "Roster" })).toBeInTheDocument();
  });

  it("Back falls back home on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderHelp();
    // Exact name: the PageShell chip ("Back"), not the mobile pane's
    // "Back to browse".
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("HOME PAGE")).toBeInTheDocument();
  });

  it("hides headOnly topics, tours, and emptied categories from assistants", () => {
    renderHelp({ team: { currentRole: "assistant" } });
    expect(
      screen.getByRole("button", { name: "Build your first lineup" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run a tryout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Advance to a new season" }),
    ).not.toBeInTheDocument();
    // Every Finances topic is headOnly, so the category disappears too.
    expect(
      screen.queryByRole("button", { name: "Finances" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    expect(
      screen.getByRole("button", { name: /Adding players/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Importing a roster CSV/ }),
    ).not.toBeInTheDocument();
  });

  it("hides topics and tours gated behind a disabled feature", () => {
    // Both stats and depthChart topics live in the Stats & Analytics
    // category — disable both so the emptied category leaves the rail.
    renderHelp({
      team: {
        team: {
          players: [],
          games: [],
          disabledFeatures: ["stats", "depthChart"],
        },
      },
    });
    expect(
      screen.queryByRole("button", { name: "Stats & Analytics" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import stats from GameChanger" }),
    ).not.toBeInTheDocument();
    // Ungated categories and tours stay.
    expect(
      screen.getByRole("button", { name: "Run a tryout" }),
    ).toBeInTheDocument();
  });

  it("starting a tour overlays the tour modal on the page", () => {
    renderHelp();
    fireEvent.click(
      screen.getByRole("button", { name: "Build your first lineup" }),
    );
    expect(screen.getByText("Add your players")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
  });

  it("completing a tour marks it complete back on the page", () => {
    renderHelp();
    fireEvent.click(
      screen.getByRole("button", { name: "Build your first lineup" }),
    );
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    }
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(getCompletedTours()).toContain("first-lineup");
    // Back on the page, with the tour marked done in the rail.
    expect(screen.getByLabelText("Search help articles")).toBeInTheDocument();
    const tourButton = screen.getByRole("button", {
      name: /Build your first lineup/,
    });
    expect(within(tourButton).getByText("Completed")).toBeInTheDocument();
  });

  it("skipping a tour returns to the page without marking it complete", () => {
    renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "Run a tryout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip Tour" }));
    expect(getCompletedTours()).toEqual([]);
    expect(screen.getByLabelText("Search help articles")).toBeInTheDocument();
  });
});
