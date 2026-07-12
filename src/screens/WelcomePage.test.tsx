import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WelcomePage } from "./WelcomePage";

vi.mock("../firebase", () => ({ auth: {}, db: {}, appId: "test-app" }));
vi.mock("firebase/auth", () => ({ signOut: vi.fn().mockResolvedValue(null) }));

// The /welcome first-run page (routed, not an overlay).
// Join/create flow behavior lives in useInviteFlows tests; this covers the
// page's form wiring and inline error surfacing. It renders standalone (no
// providers needed — ConfirmContext falls back to window.confirm).

describe("WelcomePage", () => {
  it("joins with a normalized 6-char code and surfaces a bad-code error", async () => {
    const onJoin = vi.fn().mockResolvedValue({ ok: false, retryable: false });
    render(<WelcomePage onJoin={onJoin} />);

    const codeInput = screen.getByLabelText("6-character team join code");
    const joinButton = screen.getByRole("button", { name: /Join Team/i });
    // Too short → disabled.
    fireEvent.change(codeInput, { target: { value: "abc" } });
    expect(joinButton).toBeDisabled();

    fireEvent.change(codeInput, { target: { value: "abc234" } });
    fireEvent.click(joinButton);
    expect(onJoin).toHaveBeenCalledWith("ABC234");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Code not recognized/,
    );
  });

  it("requires a team type before creating, then creates with the name", async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(<WelcomePage onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: /Create Team/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Pick a team type/,
    );
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Tournament/ }));
    fireEvent.change(screen.getByLabelText("Team name"), {
      target: { value: "Hawks" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create Team/i }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith("Hawks", "USSSA"),
    );
  });

  it("routes sign-out through the confirm dialog and aborts on cancel", async () => {
    const { signOut } = await import("firebase/auth");
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    render(<WelcomePage />);
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(signOut).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
