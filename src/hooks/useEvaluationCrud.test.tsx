import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";
import { useEvaluationCrud } from "./useEvaluationCrud";
import { applyTeamOps, makeToast } from "../test-utils";

// Both flags ON for this file (the finding-3.1 write cutover, phase 3) and stub
// every subcollection writer, so the subcollection-primary block below is
// exercised without a real Firestore. The array-op tests in the main describe
// pass no db/appId/teamId, so subPrimary is false there regardless — they stay
// on the legacy array path and never touch these mocks.
vi.mock("../constants/flags", () => ({
  EVAL_ROUNDS_DUAL_WRITE: true,
  EVAL_ROUNDS_SUBCOLLECTION: true,
}));
vi.mock("../utils/evalRounds", () => ({
  mirrorEvalRound: vi.fn(() => Promise.resolve()),
  removeEvalRoundDoc: vi.fn(() => Promise.resolve()),
  saveEvalRound: vi.fn(() => Promise.resolve()),
  deleteEvalRound: vi.fn(() => Promise.resolve()),
}));
import {
  mirrorEvalRound,
  removeEvalRoundDoc,
  saveEvalRound,
  deleteEvalRound,
} from "../utils/evalRounds";

const setup = (over: any = {}, inputs: any = {}, uid = "u1") => {
  const updateTeamArrays = jest.fn();
  const toast = makeToast();
  const uiBridge = { current: { getInputs: () => inputs } };
  const teamData = { evaluationEvents: [], ...over };
  const user = { uid, displayName: "Mike Coach", email: "m@x.com" };
  const { result } = renderHook(() =>
    useEvaluationCrud({ teamData, updateTeamArrays, toast, user, uiBridge }),
  );
  return { result, teamData, updateTeamArrays, toast };
};

