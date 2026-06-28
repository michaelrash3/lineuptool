import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppLoadingScreen, ScreenLoader } from "./LoadingScreens";

// Both loaders are presentational, but their a11y contract matters: they're
// the "still loading" surfaces, so each must expose a status role and an
// sr-only "Loading…" for screen readers.
describe("loading screens", () => {
  it("AppLoadingScreen announces loading and shows the app name", () => {
    render(<AppLoadingScreen />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
    expect(screen.getByText("The Bench Coach")).toBeInTheDocument();
  });

  it("ScreenLoader exposes a status role with an sr-only label", () => {
    render(<ScreenLoader />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
