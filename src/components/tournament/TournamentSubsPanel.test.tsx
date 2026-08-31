import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TournamentSubsPanel } from "./TournamentSubsPanel";
import { renderWithProviders } from "../../test-utils";

const tournament = {
  id: "t1",
  name: "Memorial Bash",
  gameIds: ["g1", "g2"],
};

const players = [
  { id: "p1", name: "Rostered Kid", number: "7" },
  {
    id: "s1",
    name: "Guest Arm",
    number: "42",
    isSub: true,
    subTournamentIds: ["t1"],
    comfortablePositions: ["P", "1B"],
  },
  {
    id: "s2",
    name: "Other Weekend Kid",
    number: "3",
    isSub: true,
    subTournamentIds: ["t2"],
  },
  { id: "s3", name: "Anywhere Kid", isSub: true, subTournamentIds: ["t1"] },
];

const renderPanel = (over: any = {}) =>
  renderWithProviders(
    <MemoryRouter>
      <TournamentSubsPanel tournament={tournament as any} />
    </MemoryRouter>,
    {
      team: {
        team: { players, games: [], tournaments: [tournament] },
        currentRole: "head",
        ...over,
      },
    },
  );

describe("TournamentSubsPanel", () => {
  it("lists this tournament's subs and nobody else's", () => {
    renderPanel();
    expect(screen.getByText("Guest Arm")).toBeInTheDocument();
    expect(screen.getByText("Anywhere Kid")).toBeInTheDocument();
    // A sub borrowed for a different weekend, and the actual roster, stay out.
    expect(screen.queryByText("Other Weekend Kid")).not.toBeInTheDocument();
    expect(screen.queryByText("Rostered Kid")).not.toBeInTheDocument();
  });

  it("shows where each sub can play, defaulting to anywhere", () => {
    renderPanel();
    expect(screen.getByText("P · 1B")).toBeInTheDocument();
    expect(screen.getByText("Anywhere")).toBeInTheDocument();
  });

  it("links the head to the add-sub page", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: "Add sub" })).toHaveAttribute(
      "href",
      "/schedule/tournaments/t1/subs/new",
    );
  });

  it("hides both add and remove from an assistant", () => {
    renderPanel({ currentRole: "assistant" });
    expect(screen.queryByRole("link", { name: "Add sub" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Remove Guest Arm/ }),
    ).toBeNull();
    // Read access is unaffected.
    expect(screen.getByText("Guest Arm")).toBeInTheDocument();
  });

  it("removing a sub reports the tournament it is being dropped from", async () => {
    const removeSubFromTournament = jest.fn();
    renderPanel({ removeSubFromTournament });
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Guest Arm" }),
    );
    expect(removeSubFromTournament).toHaveBeenCalledWith("s1", "t1");
  });

  it("explains the empty state rather than rendering a bare card", () => {
    renderWithProviders(
      <MemoryRouter>
        <TournamentSubsPanel tournament={tournament as any} />
      </MemoryRouter>,
      {
        team: {
          team: { players: [players[0]], games: [], tournaments: [tournament] },
          currentRole: "head",
        },
      },
    );
    expect(screen.getByText(/No subs for this tournament/)).toBeInTheDocument();
  });
});