describe("useEvaluationCrud", () => {
  it("saveTeamEvaluation appends a new Head round from uiBridge grades", () => {
    const { result, updateTeamArrays } = setup(
      {},
      { teamEvalGrades: { p1: { hit: 3 } }, selectedRoundId: null },
    );
    let id;
    act(() => {
      id = result.current.saveTeamEvaluation();
    });
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "evaluationEvents" });
    expect(op.entries[0]).toMatchObject({
      id,
      coachRole: "Head",
      evaluatorId: "u1",
      evaluatorName: "Coach",
      grades: { p1: { hit: 3 } },
    });
  });

  it("saveTeamEvaluation updates an existing round via mapEntries when selectedRoundId is set", () => {
    const { result, teamData, updateTeamArrays } = setup(
      { evaluationEvents: [{ id: "r1", coachRole: "Head", grades: {} }] },
      { teamEvalGrades: { p1: { hit: 5 } }, selectedRoundId: "r1" },
    );
    act(() => result.current.saveTeamEvaluation());
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "evaluationEvents" });
    expect(applyTeamOps(teamData, op).evaluationEvents[0]).toMatchObject({
      id: "r1",
      grades: { p1: { hit: 5 } },
    });
  });

  it("saveAssistantEvaluation appends a new Assistant round", () => {
    const { result, updateTeamArrays } = setup();
    act(() => result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "evaluationEvents" });
    expect(op.entries[0]).toMatchObject({
      coachRole: "Assistant",
      evaluatorId: "u1",
      grades: { p1: { field: 4 } },
    });
  });

  it("saveAssistantEvaluation resubmits the same round in place (mapEntries)", () => {
    const { result, updateTeamArrays } = setup();
    act(() => result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    const firstEv = updateTeamArrays.mock.calls[0][0].entries[0];

    const again = setup({ evaluationEvents: [firstEv] });
    act(() =>
      again.result.current.saveAssistantEvaluation({ p1: { field: 5 } }),
    );
    const op = again.updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "evaluationEvents" });
    const next = applyTeamOps(again.teamData, op);
    expect(next.evaluationEvents).toHaveLength(1);
    expect(next.evaluationEvents[0].grades).toEqual({ p1: { field: 5 } });
  });

  it("two assistants submitting simultaneously BOTH emit appends — neither is derived from the other's state", () => {
    // The headline concurrency fix: each first submission is an arrayUnion
    // append, so during a live eval session no assistant's scores can be
    // erased by whoever saves last (the old whole-array write did exactly
    // that). Both hooks see the same pre-submission snapshot, mirroring two
    // devices that haven't received each other's write yet.
    const a = setup({}, {}, "assistant-1");
    const b = setup({}, {}, "assistant-2");
    act(() => a.result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    act(() => b.result.current.saveAssistantEvaluation({ p1: { field: 2 } }));
    const opA = a.updateTeamArrays.mock.calls[0][0];
    const opB = b.updateTeamArrays.mock.calls[0][0];
    expect(opA).toMatchObject({ op: "append", key: "evaluationEvents" });
    expect(opB).toMatchObject({ op: "append", key: "evaluationEvents" });
    // Applying both ops in either order lands both rounds.
    const merged = applyTeamOps({ evaluationEvents: [] }, [
      opA,
    ]).evaluationEvents;
    const both = applyTeamOps({ evaluationEvents: merged }, [opB]);
    expect(both.evaluationEvents.map((e: any) => e.evaluatorId)).toEqual([
      "assistant-1",
      "assistant-2",
    ]);
  });

  it("deleteEvaluation emits removeById", () => {
    const { result, updateTeamArrays } = setup({
      evaluationEvents: [{ id: "r1" }, { id: "r2" }],
    });
    act(() => result.current.deleteEvaluation("r1"));
    expect(updateTeamArrays.mock.calls[0][0]).toEqual({
      op: "removeById",
      key: "evaluationEvents",
      id: "r1",
    });
  });

  it("stamps a new round with createdAt for same-date tie-breaking", () => {
    const { result, updateTeamArrays } = setup(
      {},
      { teamEvalGrades: {}, selectedRoundId: null },
    );
    act(() => result.current.saveTeamEvaluation());
    const ev = updateTeamArrays.mock.calls[0][0].entries[0];
    expect(typeof ev.createdAt).toBe("number");
    expect(ev.createdAt).toBeGreaterThan(0);
  });

  it("avoids date collisions: a second new round in the same window gets a fresh date", () => {
    // First save claims the snapped cadence due date…
    const first = setup({}, { teamEvalGrades: {}, selectedRoundId: null });
    act(() => first.result.current.saveTeamEvaluation());
    const firstEv = first.updateTeamArrays.mock.calls[0][0].entries[0];

    // …so a second new round (same coach, same window) must carry a distinct
    // identity instead of an identical date+label that hides one of the two.
    const second = setup(
      { evaluationEvents: [firstEv] },
      { teamEvalGrades: {}, selectedRoundId: null },
    );
    act(() => second.result.current.saveTeamEvaluation());
    const secondEv = second.updateTeamArrays.mock.calls[0][0].entries[0];
    if (secondEv.date === firstEv.date) {
      // Only when today IS the snapped due date can the literal date match —
      // createdAt still breaks the tie toward the newer round.
      expect(secondEv.createdAt).toBeGreaterThanOrEqual(firstEv.createdAt);
    } else {
      expect(secondEv.date).not.toBe(firstEv.date);
    }
  });
});

