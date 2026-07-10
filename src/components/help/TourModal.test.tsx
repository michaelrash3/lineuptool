import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Icons } from "../../icons";
import { attachStepNumbers, TourModal, type TourStep } from "./TourModal";

const makeSteps = (count: number): TourStep[] =>
  Array.from({ length: count }, (_, i) => ({
    eyebrow: `Eyebrow ${i}`,
    title: `Panel ${i}`,
    icon: Icons.Check,
    body: `Body copy ${i}`,
  }));

const setup = (
  overrides: Partial<React.ComponentProps<typeof TourModal>> = {},
) => {
  const onClose = jest.fn();
  const onComplete = jest.fn();
  const utils = render(
    <TourModal
      open
      onClose={onClose}
      onComplete={onComplete}
      steps={makeSteps(3)}
      {...overrides}
    />,
  );
  return { onClose, onComplete, ...utils };
};

describe("TourModal", () => {
  it("renders the first step when opened", () => {
    setup();
    expect(screen.getByText("Panel 0")).toBeInTheDocument();
    expect(screen.getByText("Body copy 0")).toBeInTheDocument();
    expect(screen.getByText("Eyebrow 0")).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Panel 0")).not.toBeInTheDocument();
  });

  it("walks steps with Next and Back", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Panel 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("Panel 0")).toBeInTheDocument();
    // Back is only offered past the first step.
    expect(
      screen.queryByRole("button", { name: /back/i }),
    ).not.toBeInTheDocument();
  });

  it("navigates with ArrowRight / ArrowLeft and clamps at the ends", () => {
    setup();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("Panel 0")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Panel 1")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Panel 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("Panel 1")).toBeInTheDocument();
  });

  it("closes on Escape without completing", () => {
    const { onClose, onComplete } = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("Skip Tour and the X button close without completing", () => {
    const { onClose, onComplete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Skip Tour" }));
    fireEvent.click(screen.getByRole("button", { name: "Close tour" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("Done on the last step completes, then closes", () => {
    const order: string[] = [];
    const onClose = jest.fn(() => order.push("close"));
    const onComplete = jest.fn(() => order.push("complete"));
    render(
      <TourModal
        open
        onClose={onClose}
        onComplete={onComplete}
        steps={makeSteps(2)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["complete", "close"]);
  });

  it("running a CTA fires its action and closes without completing", () => {
    const run = jest.fn();
    const secondaryRun = jest.fn();
    const steps: TourStep[] = [
      {
        title: "With CTA",
        icon: Icons.Check,
        body: "Go do it",
        cta: [
          { label: "Go to Roster", primary: true, run },
          { label: "Import a CSV", run: secondaryRun },
        ],
      },
    ];
    const { onClose, onComplete } = setup({ steps });
    fireEvent.click(screen.getByRole("button", { name: "Go to Roster" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(secondaryRun).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows the dot row for 10 or fewer steps", () => {
    const { container } = setup({ steps: makeSteps(3) });
    expect(container.querySelectorAll("span.transition-all")).toHaveLength(3);
    expect(screen.queryByText("1 / 3")).not.toBeInTheDocument();
  });

  it("shows compact n / m text instead of dots for more than 10 steps", () => {
    const { container } = setup({ steps: makeSteps(11) });
    expect(screen.getByText("1 / 11")).toBeInTheDocument();
    expect(container.querySelectorAll("span.transition-all")).toHaveLength(0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 11")).toBeInTheDocument();
  });

  it("resets to the first step whenever it reopens", () => {
    const steps = makeSteps(3);
    const onClose = jest.fn();
    const { rerender } = render(
      <TourModal open onClose={onClose} steps={steps} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Panel 1")).toBeInTheDocument();
    rerender(<TourModal open={false} onClose={onClose} steps={steps} />);
    rerender(<TourModal open onClose={onClose} steps={steps} />);
    expect(screen.getByText("Panel 0")).toBeInTheDocument();
  });
});

describe("attachStepNumbers", () => {
  it("stamps Step N of M onto numbered steps only, without mutating input", () => {
    const steps: TourStep[] = [
      { title: "Intro", icon: Icons.Check, body: "hi", eyebrow: "Welcome" },
      { title: "A", icon: Icons.Check, body: "a", numbered: true },
      { title: "B", icon: Icons.Check, body: "b", numbered: true },
    ];
    const out = attachStepNumbers(steps);
    expect(out[0].eyebrow).toBe("Welcome");
    expect(out[1].eyebrow).toBe("Step 1 of 2");
    expect(out[2].eyebrow).toBe("Step 2 of 2");
    expect(steps[1].eyebrow).toBeUndefined();
  });
});
