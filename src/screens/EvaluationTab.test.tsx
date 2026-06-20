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
    expect(
      screen.getAllByText(/Assistant · Jones/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("labels the save button 'Save as New Round' when creating a new round", () => {
    // No saved rounds → nothing to update → creating new.
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
    expect(
      screen.getByRole("button", { name: /Save as New Round/ }),
    ).toBeInTheDocument();
  });

  it("requires a two-tap confirm to overwrite an existing round", () => {
    const saveTeamEvaluation = jest.fn(() => "r1");
    renderWithProviders(<EvaluationTab />, {
      team: {
        team: {
          players: [],
          primaryColor: "#1d4ed8",
          evaluationEvents: [
            {
              id: "r1",
              date: "2026-02-01",
              coachRole: "Head",
              evaluatorId: "u1",
              evaluatorName: "Coach",
              grades: {},
            },
          ],
        },
        user: { uid: "u1" },
        currentRole: "head",
        saveTeamEvaluation,
        deleteEvaluation: jest.fn(),
      },
      ui: {
        teamEvalGrades: {},
        setTeamEvalGrades: jest.fn(),
        selectedRoundId: "r1", // editing the saved round
        setSelectedRoundId: jest.fn(),
        evalTrendPlayerId: null,
        setEvalTrendPlayerId: jest.fn(),
      },
    });
    const btn = screen.getByRole("button", { name: /Update This Round/ });
    // First tap arms the confirm — does NOT save.
    fireEvent.click(btn);
    expect(saveTeamEvaluation).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Overwrite/ }),
    ).toBeInTheDocument();
    // Second tap commits.
    fireEvent.click(screen.getByRole("button", { name: /Overwrite/ }));
    expect(saveTeamEvaluation).toHaveBeenCalledTimes(1);
  });

  it("always offers starting a new round while editing one (no cadence gate)", () => {
    renderWithProviders(<EvaluationTab />, {
      team: {
        team: {
          players: [],
          primaryColor: "#1d4ed8",
          evaluationEvents: [
            {
              id: "r1",
              date: "2026-02-01",
              coachRole: "Head",
              evaluatorId: "u1",
              evaluatorName: "Coach",
              grades: {},
            },
          ],
        },
        user: { uid: "u1" },
        currentRole: "head",
        saveTeamEvaluation: jest.fn(),
        deleteEvaluation: jest.fn(),
      },
      ui: {
        teamEvalGrades: {},
        setTeamEvalGrades: jest.fn(),
        selectedRoundId: "r1",
        setSelectedRoundId: jest.fn(),
        evalTrendPlayerId: null,
        setEvalTrendPlayerId: jest.fn(),
      },
    });
    // Both the standalone button and the dropdown option exist regardless of
    // whether a cadence window happens to be open today.
    expect(
      screen.getByRole("button", { name: /Start New Round/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/\+ Start a new Eval/)).toBeInTheDocument();
  });
});
