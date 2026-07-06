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

  it("flags a playing-up kid with a weak eval as Cut / Drop a Division", () => {
    // Baseball age 10 on a 12U team (playing up) with an all-1 eval — that
    // scores ~18/100 and no stats. The over-matched signal is the deep-below
    // cutoff, which only fires because the eval value is now read on the 0–100
    // scale: the old 1–5 cutoff (score <= 2.5) could never be true for a 0–100
    // score, so this kid used to fall through to "Fit".
    renderWithProviders(<RosterDecisionsPanel />, {
      team: {
        team: {
          players: [{ id: "p1", name: "Younger Kid", dob: "2016-01-01" }],
          primaryColor: "#1d4ed8",
          currentSeason: "Spring 2026",
          teamAge: "12U",
          evaluationEvents: [
            headRound({
              p1: {
                glove: 1,
                armStrength: 1,
                contact: 1,
                power: 1,
                speed: 1,
                baserunning: 1,
                baseballIQ: 1,
                coachability: 1,
                approach: 1,
              },
            }),
          ],
        },
        user: { uid: "u1" },
      },
      ui: { setEvalTrendPlayerId: jest.fn() },
    });
    expect(
      screen.getByText(/^Cut \/ Drop a Division \(1\)$/),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Strong Fit \(0\)$/)).toBeInTheDocument();
  });

  it("credits a high-scoring player's eval as above the bar (Strong Fit)", () => {
    // All-5 grades + at-team-average stats → a score in the mid-80s, well above
    // the 66/100 bar, so the Strong Fit rationale calls the eval out.
    renderWithProviders(<RosterDecisionsPanel />, {
      team: {
        team: {
          players: [{ id: "p1", name: "Star", stats: { ops: 0.9 } }],
          primaryColor: "#1d4ed8",
          currentSeason: "2026",
          evaluationEvents: [
            headRound({
              p1: {
                glove: 5,
                armStrength: 5,
                contact: 5,
                power: 5,
                speed: 5,
                baserunning: 5,
                baseballIQ: 5,
                coachability: 5,
                approach: 5,
              },
            }),
          ],
        },
        user: { uid: "u1" },
      },
      ui: { setEvalTrendPlayerId: jest.fn() },
    });
    expect(screen.getByText(/^Strong Fit \(1\)$/)).toBeInTheDocument();
    expect(screen.getByText(/Eval grades above average/)).toBeInTheDocument();
  });
});
