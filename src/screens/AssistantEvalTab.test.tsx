import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
