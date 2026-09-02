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
  // ---- Per-team eval categories (docs/EVALUATIONS-AUDIT.md §4) -------------
  const renderWithConfig = (teamOver: Record<string, unknown>) =>
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
            ...teamOver,
          },
          user: { uid: "u1" },
        },
        ui: { setEvalTrendPlayerId: jest.fn() },
      },
    );

  it("counts a team's own category in the eval-vs-bar rationale", () => {
    // These grades score 67/100 — just over the 66 "above the bar" line. A
    // floor grade on the team's own category pulls it to 64, so the rationale
    // must stop claiming the eval is above average. A panel that ignored team
    // categories would still read 67 and keep the line.
    const nearBar = { ...allGrades(4), coachability: 3 };
    const { unmount } = renderWithConfig({
      evaluationEvents: [headRound({ p1: nearBar })],
    });
    expect(screen.getByText(/Eval grades above average/)).toBeInTheDocument();
    unmount();

    renderWithConfig({
      evalCustomCategories: [
        { id: "custom_bunting", label: "Bunting", group: "Hitting" },
      ],
      evaluationEvents: [headRound({ p1: { ...nearBar, custom_bunting: 1 } })],
    });
    expect(
      screen.queryByText(/Eval grades above average/),
    ).not.toBeInTheDocument();
  });

  it("counts a team's own category in the roster-decision score", () => {
    // Baseline: all-5 built-ins, no team categories → a frozen 86.
    const { unmount } = renderWithConfig({
      evaluationEvents: [headRound({ p1: allGrades(5) })],
    });
    expect(screen.getAllByText("86").length).toBeGreaterThan(0);
    unmount();

    // Same round, but the team added a category and graded it at the FLOOR.
    // The score must come down — if the panel ignored team categories it
    // would still read 84.
    renderWithConfig({
      evalCustomCategories: [
        { id: "custom_bunting", label: "Bunting", group: "Hitting" },
      ],
      evaluationEvents: [
        headRound({ p1: { ...allGrades(5), custom_bunting: 1 } }),
      ],
    });
    // 86 → 82: the floor grade on the team's own category pulls the score
    // down. If the panel ignored team categories it would still read 86.
    expect(screen.getAllByText("82").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("86")).toHaveLength(0);
  });
});

// The ranking adds premiums on top of the eval score, and a pitching bonus is
// worth several rank places — so a card that ranks above a better-graded kid
// has to say why rather than leaving the coach to reverse-engineer it.
describe("RosterDecisionsPanel — standing breakdown", () => {
  const renderRoster = (
    players: Record<string, unknown>[],
    grades: Record<string, unknown>,
  ) =>
    renderWithProviders(
      <MemoryRouter>
        <RosterDecisionsPanel />
      </MemoryRouter>,
      {
        team: {
          team: {
            players,
            primaryColor: "#1d4ed8",
            currentSeason: "2026",
            teamAge: "10U",
            pitchingFormat: "Kid Pitch",
            evaluationEvents: [headRound(grades)],
          },
          user: { uid: "u1" },
        },
        ui: { setEvalTrendPlayerId: jest.fn() },
      },
    );

  const pitcher = {
    id: "p1",
    name: "Ava",
    stats: { ops: 0.9 },
    comfortablePositions: ["P"],
  };
  const other = { id: "p2", name: "Ben", stats: { ops: 0.5 } };

  // The pitching premium scores its own categories; without them neutralFill
  // leaves it at zero (which the "stays off the card" case relies on). Middling
  // universal grades keep the total clear of the 100 ceiling, so the premiums
  // land at full value — see the cap case at the end.
  const acePitching = { velocity: 5, strikes: 5, offSpeed: 5, composure: 5 };
  const midPitcherGrades = { ...allGrades(3), ...acePitching };

  it("shows the pitching premium as its own term", () => {
    renderRoster([pitcher, other], {
      p1: midPitcherGrades,
      p2: allGrades(3),
    });
    expect(screen.getByText(/pitching$/)).toBeInTheDocument();
  });

  it("names the lefty nudge separately from the pitching premium", () => {
    renderRoster([{ ...pitcher, throws: "L" }, other], {
      p1: midPitcherGrades,
      p2: allGrades(3),
    });
    expect(screen.getByText(/pitching$/)).toBeInTheDocument();
    expect(screen.getByText(/lefty$/)).toBeInTheDocument();
  });

  // Most of the roster has no premium at all; a breakdown reading
  // "Eval 62 = 62 ranked" would be noise on every card.
  it("stays off the card when nothing was added", () => {
    renderRoster([{ id: "p1", name: "Ava", stats: { ops: 0.9 } }, other], {
      p1: allGrades(4),
      p2: allGrades(3),
    });
    expect(screen.queryByText(/pitching$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/lefty$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ranked$/)).not.toBeInTheDocument();
  });

  // The whole point is that the arithmetic is checkable, so the parts have to
  // reconcile to the number the sort actually uses.
  it("adds up: eval plus every premium equals the ranked score", () => {
    const { container } = renderRoster([{ ...pitcher, throws: "L" }, other], {
      p1: midPitcherGrades,
      p2: allGrades(3),
    });
    const m = (container.textContent || "").match(
      /Eval (\d+)\s*\+ (\d+) pitching\s*\+ (\d+) lefty\s*= (\d+) ranked/,
    );
    expect(m).not.toBeNull();
    const [, base, pitch, lefty, ranked] = (m as RegExpMatchArray).map(Number);
    expect(base + pitch + lefty).toBe(ranked);
  });

  // A kid already near the ceiling gets less than the headline premium,
  // because the standing is capped at 100. The breakdown shows what was
  // actually applied, so the parts still reconcile instead of claiming a
  // bonus the ranking never gave.
  it("shows the clipped value when the premium hits the 100 cap", () => {
    const { container } = renderRoster([{ ...pitcher, throws: "L" }, other], {
      p1: { ...allGrades(5), ...acePitching },
      p2: allGrades(3),
    });
    const text = container.textContent || "";
    const m = text.match(/Eval (\d+)\s*\+ (\d+) pitching\s*= (\d+) ranked/);
    expect(m).not.toBeNull();
    const [, base, pitch, ranked] = (m as RegExpMatchArray).map(Number);
    expect(ranked).toBe(100);
    expect(base + pitch).toBe(100);
    // Pinned below the full premium: the cap ate the rest, including every
    // point of the lefty nudge, so no lefty term is claimed.
    expect(pitch).toBeLessThan(15);
    expect(text).not.toMatch(/lefty/);
  });
});
