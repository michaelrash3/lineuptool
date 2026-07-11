import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { UpNextPanel } from "./HomeTab";
import { TeamContext, UIContext } from "../contexts";

// Far-future "today" so the seeded game/practice land inside the 7-day window
// regardless of when the suite runs. Dates below are a few days after.
const TODAY = "2999-05-01";

const baseTeam: any = {
  primaryColor: "#2563eb",
  tertiaryColor: "#fff",
  players: [
    { id: "k1", name: "Ava" },
    { id: "k2", name: "Ben" },
  ],
  games: [
    {
      id: "g1",
      opponent: "Thunder",
      date: "2999-05-03",
      status: "scheduled",
      // no lineup → "Build lineup" row
      attendance: {},
    },
  ],
  finances: {
    clubFee: 100,
    depositAmount: 40,
    depositDueDate: "2999-05-05", // 4 days out — pressing
    feeDueDate: "2999-05-12", // 11 days out — inside the lead window
    payments: [{ id: "p1", playerId: "k1", amount: 100 }], // k1 paid; k2 owes
  },
};

const renderPanel = (overrides: any = {}) => {
  const ui = {
    setActiveTab: jest.fn(),
    setSelectedGameId: jest.fn(),
    setOpponentName: jest.fn(),
    setLineup: jest.fn(),
    setBattingLineup: jest.fn(),
    setCurrentGameAttendance: jest.fn(),
    openPlayerProfile: jest.fn(),
  };
  const team = { ...baseTeam, ...(overrides.team || {}) };
  render(
    <TeamContext.Provider value={{ team } as any}>
      <UIContext.Provider value={ui as any}>
        <UpNextPanel
          isHead={overrides.isHead ?? true}
          promptStatus={
            overrides.promptStatus ?? {
              active: true,
              kind: "monthly",
              nextDueDate: "2999-05-10",
            }
          }
          todayStr={TODAY}
        />
      </UIContext.Provider>
    </TeamContext.Provider>,
  );
  return ui;
};

