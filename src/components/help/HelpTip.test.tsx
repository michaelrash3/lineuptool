import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelpTip } from "./HelpTip";
import type { TourCtaCtx } from "./TourModal";
import { TOURS, visibleTours } from "../../help/tours";
import { renderWithProviders } from "../../test-utils";

const renderTip = (el: React.ReactElement) =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/roster"]}>
      <Routes>
        <Route path="/roster" element={el} />
        <Route path="/help/:topicId" element={<div>HELP ARTICLE</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("HelpTip", () => {
  it("renders an icon-only button with the default aria-label", () => {
    renderTip(<HelpTip topicId="lineup-generator" />);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("uses a custom label when given", () => {
    renderTip(
      <HelpTip topicId="lineup-generator" label="About the generator" />,
    );
    expect(
      screen.getByRole("button", { name: "About the generator" }),
    ).toBeInTheDocument();
  });

  it("navigates to the topic's help page on click", async () => {
    const user = userEvent.setup();
    renderTip(<HelpTip topicId="bench-equity-variety" />);
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByText("HELP ARTICLE")).toBeInTheDocument();
  });
});

const makeCtx = (overrides: Partial<TourCtaCtx> = {}): TourCtaCtx => ({
  hasPlayers: false,
  hasGames: false,
  hasGameToday: false,
  setActiveTab: jest.fn(),
  setIsAddingPlayer: jest.fn(),
  setIsAddingGame: jest.fn(),
  ...overrides,
});

describe("TOURS", () => {
  it("ships four tours with unique ids", () => {
    expect(TOURS).toHaveLength(4);
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(4);
  });

  it("every tour builds 4-6 numbered steps of real copy", () => {
    for (const tour of TOURS) {
      expect(tour.title.trim().length).toBeGreaterThan(0);
      expect(tour.description.trim().length).toBeGreaterThan(0);
      expect(tour.icon).toBeDefined();
      const steps = tour.buildSteps(makeCtx());
      expect(steps.length).toBeGreaterThanOrEqual(4);
      expect(steps.length).toBeLessThanOrEqual(6);
      expect(steps.some((s) => s.numbered)).toBe(true);
      for (const step of steps) {
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.body.trim().length).toBeGreaterThan(0);
        expect(step.icon).toBeDefined();
      }
    }
  });

  it("first-lineup's add-player CTA navigates to Roster and opens the modal", () => {
    const ctx = makeCtx();
    const tour = TOURS.find((t) => t.id === "first-lineup");
    const cta = tour!
      .buildSteps(ctx)
      .flatMap((s) => s.cta || [])
      .find((c) => c.label === "Add a player");
    expect(cta).toBeDefined();
    cta!.run();
    expect(ctx.setActiveTab).toHaveBeenCalledWith("roster");
    expect(ctx.setIsAddingPlayer).toHaveBeenCalledWith(true);
  });
});

describe("visibleTours", () => {
  it("shows every tour to a head coach with all features on", () => {
    expect(visibleTours(null, "head")).toHaveLength(4);
    expect(visibleTours({ disabledFeatures: [] }, "head")).toHaveLength(4);
  });

  it("hides head-only tours from assistants", () => {
    expect(visibleTours(null, "assistant").map((t) => t.id)).toEqual([
      "first-lineup",
    ]);
  });

  it("hides tours whose feature is toggled off", () => {
    const team = { disabledFeatures: ["tryouts", "stats"] };
    expect(visibleTours(team, "head").map((t) => t.id)).toEqual([
      "first-lineup",
      "advance-season",
    ]);
  });
});
