import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import {
  OnboardingTutorial,
  onboardingHasBeenCompleted,
} from "./OnboardingTutorial";
import { APP_NAME } from "../constants/ui";
import { renderWithProviders } from "../test-utils";
import type { TeamContextValue, UIContextValue } from "../types";

const STORAGE_KEY = "lineuptool.onboardingComplete.v4";

const renderTutorial = ({
  team,
  ui,
}: {
  team?: Partial<TeamContextValue>;
  ui?: Partial<UIContextValue>;
} = {}) => {
  const onClose = jest.fn();
  const utils = renderWithProviders(
    <OnboardingTutorial open onClose={onClose} />,
    {
      team,
      ui: {
        openAddPlayer: jest.fn(),
        setIsAddingGame: jest.fn(),
        ...ui,
      },
    },
  );
  return { onClose, ...utils };
};

// Walk the guide with Next, recording each step's title and — for numbered
// chapters — its "Step N of M" eyebrow. Stops on the last step (Done shown).
const walkSteps = () => {
  const titles: string[] = [];
  const eyebrows: string[] = [];
  for (let i = 0; i < 30; i++) {
    titles.push(screen.getByRole("heading", { level: 2 }).textContent || "");
    const eyebrow = screen.queryByText(/^Step \d+ of \d+$/);
    if (eyebrow) eyebrows.push(eyebrow.textContent || "");
    const next = screen.queryByRole("button", { name: /next/i });
    if (!next) break;
    fireEvent.click(next);
  }
  return { titles, eyebrows };
};

beforeEach(() => {
  localStorage.clear();
});

describe("OnboardingTutorial", () => {
  it("renders the welcome step when open", () => {
    renderTutorial();
    expect(screen.getByRole("heading", { name: APP_NAME })).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Skip Tour" }),
    ).toBeInTheDocument();
  });

  it("walks a head coach with all features through every chapter with consistent numbering", () => {
    renderTutorial();
    const { titles, eyebrows } = walkSteps();

    // Head-only chapters are all reachable.
    expect(titles[0]).toBe(APP_NAME);
    expect(titles).toContain("Set up your team");
    expect(titles).toContain("Track the money");
    expect(titles).toContain("Advance the season");
    expect(titles[titles.length - 1]).toBe("You're ready");

    // Numbered eyebrows count 1..M with a single consistent M.
    const totals = eyebrows.map((e) => Number(/of (\d+)$/.exec(e)![1]));
    expect(new Set(totals).size).toBe(1);
    const total = totals[0];
    expect(total).toBe(13);
    expect(eyebrows).toEqual(
      Array.from({ length: total }, (_, i) => `Step ${i + 1} of ${total}`),
    );
  });

  it("skips head-only chapters for assistants and shrinks the step count", () => {
    const head = renderTutorial();
    const headWalk = walkSteps();
    head.unmount();

    renderTutorial({ team: { currentRole: "assistant" } });
    const assistantWalk = walkSteps();

    expect(assistantWalk.titles).not.toContain("Set up your team");
    expect(assistantWalk.titles).not.toContain("Track the money");
    expect(assistantWalk.titles).not.toContain(
      "Recruit with tryouts & interest",
    );
    expect(assistantWalk.titles).not.toContain("Advance the season");
    // Shared chapters remain.
    expect(assistantWalk.titles).toContain("Add your players");
    expect(assistantWalk.titles).toContain("Generate a lineup");
    expect(assistantWalk.eyebrows.length).toBeLessThan(
      headWalk.eyebrows.length,
    );
  });

  it("drops chapters for features the team has switched off", () => {
    renderTutorial({
      team: {
        team: {
          players: [],
          games: [],
          disabledFeatures: ["stats", "depthChart", "practices", "finances"],
        },
      },
    });
    const { titles } = walkSteps();

    for (const gone of [
      "Track stats & season analytics",
      "Check the depth chart",
      "Plan practices",
      "Track the money",
    ]) {
      expect(titles).not.toContain(gone);
    }
    // Ungated chapters stay.
    expect(titles).toContain("Set up your team");
    expect(titles).toContain("Advance the season");
  });

  it("Skip marks onboarding complete and closes", () => {
    const { onClose } = renderTutorial();
    expect(onboardingHasBeenCompleted()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Skip Tour" }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
    expect(onboardingHasBeenCompleted()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Done on the last step marks onboarding complete and closes", () => {
    const { onClose } = renderTutorial();
    walkSteps();

    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
    expect(onboardingHasBeenCompleted()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a chapter CTA navigates, closes, and still counts as seen", () => {
    const { onClose, uiValue } = renderTutorial();
    // Welcome → chapter 1 ("Set up your team").
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(
      screen.getByRole("heading", { name: "Set up your team" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to Settings" }));

    expect(uiValue.setActiveTab).toHaveBeenCalledWith("settings");
    expect(onClose).toHaveBeenCalledTimes(1);
    // Any exit counts as seen — the guide must not re-open next visit.
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
    expect(onboardingHasBeenCompleted()).toBe(true);
  });
});
