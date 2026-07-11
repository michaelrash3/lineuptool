import { renderHook, act } from "@testing-library/react";
import { useDevelopmentCrud } from "./useDevelopmentCrud";
import { applyTeamOps, makeToast } from "../test-utils";
import { DEV_GOALS_CAP, DEV_CHECKINS_CAP } from "../utils/developmentPlan";

const setup = (teamOver: any = {}) => {
  const updateTeamArrays = jest.fn();
  const toast = makeToast();
  const teamData = {
    players: [{ id: "p1", name: "Ava" }],
    ...teamOver,
  };
  const { result } = renderHook(() =>
    useDevelopmentCrud({ teamData, updateTeamArrays, toast }),
  );
  const apply = () => applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
  return { result, teamData, updateTeamArrays, toast, apply };
};

describe("useDevelopmentCrud", () => {
  it("setPlayerHealth writes a clamped, stamped status", () => {
    const { result, apply } = setup();
    act(() =>
      result.current.setPlayerHealth("p1", {
        status: "out",
        note: "x".repeat(300),
        expectedReturn: "2026-06-10",
      }),
    );
    const p = apply().players[0];
    expect(p.health.status).toBe("out");
    expect(p.health.note).toHaveLength(200);
    expect(p.health.expectedReturn).toBe("2026-06-10");
    expect(p.health.updatedAt).toBeTruthy();
  });

  it("setPlayerHealth(null) — and 'healthy' — leave no health key behind", () => {
    const { result, apply } = setup({
      players: [{ id: "p1", name: "Ava", health: { status: "out" } }],
    });
    act(() => result.current.setPlayerHealth("p1", null));
    expect("health" in apply().players[0]).toBe(false);
  });

  it("addGoal appends an active goal and enforces the cap", () => {
    const { result, apply, updateTeamArrays, toast } = setup();
    act(() =>
      result.current.addGoal("p1", "  Square up fastballs  ", "2026-07-01"),
    );
    const p = apply().players[0];
    expect(p.devPlan.goals).toHaveLength(1);
    expect(p.devPlan.goals[0]).toMatchObject({
      text: "Square up fastballs",
      status: "active",
      targetDate: "2026-07-01",
    });

    // At the cap: warn, no write.
    updateTeamArrays.mockClear();
    const full = Array.from({ length: DEV_GOALS_CAP }, (_, i) => ({
      id: `g${i}`,
      text: "t",
      status: "active",
      createdAt: "2026-05-01",
    }));
    const capped = setup({
      players: [{ id: "p1", name: "Ava", devPlan: { goals: full } }],
    });
    act(() => capped.result.current.addGoal("p1", "One more"));
    expect(capped.updateTeamArrays).not.toHaveBeenCalled();
    expect(capped.toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn" }),
    );
  });

  it("setGoalStatus and removeGoal target one goal by id", () => {
    const goals = [
      { id: "g1", text: "a", status: "active", createdAt: "2026-05-01" },
      { id: "g2", text: "b", status: "active", createdAt: "2026-05-01" },
    ];
    const { result, apply, updateTeamArrays, teamData } = setup({
      players: [{ id: "p1", name: "Ava", devPlan: { goals } }],
    });
    act(() => result.current.setGoalStatus("p1", "g1", "achieved"));
    expect(apply().players[0].devPlan.goals[0].status).toBe("achieved");

    updateTeamArrays.mockClear();
    act(() => result.current.removeGoal("p1", "g2"));
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.players[0].devPlan.goals.map((g: any) => g.id)).toEqual(["g1"]);
  });

  it("addCheckIn clamps the note and enforces the newest-kept cap", () => {
    const existing = Array.from({ length: DEV_CHECKINS_CAP }, (_, i) => ({
      id: `c${i}`,
      date: `2026-04-${String((i % 28) + 1).padStart(2, "0")}`,
      note: "n",
    }));
    const { result, apply } = setup({
      players: [{ id: "p1", name: "Ava", devPlan: { checkIns: existing } }],
    });
    act(() => result.current.addCheckIn("p1", "y".repeat(600), "2026-06-01"));
    const list = apply().players[0].devPlan.checkIns;
    expect(list).toHaveLength(DEV_CHECKINS_CAP);
    expect(list[0].date).toBe("2026-06-01"); // newest kept, newest first
    expect(list[0].note).toHaveLength(500);
  });

  it("toggleAssignedDrill adds then removes a drill id", () => {
    const { result, apply, updateTeamArrays, teamData } = setup();
    act(() => result.current.toggleAssignedDrill("p1", "d1"));
    expect(apply().players[0].devPlan.drillIds).toEqual(["d1"]);

    updateTeamArrays.mockClear();
    const withDrill = setup({
      players: [{ id: "p1", name: "Ava", devPlan: { drillIds: ["d1"] } }],
    });
    act(() => withDrill.result.current.toggleAssignedDrill("p1", "d1"));
    expect(withDrill.apply().players[0].devPlan.drillIds).toEqual([]);
    void teamData;
  });

  it("updateDevPlan merges a patch and caps focus areas", () => {
    const { result, apply } = setup({
      players: [{ id: "p1", name: "Ava", devPlan: { drillIds: ["d1"] } }],
    });
    act(() =>
      result.current.updateDevPlan("p1", {
        focusAreas: ["contact", "glove", "speed", "approach"] as any,
      }),
    );
    const plan = apply().players[0].devPlan;
    expect(plan.focusAreas).toEqual(["contact", "glove", "speed"]);
    expect(plan.drillIds).toEqual(["d1"]); // untouched by the patch
  });
});
