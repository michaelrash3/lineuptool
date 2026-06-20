import { render, screen, fireEvent, within } from "@testing-library/react";
import { LineupGrid } from "./LineupGrid";

// LineupGrid is a pure props-driven component (no context/Firebase), so it's
// straightforward to assert the tablist a11y + swap-selection behavior shipped
// in the accessibility pass. Note: the mobile and desktop layouts are BOTH in
// the DOM under jsdom (media queries don't apply), so position-cell labels
// appear twice; the inning tablist is mobile-only and used as the anchor here.

const lineup = [
  { P: { id: "p1", name: "Ava" }, C: { id: "p2", name: "Mia" }, BENCH: [] },
  { P: { id: "p2", name: "Mia" }, C: { id: "p1", name: "Ava" }, BENCH: [] },
];
const positions = ["P", "C"];

describe("LineupGrid", () => {
  it("renders the inning strip as a tablist with one selected tab per inning", () => {
    render(
      <LineupGrid
        lineup={lineup}
        positions={positions}
        swapSelection={null}
        onCellClick={jest.fn()}
      />,
    );
    const tablist = screen.getByRole("tablist", { name: /select inning/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });

  it("switches the selected inning tab on click", () => {
    render(
      <LineupGrid
        lineup={lineup}
        positions={positions}
        swapSelection={null}
        onCellClick={jest.fn()}
      />,
    );
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
  });

  it("calls onCellClick with (inning, position, player) when a cell is tapped", () => {
    const onCellClick = jest.fn();
    render(
      <LineupGrid
        lineup={lineup}
        positions={positions}
        swapSelection={null}
        onCellClick={onCellClick}
      />,
    );
    // Both layouts render this label; either fires the same handler.
    fireEvent.click(screen.getAllByLabelText(/Inning 1, P: Ava/i)[0]);
    expect(onCellClick).toHaveBeenCalledWith(0, "P", { id: "p1", name: "Ava" });
  });

  it("marks the armed swap cell as pressed", () => {
    render(
      <LineupGrid
        lineup={lineup}
        positions={positions}
        swapSelection={{ innIdx: 0, pos: "C" }}
        onCellClick={jest.fn()}
      />,
    );
    // The C cell in inning 1 is the armed selection → aria-pressed=true.
    const armed = screen.getAllByLabelText(/Inning 1, C: Mia/i);
    expect(armed.some((el) => el.getAttribute("aria-pressed") === "true")).toBe(
      true,
    );
  });

  it("is inert (no throw) when onCellClick is omitted", () => {
    render(
      <LineupGrid lineup={lineup} positions={positions} swapSelection={null} />,
    );
    expect(() =>
      fireEvent.click(screen.getAllByLabelText(/Inning 1, P: Ava/i)[0]),
    ).not.toThrow();
  });
});
