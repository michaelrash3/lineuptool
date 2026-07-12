import { MemoryRouter, Route, Routes } from "react-router-dom";
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

// Every universal category at one value, so a player's 0–100 score is easy to
// reason about: all-1 ≈ 18/100, all-5 ≈ 84/100.
const allGrades = (v: number) => ({
  glove: v,
  armStrength: v,
  contact: v,
  power: v,
  speed: v,
  baserunning: v,
  baseballIQ: v,
  coachability: v,
  approach: v,
});

describe("RosterDecisionsPanel", () => {
  it("renders nothing when the roster is empty", () => {
    renderWithProviders(
      <MemoryRouter>
        <RosterDecisionsPanel />
      </MemoryRouter>,
      {
        team: {
          team: { players: [], primaryColor: "#1d4ed8", evaluationEvents: [] },
          user: { uid: "u1" },
        },
        ui: { setEvalTrendPlayerId: jest.fn() },
      },
    );
    expect(screen.queryByText("Roster Decisions")).not.toBeInTheDocument();
  });

  it("renders the four decision buckets and the team-average line", () => {
    renderWithProviders(
      <MemoryRouter>
        <RosterDecisionsPanel />
      </MemoryRouter>,
      {
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
      },
    );
    expect(screen.getByText("Roster Decisions")).toBeInTheDocument();
    expect(screen.getByText(/^Strong Fit \(\d+\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Fit \(\d+\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Cut Candidates \(\d+\)$/)).toBeInTheDocument();
    expect(
      screen.getByText(/^Cut \/ Drop a Division \(\d+\)$/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Team average score/)).toBeInTheDocument();
  });

  it("tapping a player card routes to that player's eval trend page", () => {
    renderWithProviders(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<RosterDecisionsPanel />} />
          <Route
            path="/evaluation/trend/:playerId"
            element={<div>TREND PAGE</div>}
          />
        </Routes>
      </MemoryRouter>,
      {
        team: {
          team: {
            players: [{ id: "p1", name: "Ava", stats: { ops: 0.9 } }],
            primaryColor: "#1d4ed8",
            currentSeason: "2026",
            evaluationEvents: [headRound({ p1: { approach: 5, speed: 5 } })],
          },
          user: { uid: "u1" },
        },
      },
    );
    // The single player renders as a tappable decision card.
    fireEvent.click(screen.getByRole("button", { name: /Ava/ }));
    expect(screen.getByText("TREND PAGE")).toBeInTheDocument();
  });

  it("flags a playing-up kid who is below the team's fluid cut line as Cut / Drop a Division", () => {
    // A weak (all-1 ≈ 18/100), no-stats kid playing up (age 10 on 12U) sits far
    // below three strong teammates (all-5 ≈ 84/100) — more than a standard
    // deviation under the team mean — so the relative cut line flags them, and
    // because they're playing up it's a Cut / Drop a Division, not a plain cut.
    renderWithProviders(
      <MemoryRouter>
        <RosterDecisionsPanel />
      </MemoryRouter>,
      {
        team: {
          team: {
            players: [
              { id: "p1", name: "Younger Kid", dob: "2016-01-01" },
              { id: "p2", name: "Star Two" },
              { id: "p3", name: "Star Three" },
              { id: "p4", name: "Star Four" },
            ],
            primaryColor: "#1d4ed8",
            currentSeason: "Spring 2026",
            teamAge: "12U",
            evaluationEvents: [
              headRound({
                p1: allGrades(1),
                p2: allGrades(5),
                p3: allGrades(5),
                p4: allGrades(5),
              }),
            ],
          },
          user: { uid: "u1" },
        },
        ui: { setEvalTrendPlayerId: jest.fn() },
      },
    );
    expect(
      screen.getByText(/^Cut \/ Drop a Division \(1\)$/),
    ).toBeInTheDocument();
    expect(screen.getByText("Younger Kid")).toBeInTheDocument();
  });

  it("still surfaces the weakest on a uniformly-weak team via the absolute floor", () => {
    // Every kid is genuinely weak (all-1 ≈ 18/100) — no spread, so the relative
    // line alone would clear the whole roster. The absolute floor catches them
    // anyway: the playing-up kid is a Cut / Drop a Division, the age-appropriate
    // peers are Cut Candidates. (Under a purely-relative line, all three would
    // wrongly be "Fit".)
    renderWithProviders(
      <MemoryRouter>
        <RosterDecisionsPanel />
      </MemoryRouter>,
      {
        team: {
          team: {
            players: [
              { id: "p1", name: "Younger Kid", dob: "2016-01-01" },
              { id: "p2", name: "Peer Two" },
              { id: "p3", name: "Peer Three" },
            ],
            primaryColor: "#1d4ed8",
            currentSeason: "Spring 2026",
            teamAge: "12U",
            evaluationEvents: [
              headRound({
                p1: allGrades(1),
                p2: allGrades(1),
                p3: allGrades(1),
              }),
            ],
          },
          user: { uid: "u1" },
        },
        ui: { setEvalTrendPlayerId: jest.fn() },
      },
    );
    expect(
      screen.getByText(/^Cut \/ Drop a Division \(1\)$/),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Cut Candidates \(2\)$/)).toBeInTheDocument();
  });

  it("does not flag anyone on a solid, tightly-bunched team", () => {
    // A uniformly AVERAGE team (all-3 ≈ 51/100): no spread, and every kid is
    // above the competitive floor — so neither line fires and nobody is a cut.
    // Proves the floor catches only genuinely-weak rooms, not merely-average ones.
    renderWithProviders(
      <MemoryRouter>
        <RosterDecisionsPanel />
      </MemoryRouter>,
      {
        team: {
          team: {
            players: [
              { id: "p1", name: "Kid One", dob: "2016-01-01" },
              { id: "p2", name: "Kid Two" },
              { id: "p3", name: "Kid Three" },
            ],
            primaryColor: "#1d4ed8",
            currentSeason: "Spring 2026",
            teamAge: "12U",
            evaluationEvents: [
              headRound({
                p1: allGrades(3),
                p2: allGrades(3),
                p3: allGrades(3),
              }),
            ],
          },
          user: { uid: "u1" },
        },
        ui: { setEvalTrendPlayerId: jest.fn() },
      },
    );
    expect(
      screen.getByText(/^Cut \/ Drop a Division \(0\)$/),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Cut Candidates \(0\)$/)).toBeInTheDocument();
  });

  it("credits a high-scoring player's eval as above the bar (Strong Fit)", () => {
    // All-5 grades + at-team-average stats → a score in the mid-80s, well above
    // the 66/100 bar, so the Strong Fit rationale calls the eval out.
    renderWithProviders(
      <MemoryRouter>
        <RosterDecisionsPanel />
      </MemoryRouter>,
      {
        team: {
          team: {
            players: [{ id: "p1", name: "Star", stats: { ops: 0.9 } }],
            primaryColor: "#1d4ed8",
            currentSeason: "2026",
            evaluationEvents: [headRound({ p1: allGrades(5) })],
          },
          user: { uid: "u1" },
        },
        ui: { setEvalTrendPlayerId: jest.fn() },
      },
    );
    expect(screen.getByText(/^Strong Fit \(1\)$/)).toBeInTheDocument();
    expect(screen.getByText(/Eval grades above average/)).toBeInTheDocument();
  });
});
