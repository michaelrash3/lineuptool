import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TournamentCreatePage } from "./TournamentCreatePage";
import { renderWithProviders } from "../../test-utils";

// Two USSSA games one day apart → one derived weekend cluster
// (tour-2099-06-05); g3 sits on its own far-away weekend.
const games = [
  { id: "g1", date: "2099-06-05", opponent: "Rays" },
  { id: "g2", date: "2099-06-06", opponent: "Cubs" },
  { id: "g3", date: "2099-07-20", opponent: "Mets" },
];

const baseTeam = (over: any = {}) => ({
  games,
  tournaments: [],
  players: [],
  leagueRuleSet: "USSSA",
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  ...over,
});

const renderPage = (
  teamOver: any = {},
  ctxOver: any = {},
  path = "/schedule/tournaments/new",
) => {
  const addTournament = jest.fn().mockReturnValue("trn-new");
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule" element={<div>SCHEDULE LIST</div>} />
        <Route
          path="/schedule/tournaments/new"
          element={<TournamentCreatePage />}
        />
        <Route
          path="/schedule/tournaments/:tournamentId"
          element={<div>DETAIL PAGE</div>}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: baseTeam(teamOver),
        currentRole: "head",
        addTournament,
        ...ctxOver,
      },
    },
  );
  return { ...utils, addTournament };
};

describe("TournamentCreatePage", () => {
  it("pre-checks the seed cluster's games and creates with its seedKey, then lands on the detail page", () => {
    const { addTournament } = renderPage(
      {},
      {},
      "/schedule/tournaments/new?seed=tour-2099-06-05",
    );
    expect(screen.getByRole("checkbox", { name: /vs Rays/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /vs Cubs/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /vs Mets/ })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "June Bash" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    expect(addTournament).toHaveBeenCalledWith({
      name: "June Bash",
      gameIds: ["g1", "g2"],
      seedKey: "tour-2099-06-05",
    });
    expect(screen.getByText("DETAIL PAGE")).toBeInTheDocument();
  });

  it("starts empty without a seed and disables Create until a name and a game are picked", () => {
    const { addTournament } = renderPage();
    const create = screen.getByRole("button", { name: /create tournament/i });
    expect(screen.getByRole("checkbox", { name: /vs Rays/ })).not.toBeChecked();
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Solo Weekend" },
    });
    expect(create).toBeDisabled(); // name alone is not enough

    fireEvent.click(screen.getByRole("checkbox", { name: /vs Mets/ }));
    expect(create).toBeEnabled();
    fireEvent.click(create);
    expect(addTournament).toHaveBeenCalledWith({
      name: "Solo Weekend",
      gameIds: ["g3"],
      seedKey: undefined,
    });
  });

  it("stays on the form when addTournament rejects the input", () => {
    const addTournament = jest.fn().mockReturnValue(null);
    renderPage({}, { addTournament });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Bash" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /vs Rays/ }));
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    expect(addTournament).toHaveBeenCalled();
    expect(screen.queryByText("DETAIL PAGE")).not.toBeInTheDocument();
    expect(screen.getByText("Name this tournament")).toBeInTheDocument();
  });

  it("excludes games already claimed by a tournament from the candidates", () => {
    renderPage({
      tournaments: [{ id: "t1", name: "Claimed", gameIds: ["g1", "g2"] }],
    });
    expect(
      screen.queryByRole("checkbox", { name: /vs Rays/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /vs Cubs/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /vs Mets/ }),
    ).toBeInTheDocument();
  });

  it("Cancel falls back to the schedule on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects assistants to the schedule", () => {
    renderPage({}, { currentRole: "assistant" });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects to the schedule when the tournaments module is off", () => {
    renderPage({ disabledFeatures: ["tournaments"] });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });
});
