import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameChangerImportPage } from "./GameChangerImportPage";
import { renderWithProviders } from "../../test-utils";

const renderPage = (teamOver: any = {}, roleOver: any = {}) => {
  const updateTeam = jest.fn();
  const updateTeamArrays = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/schedule/import/gamechanger"]}>
      <Routes>
        <Route path="/schedule" element={<div>SCHEDULE LIST</div>} />
        <Route
          path="/schedule/import/gamechanger"
          element={<GameChangerImportPage />}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: { games: [], ...teamOver },
        currentRole: "head",
        updateTeam,
        updateTeamArrays,
        ...roleOver,
      },
    },
  );
  return { ...utils, updateTeam, updateTeamArrays };
};

describe("GameChangerImportPage", () => {
  it("renders as a page with the feed input and preview action", () => {
    renderPage();
    expect(screen.getByText("Import from GameChanger")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/webcal:\/\/api\.team-manager/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview games/i }),
    ).toBeInTheDocument();
  });

  it("shows a remove button only when a feed is saved, and clears it", () => {
    const { updateTeam } = renderPage({
      gcCalendarUrl: "webcal://old.season/feed.ics",
    });
    const remove = screen.getByRole("button", { name: /remove saved feed/i });
    fireEvent.click(remove);
    expect(updateTeam).toHaveBeenCalledWith({ gcCalendarUrl: "" });
  });

  it("hides the remove button without a saved feed", () => {
    renderPage();
    expect(
      screen.queryByRole("button", { name: /remove saved feed/i }),
    ).not.toBeInTheDocument();
  });

  it("Back falls back to the schedule on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects assistants to the schedule", () => {
    renderPage({}, { currentRole: "assistant" });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });
});
