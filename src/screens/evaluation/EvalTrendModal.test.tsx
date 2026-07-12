import { screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EvalTrendView, EvalTrendPage } from "./EvalTrendModal";
import { renderWithProviders } from "../../test-utils";
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

// The view is chrome-agnostic but renders inside PageShell, which needs no
// router; renderWithProviders supplies the contexts the page variant reads.
const renderView = (props: Partial<Parameters<typeof EvalTrendView>[0]>) =>
  renderWithProviders(
    <EvalTrendView player={player} userUid="u1" onBack={vi.fn()} {...props} />,
  );

describe("EvalTrendView", () => {
  it("renders nothing without a player", () => {
    const { container } = renderWithProviders(
      <EvalTrendView player={undefined} onBack={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the empty state when the player has no eval data", () => {
    renderView({ evaluationEvents: [] });
    expect(screen.getByText("Ava Rivera")).toBeInTheDocument();
    expect(screen.getByText("No Evals Recorded")).toBeInTheDocument();
  });

  it("summarizes a single recorded eval as needing more rounds", () => {
    renderView({ evaluationEvents: [round("1", { p1: { approach: 4 } })] });
    expect(screen.getByText(/1 eval recorded/)).toBeInTheDocument();
  });

  it("only counts the viewing coach's own head rounds", () => {
    // An assistant round and another coach's round must not count toward this
    // head coach's trend.
    renderView({
      evaluationEvents: [
        round("1", { p1: { approach: 4 } }, { evaluatorId: "someone-else" }),
        round("2", { p1: { approach: 5 } }, { coachRole: "Assistant" }),
      ],
    });
    expect(screen.getByText("No Evals Recorded")).toBeInTheDocument();
  });
});

describe("EvalTrendPage", () => {
  const renderPage = (path: string, ctxOver: any = {}) =>
    renderWithProviders(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/evaluation" element={<div>EVAL TAB</div>} />
          <Route
            path="/evaluation/trend/:playerId"
            element={<EvalTrendPage />}
          />
        </Routes>
      </MemoryRouter>,
      {
        team: {
          team: {
            players: [player],
            evaluationEvents: [round("1", { p1: { approach: 4 } })],
          },
          user: { uid: "u1" },
          currentRole: "head",
          ...ctxOver,
        },
      },
    );

  it("renders the routed player's trend", () => {
    renderPage("/evaluation/trend/p1");
    expect(screen.getByText("Evaluation Trend")).toBeInTheDocument();
    expect(screen.getByText(/1 eval recorded/)).toBeInTheDocument();
  });

  it("redirects unknown players to the evaluation tab", () => {
    renderPage("/evaluation/trend/nope");
    expect(screen.getByText("EVAL TAB")).toBeInTheDocument();
  });

  it("redirects assistants to the evaluation tab", () => {
    renderPage("/evaluation/trend/p1", { currentRole: "assistant" });
    expect(screen.getByText("EVAL TAB")).toBeInTheDocument();
  });

  it("Back falls back to the evaluation tab on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage("/evaluation/trend/p1");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("EVAL TAB")).toBeInTheDocument();
  });
});
