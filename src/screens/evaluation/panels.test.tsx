import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import {
  InsightsPanel,
  RoundComparisonView,
  AssistantSubmissionsPanel,
} from "./panels";
import { EVAL_CATEGORIES } from "../../constants/ui";
import type { EvalRound } from "../../utils/evalScoring";
import type { Player } from "../../types";

// "approach" is a real universal (non-add-on) category, so avgUniversal picks
// it up — a one-category grade record has that category as its whole average.
const round = (id: string, grades: Record<string, unknown>, over = {}) =>
  ({
    id,
    date: `2026-0${id}-01`,
    label: `Round ${id}`,
    grades,
    ...over,
  }) as unknown as EvalRound;
const player = (id: string, name: string) => ({ id, name }) as Player;

const players = [player("p1", "Ava"), player("p2", "Ben")];

describe("InsightsPanel", () => {
  it("renders nothing with fewer than two rounds", () => {
    const { container } = render(
      <InsightsPanel
        rounds={[round("1", { p1: { approach: 4 } })]}
        players={players}
        activeCategories={EVAL_CATEGORIES}
        onPlayerClick={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("flags a standout, a regression, and a category drop, and links each player", () => {
    // rounds[0] is the newer round, rounds[1] the older one.
    // p1 rose 2→5 (standout, +3); p2 fell 5→2 (regression -3 AND a category
    // drop of 3 on approach).
    const rounds = [
      round("2", { p1: { approach: 5 }, p2: { approach: 2 } }),
      round("1", { p1: { approach: 2 }, p2: { approach: 5 } }),
    ];
    const onPlayerClick = vi.fn();
    render(
      <InsightsPanel
        rounds={rounds}
        players={players}
        activeCategories={EVAL_CATEGORIES}
        onPlayerClick={onPlayerClick}
      />,
    );
    expect(screen.getByText("Standouts")).toBeInTheDocument();
    expect(screen.getByText("Regressions")).toBeInTheDocument();
    expect(screen.getByText(/Category Drops/)).toBeInTheDocument();
    // The standout player's name is a button that opens their trend.
    fireEvent.click(screen.getByRole("button", { name: "Ava" }));
    expect(onPlayerClick).toHaveBeenCalledWith("p1");
  });

  it("renders nothing when the two rounds show no notable movement", () => {
    const rounds = [
      round("2", { p1: { approach: 4 } }),
      round("1", { p1: { approach: 4 } }),
    ];
    const { container } = render(
      <InsightsPanel
        rounds={rounds}
        players={[players[0]]}
        activeCategories={EVAL_CATEGORIES}
        onPlayerClick={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RoundComparisonView", () => {
  it("shows each player's newer grade and the delta", () => {
    const rounds = [
      round("2", { p1: { approach: 5 } }),
      round("1", { p1: { approach: 2 } }),
    ];
    const onPlayerClick = vi.fn();
    render(
      <RoundComparisonView
        rounds={rounds}
        players={[players[0]]}
        activeCategories={EVAL_CATEGORIES}
        onPlayerClick={onPlayerClick}
      />,
    );
    // Avg Δ from older 2 to newer 5 is +3.
    expect(screen.getAllByText("+3").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Ava" }));
    expect(onPlayerClick).toHaveBeenCalledWith("p1");
  });
});

describe("AssistantSubmissionsPanel", () => {
  const assistantEval = (over = {}) =>
    round(
      "9",
      {
        p1: { approach: 4, suggestedPositions: ["SS"], notes: "great glove" },
      },
      {
        coachRole: "Assistant",
        evaluatorId: "asst-1",
        evaluatorName: "Coach Kim",
        ...over,
      },
    );

  it("renders nothing when no assistant has submitted", () => {
    const { container } = render(
      <AssistantSubmissionsPanel
        evaluationEvents={[
          round("1", { p1: { approach: 4 } }, { coachRole: "Head" }),
        ]}
        players={players}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each assistant's latest positions and notes", () => {
    render(
      <AssistantSubmissionsPanel
        evaluationEvents={[assistantEval()]}
        players={players}
      />,
    );
    expect(screen.getByText("Assistant Submissions")).toBeInTheDocument();
    expect(screen.getByText(/Coach Kim/)).toBeInTheDocument();
    expect(screen.getByText("Ava")).toBeInTheDocument();
    expect(screen.getByText("SS")).toBeInTheDocument();
    expect(screen.getByText("great glove")).toBeInTheDocument();
  });

  it("requires a two-tap confirm before deleting an assistant round", () => {
    const onDelete = vi.fn();
    render(
      <AssistantSubmissionsPanel
        evaluationEvents={[assistantEval()]}
        players={players}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Delete assistant eval round/ }),
    );
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Confirm delete assistant eval round/,
      }),
    );
    expect(onDelete).toHaveBeenCalledWith("9");
  });
});
