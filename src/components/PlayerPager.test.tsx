import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { PlayerPager } from "./PlayerPager";
import { findPlayerByParam, playerSlug } from "../utils/playerSlug";
import { renderWithProviders } from "../test-utils";

// The pager lets a coach walk the roster from inside a profile. What matters:
// it steps in the Roster tab's own order, it never wraps, arrow keys do the
// same thing without hijacking text entry, and paging REPLACES history so Back
// is still one press to the roster.

const players = [
  { id: "a", name: "Ava", number: "1" },
  { id: "b", name: "Bo", number: "2" },
  { id: "c", name: "Cy", number: "3" },
] as any[];

const Probe = () => {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="path">{loc.pathname}</div>
      {/* Stands in for the profile's Back control, which is a plain
          history-back (useBackOrFallback). */}
      <button type="button" onClick={() => navigate(-1)}>
        GO BACK
      </button>
    </>
  );
};

// Mirrors how the profile page mounts it: the CURRENT player comes from the
// route, so a step re-renders the pager against the new player rather than
// leaving it pinned to the one the coach started on.
const RoutedPager = ({ list }: { list: any[] }) => {
  const { id } = useParams();
  // The profile page resolves the URL's name slug back to a player id before
  // handing it down; do the same here so a chained step keeps working.
  const resolved = findPlayerByParam(id, list);
  return (
    <PlayerPager
      players={list}
      playerId={resolved ? String(resolved.id) : id}
    />
  );
};

// Callers still name the player by id; the URL carries their name slug, the
// way every link in the app now builds it.
const renderPager = (playerId: string, list = players) =>
  renderWithProviders(
    <MemoryRouter
      initialEntries={[
        "/roster",
        `/roster/${playerSlug(
          list.find((p) => p.id === playerId) || { id: playerId },
          list,
        )}`,
      ]}
      initialIndex={1}
    >
      <Probe />
      <Routes>
        <Route path="/roster/:id" element={<RoutedPager list={list} />} />
        <Route path="/roster" element={<div>ROSTER LIST</div>} />
      </Routes>
    </MemoryRouter>,
    { team: { team: { players: list } } },
  );

const path = () => screen.getByTestId("path").textContent;

describe("PlayerPager", () => {
  it("names the players either side rather than showing bare arrows", () => {
    renderPager("b");
    expect(
      screen.getByRole("button", { name: "Previous player: #1 Ava" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next player: #3 Cy" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("steps forward and back through the roster", async () => {
    renderPager("b");
    await userEvent.click(
      screen.getByRole("button", { name: "Next player: #3 Cy" }),
    );
    expect(path()).toBe("/roster/cy");
  });

  it("disables the ends instead of wrapping", () => {
    renderPager("a");
    expect(
      screen.getByRole("button", { name: /Previous player/ }),
    ).toBeDisabled();
    expect(screen.getByText("Start of roster")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next player: #2 Bo" }),
    ).toBeEnabled();
  });

  it("disables Next on the last player", () => {
    renderPager("c");
    expect(screen.getByRole("button", { name: /Next player/ })).toBeDisabled();
    expect(screen.getByText("End of roster")).toBeInTheDocument();
  });

  it("replaces history so Back is still ONE press to the roster", async () => {
    renderPager("a");
    // Walk the whole roster: a -> b -> c.
    await userEvent.click(
      screen.getByRole("button", { name: "Next player: #2 Bo" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Next player: #3 Cy" }),
    );
    expect(path()).toBe("/roster/cy");

    // A single back press lands on the roster — not on Bo, and not on Ava.
    // Pushing instead of replacing would bury the list under every player
    // the coach flipped past.
    await userEvent.click(screen.getByRole("button", { name: "GO BACK" }));
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("arrow keys page left and right", () => {
    renderPager("b");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(path()).toBe("/roster/cy");
  });

  it("arrow keys stop at the ends", () => {
    renderPager("a");
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(path()).toBe("/roster/ava");
  });

  it("leaves arrow keys alone while typing in a field", () => {
    renderPager("b");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(path()).toBe("/roster/bo");
    input.remove();
  });

  it("leaves arrow keys alone while a dialog is open", () => {
    renderPager("b");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(path()).toBe("/roster/bo");
    dialog.remove();
  });

  it("ignores a modified arrow — that is a text or browser gesture", () => {
    renderPager("b");
    fireEvent.keyDown(document, { key: "ArrowRight", metaKey: true });
    expect(path()).toBe("/roster/bo");
  });

  it("renders nothing for a one-player roster", () => {
    const { container } = renderPager("a", [players[0]]);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("renders nothing for a tournament sub, who is not in the sequence", () => {
    const withSub = [
      ...players,
      { id: "s1", name: "Guest", isSub: true, subTournamentIds: ["t1"] },
    ] as any[];
    const { container } = renderPager("s1", withSub);
    expect(container.querySelector("nav")).toBeNull();
  });
});
