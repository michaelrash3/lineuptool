import React from "react";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline baseline", () => {
  it("draws a dashed reference line when a baseline is given", () => {
    const { container } = render(
      <Sparkline values={[0.2, 0.25, 0.3]} baseline={0.27} />,
    );
    const ref = container.querySelector(".recharts-reference-line-line");
    expect(ref).toBeTruthy();
    expect(ref).toHaveAttribute("stroke-dasharray", "2 3");
  });

  it("renders no reference line without a baseline", () => {
    const { container } = render(<Sparkline values={[0.2, 0.25, 0.3]} />);
    expect(container.querySelector(".recharts-reference-line-line")).toBeNull();
  });

  it("still renders the baseline when it sits outside the data range", () => {
    // Baseline (0.5) is well above the data (.1–.2); the domain widens to keep
    // the reference line on-canvas instead of clipping off the top.
    const { container } = render(
      <Sparkline values={[0.1, 0.15, 0.2]} baseline={0.5} />,
    );
    expect(
      container.querySelector(".recharts-reference-line-line"),
    ).toBeTruthy();
  });
});
