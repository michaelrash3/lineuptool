import React from "react";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlayerNameLink } from "./PlayerNameLink";
import { renderWithProviders } from "../test-utils";

const players = [
  { id: "p1", name: "Marcus Elliott", number: "7" },
  { id: "p2", name: "Jack Ryan" },
  { id: "p3", name: "Jack Ryan" },
] as any[];

const mount = (node: React.ReactNode, list = players) =>
  renderWithProviders(<MemoryRouter>{node}</MemoryRouter>, {
    team: { team: { players: list } },
  });

describe("PlayerNameLink", () => {
  it("renders the name as a link to that player's page", () => {
    mount(<PlayerNameLink player={players[0]} />);
    expect(
      screen.getByRole("link", { name: "Marcus Elliott" }),
    ).toHaveAttribute("href", "/roster/marcus-elliott");
  });

  it("accepts an id for callers that only hold one", () => {
    mount(<PlayerNameLink playerId="p1" />);
    expect(
      screen.getByRole("link", { name: "Marcus Elliott" }),
    ).toHaveAttribute("href", "/roster/marcus-elliott");
  });

  it("lets the caller supply its own label content", () => {
    mount(<PlayerNameLink player={players[0]}>#7 Marcus</PlayerNameLink>);
    expect(screen.getByRole("link", { name: "#7 Marcus" })).toHaveAttribute(
      "href",
      "/roster/marcus-elliott",
    );
  });

  it("uses the disambiguated address when two players share a name", () => {
    mount(<PlayerNameLink playerId="p3" />);
    expect(screen.getByRole("link", { name: "Jack Ryan" })).toHaveAttribute(
      "href",
      "/roster/jack-ryan-p3",
    );
  });

  // A stat or fee row can outlive the player it names. It should still read
  // the same — just not link anywhere.
  it("falls back to plain text when no player resolves", () => {
    mount(<PlayerNameLink playerId="gone">Departed Kid</PlayerNameLink>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Departed Kid")).toBeInTheDocument();
  });

  it("keeps the tooltip on both the link and the plain-text fallback", () => {
    const { unmount } = mount(
      <PlayerNameLink player={players[0]} title="Resting" />,
    );
    expect(
      screen.getByRole("link", { name: "Marcus Elliott" }),
    ).toHaveAttribute("title", "Resting");
    unmount();
    mount(
      <PlayerNameLink playerId="gone" title="Resting">
        Departed Kid
      </PlayerNameLink>,
    );
    expect(screen.getByText("Departed Kid")).toHaveAttribute(
      "title",
      "Resting",
    );
  });

  it("is an anchor, so it can be opened in a new tab", () => {
    mount(<PlayerNameLink player={players[0]} />);
    expect(screen.getByRole("link", { name: "Marcus Elliott" }).tagName).toBe(
      "A",
    );
  });
});
