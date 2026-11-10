import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { GettingStartedCard } from "./GettingStartedCard";

const handlers = () => ({
  onAddPlayers: vi.fn(),
  onAddGame: vi.fn(),
  onOpenSchedule: vi.fn(),
  onInviteCoaches: vi.fn(),
});
const renderCard = (team: any, over: any = {}) => {
  const h = handlers();
  const utils = render(
    <GettingStartedCard team={team} teamId="t1" isHead {...h} {...over} />,
  );
  return { ...h, ...utils };
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("GettingStartedCard", () => {
  it("walks a brand-new team through setup", () => {
    const h = renderCard({ players: [], games: [], members: ["me"] });
    expect(screen.getByText("0 of 4 done")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add players" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a game" }));
    fireEvent.click(screen.getByRole("button", { name: "Get the team code" }));
    expect(h.onAddPlayers).toHaveBeenCalled();
    expect(h.onAddGame).toHaveBeenCalled();
    expect(h.onInviteCoaches).toHaveBeenCalled();
  });

  it("ticks off what's done", () => {
    renderCard({
      players: [{ id: "p1", name: "Ada" }],
      games: [{ id: "g1" }],
      members: ["me"],
    });
    expect(screen.getByText("2 of 4 done")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open the schedule" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add players" })).toBeNull();
  });

  it("goes away once players, a game and a lineup exist", () => {
    const { container } = renderCard({
      players: [{ id: "p1" }],
      games: [{ id: "g1", lineup: [{ P: { id: "p1" } }] }],
      members: ["me"],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden once dismissed, and never shows to an assistant", () => {
    const team = { players: [], games: [], members: ["me"] };
    const first = renderCard(team);
    fireEvent.click(screen.getByLabelText("Hide getting started"));
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    expect(renderCard(team).container).toBeEmptyDOMElement();
    window.localStorage.clear();
    expect(renderCard(team, { isHead: false }).container).toBeEmptyDOMElement();
  });
});
