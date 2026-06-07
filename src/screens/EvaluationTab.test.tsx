import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { EvaluationTab } from "./EvaluationTab";
import { renderWithProviders } from "../test-utils";

describe("EvaluationTab", () => {
  it("renders the head-coach evaluation dashboard for an empty team", () => {
    renderWithProviders(<EvaluationTab />, {
      team: {
        team: { players: [], primaryColor: "#1d4ed8", evaluationEvents: [] },
        user: { uid: "u1" },
        currentRole: "head",
        saveTeamEvaluation: jest.fn(),
        deleteEvaluation: jest.fn(),
      },
      ui: {
        teamEvalGrades: {},
        setTeamEvalGrades: jest.fn(),
        selectedRoundId: null,
        setSelectedRoundId: jest.fn(),
        evalTrendPlayerId: null,
        setEvalTrendPlayerId: jest.fn(),
      },
    });
    expect(screen.getByText("Player Evaluation")).toBeInTheDocument();
  });

  it("shows each assistant's grades + notes inline under a player", () => {
    renderWithProviders(<EvaluationTab />, {
      team: {
        team: {
          players: [{ id: "p1", name: "Sammy", number: "5" }],
          primaryColor: "#1d4ed8",
          pitchingFormat: "Coach Pitch",
          evaluationEvents: [
            {
              id: "a1",
              date: "2026-02-01",
              coachRole: "Assistant",
              evaluatorId: "asst1",
              evaluatorName: "Jones",
              grades: { p1: { contact: 5, notes: "Great swing" } },
            },
          ],
        },
        user: { uid: "head1" },
        currentRole: "head",
        saveTeamEvaluation: jest.fn(),
        deleteEvaluation: jest.fn(),
      },
      ui: {
        teamEvalGrades: {},
        setTeamEvalGrades: jest.fn(),
        selectedRoundId: null,
        setSelectedRoundId: jest.fn(),
        evalTrendPlayerId: null,
        setEvalTrendPlayerId: jest.fn(),
      },
    });
    // Expand the player's grading card (the only collapsible toggle).
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    // "Assistant Evaluations (n)" header + curly-quoted notes are unique to the
    // inline per-player readout (the top roll-up panel renders notes unquoted).
    expect(screen.getByText("Assistant Evaluations (1)")).toBeInTheDocument();
    expect(screen.getByText("“Great swing”")).toBeInTheDocument();
    expect(screen.getAllByText(/Assistant · Jones/).length).toBeGreaterThanOrEqual(1);
  });
});
