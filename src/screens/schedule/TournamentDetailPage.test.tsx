import React from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TournamentDetailPage } from "./TournamentDetailPage";
import { ConfirmContext } from "../../contexts";
import { renderWithProviders, makeConfirm } from "../../test-utils";

const games = [
  { id: "g1", date: "2099-06-05", opponent: "Rays" },
  { id: "g2", date: "2099-06-06", opponent: "Cubs" },
  { id: "g3", date: "2099-06-07", opponent: "Mets" },
];

const baseTeam = (over: any = {}) => ({
  games,
  tournaments: [{ id: "t1", name: "Memorial Bash", gameIds: ["g2", "g1"] }],
  players: [],
  leagueRuleSet: "USSSA",
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  ...over,
});

const renderPage = (
  teamOver: any = {},
  ctxOver: any = {},
  {
    path = "/schedule/tournaments/t1",
    confirm = makeConfirm(),
    promptText = jest.fn().mockResolvedValue(null),
  }: any = {},
) => {
  const updateTournament = jest.fn();
  const removeTournament = jest.fn().mockResolvedValue(true);
  const utils = renderWithProviders(
    <ConfirmContext.Provider value={{ confirm, promptText } as any}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/schedule" element={<div>SCHEDULE LIST</div>} />
          <Route
            path="/schedule/tournaments/:tournamentId"
            element={<TournamentDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </ConfirmContext.Provider>,
    {
      team: {
        team: baseTeam(teamOver),
        currentRole: "head",
        updateTournament,
        removeTournament,
        ...ctxOver,
      },
    },
  );
  return { ...utils, updateTournament, removeTournament, confirm, promptText };
};

describe("TournamentDetailPage", () => {
  it("renders the tournament header, chronological games, and the pitch-plan panel", () => {
    renderPage();
    expect(screen.getByText("Memorial Bash")).toBeInTheDocument();
    // Date range + game count under the title.
    expect(screen.getByText(/2 games/)).toBeInTheDocument();
    // Games appear in the list and again inside the pitch-plan panel.
    expect(screen.getAllByText(/vs Rays/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/vs Cubs/).length).toBeGreaterThan(0);
    // Unlinked g3 stays out of the read view.
    expect(screen.queryByText(/vs Mets/)).not.toBeInTheDocument();
  });

  it("shows a Final score chip for finalized games and a Pool/Bracket chip otherwise", () => {
    renderPage({
      games: [
        {
          id: "g1",
          date: "2099-06-05",
          opponent: "Rays",
          status: "final",
          teamScore: 7,
          opponentScore: 3,
        },
        { id: "g2", date: "2099-06-06", opponent: "Cubs", gameType: "bracket" },
      ],
    });
    expect(screen.getByText(/Final 7-3/)).toBeInTheDocument();
    expect(screen.getByText("Bracket")).toBeInTheDocument();
  });

  it("redirects to the schedule for an unknown tournament id", () => {
    renderPage({}, {}, { path: "/schedule/tournaments/nope" });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects to the schedule when the tournaments module is off", () => {
    renderPage({ disabledFeatures: ["tournaments"] });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("hides rename/delete/edit-games controls from assistants", () => {
    renderPage({}, { currentRole: "assistant" });
    expect(screen.getByText("Memorial Bash")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Rename Memorial Bash"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Delete Memorial Bash"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Edit games")).not.toBeInTheDocument();
  });

  it("renames through promptText", async () => {
    const promptText = jest.fn().mockResolvedValue("June Classic");
    const { updateTournament } = renderPage({}, {}, { promptText });
    fireEvent.click(screen.getByLabelText("Rename Memorial Bash"));
    await waitFor(() =>
      expect(updateTournament).toHaveBeenCalledWith("t1", {
        name: "June Classic",
      }),
    );
    expect(promptText).toHaveBeenCalledWith(
      expect.objectContaining({ defaultValue: "Memorial Bash" }),
    );
  });

  it("keeps the name when the rename prompt is dismissed", async () => {
    const promptText = jest.fn().mockResolvedValue(null);
    const { updateTournament } = renderPage({}, {}, { promptText });
    fireEvent.click(screen.getByLabelText("Rename Memorial Bash"));
    await act(async () => {});
    expect(promptText).toHaveBeenCalled();
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it("deletes and navigates back to the schedule", async () => {
    window.history.replaceState({ idx: 0 }, "");
    const { removeTournament } = renderPage();
    fireEvent.click(screen.getByLabelText("Delete Memorial Bash"));
    expect(await screen.findByText("SCHEDULE LIST")).toBeInTheDocument();
    expect(removeTournament).toHaveBeenCalledWith("t1");
  });

  it("stays on the page when the delete confirm is declined", async () => {
    const removeTournament = jest.fn().mockResolvedValue(false);
    renderPage({}, { removeTournament });
    fireEvent.click(screen.getByLabelText("Delete Memorial Bash"));
    await act(async () => {});
    expect(removeTournament).toHaveBeenCalledWith("t1");
    expect(screen.queryByText("SCHEDULE LIST")).not.toBeInTheDocument();
    expect(screen.getByText("Memorial Bash")).toBeInTheDocument();
  });

  it("Edit games lists unclaimed candidates and links one via updateTournament", async () => {
    const { updateTournament } = renderPage();
    fireEvent.click(screen.getByText("Edit games"));
    fireEvent.click(screen.getByRole("checkbox", { name: /vs Mets/ }));
    await waitFor(() =>
      expect(updateTournament).toHaveBeenCalledWith("t1", {
        gameIds: ["g2", "g1", "g3"],
      }),
    );
  });

  it("excludes games claimed by another tournament from the candidates", () => {
    renderPage({
      tournaments: [
        { id: "t1", name: "Memorial Bash", gameIds: ["g1"] },
        { id: "t2", name: "Other Bash", gameIds: ["g3"] },
      ],
    });
    fireEvent.click(screen.getByText("Edit games"));
    // Its own game plus the unclaimed g2 remain offered; g3 belongs to t2.
    expect(screen.getByRole("checkbox", { name: /vs Rays/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /vs Cubs/ })).not.toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: /vs Mets/ }),
    ).not.toBeInTheDocument();
  });

  it("asks before unlinking the last game and honors a decline", async () => {
    const confirm = makeConfirm(false);
    const { updateTournament } = renderPage(
      { tournaments: [{ id: "t1", name: "Memorial Bash", gameIds: ["g1"] }] },
      {},
      { confirm },
    );
    fireEvent.click(screen.getByText("Edit games"));
    fireEvent.click(screen.getByRole("checkbox", { name: /vs Rays/ }));
    await act(async () => {});
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ danger: true }),
    );
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it("unlinks the last game after the confirm is accepted", async () => {
    const confirm = makeConfirm(true);
    const { updateTournament } = renderPage(
      { tournaments: [{ id: "t1", name: "Memorial Bash", gameIds: ["g1"] }] },
      {},
      { confirm },
    );
    fireEvent.click(screen.getByText("Edit games"));
    fireEvent.click(screen.getByRole("checkbox", { name: /vs Rays/ }));
    await waitFor(() =>
      expect(updateTournament).toHaveBeenCalledWith("t1", { gameIds: [] }),
    );
  });

  it("Back falls back to the schedule on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });
});
