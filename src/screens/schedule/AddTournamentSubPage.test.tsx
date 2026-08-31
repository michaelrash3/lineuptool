import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AddTournamentSubPage } from "./AddTournamentSubPage";
import { renderWithProviders } from "../../test-utils";

const tournament = { id: "t1", name: "Memorial Bash", gameIds: ["g1", "g2"] };
const games = [
  { id: "g1", date: "2099-06-05", opponent: "Rays" },
  { id: "g2", date: "2099-06-06", opponent: "Cubs" },
];

const renderPage = (over: any = {}, teamOver: any = {}) =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/schedule/tournaments/t1/subs/new"]}>
      <Routes>
        <Route
          path="/schedule/tournaments/:tournamentId/subs/new"
          element={<AddTournamentSubPage />}
        />
        <Route
          path="/schedule/tournaments/:tournamentId"
          element={<p>Detail</p>}
        />
        <Route path="/schedule" element={<p>Schedule</p>} />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: {
          players: [{ id: "p1", name: "Rostered Kid", number: "42" }],
          games,
          tournaments: [tournament],
          primaryColor: "#123456",
          tertiaryColor: "#ffffff",
          ...teamOver,
        },
        currentRole: "head",
        ...over,
      },
    },
  );

describe("AddTournamentSubPage", () => {
  it("adds the sub against the tournament in the URL", async () => {
    const addSubPlayer = jest.fn(() => "new-sub");
    renderPage({ addSubPlayer });

    await userEvent.type(screen.getByLabelText("Name *"), "Guest Arm");
    await userEvent.type(screen.getByLabelText("Number"), "11");
    await userEvent.selectOptions(screen.getByLabelText("Throws"), "L");
    await userEvent.click(screen.getByRole("button", { name: "P" }));
    await userEvent.click(screen.getByRole("button", { name: "1B" }));
    await userEvent.click(screen.getByRole("button", { name: "Add Sub" }));

    expect(addSubPlayer).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        name: "Guest Arm",
        number: "11",
        throws: "L",
        comfortablePositions: ["P", "1B"],
      }),
    );
  });

  it("says up front that a sub is not a roster add", () => {
    renderPage();
    expect(
      screen.getByText(/never join your roster, count against the cap/),
    ).toBeInTheDocument();
  });

  it("names the games the sub will be available for", () => {
    renderPage();
    expect(screen.getByText(/Available for 2 games/)).toBeInTheDocument();
  });

  it("warns when the jersey number is already in the dugout", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText("Number"), "42");
    expect(
      screen.getByText(/already worn by Rostered Kid/),
    ).toBeInTheDocument();
  });

  it("refuses to submit a nameless sub", async () => {
    const addSubPlayer = jest.fn();
    renderPage({ addSubPlayer });
    await userEvent.click(screen.getByRole("button", { name: "Add Sub" }));
    expect(addSubPlayer).not.toHaveBeenCalled();
  });

  it("bounces an assistant back to the tournament", () => {
    renderPage({ currentRole: "assistant" });
    expect(screen.getByText("Detail")).toBeInTheDocument();
  });

  it("bounces to the schedule when the tournament is gone", () => {
    renderPage({}, { tournaments: [] });
    expect(screen.getByText("Schedule")).toBeInTheDocument();
  });
});
