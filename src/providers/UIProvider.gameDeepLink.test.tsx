import React, { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// A game id that arrives from the URL (refresh or deep link on
// /schedule/game/:id or /in-game/:id) is set BEFORE the games have loaded.
// The "this game was deleted" cleanup used to read the still-empty list as
// proof and clear the id, dropping the coach back to the schedule — mid-game,
// on the screen they most need to survive a reload.

vi.mock("../firebase", () => ({ auth: {}, db: {}, appId: "test-app" }));

import { UIProvider } from "./UIProvider";
import { TeamContext, TeamActionsContext, useUI } from "../contexts";
import { makeTeam } from "../test-utils";

const Probe = ({ open }: { open: { editor?: string; live?: string } }) => {
  const { selectedGameId, inGameId, setSelectedGameId, setInGameId } = useUI();
  // Mount only, like the URL → state effect in useMainShellRouting.
  useEffect(() => {
    if (open.editor) setSelectedGameId(open.editor);
    if (open.live) setInGameId(open.live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      editor:{selectedGameId || "none"} live:{inGameId || "none"}
    </div>
  );
};

interface TeamState {
  games: Array<{ id: string }>;
  loading?: boolean;
  gamesServerConfirmed?: boolean;
}

const tree = (
  state: TeamState,
  open: { editor?: string; live?: string },
  uiBridge: { current: unknown },
) => {
  const team = makeTeam({
    team: { name: "Hawks", players: [], games: state.games },
    loading: state.loading ?? false,
    gamesServerConfirmed: state.gamesServerConfirmed ?? false,
    uiBridge,
  });
  return (
    <MemoryRouter>
      <TeamContext.Provider value={team}>
        <TeamActionsContext.Provider value={team}>
          <UIProvider>
            <Probe open={open} />
          </UIProvider>
        </TeamActionsContext.Provider>
      </TeamContext.Provider>
    </MemoryRouter>
  );
};

const mount = (
  initial: TeamState,
  open: { editor?: string; live?: string },
) => {
  const uiBridge = { current: {} };
  const view = render(tree(initial, open, uiBridge));
  return {
    update: (next: TeamState) => view.rerender(tree(next, open, uiBridge)),
    shows: (text: string) => expect(screen.getByText(text)).toBeInTheDocument(),
  };
};

describe("UIProvider — a game opened from the URL", () => {
  it("keeps the editor's game while the team is still loading, and after it arrives", () => {
    const app = mount({ games: [], loading: true }, { editor: "g1" });
    app.shows("editor:g1 live:none");
    // Team doc landed, games lane not yet server-confirmed (cache-first).
    app.update({ games: [], loading: false });
    app.shows("editor:g1 live:none");
    app.update({ games: [{ id: "g1" }], gamesServerConfirmed: true });
    app.shows("editor:g1 live:none");
  });

  it("keeps the live game across a reload", () => {
    const app = mount({ games: [], loading: true }, { live: "g1" });
    app.shows("editor:none live:g1");
    app.update({ games: [{ id: "g1" }], gamesServerConfirmed: true });
    app.shows("editor:none live:g1");
  });

  it("clears a game that was there and is then deleted, even offline", () => {
    // Never server-confirmed (offline): the list is still enough to see a
    // game the coach had open disappear.
    const app = mount({ games: [{ id: "g1" }, { id: "g2" }] }, { live: "g1" });
    app.shows("editor:none live:g1");
    app.update({ games: [{ id: "g2" }] });
    app.shows("editor:none live:none");
  });

  it("clears a link to a game that does not exist once the server has confirmed the list", () => {
    const app = mount({ games: [], loading: true }, { editor: "gone" });
    app.update({ games: [{ id: "g1" }], gamesServerConfirmed: true });
    app.shows("editor:none live:none");
  });
});
