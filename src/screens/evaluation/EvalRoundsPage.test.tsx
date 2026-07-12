import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EvalRoundsPage } from "./EvalRoundsPage";
import { EvalComparePage } from "./EvalComparePage";
import { renderWithProviders } from "../../test-utils";

const rounds = [
  {
    id: "r2",
    date: "2026-05-01",
    label: "May",
    coachRole: "Head",
    evaluatorId: "u1",
    createdAt: 2,
    grades: { p1: { approach: 5 } },
  },
  {
    id: "r1",
    date: "2026-02-01",
    label: "February",
    coachRole: "Head",
    evaluatorId: "u1",
    createdAt: 1,
    grades: { p1: { approach: 2 } },
  },
  // Someone else's round never shows in "your" lists.
  {
    id: "rx",
    date: "2026-03-01",
    label: "Other Coach",
    coachRole: "Head",
    evaluatorId: "u2",
    grades: {},
  },
];

const team = {
  players: [{ id: "p1", name: "Ava Rivera", number: "7" }],
  evaluationEvents: rounds,
  pitchingFormat: "Kid Pitch",
};

const renderPage = (
  path: string,
  el: React.ReactElement,
  ctxOver: any = {},
  uiOver: any = {},
) => {
  const deleteEvaluation = jest.fn();
  const setSelectedRoundId = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/evaluation" element={<div>EVAL TAB</div>} />
        <Route path="/evaluation/rounds" element={<EvalRoundsPage />} />
        <Route path="/evaluation/compare" element={<EvalComparePage />} />
        <Route
          path="/evaluation/trend/:playerId"
          element={<div>TREND PAGE</div>}
        />
        {el}
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team,
        user: { uid: "u1" },
        currentRole: "head",
        deleteEvaluation,
        ...ctxOver,
      },
      ui: { selectedRoundId: "r2", setSelectedRoundId, ...uiOver },
    },
  );
  return { deleteEvaluation, setSelectedRoundId, ...utils };
};

describe("EvalRoundsPage", () => {
  it("lists only the coach's own rounds, marking the active one", () => {
    renderPage("/evaluation/rounds", <></>);
    expect(screen.getByText("Your Saved Rounds")).toBeInTheDocument();
    expect(screen.getByText(/May/)).toBeInTheDocument();
    expect(screen.getByText(/February/)).toBeInTheDocument();
    expect(screen.queryByText(/Other Coach/)).not.toBeInTheDocument();
    expect(screen.getByText("Currently editing")).toBeInTheDocument();
  });

  it("Select switches the round and returns to the workspace", () => {
    const { setSelectedRoundId } = renderPage("/evaluation/rounds", <></>);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(setSelectedRoundId).toHaveBeenCalledWith("r1");
    expect(screen.getByText("EVAL TAB")).toBeInTheDocument();
  });

  it("delete is two-tap armed and clears the selection when it was active", () => {
    const { deleteEvaluation, setSelectedRoundId } = renderPage(
      "/evaluation/rounds",
      <></>,
    );
    const del = screen.getByRole("button", { name: /^Delete May/ });
    fireEvent.click(del);
    expect(deleteEvaluation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirm delete May/ }));
    expect(deleteEvaluation).toHaveBeenCalledWith("r2");
    expect(setSelectedRoundId).toHaveBeenCalledWith(null);
  });

  it("redirects assistants to the evaluation tab", () => {
    renderPage("/evaluation/rounds", <></>, { currentRole: "assistant" });
    expect(screen.getByText("EVAL TAB")).toBeInTheDocument();
  });
});

describe("EvalComparePage", () => {
  it("compares the two newest rounds and links players to their trend", () => {
    renderPage("/evaluation/compare", <></>);
    expect(screen.getByText("Side By Side")).toBeInTheDocument();
    // Older 2 → newer 5 = +3 delta somewhere in the grid.
    expect(screen.getAllByText("+3").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Ava Rivera" }));
    expect(screen.getByText("TREND PAGE")).toBeInTheDocument();
  });

  it("redirects when there are fewer than two rounds", () => {
    renderPage("/evaluation/compare", <></>, {
      team: { ...team, evaluationEvents: [rounds[0]] },
    });
    expect(screen.getByText("EVAL TAB")).toBeInTheDocument();
  });

  it("redirects assistants to the evaluation tab", () => {
    renderPage("/evaluation/compare", <></>, { currentRole: "assistant" });
    expect(screen.getByText("EVAL TAB")).toBeInTheDocument();
  });
});