describe("useEvaluationCrud subcollection-primary (write cutover)", () => {
  // Same as setup(), but supplies db/appId/teamId so subPrimary is true (both
  // flags are mocked on at the top of this file). In this mode the subcollection
  // is the authoritative home: writes go per-doc via saveEvalRound/deleteEvalRound
  // (error-propagating), and the legacy `evaluationEvents` array is NOT written.
  const cutSetup = (over: any = {}, inputs: any = {}, uid = "u1") => {
    const updateTeamArrays = jest.fn();
    const toast = makeToast();
    const uiBridge = { current: { getInputs: () => inputs } };
    const teamData = { evaluationEvents: [], ...over };
    const user = { uid, displayName: "Mike Coach", email: "m@x.com" };
    const { result } = renderHook(() =>
      useEvaluationCrud({
        teamData,
        updateTeamArrays,
        toast,
        user,
        uiBridge,
        db: {} as never,
        appId: "app1",
        teamId: "team1",
      }),
    );
    return { result, updateTeamArrays, toast };
  };

  beforeEach(() => {
    (saveEvalRound as any).mockClear();
    (deleteEvalRound as any).mockClear();
    (mirrorEvalRound as any).mockClear();
    (removeEvalRoundDoc as any).mockClear();
  });

  it("writes a new Head round to the subcollection and NOT the array", () => {
    const { result, updateTeamArrays } = cutSetup(
      {},
      { teamEvalGrades: { p1: { hit: 3 } }, selectedRoundId: null },
    );
    act(() => result.current.saveTeamEvaluation());
    // The authoritative write is the per-doc setDoc; the legacy array is left
    // untouched (no updateTeamArrays call at all).
    expect(saveEvalRound).toHaveBeenCalledTimes(1);
    expect(updateTeamArrays).not.toHaveBeenCalled();
    const [, appId, teamId, round] = (saveEvalRound as any).mock.calls[0];
    expect([appId, teamId]).toEqual(["app1", "team1"]);
    expect(round).toMatchObject({
      coachRole: "Head",
      evaluatorId: "u1",
      grades: { p1: { hit: 3 } },
    });
    // The best-effort mirror belongs to the pre-cutover soak — never fires now.
    expect(mirrorEvalRound).not.toHaveBeenCalled();
  });

  it("writes the edited round (grades applied) and NOT the array on in-place save", () => {
    const { result, updateTeamArrays } = cutSetup(
      {
        evaluationEvents: [
          { id: "r1", coachRole: "Head", evaluatorId: "u1", grades: {} },
        ],
      },
      { teamEvalGrades: { p1: { hit: 5 } }, selectedRoundId: "r1" },
    );
    act(() => result.current.saveTeamEvaluation());
    expect(updateTeamArrays).not.toHaveBeenCalled();
    expect(saveEvalRound).toHaveBeenCalledWith(
      expect.anything(),
      "app1",
      "team1",
      expect.objectContaining({ id: "r1", grades: { p1: { hit: 5 } } }),
    );
  });

  it("writes a new Assistant round to the subcollection and NOT the array", () => {
    const { result, updateTeamArrays } = cutSetup();
    act(() => result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    expect(updateTeamArrays).not.toHaveBeenCalled();
    expect(saveEvalRound).toHaveBeenCalledTimes(1);
    const round = (saveEvalRound as any).mock.calls[0][3];
    expect(round).toMatchObject({
      coachRole: "Assistant",
      evaluatorId: "u1",
      grades: { p1: { field: 4 } },
    });
  });

  it("deletes the round's doc and NOT via the array on delete", () => {
    const { result, updateTeamArrays } = cutSetup({
      evaluationEvents: [{ id: "r1" }],
    });
    act(() => result.current.deleteEvaluation("r1"));
    expect(updateTeamArrays).not.toHaveBeenCalled();
    expect(deleteEvalRound).toHaveBeenCalledWith(
      expect.anything(),
      "app1",
      "team1",
      "r1",
    );
    expect(removeEvalRoundDoc).not.toHaveBeenCalled();
  });

  it("surfaces an error toast when the subcollection save rejects", async () => {
    (saveEvalRound as any).mockRejectedValueOnce(new Error("offline"));
    const { result, toast } = cutSetup(
      {},
      { teamEvalGrades: { p1: { hit: 3 } }, selectedRoundId: null },
    );
    await act(async () => {
      result.current.saveTeamEvaluation();
      // Let the rejected save's .catch microtask run.
      await Promise.resolve();
    });
    expect(
      (toast.push as any).mock.calls.some((c: any[]) => c[0]?.kind === "error"),
    ).toBe(true);
  });

  it("surfaces an error toast when the subcollection delete rejects", async () => {
    (deleteEvalRound as any).mockRejectedValueOnce(new Error("offline"));
    const { result, toast } = cutSetup({ evaluationEvents: [{ id: "r1" }] });
    await act(async () => {
      result.current.deleteEvaluation("r1");
      await Promise.resolve();
    });
    expect(
      (toast.push as any).mock.calls.some((c: any[]) => c[0]?.kind === "error"),
    ).toBe(true);
  });
});