describe("UpNextPanel", () => {
  it("surfaces lineup, eval and team-fee actions for a head coach", () => {
    renderPanel();
    expect(
      screen.getByText(/build the lineup vs thunder/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/start this round's evaluations/i),
    ).toBeInTheDocument();
    // k2 still owes the full fee and hasn't met the deposit.
    expect(screen.getByText(/team fees outstanding/i)).toBeInTheDocument();
    expect(screen.getByText(/owe the team-fee deposit/i)).toBeInTheDocument();
  });

  it("hides team-fee rows whose due date is far in the future", () => {
    // Both fees are real but due months out — pressing-only Up Next should
    // leave them on the Finances tab, not clutter the dashboard.
    renderPanel({
      team: {
        finances: {
          ...baseTeam.finances,
          depositDueDate: "2999-09-01", // ~4 months out
          feeDueDate: "2999-12-01", // ~7 months out
        },
      },
    });
    expect(
      screen.queryByText(/owe the team-fee deposit/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/team fees outstanding/i),
    ).not.toBeInTheDocument();
    // The near-term, non-fee actions still show.
    expect(
      screen.getByText(/build the lineup vs thunder/i),
    ).toBeInTheDocument();
  });

  it("deep-links the lineup action into the schedule editor", () => {
    const ui = renderPanel();
    const row = screen
      .getByText(/build the lineup vs thunder/i)
      .closest("button") as HTMLButtonElement;
    fireEvent.click(row);
    expect(ui.setSelectedGameId).toHaveBeenCalledWith("g1");
    expect(ui.setActiveTab).toHaveBeenCalledWith("schedule");
  });

  it("snoozes a row so it disappears from the list", () => {
    renderPanel();
    expect(
      screen.getByText(/build the lineup vs thunder/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /snooze: build the lineup vs thunder/i,
      }),
    );
    expect(
      screen.queryByText(/build the lineup vs thunder/i),
    ).not.toBeInTheDocument();
  });

  it("shows only the eval nudge for assistants (no lineup or finances)", () => {
    renderPanel({ isHead: false });
    expect(
      screen.getByText(/send your evaluations to the head coach/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/build the lineup/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/team fees outstanding/i),
    ).not.toBeInTheDocument();
  });

  describe("tournament pitch-plan rows (Kid Pitch 9U+)", () => {
    const kidPitch = {
      teamAge: "10U",
      pitchingFormat: "Kid Pitch",
      players: [
        { id: "k1", name: "Ava", comfortablePositions: ["P"], pitching: {} },
        { id: "k2", name: "Ben", comfortablePositions: ["P"], pitching: {} },
      ],
      games: [
        { id: "g1", opponent: "Rays", date: "2999-05-03", lineup: [{}] },
        { id: "g2", opponent: "Cubs", date: "2999-05-04", lineup: [{}] },
      ],
      finances: { clubFee: 0 },
    };

    it("prompts to set the plan when the weekend has no arms penciled in", () => {
      const ui = renderPanel({
        team: {
          ...kidPitch,
          tournaments: [{ id: "t1", name: "Bash", gameIds: ["g1", "g2"] }],
        },
      });
      // The whole row is one button — click through the title text.
      fireEvent.click(screen.getByText(/set the pitch plan for bash/i));
      expect(ui.setActiveTab).toHaveBeenCalledWith("schedule");
    });

    it("surfaces rest conflicts in a set plan", () => {
      renderPanel({
        team: {
          ...kidPitch,
          tournaments: [
            {
              id: "t1",
              name: "Bash",
              gameIds: ["g1", "g2"],
              pitchPlan: {
                g1: [{ playerId: "k1", role: "start", plannedPitches: 60 }],
                g2: [{ playerId: "k1", role: "start", plannedPitches: 20 }],
              },
            },
          ],
        },
      });
      expect(
        screen.getByText(/1 rest conflict in the Bash pitch plan/i),
      ).toBeInTheDocument();
    });

    it("stays quiet when the plan is set and clean, or the module is off", () => {
      const cleanPlan = {
        ...kidPitch,
        tournaments: [
          {
            id: "t1",
            name: "Bash",
            gameIds: ["g1", "g2"],
            pitchPlan: {
              g1: [{ playerId: "k1", role: "start", plannedPitches: 40 }],
              g2: [{ playerId: "k2", role: "start", plannedPitches: 40 }],
            },
          },
        ],
      };
      renderPanel({ team: cleanPlan });
      expect(screen.queryByText(/pitch plan/i)).not.toBeInTheDocument();

      renderPanel({
        team: {
          ...kidPitch,
          disabledFeatures: ["tournaments"],
          tournaments: [{ id: "t1", name: "Bash", gameIds: ["g1", "g2"] }],
        },
      });
      expect(screen.queryByText(/set the pitch plan/i)).not.toBeInTheDocument();
    });
  });

  describe("injured-player rows", () => {
    it("links a lone injured player straight to their profile", () => {
      const ui = renderPanel({
        team: {
          games: [],
          finances: { clubFee: 0 },
          players: [
            {
              id: "k1",
              name: "Ava",
              health: { status: "out", expectedReturn: "2999-05-06" },
            },
            { id: "k2", name: "Ben" },
          ],
        },
        promptStatus: { active: false },
      });
      expect(screen.getByText(/expected back/i)).toBeInTheDocument();
      fireEvent.click(screen.getByText(/ava is out injured/i));
      expect(ui.openPlayerProfile).toHaveBeenCalledWith("k1");
    });

    it("aggregates several injured players into one roster-bound row", () => {
      const ui = renderPanel({
        team: {
          games: [],
          finances: { clubFee: 0 },
          players: [
            { id: "k1", name: "Ava", health: { status: "out" } },
            { id: "k2", name: "Ben", health: { status: "out" } },
          ],
        },
        promptStatus: { active: false },
      });
      fireEvent.click(screen.getByText(/2 players are out injured/i));
      expect(ui.setActiveTab).toHaveBeenCalledWith("roster");
    });

    it("shows nothing when the development module is off", () => {
      renderPanel({
        team: {
          games: [],
          finances: { clubFee: 0 },
          disabledFeatures: ["development"],
          players: [{ id: "k1", name: "Ava", health: { status: "out" } }],
        },
        promptStatus: { active: false },
      });
      expect(screen.queryByText(/out injured/i)).not.toBeInTheDocument();
    });
  });

  it("renders nothing when there is nothing to do", () => {
    const { container } = (() => {
      renderPanel({
        promptStatus: { active: false },
        team: { games: [], practices: [], finances: { clubFee: 0 } },
      });
      return { container: document.body };
    })();
    expect(within(container).queryByText(/up next/i)).not.toBeInTheDocument();
  });
});
