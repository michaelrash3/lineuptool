import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PracticeAttendanceReportPage } from "./PracticeAttendanceReportPage";
import { renderWithProviders } from "../../test-utils";

const players = [
  { id: "p1", name: "Ava" },
  { id: "p2", name: "Sam" },
];

// One completed practice with attendance taken (Ava absent), one future
// practice that must never count even though attendance is pre-marked.
const practices = [
  {
    id: "pr1",
    date: "2020-05-01",
    attendance: { p1: "absent", p2: "present" },
  },
  {
    id: "pr2",
    date: "2099-05-01",
    attendance: { p1: "absent" },
  },
];

const renderPage = (ctxOver: any = {}) =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/practices/attendance-report"]}>
      <Routes>
        <Route path="/practices" element={<div>PRACTICES LIST</div>} />
        <Route
          path="/practices/attendance-report"
          element={<PracticeAttendanceReportPage />}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: { players, practices },
        currentRole: "head",
        ...ctxOver,
      },
    },
  );

describe("PracticeAttendanceReportPage", () => {
  it("counts only completed practices and sorts by misses", () => {
    renderPage();
    expect(screen.getByText("Attendance Report")).toBeInTheDocument();
    expect(
      screen.getByText(/Across 1 completed practice with attendance taken/),
    ).toBeInTheDocument();
    // Ava missed the one counted practice; Sam attended it. The future
    // practice's pre-marked absence never counts.
    const rows = screen.getAllByText(/Ava|Sam/).map((el) => el.textContent);
    expect(rows[0]).toBe("Ava");
  });

  it("shows the empty state when nothing has been counted", () => {
    renderPage({ team: { players, practices: [] } });
    expect(
      screen.getByText(/No completed practices with attendance taken yet/),
    ).toBeInTheDocument();
  });

  it("redirects assistants to the practices list", () => {
    renderPage({ currentRole: "assistant" });
    expect(screen.getByText("PRACTICES LIST")).toBeInTheDocument();
  });

  it("Back falls back to the practices list on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("PRACTICES LIST")).toBeInTheDocument();
  });
});
