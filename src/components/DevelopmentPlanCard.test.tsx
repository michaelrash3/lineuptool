import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevelopmentPlanCard } from "./DevelopmentPlanCard";
import { renderWithProviders } from "../test-utils";

const player = (over: any = {}) => ({
  id: "p1",
  name: "Ava Lopez",
  comfortablePositions: ["SS"],
  ...over,
});

const baseTeam = (over: any = {}) => ({
  players: [player()],
  games: [],
  evaluationEvents: [],
  drillLibrary: [
    { id: "d1", name: "Tee ladder", category: "Hitting" },
    {
      id: "d2",
      name: "Two-strike battles",
      category: "Hitting",
      evalCategory: "contact",
    },
  ],
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  ...over,
});

const actions = () => ({
  setPlayerHealth: jest.fn(),
  updateDevPlan: jest.fn(),
  addGoal: jest.fn(),
  setGoalStatus: jest.fn(),
  removeGoal: jest.fn(),
  addCheckIn: jest.fn(),
  toggleAssignedDrill: jest.fn(),
});

describe("DevelopmentPlanCard", () => {
  it("sets a player Out and clears back to healthy with null", async () => {
    const a = actions();
    const p = player();
    renderWithProviders(<DevelopmentPlanCard player={p} canEdit />, {
      team: { team: baseTeam(), currentRole: "head", ...a },
    });
    await userEvent.click(screen.getByText("Out"));
    expect(a.setPlayerHealth).toHaveBeenCalledWith("p1", { status: "out" });

    await userEvent.click(screen.getByText("Healthy"));
    expect(a.setPlayerHealth).toHaveBeenLastCalledWith("p1", null);
  });

  it("shows the availability warning while Out", () => {
    renderWithProviders(
      <DevelopmentPlanCard
        player={player({
          health: { status: "out", expectedReturn: "2026-06-10" },
        })}
        canEdit
      />,
      { team: { team: baseTeam(), currentRole: "head", ...actions() } },
    );
    expect(screen.getByText(/games default Ava to absent/)).toBeInTheDocument();
  });

  it("adds a goal and logs a check-in", async () => {
    const a = actions();
    renderWithProviders(<DevelopmentPlanCard player={player()} canEdit />, {
      team: { team: baseTeam(), currentRole: "head", ...a },
    });
    await userEvent.type(
      screen.getByLabelText("New goal for Ava Lopez"),
      "Backhand picks",
    );
    await userEvent.click(screen.getByLabelText("Add goal for Ava Lopez"));
    expect(a.addGoal).toHaveBeenCalledWith("p1", "Backhand picks", undefined);

    await userEvent.type(
      screen.getByLabelText("New check-in for Ava Lopez"),
      "Looked sharp",
    );
    await userEvent.click(screen.getByLabelText("Add check-in for Ava Lopez"));
    expect(a.addCheckIn).toHaveBeenCalledWith("p1", "Looked sharp");
  });

  it("suggests drills matching the focus areas and assigns on tap", async () => {
    const a = actions();
    renderWithProviders(
      <DevelopmentPlanCard
        player={player({ devPlan: { focusAreas: ["contact"] } })}
        canEdit
      />,
      { team: { team: baseTeam(), currentRole: "head", ...a } },
    );
    // Exact evalCategory match pinned first among the dashed suggestions.
    await userEvent.click(screen.getByText("Two-strike battles"));
    expect(a.toggleAssignedDrill).toHaveBeenCalledWith("p1", "d2");
  });

  it("read-only for assistants: no inputs, no removal buttons", () => {
    renderWithProviders(
      <DevelopmentPlanCard
        player={player({
          devPlan: {
            focusAreas: ["contact"],
            goals: [
              { id: "g1", text: "Goal", status: "active", createdAt: "x" },
            ],
            drillIds: ["d1"],
          },
        })}
        canEdit={false}
      />,
      { team: { team: baseTeam(), currentRole: "assistant", ...actions() } },
    );
    expect(screen.queryByLabelText(/New goal/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Remove goal/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Unassign drill/)).not.toBeInTheDocument();
  });

  it("hides entirely when the development module is off", () => {
    const { container } = renderWithProviders(
      <DevelopmentPlanCard player={player()} canEdit />,
      {
        team: {
          team: baseTeam({ disabledFeatures: ["development"] }),
          currentRole: "head",
          ...actions(),
        },
      },
    );
    expect(container).toBeEmptyDOMElement();
  });
});
