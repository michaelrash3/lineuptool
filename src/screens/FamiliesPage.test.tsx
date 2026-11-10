import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FamiliesPage } from "./FamiliesPage";
import { renderWithProviders } from "../test-utils";

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

const setup = (team: any = {}) =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/families"]}>
      <Routes>
        <Route path="/families" element={<FamiliesPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
    { team: { currentRole: "head", team: { currentSeason: "2026", ...team } } },
  );

const card = (title: RegExp) =>
  screen.getByRole("button", { name: title }) as HTMLButtonElement;

describe("FamiliesPage", () => {
  it("shows one card per parent inbox with what's waiting in it", () => {
    setup({
      interestSignups: [{ id: "i1" }, { id: "i2" }],
      playerInfoSubmissions: [
        // The same parent sent the form twice — the inbox shows one, so the
        // card must count one.
        {
          id: "a",
          firstName: "Ada",
          lastName: "Ray",
          dob: "2016-04-01",
          submittedAt: "2026-05-01T00:00:00Z",
        },
        {
          id: "b",
          firstName: "Ada",
          lastName: "Ray",
          dob: "2016-04-01",
          submittedAt: "2026-05-03T00:00:00Z",
        },
        { id: "c", firstName: "Bo", lastName: "Li", dob: "2016-07-02" },
      ],
      availabilitySubmissions: [
        { id: "x", appliedToPlayerId: "p1" }, // already matched — done
        { id: "y" },
      ],
    });
    expect(card(/interest/i)).toHaveTextContent(/2\s*signups/i);
    expect(card(/player info/i)).toHaveTextContent(/2\s*players/i);
    expect(card(/availability/i)).toHaveTextContent(/1\s*to match/i);
  });

  it("hides inboxes the coach turned off in Settings", () => {
    setup({ disabledFeatures: ["interest", "availability"] });
    expect(
      screen.queryByRole("button", { name: /interest/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /availability/i }),
    ).not.toBeInTheDocument();
    expect(card(/player info/i)).toBeInTheDocument();
  });

  it("opens the inbox a card stands for", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(card(/player info/i));
    expect(screen.getByTestId("where")).toHaveTextContent("/player-info");
  });
});
