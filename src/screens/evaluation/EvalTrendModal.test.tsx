import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { EvalTrendModal } from "./EvalTrendModal";
import type { EvalRound } from "../../utils/evalScoring";
import type { Player } from "../../types";

const player = { id: "p1", name: "Ava Rivera" } as Player;
const round = (id: string, grades: Record<string, unknown>, over = {}) =>
  ({
    id,
    date: `2026-0${id}-01`,
    label: `Round ${id}`,
    coachRole: "Head",
    evaluatorId: "u1",
    grades,
    ...over,
  }) as unknown as EvalRound;

describe("EvalTrendModal", () => {
  it("renders nothing without a player", () => {
    const { container } = render(
      <EvalTrendModal player={undefined} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the empty state when the player has no eval data, and closes", () => {
    const onClose = vi.fn();
    const { container } = render(
      <EvalTrendModal
        player={player}
        evaluationEvents={[]}
        userUid="u1"
        primaryColor="#1d4ed8"
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Ava Rivera")).toBeInTheDocument();
    expect(screen.getByText("No Evals Recorded")).toBeInTheDocument();
    // Clicking the backdrop (the outermost element) closes the modal.
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("summarizes a single recorded eval as needing more rounds", () => {
    render(
      <EvalTrendModal
        player={player}
        evaluationEvents={[round("1", { p1: { approach: 4 } })]}
        userUid="u1"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 eval recorded/)).toBeInTheDocument();
  });

  it("only counts the viewing coach's own head rounds", () => {
    // An assistant round and another coach's round must not count toward this
    // head coach's trend.
    render(
      <EvalTrendModal
        player={player}
        evaluationEvents={[
          round("1", { p1: { approach: 4 } }, { evaluatorId: "someone-else" }),
          round("2", { p1: { approach: 5 } }, { coachRole: "Assistant" }),
        ]}
        userUid="u1"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No Evals Recorded")).toBeInTheDocument();
  });
});
