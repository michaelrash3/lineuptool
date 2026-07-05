import { screen, fireEvent } from "@testing-library/react";
import { RosterDecisionsPanel } from "./RosterDecisionsPanel";
import { renderWithProviders } from "../../test-utils";

const headRound = (grades: Record<string, unknown>) => ({
  id: "r1",
  date: "2026-05-01",
  label: "May Eval",
  coachRole: "Head",
  evaluatorId: "u1",
  grades,
});

describe("RosterDecisionsPanel", () => {
  it("renders nothing when the roster is empty", () => {
    renderWithProviders(<RosterDecisionsPanel />, {
      team: {
        team: { players: [], primaryColor: "#1d4ed8", evaluationEvents: [] },
        user: { uid: "u1" },
      },
      ui: { setEvalTrendPlayerId: jest.fn() },
    });
    expect(screen.queryByText("Roster Decisions")).not.toBeInTheDocument();
  });

  it("renders the four decision buckets and the team-average line", () => {
    renderWithProviders(<RosterDecisionsPanel />, {
      team: {
        team: {
          players: [
            { id: "p1", name: "Ava", stats: { ops: 0.9 } },
            { id: "p2", name: "Ben", stats: { ops: 0.4 } },
          ],
          primaryColor: "#1d4ed8",
          currentSeason: "2026",
          evaluationEvents: [
            headRound({
              p1: { approach: 5, speed: 5 },
              p2: { approach: 2, speed: 2 },
            }),
          ],
        },
        user: { uid: "u1" },
      },
      ui: { setEvalTrendPlayerId: jest.fn() },
    });
    expect(screen.getByText("Roster Decisions")).toBeInTheDocument();
    expect(screen.getByText(/^Strong Fit \(\d+\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Fit \(\d+\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Cut Candidates \(\d+\)$/)).toBeInTheDocument();
    expect(
      screen.getByText(/^Cut \/ Drop a Division \(\d+\)$/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Team average score/)).toBeInTheDocument();
  });

  it("tapping a player card opens that player's eval trend", () => {
    const setEvalTrendPlayerId = jest.fn();
    renderWithProviders(<RosterDecisionsPanel />, {
      team: {
        team: {
          players: [{ id: "p1", name: "Ava", stats: { ops: 0.9 } }],
          primaryColor: "#1d4ed8",
          currentSeason: "2026",
          evaluationEvents: [headRound({ p1: { approach: 5, speed: 5 } })],
        },
        user: { uid: "u1" },
      },
      ui: { setEvalTrendPlayerId },
    });
    // The single player renders as a tappable decision card.
    fireEvent.click(screen.getByRole("button", { name: /Ava/ }));
    expect(setEvalTrendPlayerId).toHaveBeenCalledWith("p1");
  });
});
