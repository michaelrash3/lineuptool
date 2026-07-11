import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { PracticesTab } from "./PracticesTab";
import { renderWithProviders } from "../test-utils";
import { DEFAULT_TEAM_DATA } from "../constants/ui";
import type { CoachRole } from "../types";

// The planner's pure brain (buildTeamSkillProfile / generatePracticePlan) is
// covered by src/utils/practicePlanner.test.ts. This covers the Smart Practice
// Planner *UI* wiring in PracticesTab: that a head coach can open it from a
// practice row and that applying the plan writes the agenda back to the
// practice — and that an assistant never sees the entry point.

const round = {
  id: "r1",
  date: "2026-06-01",
  grades: {
    p1: { approach: 1, baseballIQ: 5, speed: 2, baserunning: 2 },
  },
};

const practice = {
  id: "pr1",
  date: "2026-07-05",
  environment: "outdoor",
  drills: [],
};

const renderPractices = (
  role: CoachRole = "head",
  opts: { drillLibrary?: unknown[] } = {},
) => {
  const updatePractice = vi.fn();
  const utils = renderWithProviders(<PracticesTab />, {
    team: {
      team: {
        ...DEFAULT_TEAM_DATA,
        practices: [practice],
        evaluationEvents: [round],
        ...(opts.drillLibrary ? { drillLibrary: opts.drillLibrary } : {}),
      },
      currentRole: role,
      realRole: role,
      addPractice: vi.fn(),
      updatePractice,
      removePractice: vi.fn(),
      savePracticeAttendance: vi.fn(),
      addDrillToLibrary: vi.fn(),
      removeDrillFromLibrary: vi.fn(),
    },
  });
  return { ...utils, updatePractice };
};

const expandRow = () => {
  const heading = screen.getByRole("heading", { name: "Practice" });
  fireEvent.click(heading.closest("button") as HTMLElement);
};

describe("PracticesTab — Smart Practice Planner", () => {
  it("builds and applies a plan to the practice for a head coach", () => {
    const { updatePractice } = renderPractices("head");
    expandRow();

    fireEvent.click(screen.getByRole("button", { name: /Build a plan/i }));
    expect(screen.getByText("Build a practice plan")).toBeInTheDocument();

    // Empty practice → the apply button reads "Apply to practice".
    fireEvent.click(screen.getByRole("button", { name: /Apply to practice/i }));

    expect(updatePractice).toHaveBeenCalledTimes(1);
    const [practiceId, patch] = updatePractice.mock.calls[0];
    expect(practiceId).toBe("pr1");
    expect(Array.isArray(patch.drills)).toBe(true);
    expect(patch.drills.length).toBeGreaterThan(0);
    // Each planned block carries a name and an allocated minute count.
    expect(patch.drills[0]).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        minutes: expect.any(Number),
      }),
    );
  });

  it("re-plans at a different length and still applies", () => {
    const { updatePractice } = renderPractices("head");
    expandRow();
    fireEvent.click(screen.getByRole("button", { name: /Build a plan/i }));

    fireEvent.click(screen.getByRole("button", { name: "60 min" }));
    fireEvent.click(screen.getByRole("button", { name: /Apply to practice/i }));

    const [, patch] = updatePractice.mock.calls[0];
    const total = patch.drills.reduce(
      (s: number, d: { minutes?: number }) => s + (d.minutes || 0),
      0,
    );
    expect(total).toBe(60);
  });

  it("reshuffles to a different drill before applying", () => {
    // Two Team drills so the closer block has an alternative to rotate to.
    const drillLibrary = [
      {
        id: "cond",
        name: "Laps",
        category: "Conditioning",
        environment: "both",
      },
      { id: "t1", name: "Situations A", category: "Team", environment: "both" },
      { id: "t2", name: "Situations B", category: "Team", environment: "both" },
    ];
    const { updatePractice } = renderPractices("head", { drillLibrary });
    expandRow();
    fireEvent.click(screen.getByRole("button", { name: /Build a plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /Reshuffle/i }));
    fireEvent.click(screen.getByRole("button", { name: /Apply to practice/i }));

    const [, patch] = updatePractice.mock.calls[0];
    const teamBlock = patch.drills.find(
      (d: { category?: string }) => d.category === "Team",
    );
    expect(teamBlock.name).toBe("Situations B");
  });

  it("hides the planner entry point from an assistant", () => {
    renderPractices("assistant");
    expandRow();
    expect(
      screen.queryByRole("button", { name: /Build a plan/i }),
    ).not.toBeInTheDocument();
  });
});

describe("PracticesTab — drill targets", () => {
  const taggedLibrary = [
    {
      id: "d1",
      name: "Two-strike battles",
      category: "Hitting",
      environment: "both",
      evalCategory: "contact",
    },
  ];

  const renderWithAssignment = (over: Record<string, unknown> = {}) =>
    renderWithProviders(<PracticesTab />, {
      team: {
        team: {
          ...DEFAULT_TEAM_DATA,
          practices: [
            {
              ...practice,
              drills: [
                {
                  id: "a1",
                  name: "Two-strike battles",
                  category: "Hitting",
                  libraryId: "d1",
                },
              ],
            },
          ],
          drillLibrary: taggedLibrary,
          players: [
            { id: "p1", name: "Ava", devPlan: { drillIds: ["d1"] } },
            { id: "p2", name: "Sam", devPlan: { drillIds: ["d1"] } },
          ],
          ...over,
        },
        currentRole: "head",
        realRole: "head",
        addPractice: vi.fn(),
        updatePractice: vi.fn(),
        removePractice: vi.fn(),
        savePracticeAttendance: vi.fn(),
        addDrillToLibrary: vi.fn(),
        removeDrillFromLibrary: vi.fn(),
      },
    });

  it("annotates agenda drills with the players assigned to them", () => {
    renderWithAssignment();
    expandRow();
    expect(screen.getByText("Targets: Ava, Sam")).toBeInTheDocument();
  });

  it("drops the annotation when the Development module is off", () => {
    renderWithAssignment({ disabledFeatures: ["development"] });
    expandRow();
    expect(screen.queryByText(/Targets:/)).not.toBeInTheDocument();
  });

  it("lets the library form tag a drill with an eval category", () => {
    const addDrillToLibrary = vi.fn();
    renderWithProviders(<PracticesTab />, {
      team: {
        team: { ...DEFAULT_TEAM_DATA, practices: [practice] },
        currentRole: "head",
        realRole: "head",
        addPractice: vi.fn(),
        updatePractice: vi.fn(),
        removePractice: vi.fn(),
        savePracticeAttendance: vi.fn(),
        addDrillToLibrary,
        removeDrillFromLibrary: vi.fn(),
      },
    });
    // Open the library manager, fill the form, tag Contact, submit.
    fireEvent.click(screen.getByText(/Drill Library ·/));
    fireEvent.change(screen.getByPlaceholderText("Drill name…"), {
      target: { value: "Machine BP" },
    });
    fireEvent.change(
      screen.getByLabelText(/Targets eval category/, { selector: "select" }),
      { target: { value: "approach" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add drill to library" }),
    );
    expect(addDrillToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Machine BP", evalCategory: "approach" }),
    );
  });
});
