import { vi } from "vitest";
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HomeTab } from "./HomeTab";
import { renderWithProviders } from "../test-utils";

const emptyTeam = {
  players: [],
  coaches: [],
  games: [],
  evaluationEvents: [],
  leagueRuleSet: "USSSA",
  teamAge: "10U",
  currentSeason: "Spring 2026",
  pitchingFormat: "Kid Pitch",
  primaryColor: "#1d4ed8",
  tertiaryColor: "#ffffff",
};

describe("HomeTab", () => {
  // HomeTab derives "today" from `new Date()` internally, and the dashboard's
  // "This Week" section only surfaces games/practices in the next 7 days. Pin
  // the clock so fixtures dated 2026-06-18/19 stay in-window regardless of when
  // the suite runs — otherwise the test silently rots once the real date passes
  // them. Fake only Date (not timers) so RTL/animation scheduling stays real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-18T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the dashboard without crashing for an empty team", () => {
    renderWithProviders(
      <MemoryRouter>
        <HomeTab />
      </MemoryRouter>,
      {
        team: {
          team: emptyTeam,
          teams: [{ id: "t1", name: "Hawks" }],
          activeTeamId: "t1",
          record: { wins: 0, losses: 0, ties: 0 },
          user: { uid: "u1" },
          currentRole: "head",
        },
        ui: {
          setIsAddingGame: jest.fn(),
          openAddPlayer: jest.fn(),
        },
      },
    );
    // With an empty roster the dashboard shows a "get a roster in place"
    // prompt — a stable anchor proving the screen mounted without crashing.
    expect(screen.getByText(/add players to the roster/i)).toBeInTheDocument();
  });

  it("shows the Kid Pitch / Machine record split when the team played both", () => {
    renderWithProviders(
      <MemoryRouter>
        <HomeTab />
      </MemoryRouter>,
      {
        team: {
          team: emptyTeam,
          teams: [{ id: "t1", name: "Hawks" }],
          activeTeamId: "t1",
          record: {
            wins: 5,
            losses: 3,
            ties: 0,
            byFormat: {
              kidPitch: { wins: 3, losses: 1, ties: 0 },
              machine: { wins: 2, losses: 2, ties: 0 },
            },
          },
          user: { uid: "u1" },
          currentRole: "head",
        },
        ui: { setIsAddingGame: jest.fn(), openAddPlayer: jest.fn() },
      },
    );
    expect(screen.getByText(/Kid Pitch 3–1/)).toBeInTheDocument();
    expect(screen.getByText(/Machine\/Coach 2–2/)).toBeInTheDocument();
  });

  it("renders the new dashboard tiles (summary, run/streak, attendance, this week)", () => {
    renderWithProviders(
      <MemoryRouter>
        <HomeTab />
      </MemoryRouter>,
      {
        team: {
          team: {
            ...emptyTeam,
            players: [
              {
                id: "p1",
                name: "Ava Rivera",
                stats: {
                  ab: 10,
                  h: 4,
                  avg: 0.4,
                  obp: 0.45,
                  ops: 0.9,
                  hr: 1,
                  rbi: 5,
                },
              },
            ],
            games: [
              {
                id: "g1",
                date: "2026-05-01",
                status: "final",
                opponent: "Tigers",
                teamScore: 7,
                opponentScore: 3,
                attendance: { p1: true },
              },
              {
                id: "g2",
                date: "2026-06-19",
                status: "draft",
                opponent: "Bears",
                time: "10:00",
              },
            ],
            practices: [
              { id: "pr1", date: "2026-06-18", attendance: { p1: false } },
            ],
          },
          teams: [{ id: "t1", name: "Hawks" }],
          activeTeamId: "t1",
          record: { wins: 1, losses: 0, ties: 0 },
          user: { uid: "u1" },
          currentRole: "head",
        },
        ui: {
          setIsAddingGame: jest.fn(),
          openAddPlayer: jest.fn(),
          openPlayerProfile: jest.fn(),
          setActiveTab: jest.fn(),
        },
      },
    );
    expect(screen.getByText("Team Summary")).toBeInTheDocument();
    expect(screen.getByText("Run Diff & Streak")).toBeInTheDocument();
    // Attendance tile's unique line (the word "Attendance" alone also appears
    // in the Up Next digest).
    expect(screen.getByText(/present ·/)).toBeInTheDocument();
    expect(screen.getByText("This Week")).toBeInTheDocument();
    expect(screen.getByText("vs Bears")).toBeInTheDocument();
  });

  it("This Week shows each game's start time and orders a day by the clock", () => {
    // Games store first pitch as a startUtc instant (no `time` field), and a
    // "10:00 AM" label sorts ahead of "9:00 AM" as text.
    const at = (h: number) => new Date(2026, 5, 19, h, 0).toISOString();
    const label = (iso: string) =>
      new Date(iso).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    renderWithProviders(
      <MemoryRouter>
        <HomeTab />
      </MemoryRouter>,
      {
        team: {
          team: {
            ...emptyTeam,
            players: [{ id: "p1", name: "Ava Rivera" }],
            games: [
              {
                id: "late",
                date: "2026-06-19",
                status: "draft",
                opponent: "Bears",
                startUtc: at(10),
              },
              {
                id: "early",
                date: "2026-06-19",
                status: "draft",
                opponent: "Cubs",
                startUtc: at(9),
              },
            ],
          },
          teams: [{ id: "t1", name: "Hawks" }],
          activeTeamId: "t1",
          record: { wins: 0, losses: 0, ties: 0 },
          user: { uid: "u1" },
          currentRole: "head",
        },
        ui: {
          setIsAddingGame: jest.fn(),
          openAddPlayer: jest.fn(),
          openPlayerProfile: jest.fn(),
          setActiveTab: jest.fn(),
        },
      },
    );
    const early = screen.getByText("vs Cubs").closest("button")!;
    const late = screen.getByText("vs Bears").closest("button")!;
    expect(early).toHaveTextContent(label(at(9)));
    expect(late).toHaveTextContent(label(at(10)));
    expect(
      early.compareDocumentPosition(late) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("suppresses dashboard surfaces that deep-link into disabled features", () => {
    // A team with an in-window practice AND pressing unpaid team fees. With
    // Practices/Finances switched off in Settings, the "This Week" practice
    // card and the fee-nag Up Next card must both disappear — their CTAs
    // would deep-link into tabs that no longer exist. Games stay.
    const richTeam = (disabledFeatures?: string[]) => ({
      ...emptyTeam,
      ...(disabledFeatures ? { disabledFeatures } : {}),
      players: [{ id: "p1", name: "Ava Rivera", stats: { ab: 4, h: 2 } }],
      games: [
        {
          id: "g2",
          date: "2026-06-19",
          status: "draft",
          opponent: "Bears",
          time: "10:00",
        },
      ],
      practices: [{ id: "pr1", date: "2026-06-18", location: "Field 4" }],
      finances: {
        clubFee: 100,
        feeDueDate: "2026-06-25", // 7 days out → inside the 14-day nag window
        payments: [],
      },
    });
    const mount = (disabled?: string[]) =>
      renderWithProviders(
        <MemoryRouter>
          <HomeTab />
        </MemoryRouter>,
        {
          team: {
            team: richTeam(disabled),
            teams: [{ id: "t1", name: "Hawks" }],
            activeTeamId: "t1",
            record: { wins: 0, losses: 0, ties: 0 },
            user: { uid: "u1" },
            currentRole: "head",
          },
          ui: {
            setIsAddingGame: jest.fn(),
            openAddPlayer: jest.fn(),
            openPlayerProfile: jest.fn(),
            setActiveTab: jest.fn(),
          },
        },
      );

    // Everything on: both surfaces render.
    const first = mount();
    expect(screen.getByText(/Practice · Field 4/)).toBeInTheDocument();
    expect(screen.getByText(/in team fees outstanding/)).toBeInTheDocument();
    first.unmount();

    // Practices + Finances off: both surfaces gone, the game card stays.
    mount(["practices", "finances"]);
    expect(screen.queryByText(/Practice · Field 4/)).toBeNull();
    expect(screen.queryByText(/in team fees outstanding/)).toBeNull();
    expect(screen.getByText("vs Bears")).toBeInTheDocument();
  });

  it("hides the split when only one format has games (no redundancy)", () => {
    renderWithProviders(
      <MemoryRouter>
        <HomeTab />
      </MemoryRouter>,
      {
        team: {
          team: emptyTeam,
          teams: [{ id: "t1", name: "Hawks" }],
          activeTeamId: "t1",
          record: {
            wins: 3,
            losses: 1,
            ties: 0,
            byFormat: {
              kidPitch: { wins: 3, losses: 1, ties: 0 },
              machine: { wins: 0, losses: 0, ties: 0 },
            },
          },
          user: { uid: "u1" },
          currentRole: "head",
        },
        ui: { setIsAddingGame: jest.fn(), openAddPlayer: jest.fn() },
      },
    );
    expect(screen.queryByText(/Machine\/Coach/)).toBeNull();
  });

  it("counts only active-roster players in the next-game Out badge", () => {
    renderWithProviders(
      <MemoryRouter>
        <HomeTab />
      </MemoryRouter>,
      {
        team: {
          team: {
            ...emptyTeam,
            players: [
              { id: "a1", name: "Active One", present: true, stats: {} },
              { id: "a2", name: "Active Two", present: true, stats: {} },
              { id: "a3", name: "Active Three", present: true, stats: {} },
              // Inactive/released kids get auto-marked absent during prep —
              // they must NOT inflate the "Out" badge.
              { id: "x1", name: "Inactive One", present: false, stats: {} },
              { id: "x2", name: "Inactive Two", present: false, stats: {} },
            ],
            games: [
              {
                id: "g1",
                date: "2026-06-19",
                status: "draft",
                opponent: "Bears",
                attendance: {
                  a1: false, // the one kid actually marked out
                  a2: true,
                  a3: true,
                  x1: false, // inactive — should be ignored
                  x2: false, // inactive — should be ignored
                },
              },
            ],
          },
          teams: [{ id: "t1", name: "Hawks" }],
          activeTeamId: "t1",
          record: { wins: 0, losses: 0, ties: 0 },
          user: { uid: "u1" },
          currentRole: "head",
        },
        ui: {
          setIsAddingGame: jest.fn(),
          openAddPlayer: jest.fn(),
        },
      },
    );
    // One active player is out — not three. The badge renders "<n> Out" as two
    // text nodes, so match on the element's full text content.
    expect(
      screen.getByText((_, el) => el?.textContent === "1 Out"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText((_, el) => el?.textContent === "3 Out"),
    ).toBeNull();
  });
  it("routes the Bench Equity tile to the Playing Time page", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomeTab />} />
          <Route path="/playing-time" element={<div>PLAYING TIME PAGE</div>} />
        </Routes>
      </MemoryRouter>,
      {
        team: {
          team: {
            ...emptyTeam,
            players: [
              { id: "a1", name: "Ava", stats: {} },
              { id: "a2", name: "Mia", stats: {} },
            ],
            games: [
              {
                id: "g1",
                date: "2026-06-10",
                status: "final",
                opponent: "Bears",
                teamScore: 5,
                opponentScore: 3,
                playerStats: {
                  a1: { fInnTotal: 4 },
                  a2: { fInnTotal: 0 },
                },
              },
            ],
          },
          teams: [{ id: "t1", name: "Hawks" }],
          activeTeamId: "t1",
          record: { wins: 1, losses: 0, ties: 0 },
          user: { uid: "u1" },
          currentRole: "head",
        },
        ui: {
          setIsAddingGame: jest.fn(),
          openAddPlayer: jest.fn(),
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /Playing time/i }));
    expect(await screen.findByText("PLAYING TIME PAGE")).toBeInTheDocument();
  });

  it("offers to resume a game already under way at the inning it's on", () => {
    const today = {
      id: "g-today",
      date: "2026-06-18",
      time: "18:00",
      opponent: "Rivals",
      status: "scheduled",
      lineup: [{ P: { id: "p1", name: "Ada" } }],
      battingLineup: [],
    };
    const renderWith = (game: Record<string, unknown>) =>
      renderWithProviders(
        <MemoryRouter>
          <HomeTab />
        </MemoryRouter>,
        {
          team: {
            team: { ...emptyTeam, games: [game] },
            teams: [{ id: "t1", name: "Hawks" }],
            activeTeamId: "t1",
            record: { wins: 0, losses: 0, ties: 0 },
            user: { uid: "u1" },
            currentRole: "head",
          },
          ui: { setIsAddingGame: jest.fn(), openAddPlayer: jest.fn() },
        },
      );
    const { unmount } = renderWith(today);
    expect(
      screen.getByRole("button", { name: /start game/i }),
    ).toBeInTheDocument();
    unmount();
    renderWith({ ...today, liveInning: 3 });
    expect(
      screen.getByRole("button", { name: /resume · inning 4/i }),
    ).toBeInTheDocument();
  });
});
