import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AssistantEvalTab } from "./AssistantEvalTab";
import { renderWithProviders } from "../test-utils";

// AssistantEvalTab reads useParams/useNavigate, so it must render inside a
// router. No :roundId in the entry → the grading form (not the past-round
// read-only view) renders.
const setup = (teamOver: any = {}, uid = "assistant-1") => {
  const saveAssistantEvaluation = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/evaluation"]}>
      <AssistantEvalTab />
    </MemoryRouter>,
    {
      team: {
        currentRole: "assistant",
        user: { uid },
        saveAssistantEvaluation,
        team: {
          pitchingFormat: "Kid Pitch",
          defenseSize: 9,
          evaluationEvents: [],
          players: [
            { id: "p1", name: "Ava", number: "3", present: true },
            { id: "p2", name: "Ben", number: "7", present: true },
          ],
          ...teamOver,
        },
      },
    },
  );
  return { saveAssistantEvaluation, ...utils };
};

describe("AssistantEvalTab", () => {
  it("saves the assistant's grades and confirms with a toast", async () => {
    const user = userEvent.setup();
    const { saveAssistantEvaluation, toastValue } = setup();
    const save = screen.getByRole("button", { name: /save evaluation/i });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(saveAssistantEvaluation).toHaveBeenCalledTimes(1);
    // Seeded grades cover the active roster (the concurrency-safe append path
    // in useEvaluationCrud consumes exactly this shape).
    const grades = saveAssistantEvaluation.mock.calls[0][0];
    expect(Object.keys(grades)).toEqual(expect.arrayContaining(["p1", "p2"]));
    expect(toastValue.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", title: "Evaluation saved" }),
    );
  });

  it("disables Save when there are no active players", () => {
    setup({ players: [] });
    expect(
      screen.getByRole("button", { name: /save evaluation/i }),
    ).toBeDisabled();
  });

  it("lists only THIS assistant's own past rounds", () => {
    setup({
      evaluationEvents: [
        {
          id: "mine",
          date: "2026-06-20",
          coachRole: "Assistant",
          evaluatorId: "assistant-1",
          grades: { p1: {} },
        },
        {
          id: "other-assistant",
          date: "2026-06-21",
          coachRole: "Assistant",
          evaluatorId: "assistant-2",
          grades: { p1: {} },
        },
        {
          id: "head-round",
          date: "2026-06-22",
          coachRole: "Head",
          evaluatorId: "head-1",
          grades: { p1: {} },
        },
      ],
    });
    // Own round surfaces in "Your Past Rounds"; the other assistant's and the
    // head's rounds stay hidden.
    expect(screen.getByText(/your past rounds/i)).toBeInTheDocument();
    expect(screen.getByText("2026-06-20")).toBeInTheDocument();
    expect(screen.queryByText("2026-06-21")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-06-22")).not.toBeInTheDocument();
  });
});

// ---- Per-team eval categories (docs/EVALUATIONS-AUDIT.md §4) ---------------
// Assistants grade the head coach's configured list, not the stock catalog.
describe("AssistantEvalTab — per-team categories", () => {
  it("grades a category the team added", () => {
    setup({
      evalCustomCategories: [
        { id: "custom_bunting", label: "Bunting", group: "Hitting" },
      ],
    });
    expect(screen.getAllByText("Bunting").length).toBeGreaterThan(0);
  });

  it("uses the team's rename and drops a hidden category", () => {
    setup({
      evalCategoryOverrides: {
        approach: { label: "At Bats" },
        speed: { hidden: true },
        baserunning: { hidden: true },
      },
    });
    expect(screen.getAllByText("At Bats").length).toBeGreaterThan(0);
    expect(screen.queryByText("Approach")).not.toBeInTheDocument();
    // Baserunning is exactly two categories — hide both and the whole tab goes,
    // rather than offering an empty one.
    expect(
      screen.queryByRole("button", { name: "Baserunning" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hitting" })).toBeInTheDocument();
  });
});

// ---- Past-round read-only view: per-player specialty gating ----------------
// Pitching/Catching categories only render under kids who hold the position.
// The team-wide history list used to hand every card every specialty row —
// seeded, never-editable defaults under kids the grading tabs themselves
// would never have shown.
describe("AssistantEvalTab — past round per-player categories", () => {
  const renderPastRound = () =>
    renderWithProviders(
      <MemoryRouter initialEntries={["/evaluation/round/mine"]}>
        <Routes>
          <Route
            path="/evaluation/round/:roundId"
            element={<AssistantEvalTab />}
          />
        </Routes>
      </MemoryRouter>,
      {
        team: {
          currentRole: "assistant",
          user: { uid: "assistant-1" },
          saveAssistantEvaluation: jest.fn(),
          team: {
            pitchingFormat: "Kid Pitch",
            defenseSize: 9,
            players: [
              {
                id: "p-cat",
                name: "Casey Catcher",
                present: true,
                comfortablePositions: ["C", "1B"],
              },
              {
                id: "p-field",
                name: "Frankie Fielder",
                present: true,
                comfortablePositions: ["1B", "LF"],
              },
            ],
            evaluationEvents: [
              {
                id: "mine",
                date: "2026-06-20",
                coachRole: "Assistant",
                evaluatorId: "assistant-1",
                grades: {
                  "p-cat": { blocking: 4, receiving: 3 },
                  "p-field": { blocking: 3, receiving: 3 },
                },
              },
            ],
          },
        },
      },
    );

  it("shows Catching rows only under the catcher, and no Pitching rows without a pitcher", () => {
    renderPastRound();
    expect(screen.getByText(/read-only view/i)).toBeInTheDocument();
    // Exactly ONE card (the catcher's) carries the Catching categories, even
    // though the saved round holds seeded values for the fielder too.
    expect(screen.getAllByText("Blocking")).toHaveLength(1);
    expect(screen.getAllByText("Receiving")).toHaveLength(1);
    // Nobody has "P" — the Pitching specialty renders for no one.
    expect(screen.queryByText("Pitch Velocity")).not.toBeInTheDocument();
  });
});
