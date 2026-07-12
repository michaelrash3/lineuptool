import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PastSeasonImportPage } from "./PastSeasonImportPage";
import { renderWithProviders } from "../../test-utils";

const players = [
  { id: "p1", name: "Ava Rivera", number: "7" },
  { id: "p2", name: "Sam Cole", number: "12" },
];

const payload = {
  rows: [
    { csvName: "Rivera, Ava", number: "7", stats: { avg: 0.4 } },
    { csvName: "Unknown Kid", number: "", stats: { avg: 0.2 } },
  ],
  season: "",
  ageGroup: "",
  pitchingFormat: "Kid Pitch",
  assignments: { "Rivera, Ava": "p1", "Unknown Kid": "skip" },
};

const renderPage = (state: any = payload, ctxOver: any = {}) => {
  const bulkAddPastSeasons = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter
      initialEntries={[{ pathname: "/settings/import/past-season", state }]}
    >
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/settings" element={<div>SETTINGS PAGE</div>} />
        <Route
          path="/settings/import/past-season"
          element={<PastSeasonImportPage />}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: { players, primaryColor: "#1d4ed8", tertiaryColor: "#fff" },
        currentRole: "head",
        bulkAddPastSeasons,
        ...ctxOver,
      },
    },
  );
  return { bulkAddPastSeasons, ...utils };
};

describe("PastSeasonImportPage", () => {
  it("renders the parsed rows with their suggested assignments", () => {
    renderPage();
    expect(screen.getByText("Import Past Season Stats")).toBeInTheDocument();
    expect(screen.getByText("Rivera, Ava")).toBeInTheDocument();
    expect(screen.getByText("Unknown Kid")).toBeInTheDocument();
    expect(screen.getByText("1 matched · 1 skipped")).toBeInTheDocument();
  });

  it("commits matched rows once season and age group are filled", () => {
    window.history.replaceState({ idx: 0 }, "");
    const { bulkAddPastSeasons } = renderPage();
    fireEvent.change(screen.getByLabelText("Season *"), {
      target: { value: "Spring 2025" },
    });
    fireEvent.change(screen.getByLabelText("Age Group *"), {
      target: { value: "9U" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(bulkAddPastSeasons).toHaveBeenCalledWith([
      {
        playerId: "p1",
        season: "Spring 2025",
        ageGroup: "9U",
        pitchingFormat: "Kid Pitch",
        stats: { avg: 0.4 },
      },
    ]);
    // back() falls back to Settings on a deep-linked entry.
    expect(screen.getByText("SETTINGS PAGE")).toBeInTheDocument();
  });

  it("disables Import until the required fields are set", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("reassigning a row updates the matched count", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Assign Unknown Kid"), {
      target: { value: "p2" },
    });
    expect(screen.getByText("2 matched · 0 skipped")).toBeInTheDocument();
  });

  it("bounces to Settings when there is no payload (refresh / cold link)", () => {
    renderPage(null);
    expect(screen.getByText("SETTINGS PAGE")).toBeInTheDocument();
  });

  it("redirects assistants home, like the rest of /settings", () => {
    renderPage(payload, { currentRole: "assistant" });
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });
});
