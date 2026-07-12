import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LogoColorPage } from "./LogoColorPage";
import { renderWithProviders } from "../../test-utils";

// /settings/logo-colors — assign extracted logo colors to the team's
// Primary / Secondary / Tertiary roles. The palette arrives via navigation
// state; a stateless arrival (refresh, cold deep link) bounces to Settings.

const team = {
  primaryColor: "#111111",
  secondaryColor: "#222222",
  tertiaryColor: "#ffffff",
  logoUrl: "data:image/png;base64,x",
};

const renderPage = (state: { palette: string[] } | null, ctxOver: any = {}) => {
  window.history.replaceState({ idx: 0 }, "");
  return renderWithProviders(
    <MemoryRouter
      initialEntries={[
        state
          ? { pathname: "/settings/logo-colors", state }
          : "/settings/logo-colors",
      ]}
    >
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/settings" element={<div>SETTINGS</div>} />
        <Route path="/settings/logo-colors" element={<LogoColorPage />} />
      </Routes>
    </MemoryRouter>,
    { team: { team, currentRole: "head", ...ctxOver } as any },
  );
};

describe("LogoColorPage", () => {
  it("seeds roles from the palette and applies the assignment", () => {
    const { teamValue } = renderPage({
      palette: ["#aa0000", "#00bb00", "#0000cc"],
    });
    expect(screen.getByText("Set colors from your logo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply colors" }));
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      primaryColor: "#aa0000",
      secondaryColor: "#00bb00",
      tertiaryColor: "#0000cc",
    });
    // Applying navigates back — deep link falls back to Settings.
    expect(screen.getByText("SETTINGS")).toBeInTheDocument();
  });

  it("reassigns a role when its swatch is tapped", () => {
    const { teamValue } = renderPage({ palette: ["#aa0000", "#00bb00"] });
    // Two-color palette: Tertiary falls back to the team's current value.
    fireEvent.click(
      screen.getByRole("button", { name: "Use #00bb00 for Primary" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply colors" }));
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      primaryColor: "#00bb00",
      secondaryColor: "#00bb00",
      tertiaryColor: "#ffffff",
    });
  });

  it("explains when extraction found nothing and offers no Apply", () => {
    renderPage({ palette: [] });
    expect(
      screen.getByText(/couldn't read distinct colors/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply colors" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("SETTINGS")).toBeInTheDocument();
  });

  it("bounces to Settings when there is no palette payload", () => {
    renderPage(null);
    expect(screen.getByText("SETTINGS")).toBeInTheDocument();
  });

  it("redirects assistants home", () => {
    renderPage({ palette: ["#aa0000"] }, { currentRole: "assistant" });
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });
});
