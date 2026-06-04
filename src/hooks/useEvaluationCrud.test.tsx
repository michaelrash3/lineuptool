import { renderHook, act } from "@testing-library/react";
import { useEvaluationCrud } from "./useEvaluationCrud";
import { makeToast } from "../test-utils";

const setup = (over: any = {}, inputs: any = {}) => {
  const updateTeam = jest.fn();
  const toast = makeToast();
  const uiBridge = { current: { getInputs: () => inputs } };
  const teamData = { evaluationEvents: [], ...over };
  const user = { uid: "u1", displayName: "Mike Coach", email: "m@x.com" };
  const { result } = renderHook(() =>
    useEvaluationCrud({ teamData, updateTeam, toast, user, uiBridge })
  );
  return { result, updateTeam, toast };
};

describe("useEvaluationCrud", () => {
  it("saveTeamEvaluation creates a new Head round from uiBridge grades", () => {
    const { result, updateTeam } = setup({}, { teamEvalGrades: { p1: { hit: 3 } }, selectedRoundId: null });
    let id;
    act(() => { id = result.current.saveTeamEvaluation(); });
    const ev = updateTeam.mock.calls[0][0].evaluationEvents[0];
    expect(ev).toMatchObject({ id, coachRole: "Head", evaluatorId: "u1", evaluatorName: "Coach", grades: { p1: { hit: 3 } } });
  });

  it("saveTeamEvaluation updates an existing round when selectedRoundId is set", () => {
    const { result, updateTeam } = setup(
      { evaluationEvents: [{ id: "r1", coachRole: "Head", grades: {} }] },
      { teamEvalGrades: { p1: { hit: 5 } }, selectedRoundId: "r1" }
    );
    act(() => result.current.saveTeamEvaluation());
    expect(updateTeam.mock.calls[0][0].evaluationEvents[0]).toMatchObject({ id: "r1", grades: { p1: { hit: 5 } } });
  });

  it("saveAssistantEvaluation upserts an Assistant round", () => {
    const { result, updateTeam } = setup();
    act(() => result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    const ev = updateTeam.mock.calls[0][0].evaluationEvents[0];
    expect(ev).toMatchObject({ coachRole: "Assistant", evaluatorId: "u1", grades: { p1: { field: 4 } } });
  });

  it("deleteEvaluation removes the round by id", () => {
    const { result, updateTeam } = setup({ evaluationEvents: [{ id: "r1" }, { id: "r2" }] });
    act(() => result.current.deleteEvaluation("r1"));
    expect(updateTeam.mock.calls[0][0].evaluationEvents.map((e: any) => e.id)).toEqual(["r2"]);
  });
});
