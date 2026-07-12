import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AddPlayerPage } from "./AddPlayerPage";
import { renderWithProviders } from "../../test-utils";

const renderPage = (ctxOver: any = {}) => {
  const addPlayer = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/roster/new"]}>
      <Routes>
        <Route path="/roster" element={<div>ROSTER LIST</div>} />
        <Route path="/roster/new" element={<AddPlayerPage />} />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        addPlayer,
        currentRole: "head",
        team: { primaryColor: "#1d4ed8", tertiaryColor: "#ffffff" },
        ...ctxOver,
      },
    },
  );
  return { addPlayer, ...utils };
};

// The Name label isn't linked to its input (no htmlFor), so the field has no
// accessible name — it's just the first textbox in the form (Number is second).
const nameInput = () => screen.getAllByRole("textbox")[0];

describe("AddPlayerPage", () => {
  it("renders the form as a page", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Add Player" }),
    ).toBeInTheDocument();
    expect(nameInput()).toBeInTheDocument();
  });

  it("submits a trimmed player and returns to the roster", async () => {
    window.history.replaceState({ idx: 0 }, "");
    const user = userEvent.setup();
    const { addPlayer } = renderPage();
    await user.type(nameInput(), "Ava");
    await user.click(screen.getByRole("button", { name: /add player/i }));
    expect(addPlayer).toHaveBeenCalledTimes(1);
    expect(addPlayer.mock.calls[0][0]).toMatchObject({
      name: "Ava",
      bats: "R",
      throws: "R",
    });
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("does not add a player when the name is only whitespace", async () => {
    const user = userEvent.setup();
    const { addPlayer } = renderPage();
    // A space satisfies the native `required` attribute but the submit guard
    // trims it away, so no player is created.
    await user.type(nameInput(), " ");
    await user.click(screen.getByRole("button", { name: /add player/i }));
    expect(addPlayer).not.toHaveBeenCalled();
  });

  it("cancels back to the roster without adding a player", async () => {
    window.history.replaceState({ idx: 0 }, "");
    const user = userEvent.setup();
    const { addPlayer } = renderPage();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(addPlayer).not.toHaveBeenCalled();
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });

  it("redirects assistants to the roster", () => {
    renderPage({ currentRole: "assistant" });
    expect(screen.getByText("ROSTER LIST")).toBeInTheDocument();
  });
});
