import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmProvider } from "./ConfirmDialog";
import { useConfirm } from "../contexts";

// Harness: buttons that fire confirm/promptText and report the resolution.
const Harness = ({ onResult }: { onResult: (v: any) => void }) => {
  const { confirm, promptText } = useConfirm();
  return (
    <div>
      <button
        onClick={async () =>
          onResult(
            await confirm({
              title: "Delete thing?",
              message: "Gone forever.",
              confirmLabel: "Delete",
              danger: true,
            })
          )
        }
      >
        ask-confirm
      </button>
      <button
        onClick={async () =>
          onResult(
            await promptText({
              title: "Your email",
              label: "Email",
              inputType: "email",
              confirmLabel: "Send",
            })
          )
        }
      >
        ask-prompt
      </button>
    </div>
  );
};

const setup = () => {
  const onResult = jest.fn();
  render(
    <ConfirmProvider>
      <Harness onResult={onResult} />
    </ConfirmProvider>
  );
  return { onResult };
};

describe("ConfirmProvider", () => {
  it("resolves true when the confirm button is pressed", async () => {
    const { onResult } = setup();
    fireEvent.click(screen.getByText("ask-confirm"));
    expect(
      screen.getByRole("dialog", { name: /delete thing\?/i })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resolves false on Cancel and on Escape", async () => {
    const { onResult } = setup();
    fireEvent.click(screen.getByText("ask-confirm"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));

    fireEvent.click(screen.getByText("ask-confirm"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(onResult).toHaveBeenLastCalledWith(false);
  });

  it("promptText validates email before resolving the trimmed value", async () => {
    const { onResult } = setup();
    fireEvent.click(screen.getByText("ask-prompt"));
    const input = screen.getByLabelText("Email");

    // Invalid email blocks submit and shows an inline error.
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid email/i);
    expect(onResult).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  coach@example.com  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith("coach@example.com")
    );
  });

  it("promptText resolves null when dismissed via the scrim", async () => {
    const { onResult } = setup();
    fireEvent.click(screen.getByText("ask-prompt"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.parentElement as HTMLElement);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });

  it("queues a second request instead of dropping it", async () => {
    const { onResult } = setup();
    fireEvent.click(screen.getByText("ask-confirm"));
    fireEvent.click(screen.getByText("ask-prompt"));
    // First dialog is the confirm.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    // The queued prompt now renders.
    expect(
      screen.getByRole("dialog", { name: /your email/i })
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });
});
