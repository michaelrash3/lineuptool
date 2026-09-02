import React from "react";
import { screen, within } from "@testing-library/react";
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
    stats: { ab: 9, h: 3, avg: 0.333 },
    pitching: { recentPitches: 40 },
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

const renderPanel = (over: any = {}, list: any[] = players) =>
  renderWithProviders(
    <MemoryRouter>
      <TournamentSubsPanel tournament={tournament as any} />
    </MemoryRouter>,
    {
      team: {
        team: { players: list, games: [], tournaments: [tournament] },
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

  it("links the head to the new-sub page", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: "New sub" })).toHaveAttribute(
      "href",
      "/schedule/tournaments/t1/subs/new",
    );
  });

  it("links each sub to their profile, the only place to edit or read them", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: /Guest Arm/ })).toHaveAttribute(
      "href",
      "/roster/guest-arm",
    );
  });

  it("shows the stats a sub has piled up, so they are visibly kept", () => {
    renderPanel();
    expect(screen.getByText(/\.333 · 9 AB/)).toBeInTheDocument();
    expect(screen.getByText(/40 recent pitches/)).toBeInTheDocument();
  });

  it("offers past subs for reuse rather than a fresh record", async () => {
    const addSubToTournament = jest.fn();
    renderPanel({ addSubToTournament });
    // "Other Weekend Kid" is a sub on t2 — reusable here.
    await userEvent.click(screen.getByRole("button", { name: "Add past sub" }));
    await userEvent.click(
      screen.getByRole("button", { name: /Other Weekend Kid/ }),
    );
    expect(addSubToTournament).toHaveBeenCalledWith("s2", "t1");
  });

  it("does not offer subs already on this tournament", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Add past sub" }));
    // Guest Arm is already on t1, so only the other-weekend subs are offered.
    // Scoped to the reuse list: Guest Arm's own row still carries a
    // "Remove Guest Arm" button elsewhere on the card.
    const list = within(screen.getByRole("group", { name: "Past subs" }));
    expect(list.queryByText("Guest Arm")).not.toBeInTheDocument();
    expect(list.getByText("Other Weekend Kid")).toBeInTheDocument();
  });

  it("hides the reuse control when there are no past subs to add", () => {
    renderPanel({}, [players[0], players[1]]);
    expect(
      screen.queryByRole("button", { name: "Add past sub" }),
    ).not.toBeInTheDocument();
  });

  it("hides every edit control from an assistant", () => {
    renderPanel({ currentRole: "assistant" });
    expect(screen.queryByRole("link", { name: "New sub" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add past sub" })).toBeNull();
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
