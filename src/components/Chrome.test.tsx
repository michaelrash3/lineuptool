import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavDrawer } from "./Chrome";
import { Icons } from "../icons";

const NAV = [
  { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
  { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
  { id: "roster", icon: Icons.Users, label: "Roster" },
  { id: "stats", icon: Icons.Chart, label: "Stats" },
  { id: "depthChart", icon: Icons.Glove, label: "Depth Chart" },
  { id: "evaluation", icon: Icons.Clipboard, label: "Evaluation" },
  { id: "finances", icon: Icons.Wallet, label: "Finances" },
];

const setup = (overrides: any = {}) => {
  const setActiveTab = jest.fn();
  const onSettings = jest.fn();
  const onSignOut = jest.fn();
  render(
    <NavDrawer
      navButtons={NAV}
      activeTab={overrides.activeTab ?? "home"}
      setActiveTab={setActiveTab}
      teamName="Wildcats"
      subtitle="Head Coach Dashboard"
      showSettings={overrides.showSettings ?? true}
      onSettings={onSettings}
      themeToggle={<button>Theme</button>}
      onSignOut={onSignOut}
    />
  );
  return { setActiveTab, onSettings, onSignOut };
};

const openDrawer = () =>
  fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));

describe("NavDrawer", () => {
  it("hides the navigation until the hamburger is tapped", () => {
    setup();
    // Drawer panel is not mounted while closed.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    openDrawer();
    expect(
      screen.getByRole("menu", { name: /primary navigation/i })
    ).toBeInTheDocument();
  });

  it("lists every destination once the drawer is open", () => {
    setup();
    openDrawer();
    NAV.forEach((b) =>
      expect(screen.getByRole("menuitem", { name: b.label })).toBeInTheDocument()
    );
  });

  it("marks the active destination with aria-current", () => {
    setup({ activeTab: "roster" });
    openDrawer();
    const current = screen
      .getAllByRole("menuitem")
      .filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Roster");
  });

  it("selects a destination and auto-closes the drawer", () => {
    const { setActiveTab } = setup();
    openDrawer();
    fireEvent.click(screen.getByRole("menuitem", { name: /finances/i }));
    expect(setActiveTab).toHaveBeenCalledWith("finances");
    // Drawer closes after picking.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("exposes Settings and Sign Out in the footer for head coaches", () => {
    const { onSettings, onSignOut } = setup({ showSettings: true });
    openDrawer();
    fireEvent.click(screen.getByRole("menuitem", { name: /settings/i }));
    expect(onSettings).toHaveBeenCalled();
    openDrawer();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("omits Settings when showSettings is false (assistant view)", () => {
    setup({ showSettings: false });
    openDrawer();
    expect(
      screen.queryByRole("menuitem", { name: /settings/i })
    ).not.toBeInTheDocument();
    // Sign Out remains reachable for everyone.
    expect(
      screen.getByRole("button", { name: /sign out/i })
    ).toBeInTheDocument();
  });
});
