import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { PlayerProfilePage } from "./PlayerProfilePage";
import { renderWithProviders } from "../test-utils";

// The player profile is a routed PAGE at /roster/:playerId — not a modal.
// These tests pin the page semantics: the URL param drives which player
// renders (deep-linkable), and Back returns to the previous history entry
// (with a roster fallback for deep links that have no in-app history).

// jsdom has no IntersectionObserver; the profile's section scroll-spy needs a
// no-op stand-in to mount.
beforeAll(() => {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const mkPlayer = (id: string, name: string, number: string) => ({
  id,
  name,
  number,
  bats: "R",
  throws: "R",
  present: true,
  stats: {},
  pitching: { recentPitches: 0, lastPitchDate: null },
});

const team = {
  // Three players so the Prev/Next pager has somewhere to go. Ava wears #3, so
  // display order is Bo (#1), Cy (#2), Ava (#3) — which is what pins the pager
  // to jersey order rather than array order.
  players: [
    mkPlayer("p1", "Ava", "3"),
    mkPlayer("p2", "Bo", "1"),
    mkPlayer("p3", "Cy", "2"),
  ],
  games: [],
  evaluationEvents: [],
  currentSeason: "Spring 2026",
  pitchingFormat: "Kid Pitch",
  defenseSize: "10",
  teamAge: "8U",
  primaryColor: "#2563eb",
  secondaryColor: "#f8fafc",
  tertiaryColor: "#ffffff",
};

const PathProbe = () => {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
};

const mountAt = (entries: string[], initialIndex: number) => {
  const setViewingPlayerId = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <Routes>
        <Route path="/roster" element={<div>ROSTER LIST</div>} />
        <Route path="/roster/:playerId" element={<PlayerProfilePage />} />
      </Routes>
    </MemoryRouter>,
    {
      team: { team },
      // The route owns which player renders: PlayerProfilePage mirrors the
      // URL param into viewingPlayerId, which the profile content reads. The
      // test provider is a plain mock, so supply the mirrored value directly
      // and assert the page performed the mirroring call.
      ui: { viewingPlayerId: "p1", setViewingPlayerId } as any,
    },
  );
  return { setViewingPlayerId, ...utils };
};

describe("PlayerProfilePage — a real navigable page", () => {
  it("renders the player from the URL param (deep-linkable)", () => {
    const { setViewingPlayerId } = mountAt(["/roster/p1"], 0);
    expect(setViewingPlayerId).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("heading", { name: "Ava" })).toBeInTheDocument();
  });

  it("Back returns to the PREVIOUS history entry — one press, like any page", () => {
    // Arrived from the roster list: history is [/roster, /roster/p1].
    window.history.replaceState({ idx: 1 }, "");
    mountAt(["/roster", "/roster/p1"], 1);
    // Header back chip and footer Back button do the same thing.
    fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]);
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("carries a roster pager that follows jersey order, not array order", () => {
    // Ava wears #3 and is last in display order, so her only neighbour is
    // Cy (#2) behind her — the pager reads the Roster tab's list order, not
    // the order players happen to sit in the array.
    window.history.replaceState({ idx: 1 }, "");
    mountAt(["/roster", "/roster/p1"], 1);
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous player: #2 Cy" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: /Next player/ })).toBeDisabled();
  });

  it("paging mirrors the new player into the provider without leaving the page", async () => {
    window.history.replaceState({ idx: 1 }, "");
    const { setViewingPlayerId } = mountAt(["/roster", "/roster/p1"], 1);
    await userEvent.click(
      screen.getByRole("button", { name: "Previous player: #2 Cy" }),
    );
    // The route moved to Cy and the page mirrored it into viewingPlayerId,
    // which is what drives the profile content (see the mirroring note above).
    expect(setViewingPlayerId).toHaveBeenCalledWith("p3");
    // And the coach stayed on the profile rather than bouncing to the list.
    expect(screen.queryByText("ROSTER LIST")).not.toBeInTheDocument();
  });

  it("a deep link with no in-app history falls back to the roster", () => {
    // Fresh tab: this entry is the whole history (react-router idx 0).
    window.history.replaceState(null, "");
    mountAt(["/roster/p1"], 0);
    fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]);
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });
});

// The address bar used to read /roster/p-rcq7zzwi. A player's page is a place
// a coach shares and bookmarks, so it is named after the player.
describe("PlayerProfilePage — player names in the URL", () => {
  // The test provider is a plain mock, so the profile CONTENT only renders
  // when viewingPlayerId is supplied directly (as in mountAt above). The
  // address assertions here don't need it; the Back test does.
  const mountPath = (
    entries: string[],
    list = team.players,
    viewingPlayerId: string | null = null,
  ) => {
    const setViewingPlayerId = jest.fn();
    const utils = renderWithProviders(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <PathProbe />
        <Routes>
          <Route path="/roster" element={<div>ROSTER LIST</div>} />
          <Route path="/roster/:playerId" element={<PlayerProfilePage />} />
        </Routes>
      </MemoryRouter>,
      {
        team: { team: { ...team, players: list } },
        ui: { viewingPlayerId, setViewingPlayerId } as any,
      },
    );
    return { setViewingPlayerId, ...utils };
  };

  const path = () => screen.getByTestId("path").textContent;

  it("opens a player from their name", () => {
    const { setViewingPlayerId } = mountPath(["/roster/ava"]);
    expect(setViewingPlayerId).toHaveBeenCalledWith("p1");
    expect(path()).toBe("/roster/ava");
  });

  // Links a coach already texted or bookmarked keep working, and get quietly
  // upgraded to the readable address.
  it("rewrites an old id URL to the player's name", () => {
    const { setViewingPlayerId } = mountPath(["/roster/p1"]);
    expect(path()).toBe("/roster/ava");
    expect(setViewingPlayerId).toHaveBeenCalledWith("p1");
  });

  // The rewrite must REPLACE, or Back would land on the id URL and bounce
  // forward again instead of reaching the roster.
  it("keeps Back one press away after rewriting an id URL", () => {
    window.history.replaceState({ idx: 1 }, "");
    mountPath(["/roster", "/roster/p1"], team.players, "p1");
    expect(path()).toBe("/roster/ava");
    fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]);
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("gives two same-named players distinct working addresses", () => {
    const twins = [
      mkPlayer("p1", "Jack Ryan", "3"),
      mkPlayer("p2", "Jack Ryan", "1"),
      mkPlayer("p3", "Cy", "2"),
    ];
    const { setViewingPlayerId } = mountPath(["/roster/jack-ryan-p2"], twins);
    expect(setViewingPlayerId).toHaveBeenCalledWith("p2");
    expect(path()).toBe("/roster/jack-ryan-p2");
  });

  it("renders nothing for a name that matches no one", () => {
    const { setViewingPlayerId } = mountPath(["/roster/nobody-here"]);
    expect(
      screen.queryByRole("heading", { name: "Ava" }),
    ).not.toBeInTheDocument();
    expect(setViewingPlayerId).toHaveBeenCalledWith("nobody-here");
  });
});
