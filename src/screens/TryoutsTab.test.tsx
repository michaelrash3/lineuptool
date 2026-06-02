import React from "react";
import { screen } from "@testing-library/react";
import { TryoutsTab } from "./TryoutsTab";
import { renderWithProviders } from "../test-utils";

describe("TryoutsTab", () => {
  it("renders the tryouts dashboard for an empty signup list", () => {
    renderWithProviders(<TryoutsTab />, {
      team: {
        team: {
          tryoutSignups: [],
          evaluationEvents: [],
          defenseSize: 9,
          pitchingFormat: "Kid Pitch",
        },
        user: { uid: "u1" },
        currentRole: "head",
        updateTryoutSignup: jest.fn(),
        deleteTryoutSignup: jest.fn(),
        acceptTryout: jest.fn(),
        saveTryoutEvaluation: jest.fn(),
      },
    });
    expect(screen.getByText("Tryouts")).toBeInTheDocument();
  });
});
