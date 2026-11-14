import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ScheduleCalendarCard } from "./ScheduleCalendarCard";
import { ConfirmContext } from "../../contexts";
import { makeConfirm, renderWithProviders } from "../../test-utils";

const TOKEN = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4";
const upcoming = [{ id: "g1", date: "2099-05-16", opponent: "Cubs" }];
const played = [
  {
    id: "g0",
    date: "2026-05-01",
    opponent: "Rays",
    status: "final",
    teamScore: 4,
    opponentScore: 2,
  },
];

const renderCard = ({
  role = "head",
  token = null as string | null,
  games = upcoming as any[],
  confirm = makeConfirm(true),
  disableCalendarFeed = vi.fn().mockResolvedValue(true),
} = {}) => {
  const enableCalendarFeed = vi.fn();
  const view = renderWithProviders(
    <ConfirmContext.Provider value={{ confirm, promptText: vi.fn() }}>
      <ScheduleCalendarCard games={games} />
    </ConfirmContext.Provider>,
    {
      team: {
        team: { name: "Hawks", calendarFeedToken: token, players: [], games },
        activeTeamId: "team-1",
        currentRole: role as "head" | "assistant",
        enableCalendarFeed,
        disableCalendarFeed,
      },
    },
  );
  return { ...view, enableCalendarFeed, disableCalendarFeed, confirm };
};

describe("ScheduleCalendarCard", () => {
  it("lets a head coach create the subscription link", () => {
    const { enableCalendarFeed } = renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: /create calendar link/i }),
    );
    expect(enableCalendarFeed).toHaveBeenCalledTimes(1);
    // Says who can see what before the coach creates it.
    expect(
      screen.getByText(/anyone with\s+the link can see opponents/i),
    ).toBeInTheDocument();
  });

  it("tells an assistant the head coach creates it, with nothing to press", () => {
    renderCard({ role: "assistant" });
    expect(
      screen.queryByRole("button", { name: /create calendar link/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/your head coach can create a link/i),
    ).toBeInTheDocument();
    // The one-time download is still theirs.
    expect(
      screen.getByRole("button", { name: /download calendar/i }),
    ).toBeInTheDocument();
  });

  it("shows the link with copy and subscribe once it exists", () => {
    renderCard({ token: TOKEN });
    const expected = `${window.location.origin}/api/calendar?feed=team-1.${TOKEN}`;
    expect(screen.getByLabelText("Subscription link")).toHaveValue(expected);
    expect(
      screen.getByRole("button", { name: /copy link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /subscribe on this device/i }),
    ).toHaveAttribute("href", expected.replace(/^https?:/, "webcal:"));
  });

  it("gives an assistant the link but not the off switch", () => {
    renderCard({ role: "assistant", token: TOKEN });
    expect(screen.getByLabelText("Subscription link")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /turn off link/i }),
    ).not.toBeInTheDocument();
  });

  it("turns the link off only after the head coach confirms", async () => {
    const declined = renderCard({ token: TOKEN, confirm: makeConfirm(false) });
    fireEvent.click(screen.getByRole("button", { name: /turn off link/i }));
    await waitFor(() => expect(declined.confirm).toHaveBeenCalled());
    expect(declined.disableCalendarFeed).not.toHaveBeenCalled();
    declined.unmount();

    const accepted = renderCard({ token: TOKEN });
    fireEvent.click(screen.getByRole("button", { name: /turn off link/i }));
    await waitFor(() =>
      expect(accepted.disableCalendarFeed).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(accepted.toastValue.push).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Calendar link turned off" }),
      ),
    );
  });

  it("stays visible with nothing upcoming while a link exists, so it can be turned off", () => {
    renderCard({ token: TOKEN, games: played });
    expect(
      screen.getByRole("button", { name: /turn off link/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /download calendar/i }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing with no upcoming games and no link", () => {
    const { container } = renderCard({ games: played });
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores a stored token that isn't shaped like one", () => {
    renderCard({ token: "hawks" });
    expect(
      screen.queryByLabelText("Subscription link"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create calendar link/i }),
    ).toBeInTheDocument();
  });
});
