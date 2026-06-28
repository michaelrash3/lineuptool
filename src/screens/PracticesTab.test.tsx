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

const renderPractices = (role: CoachRole = "head") => {
  const updatePractice = vi.fn();
  const utils = renderWithProviders(<PracticesTab />, {
    team: {
      team: {
        ...DEFAULT_TEAM_DATA,
        practices: [practice],
        evaluationEvents: [round],
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

  it("hides the planner entry point from an assistant", () => {
    renderPractices("assistant");
    expandRow();
    expect(
      screen.queryByRole("button", { name: /Build a plan/i }),
    ).not.toBeInTheDocument();
  });
});
