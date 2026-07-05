import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddPlayerModal } from "./modals";
import { renderWithProviders } from "../test-utils";

const setup = (isAddingPlayer = true) => {
  const addPlayer = jest.fn();
  const setIsAddingPlayer = jest.fn();
  const utils = renderWithProviders(<AddPlayerModal />, {
    team: {
      addPlayer,
      team: { primaryColor: "#1d4ed8", tertiaryColor: "#ffffff" },
    },
    ui: { isAddingPlayer, setIsAddingPlayer },
  });
  return { addPlayer, setIsAddingPlayer, ...utils };
};

// The Name label isn't linked to its input (no htmlFor), so the field has no
// accessible name — it's just the first textbox in the form (Number is second).
const nameInput = () => screen.getAllByRole("textbox")[0];

describe("AddPlayerModal", () => {
  it("renders nothing while the modal is closed", () => {
    setup(false);
    expect(screen.queryByText("Add Player")).not.toBeInTheDocument();
  });

  it("renders the form when opened", () => {
    setup(true);
    expect(
      screen.getByRole("heading", { name: "Add Player" }),
    ).toBeInTheDocument();
    expect(nameInput()).toBeInTheDocument();
  });

  it("submits a trimmed player and closes the modal", async () => {
    const user = userEvent.setup();
    const { addPlayer, setIsAddingPlayer } = setup(true);
    await user.type(nameInput(), "Ava");
    await user.click(screen.getByRole("button", { name: /add player/i }));
    expect(addPlayer).toHaveBeenCalledTimes(1);
    expect(addPlayer.mock.calls[0][0]).toMatchObject({
      name: "Ava",
      bats: "R",
      throws: "R",
    });
    // close() flips the UI flag back off.
    expect(setIsAddingPlayer).toHaveBeenCalledWith(false);
  });

  it("does not add a player when the name is only whitespace", async () => {
    const user = userEvent.setup();
    const { addPlayer } = setup(true);
    // A space satisfies the native `required` attribute but the submit guard
    // trims it away, so no player is created.
    await user.type(nameInput(), " ");
    await user.click(screen.getByRole("button", { name: /add player/i }));
    expect(addPlayer).not.toHaveBeenCalled();
  });

  it("cancels without adding a player", async () => {
    const user = userEvent.setup();
    const { addPlayer, setIsAddingPlayer } = setup(true);
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(addPlayer).not.toHaveBeenCalled();
    expect(setIsAddingPlayer).toHaveBeenCalledWith(false);
  });
});
