import { vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { useEvaluationCrud } from "./useEvaluationCrud";
import { makeToast } from "../test-utils";

// Evaluations now live in a subcollection, so the hook imports firebase. Stub
// it, and encode doc paths so source-routing is assertable.
vi.mock("../firebase", () => ({ appId: "app", db: {} }));
vi.mock("../utils/errorReporter", () => ({ reportError: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: any, ...path: string[]) => ({ path: path.join("/") })),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
}));

const mockSetDoc = setDoc as unknown as ReturnType<typeof vi.fn>;
const mockUpdateDoc = updateDoc as unknown as ReturnType<typeof vi.fn>;
const mockDeleteDoc = deleteDoc as unknown as ReturnType<typeof vi.fn>;

const setup = (over: any = {}, inputs: any = {}) => {
  const updateTeam = jest.fn();
  const toast = makeToast();
  const uiBridge = { current: { getInputs: () => inputs } };
  const teamData = { evaluationEvents: [], ...over };
  const user = { uid: "u1", displayName: "Mike Coach", email: "m@x.com" };
  const { result } = renderHook(() =>
    useEvaluationCrud({ teamData, updateTeam, toast, user, uiBridge, activeTeamId: "team-1" })
  );
  return { result, updateTeam, toast };
};

beforeEach(() => {
  mockSetDoc.mockClear();
  mockUpdateDoc.mockClear();
  mockDeleteDoc.mockClear();
});

describe("useEvaluationCrud", () => {
  it("saveTeamEvaluation creates a new Head round in the subcollection", () => {
    const { result, updateTeam } = setup({}, { teamEvalGrades: { p1: { hit: 3 } }, selectedRoundId: null });
    let id;
    act(() => { id = result.current.saveTeamEvaluation(); });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, ev] = mockSetDoc.mock.calls[0];
    expect(ref.path).toContain("/evaluationEvents/");
    expect(ev).toMatchObject({ id, coachRole: "Head", evaluatorId: "u1", evaluatorName: "Coach", grades: { p1: { hit: 3 } } });
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("saveTeamEvaluation updates an existing LEGACY round via the root array", () => {
    const { result, updateTeam } = setup(
      { evaluationEvents: [{ id: "r1", coachRole: "Head", grades: {} }] },
      { teamEvalGrades: { p1: { hit: 5 } }, selectedRoundId: "r1" }
    );
    act(() => result.current.saveTeamEvaluation());
    expect(updateTeam.mock.calls[0][0].evaluationEvents[0]).toMatchObject({ id: "r1", grades: { p1: { hit: 5 } } });
  });

  it("saveTeamEvaluation updates an existing SUBCOLLECTION round via its doc", () => {
    const { result, updateTeam } = setup(
      { evaluationEvents: [{ id: "r1", _sub: "evaluationEvents", coachRole: "Head", grades: {} }] },
      { teamEvalGrades: { p1: { hit: 5 } }, selectedRoundId: "r1" }
    );
    act(() => result.current.saveTeamEvaluation());
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("/evaluationEvents/r1") }),
      { grades: { p1: { hit: 5 } } }
    );
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("saveAssistantEvaluation creates a new round in the subcollection", () => {
    const { result } = setup();
    act(() => result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    const [, ev] = mockSetDoc.mock.calls[0];
    expect(ev).toMatchObject({ coachRole: "Assistant", evaluatorId: "u1", grades: { p1: { field: 4 } } });
  });

  it("deleteEvaluation removes a legacy round via the root array", () => {
    const { result, updateTeam } = setup({ evaluationEvents: [{ id: "r1" }, { id: "r2" }] });
    act(() => result.current.deleteEvaluation("r1"));
    expect(updateTeam.mock.calls[0][0].evaluationEvents.map((e: any) => e.id)).toEqual(["r2"]);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("deleteEvaluation removes a subcollection round via its doc", () => {
    const { result, updateTeam } = setup({
      evaluationEvents: [{ id: "r1", _sub: "evaluationEvents" }],
    });
    act(() => result.current.deleteEvaluation("r1"));
    expect(mockDeleteDoc.mock.calls[0][0].path).toContain("/evaluationEvents/r1");
    expect(updateTeam).not.toHaveBeenCalled();
  });
});
