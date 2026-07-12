import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ScheduleImportPage } from "./ScheduleImportPage";
import { renderWithProviders } from "../../test-utils";

const renderPage = (roleOver: any = {}) => {
  const uploadScheduleCsv = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/schedule/import"]}>
      <Routes>
        <Route path="/schedule" element={<div>SCHEDULE LIST</div>} />
        <Route path="/schedule/import" element={<ScheduleImportPage />} />
        <Route
          path="/schedule/import/gamechanger"
          element={<div>GC IMPORT PAGE</div>}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: { games: [] },
        currentRole: "head",
        uploadScheduleCsv,
        ...roleOver,
      },
    },
  );
  return { ...utils, uploadScheduleCsv };
};

describe("ScheduleImportPage", () => {
  it("offers both import paths and links to the GameChanger page", () => {
    renderPage();
    expect(screen.getByText("Import Schedule")).toBeInTheDocument();
    fireEvent.click(screen.getByText("From GameChanger"));
    expect(screen.getByText("GC IMPORT PAGE")).toBeInTheDocument();
  });

  it("runs the CSV upload and returns to the schedule", () => {
    window.history.replaceState({ idx: 0 }, "");
    const { uploadScheduleCsv } = renderPage();
    const input = document.getElementById(
      "schedule-import-csv",
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["date,opponent"], "s.csv")] },
    });
    expect(uploadScheduleCsv).toHaveBeenCalled();
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects assistants to the schedule", () => {
    renderPage({ currentRole: "assistant" });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });
});
