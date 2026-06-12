import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBarNav } from "./Chrome";
import { Icons } from "../icons";

const NAV = [
  { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
  { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
  { id: "roster", icon: Icons.Users, label: "Roster" },
  { id: "stats", icon: Icons.Chart, label: "Stats" },
  { id: "depthChart", icon: Icons.Glove, label: "Depth Chart" },
  { id: "evaluation", icon: Icons.Clipboard, label: "Evaluation" },
  { id: "finances", icon: Icons.Wallet, label: "Finances" },
  { id: "settings", icon: Icons.Settings, label: "Settings" },
];

const setup = (activeTab = "home") => {
  const setActiveTab = jest.fn();
  render(
    <TabBarNav activeTab={activeTab} setActiveTab={setActiveTab} navButtons={NAV} />
  );
  return { setActiveTab };
};

describe("TabBarNav", () => {
  it("renders every tab in the desktop row", () => {
    setup();
    // Each label appears twice or once: priority tabs render in both the
    // desktop row and the mobile row; overflow tabs render in the desktop
    // row only (until the More panel opens).
    NAV.forEach((b) =>
      expect(screen.getAllByText(b.label).length).toBeGreaterThanOrEqual(1)
    );
  });

  it("marks the active tab with aria-current", () => {
    setup("roster");
    const current = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "page");
    expect(current.length).toBeGreaterThanOrEqual(1);
    current.forEach((b) => expect(b.textContent).toContain("Roster"));
  });

  it("opens the More menu and selects an overflow tab", () => {
    const { setActiveTab } = setup();
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    const menu = screen.getByRole("menu", { name: /more tabs/i });
    expect(menu).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /finances/i }));
    expect(setActiveTab).toHaveBeenCalledWith("finances");
    // Menu closes after picking.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows the active overflow tab's label on the More pill", () => {
    setup("finances");
    // No plain "More" button — the pill takes the overflow tab's label.
    expect(
      screen.queryByRole("button", { name: /^more$/i })
    ).not.toBeInTheDocument();
    const pill = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-haspopup") === "menu");
    expect(pill?.textContent).toContain("Finances");
    expect(pill?.getAttribute("aria-current")).toBe("page");
  });
});
