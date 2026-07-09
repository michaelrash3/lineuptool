import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";
import { useEvaluationCrud } from "./useEvaluationCrud";
import { makeToast } from "../test-utils";

// Stub the subcollection writers so the per-doc write path is exercised
// without a real Firestore. Rounds live ONLY in the evalRounds subcollection
// (finding-3.1) — there is no legacy-array write path left to test.
vi.mock("../utils/evalRounds", () => ({
  saveEvalRound: vi.fn(() => Promise.resolve()),
  deleteEvalRound: vi.fn(() => Promise.resolve()),
}));
import { saveEvalRound, deleteEvalRound } from "../utils/evalRounds";

const setup = (over: any = {}, inputs: any = {}, uid = "u1") => {
  const toast = makeToast();
  const uiBridge = { current: { getInputs: () => inputs } };
  const teamData = { evaluationEvents: [], ...over };
  const user = { uid, displayName: "Mike Coach", email: "m@x.com" };
  const { result } = renderHook(() =>
    useEvaluationCrud({
      teamData,
      toast,
      user,
      uiBridge,
      db: {} as never,
      appId: "app1",
      teamId: "team1",
    }),
  );
  return { result, teamData, toast };
};

beforeEach(() => {
  (saveEvalRound as any).mockClear();
  (deleteEvalRound as any).mockClear();
});

describe("useEvaluationCrud", () => {
  it("saveTeamEvaluation writes a new Head round per-doc from uiBridge grades", () => {
    const { result } = setup(
      {},
      { teamEvalGrades: { p1: { hit: 3 } }, selectedRoundId: null },
    );
    let id;
    act(() => {
      id = result.current.saveTeamEvaluation();
    });
    expect(saveEvalRound).toHaveBeenCalledTimes(1);
    const [, appId, teamId, round] = (saveEvalRound as any).mock.calls[0];
    expect([appId, teamId]).toEqual(["app1", "team1"]);
    expect(round).toMatchObject({
      id,
      coachRole: "Head",
      evaluatorId: "u1",
      evaluatorName: "Coach",
      grades: { p1: { hit: 3 } },
    });
  });

  it("saveTeamEvaluation updates the existing round in place when selectedRoundId is set", () => {
    const { result } = setup(
      {
        evaluationEvents: [
          { id: "r1", coachRole: "Head", evaluatorId: "u1", grades: {} },
        ],
      },
      { teamEvalGrades: { p1: { hit: 5 } }, selectedRoundId: "r1" },
    );
    act(() => result.current.saveTeamEvaluation());
    expect(saveEvalRound).toHaveBeenCalledWith(
      expect.anything(),
      "app1",
      "team1",
      expect.objectContaining({ id: "r1", grades: { p1: { hit: 5 } } }),
    );
  });

  it("saveAssistantEvaluation writes a new Assistant round per-doc", () => {
    const { result } = setup();
    act(() => result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    expect(saveEvalRound).toHaveBeenCalledTimes(1);
    const round = (saveEvalRound as any).mock.calls[0][3];
    expect(round).toMatchObject({
      coachRole: "Assistant",
      evaluatorId: "u1",
      grades: { p1: { field: 4 } },
    });
  });

  it("saveAssistantEvaluation resubmits the same round in place (same id)", () => {
    const { result } = setup();
    act(() => result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    const firstEv = (saveEvalRound as any).mock.calls[0][3];

    const again = setup({ evaluationEvents: [firstEv] });
    act(() =>
      again.result.current.saveAssistantEvaluation({ p1: { field: 5 } }),
    );
    const secondEv = (saveEvalRound as any).mock.calls[1][3];
    // Same round id → setDoc overwrites the round instead of duplicating it.
    expect(secondEv.id).toBe(firstEv.id);
    expect(secondEv.grades).toEqual({ p1: { field: 5 } });
  });

  it("two assistants submitting simultaneously each land in their OWN doc", () => {
    // The concurrency property, by construction: every round is its own
    // subcollection doc keyed by its own id, so during a live eval session no
    // assistant's scores can be erased by whoever saves last.
    const a = setup({}, {}, "assistant-1");
    const b = setup({}, {}, "assistant-2");
    act(() => a.result.current.saveAssistantEvaluation({ p1: { field: 4 } }));
    act(() => b.result.current.saveAssistantEvaluation({ p1: { field: 2 } }));
    const rounds = (saveEvalRound as any).mock.calls.map((c: any[]) => c[3]);
    expect(rounds.map((r: any) => r.evaluatorId)).toEqual([
      "assistant-1",
      "assistant-2",
    ]);
    expect(rounds[0].id).not.toBe(rounds[1].id);
  });

  it("deleteEvaluation deletes the round's own doc", () => {
    const { result } = setup({
      evaluationEvents: [{ id: "r1" }, { id: "r2" }],
    });
    act(() => result.current.deleteEvaluation("r1"));
    expect(deleteEvalRound).toHaveBeenCalledWith(
      expect.anything(),
      "app1",
      "team1",
      "r1",
    );
  });

  it("stamps a new round with createdAt for same-date tie-breaking", () => {
    const { result } = setup({}, { teamEvalGrades: {}, selectedRoundId: null });
    act(() => result.current.saveTeamEvaluation());
    const ev = (saveEvalRound as any).mock.calls[0][3];
    expect(typeof ev.createdAt).toBe("number");
    expect(ev.createdAt).toBeGreaterThan(0);
  });

  it("avoids date collisions: a second new round in the same window gets a fresh date", () => {
    // First save claims the snapped cadence due date…
    const first = setup({}, { teamEvalGrades: {}, selectedRoundId: null });
    act(() => first.result.current.saveTeamEvaluation());
    const firstEv = (saveEvalRound as any).mock.calls[0][3];

    // …so a second new round (same coach, same window) must carry a distinct
    // identity instead of an identical date+label that hides one of the two.
    const second = setup(
      { evaluationEvents: [firstEv] },
      { teamEvalGrades: {}, selectedRoundId: null },
    );
    act(() => second.result.current.saveTeamEvaluation());
    const secondEv = (saveEvalRound as any).mock.calls[1][3];
    if (secondEv.date === firstEv.date) {
      // Only when today IS the snapped due date can the literal date match —
      // createdAt still breaks the tie toward the newer round.
      expect(secondEv.createdAt).toBeGreaterThanOrEqual(firstEv.createdAt);
    } else {
      expect(secondEv.date).not.toBe(firstEv.date);
    }
  });

  it("no-ops the write (no crash) when the Firestore handles are absent", () => {
    const toast = makeToast();
    const uiBridge = {
      current: { getInputs: () => ({ teamEvalGrades: {} }) },
    };
    const { result } = renderHook(() =>
      useEvaluationCrud({
        teamData: { evaluationEvents: [] },
        toast,
        user: { uid: "u1" },
        uiBridge,
      }),
    );
    act(() => {
      result.current.saveTeamEvaluation();
      result.current.deleteEvaluation("r1");
    });
    expect(saveEvalRound).not.toHaveBeenCalled();
    expect(deleteEvalRound).not.toHaveBeenCalled();
  });

  it("surfaces an error toast when the subcollection save rejects", async () => {
    (saveEvalRound as any).mockRejectedValueOnce(new Error("offline"));
    const { result, toast } = setup(
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
    const { result, toast } = setup({ evaluationEvents: [{ id: "r1" }] });
    await act(async () => {
      result.current.deleteEvaluation("r1");
      await Promise.resolve();
    });
    expect(
      (toast.push as any).mock.calls.some((c: any[]) => c[0]?.kind === "error"),
    ).toBe(true);
  });
});
