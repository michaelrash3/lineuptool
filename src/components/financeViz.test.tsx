import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyMeter } from "./financeViz";

// MoneyMeter is a role=progressbar; it must carry an accessible name and a
// human-readable value, and never report a value past its max (invalid ARIA).
describe("MoneyMeter accessibility", () => {
  it("exposes an accessible name, valuetext, and clamped range", () => {
    render(
      <MoneyMeter value={1200} max={1500} ariaLabel="Team fees collected" />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-label", "Team fees collected");
    expect(bar).toHaveAttribute("aria-valuetext", "$1,200 of $1,500 — 80%");
    expect(bar).toHaveAttribute("aria-valuenow", "80");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps aria-valuenow to 100 when over budget", () => {
    render(<MoneyMeter value={2000} max={1000} />);
    const bar = screen.getByRole("progressbar");
    // 200% spend clamps to 100 so aria-valuenow never exceeds aria-valuemax,
    // while the spoken valuetext still tells the true story.
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "$2,000 of $1,000 — 200%");
  });

  it("falls back to the valuetext as its name when no label is given", () => {
    render(<MoneyMeter value={50} max={0} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuetext", "$50");
    expect(bar).toHaveAttribute("aria-label", "$50");
  });
});
