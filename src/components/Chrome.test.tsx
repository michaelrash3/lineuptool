import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

// Surfaces the router's current path so a test can assert that clicking a
// row actually navigated, rather than that a callback fired.
const PathProbe = () => {
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
};

const setup = (overrides: any = {}) => {
  const onSignOut = jest.fn();
  render(
    <MemoryRouter initialEntries={["/"]}>
      <NavDrawer
        navButtons={NAV}
        activeTab={overrides.activeTab ?? "home"}
        teamName="Wildcats"
        subtitle="Head Coach Dashboard"
        showSettings={overrides.showSettings ?? true}
        themeToggle={<button>Theme</button>}
        onSignOut={onSignOut}
      />
      <Routes>
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onSignOut };
};

const openDrawer = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /open navigation menu/i }),
  );

const drawer = () => screen.queryByRole("navigation", { name: /primary/i });

describe("NavDrawer", () => {
  it("hides the navigation until the hamburger is tapped", () => {
    setup();
    // Drawer panel is not mounted while closed.
    expect(drawer()).not.toBeInTheDocument();
    openDrawer();
    expect(drawer()).toBeInTheDocument();
  });

  it("lists every destination once the drawer is open", () => {
    setup();
    openDrawer();
    NAV.forEach((b) =>
      expect(screen.getByRole("link", { name: b.label })).toBeInTheDocument(),
    );
  });

  // The point of the drawer rows being anchors: the browser can preview the
  // target on hover, Cmd/middle-click opens a section in a new tab, and
  // right-click offers "Copy link address". A button gives you none of that.
  it("renders each destination as a real link to its route", () => {
    setup();
    openDrawer();
    expect(screen.getByRole("link", { name: "Finances" })).toHaveAttribute(
      "href",
      "/finances",
    );
    expect(screen.getByRole("link", { name: "Depth Chart" })).toHaveAttribute(
      "href",
      "/depth-chart",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("marks the active destination with aria-current", () => {
    setup({ activeTab: "roster" });
    openDrawer();
    const current = screen
      .getAllByRole("link")
      .filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Roster");
  });

  it("navigates to a destination and auto-closes the drawer", () => {
    setup();
    openDrawer();
    fireEvent.click(screen.getByRole("link", { name: /finances/i }));
    expect(screen.getByTestId("path")).toHaveTextContent("/finances");
    // Drawer closes after picking.
    expect(drawer()).not.toBeInTheDocument();
  });

  it("exposes Settings and Sign Out in the footer for head coaches", () => {
    const { onSignOut } = setup({ showSettings: true });
    openDrawer();
    fireEvent.click(screen.getByRole("link", { name: /settings/i }));
    expect(screen.getByTestId("path")).toHaveTextContent("/settings");
    openDrawer();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("omits Settings when showSettings is false (assistant view)", () => {
    setup({ showSettings: false });
    openDrawer();
    expect(
      screen.queryByRole("link", { name: /settings/i }),
    ).not.toBeInTheDocument();
    // Sign Out remains reachable for everyone.
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });
});
