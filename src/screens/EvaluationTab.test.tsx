import React from "react";
import { screen } from "@testing-library/react";
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
});
