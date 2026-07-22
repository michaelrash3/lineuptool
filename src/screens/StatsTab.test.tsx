import React from "react";
import { MemoryRouter } from "react-router-dom";
import { screen, fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";
import { StatsTab } from "./StatsTab";
import { renderWithProviders } from "../test-utils";

// The PDF export lazy-loads jspdf and does real canvas work; mock the whole
// renderer so the screen test only asserts the button wires through to it. The
// report shaping is covered by statsReportPdf.test.ts.
const { downloadStatsReportPdfMock } = vi.hoisted(() => ({
  downloadStatsReportPdfMock: vi.fn(),
}));
vi.mock("../stats/statsReportPdf", () => ({
  downloadStatsReportPdf: downloadStatsReportPdfMock,
}));

const team = {
  players: [
    {
      id: "a",
      name: "Apex",
      number: "1",
      stats: {
        ab: 20,
        ops: 1.2,
        avg: 0.4,
        hr: 3,
        pEra: 2.5,
        pWhip: 1.1,
        pGoAo: 2.1,
      },
    },
    {
      id: "b",
      name: "Bolt",
      number: "2",
      stats: {
        ab: 18,
        ops: 0.6,
        avg: 0.25,
        hr: 0,
        pEra: 6.0,
        pWhip: 1.9,
        pGoAo: 0.8,
      },
    },
  ],
  games: [],
  evaluationEvents: [],
  primaryColor: "#1d4ed8",
  tertiaryColor: "#ffffff",
};

describe("StatsTab", () => {
  it("shows an empty state when there are no players (no header card)", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      {
        team: { team: { players: [], games: [] } },
      },
    );
    expect(
      screen.getByText(/Add players and import stats/i),
    ).toBeInTheDocument();
    // The "Stats & Dashboard" title card was removed — content leads the tab.
    expect(screen.queryByText("Stats & Dashboard")).toBeNull();
  });

  it("offers Import Stats at the bottom for head coaches", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      {
        team: { team, currentRole: "head", uploadStatsCsv: jest.fn() },
      },
    );
    expect(screen.getByText("Import Stats")).toBeInTheDocument();
  });

  it("hides Import Stats from assistant coaches", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      {
        team: { team, currentRole: "assistant" },
      },
    );
    expect(screen.queryByText("Import Stats")).not.toBeInTheDocument();
  });

  it("renders the batting table with players and sortable headers", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      { team: { team } },
    );
    expect(screen.getByRole("button", { name: /OPS/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Overall/ })).toBeInTheDocument();
    // Player appears at least in the table (and possibly leader cards).
    expect(
      screen.getAllByRole("button", { name: /Apex/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /Bolt/ }).length,
    ).toBeGreaterThan(0);
    // Pitching-only columns are not shown in the batting view.
    expect(screen.queryByRole("button", { name: /WHIP/ })).toBeNull();
  });

  it("switches to the pitching view and reveals advanced pitching columns", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      { team: { team } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Pitching" }));
    expect(screen.getByRole("button", { name: /WHIP/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SM%/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GO\/AO/ })).toBeInTheDocument();
  });

  it("does not render the removed Game Log or Leaders sections", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      { team: { team } },
    );
    expect(screen.queryByText("Leaders")).toBeNull();
    expect(screen.queryByText(/Season Log|Recent Games|Game Log/i)).toBeNull();
  });

  it("opens the player profile when a name is tapped", () => {
    const openPlayerProfile = jest.fn();
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      {
        team: { team },
        ui: { openPlayerProfile },
      },
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Apex/ })[0]);
    expect(openPlayerProfile).toHaveBeenCalledWith("a");
  });

  it("draws an eval-trend sparkline for a player with multiple rounds", () => {
    const withEvals = {
      ...team,
      evaluationEvents: [
        {
          id: "r1",
          date: "2026-02-01",
          coachRole: "Head",
          grades: { a: { contact: 2, glove: 2 } },
        },
        {
          id: "r2",
          date: "2026-03-01",
          coachRole: "Head",
          grades: { a: { contact: 5, glove: 5 } },
        },
      ],
    };
    const { container } = renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      {
        team: { team: withEvals },
      },
    );
    // The sparkline is a fixed-size recharts AreaChart, which draws paths.
    expect(container.querySelector("svg .recharts-area-curve")).toBeTruthy();
  });

  it("shows the export buttons to assistants too (export is read-only)", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      {
        team: { team, currentRole: "assistant" },
      },
    );
    expect(screen.getByLabelText("Export stats CSV")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Download stats report PDF"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Import Stats")).not.toBeInTheDocument();
  });

  it("downloads the current table as CSV with a success toast", () => {
    const createObjectURL = jest.fn(() => "blob:x");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });
    const { toastValue } = renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      { team: { team } },
    );
    fireEvent.click(screen.getByLabelText("Export stats CSV"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
    expect(toastValue.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" }),
    );
  });

  it("wires the PDF button through to the stats-report builder with scoped rows", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      { team: { team } },
    );
    fireEvent.click(screen.getByLabelText("Download stats report PDF"));
    expect(downloadStatsReportPdfMock).toHaveBeenCalledTimes(1);
    const arg = downloadStatsReportPdfMock.mock.calls[0][0];
    // No teamAge on the fixture → age defaults to 10 → stats lock to Kid Pitch.
    expect(arg.scopeLabel).toBe("Kid Pitch");
    expect(arg.rows.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
  });

  it("marks sortable stat columns with aria-sort and toggles direction", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      { team: { team } },
    );
    // Batting defaults to its marquee stat, OPS, descending. (The <th> takes
    // its accessible name from the button's visible text; the sort state
    // lives in the button's aria-label.)
    expect(screen.getByRole("columnheader", { name: "OPS" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    fireEvent.click(screen.getByRole("button", { name: /Sort by AVG/ }));
    expect(screen.getByRole("columnheader", { name: "AVG" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByRole("columnheader", { name: "OPS" })).toHaveAttribute(
      "aria-sort",
      "none",
    );
    fireEvent.click(screen.getByRole("button", { name: /Sort by AVG/ }));
    expect(screen.getByRole("columnheader", { name: "AVG" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("exposes the pill rows as labelled toggle groups", () => {
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      // 8U team → the pitching-format filter isn't locked, so all three
      // groups render.
      { team: { team: { ...team, teamAge: "8U" } } },
    );
    expect(
      screen.getByRole("group", { name: "Stats view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Pitching format filter" }),
    ).toBeInTheDocument();
    const catGroup = screen.getByRole("group", { name: "Stat category" });
    expect(
      within(catGroup).getByRole("button", { name: "Batting" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(catGroup).getByRole("button", { name: "Pitching" }));
    expect(
      within(catGroup).getByRole("button", { name: "Batting" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(catGroup).getByRole("button", { name: "Pitching" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("surfaces an arm-care banner for an overused Kid-Pitch pitcher", () => {
    const kidPitch = {
      ...team,
      pitchingFormat: "Kid Pitch",
      players: [
        {
          id: "a",
          name: "Apex",
          number: "1",
          stats: {},
          pitching: {
            log: [
              { date: "2026-05-01", pitches: 20 },
              { date: "2026-05-02", pitches: 20 },
              { date: "2026-05-03", pitches: 20 },
            ],
          },
        },
      ],
    };
    renderWithProviders(
      <MemoryRouter>
        <StatsTab />
      </MemoryRouter>,
      {
        team: { team: kidPitch, currentRole: "head" },
      },
    );
    expect(screen.getByText(/Arm Care/i)).toBeInTheDocument();
  });
});
