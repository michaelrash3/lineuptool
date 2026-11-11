import React from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { LetterTemplatesPanel } from "./LetterTemplatesPanel";
import { ConfirmContext } from "../../contexts";
import { makeConfirm, renderWithProviders } from "../../test-utils";
import { defaultLetterTemplate } from "../../constants/offerLetters";

const baseTeam = {
  name: "Trash Pandas",
  players: [],
  games: [],
  finances: { nextClubFee: 1200, nextDepositAmount: 300 },
};

const setup = (team: any = {}, confirm = makeConfirm()) => {
  const updateTeam = jest.fn();
  const utils = renderWithProviders(
    <ConfirmContext.Provider value={{ confirm } as any}>
      <LetterTemplatesPanel />
    </ConfirmContext.Provider>,
    {
      team: {
        team: { ...baseTeam, ...team },
        user: { displayName: "Coach Mike", email: "mike@example.com" },
        updateTeam,
      },
    },
  );
  return { ...utils, updateTeam, confirm };
};

const card = (name: RegExp) => screen.getByRole("region", { name });
const openEditor = (name: RegExp) =>
  fireEvent.click(within(card(name)).getByRole("button", { name: /edit/i }));
const message = () => screen.getByRole("textbox", { name: /message/i });

describe("LetterTemplatesPanel", () => {
  it("lists every letter a family can get, standard until reworded", () => {
    setup();
    for (const name of [
      /returning player offer/i,
      /new player offer/i,
      /not returning player letter/i,
      /tryout rejection letter/i,
      /interest \/ tryout invite/i,
    ])
      expect(within(card(name)).getByText("Standard")).toBeInTheDocument();
  });

  it("starts the editor from the standard wording, with its blanks showing", () => {
    setup();
    openEditor(/returning player offer/i);
    expect((message() as HTMLTextAreaElement).value).toBe(
      defaultLetterTemplate("returning").body,
    );
    expect((message() as HTMLTextAreaElement).value).toContain(
      "[Deposit Amount]",
    );
  });

  it("saves the head coach's wording for that letter", () => {
    const { updateTeam } = setup();
    openEditor(/returning player offer/i);
    fireEvent.change(message(), {
      target: { value: "Hi [Player Name], we'd love you back." },
    });
    fireEvent.click(screen.getByRole("button", { name: /save wording/i }));
    expect(updateTeam).toHaveBeenCalledWith({
      letterTemplates: {
        returning: {
          subject: defaultLetterTemplate("returning").subject,
          body: "Hi [Player Name], we'd love you back.",
        },
      },
    });
  });

  it("saving the standard wording unchanged stores nothing", () => {
    const { updateTeam } = setup();
    openEditor(/tryout rejection letter/i);
    fireEvent.click(screen.getByRole("button", { name: /save wording/i }));
    expect(updateTeam).toHaveBeenCalledWith({ letterTemplates: {} });
  });

  it("adds a fill-in field where the cursor is", () => {
    setup();
    openEditor(/tryout rejection letter/i);
    const box = message() as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Dear , thanks." } });
    box.setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole("button", { name: "[Player Name]" }));
    expect(box.value).toBe("Dear [Player Name], thanks.");
  });

  it("warns about bracketed words that aren't fill-in fields", () => {
    setup();
    openEditor(/tryout rejection letter/i);
    fireEvent.change(message(), { target: { value: "Dear [Player]," } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "[Player] isn't a fill-in field",
    );
  });

  it("previews the letter filled in for a sample family", () => {
    setup();
    openEditor(/returning player offer/i);
    fireEvent.change(message(), {
      target: { value: "Dear [Player Name], fees are [Team Fees]." },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByLabelText(/letter preview/i)).toHaveTextContent(
      "Dear Sam Rivera, fees are $1,200.",
    );
  });

  it("brings back the standard letter, removing only that one", async () => {
    const saved = {
      returning: { subject: "Back!", body: "Mine" },
      rejection: { subject: "Tryouts", body: "Also mine" },
    };
    const { updateTeam, confirm } = setup({ letterTemplates: saved });
    expect(within(card(/returning player offer/i)).getByText("Your wording"));
    openEditor(/returning player offer/i);
    fireEvent.click(
      screen.getByRole("button", { name: /use the standard letter/i }),
    );
    await screen.findByRole("region", { name: /returning player offer/i });
    await Promise.resolve();
    expect(confirm).toHaveBeenCalled();
    expect(updateTeam).toHaveBeenCalledWith({
      letterTemplates: { rejection: saved.rejection },
    });
  });
});
