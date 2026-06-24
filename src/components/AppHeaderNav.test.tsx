import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppHeader } from "./Chrome";
import { Icons } from "../icons";
import { TeamContext, UIContext, ToastContext } from "../contexts";

const NAV = [
  { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
  { id: "roster", icon: Icons.Users, label: "Roster" },
  { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
  { id: "finances", icon: Icons.Wallet, label: "Finances" },
];

const team: any = {
  primaryColor: "#2563eb",
  secondaryColor: "#fff",
  tertiaryColor: "#fff",
  logoUrl: "",
  interestSignups: [],
};

const teamCtx: any = {
  team,
  teams: [{ id: "t1", name: "Trash Pandas" }],
  activeTeamId: "t1",
  syncStatus: "synced",
  switchTeam: () => {},
  createTeam: () => {},
  record: { wins: 1, losses: 2, ties: 0 },
  currentRole: "head",
  realRole: "head",
  viewAsRole: null,
  setViewAsRole: () => {},
  joinTeamByCode: async () => ({ ok: true }),
};

const uiCtx: any = {
  isAddingTeam: false,
  setIsAddingTeam: () => {},
  newTeamName: "",
  setNewTeamName: () => {},
  activeTab: "home",
  setActiveTab: () => {},
};

const renderHeader = () =>
  render(
    <ToastContext.Provider value={{ push: () => {}, dismiss: () => {} } as any}>
      <TeamContext.Provider value={teamCtx}>
        <UIContext.Provider value={uiCtx}>
          <AppHeader navButtons={NAV} />
        </UIContext.Provider>
      </TeamContext.Provider>
    </ToastContext.Provider>,
  );

describe("AppHeader → NavDrawer integration", () => {
  it("renders the passed navButtons inside the drawer for a head coach", () => {
    renderHeader();
    fireEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );
    NAV.forEach((b) =>
      expect(
        screen.getByRole("menuitem", { name: b.label }),
      ).toBeInTheDocument(),
    );
  });

  it("portals the drawer out of the header", () => {
    // Regression: the drawer should never be constrained by header
    // chrome/layout. It must be portaled to <body> so it stays pinned to the
    // full viewport.
    const { container } = renderHeader();
    fireEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );
    const menu = screen.getByRole("menu", { name: /primary navigation/i });
    // Not a descendant of the <header> (it was portaled to document.body).
    expect(menu.closest("header")).toBeNull();
    expect(container.querySelector("header")).not.toBeNull();
  });
});
