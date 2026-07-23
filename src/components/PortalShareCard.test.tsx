import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortalShareCard, ShareLinkBlock } from "./PortalShareCard";
import { renderWithProviders } from "../test-utils";

const team = { name: "Hawks", tryoutShareId: "abc123" };

const renderCard = (overrides: Record<string, unknown> = {}) =>
  renderWithProviders(
    <PortalShareCard
      team={team}
      path="tryouts-portal"
      eyebrow="Interest"
      title="Player Interest Form"
      buttonLabel="Interest Form"
      description="Send to families."
      filenameSuffix="player-interest"
      {...overrides}
    />,
  );

afterEach(() => {
  delete (navigator as any).clipboard;
  delete (document as any).execCommand;
});

describe("PortalShareCard", () => {
  it("opens the modal and shows the standing portal URL", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: /interest form/i }));
    expect(screen.getByText(/tryouts-portal\/abc123/)).toBeInTheDocument();
  });

  it("points at the Tryouts tab when no share link exists yet", async () => {
    const user = userEvent.setup();
    renderCard({ team: { name: "Hawks" } });
    await user.click(screen.getByRole("button", { name: /interest form/i }));
    expect(
      screen.getByText(/generate your team's share link first/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/tryout setup/i)).toBeInTheDocument();
  });

  it("copies the link and toasts success", async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { toastValue } = renderCard();
    await user.click(screen.getByRole("button", { name: /interest form/i }));
    await user.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() =>
      expect(toastValue.push).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "success", title: "Link copied" }),
      ),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("tryouts-portal/abc123"),
    );
  });

  it("toasts an error instead of silently failing when copy is impossible", async () => {
    // Clipboard API denied (insecure context / permissions) and no
    // execCommand — the old widgets no-opped here; the shared card reports it.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const { toastValue } = renderCard();
    await user.click(screen.getByRole("button", { name: /interest form/i }));
    await user.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() =>
      expect(toastValue.push).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "error", title: "Couldn't copy" }),
      ),
    );
  });

  it("renders extra actions passed as children inside the modal", async () => {
    const user = userEvent.setup();
    renderCard({
      children: <button type="button">Email All Parents</button>,
    });
    await user.click(screen.getByRole("button", { name: /interest form/i }));
    expect(
      screen.getByRole("button", { name: /email all parents/i }),
    ).toBeInTheDocument();
  });

  it("keeps children visible when no share link exists yet", async () => {
    // The Roster card's parent-contact tools must not disappear for teams
    // that haven't generated a link.
    const user = userEvent.setup();
    renderCard({
      team: { name: "Hawks" },
      children: <button type="button">Email All Parents</button>,
    });
    await user.click(screen.getByRole("button", { name: /interest form/i }));
    expect(
      screen.getByRole("button", { name: /email all parents/i }),
    ).toBeInTheDocument();
  });
});

describe("ShareLinkBlock", () => {
  it("renders the link and slots extra actions beside Copy", () => {
    const onRegenerate = jest.fn();
    renderWithProviders(
      <ShareLinkBlock
        url="https://example.com/tryouts-portal/abc123"
        filename="hawks-qr"
        hint="Always opens the survey."
        actions={
          <button type="button" onClick={onRegenerate}>
            Regenerate
          </button>
        }
      />,
    );
    expect(screen.getByText(/tryouts-portal\/abc123/)).toBeInTheDocument();
    expect(screen.getByText(/always opens the survey/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
