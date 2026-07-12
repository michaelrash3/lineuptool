import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TryoutAddPage } from "./TryoutAddPage";
import { renderWithProviders } from "../../test-utils";

// /tryouts/add — walk-up entry page. The end-to-end tab→page→submit flow is
// covered in TryoutsTab.test; this covers the page's own guards.

const renderPage = (ctxOver: any = {}) => {
  const appendTryoutSignup = vi.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/tryouts/add"]}>
      <Routes>
        <Route path="/tryouts" element={<div>TRYOUTS TAB</div>} />
        <Route path="/tryouts/add" element={<TryoutAddPage />} />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: { tryoutSignups: [], tryoutDates: [] },
        currentRole: "head",
        appendTryoutSignup,
        ...ctxOver,
      } as any,
    },
  );
  return { ...utils, appendTryoutSignup };
};

describe("TryoutAddPage", () => {
  it("requires first and last name before appending", () => {
    const { appendTryoutSignup, toastValue } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Add Player$/ }));
    expect(appendTryoutSignup).not.toHaveBeenCalled();
    expect(toastValue.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn" }),
    );
  });

  it("redirects assistants to the tryouts tab", () => {
    renderPage({ currentRole: "assistant" });
    expect(screen.getByText("TRYOUTS TAB")).toBeInTheDocument();
  });

  it("Back falls back to the tryouts tab on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("TRYOUTS TAB")).toBeInTheDocument();
  });
});
