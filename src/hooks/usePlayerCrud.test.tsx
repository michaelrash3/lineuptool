import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";

// Stub the subcollection writer so the eval-grade-strip describe below runs
// without a real Firestore. The main describes pass no db/appId/teamId, so
// the per-doc strip is skipped there.
vi.mock("../utils/evalRounds", () => ({
  saveEvalRound: vi.fn(() => Promise.resolve()),
}));
import { saveEvalRound } from "../utils/evalRounds";
import { usePlayerCrud } from "./usePlayerCrud";
import { applyTeamOps, makeConfirm, makeToast } from "../test-utils";

const setup = (teamOver: any = {}, handles: any = {}) => {
  const updateTeamArrays = jest.fn();
  const toast = makeToast();
  const confirm = makeConfirm();
  const teamData = {
    players: [],
    games: [],
    evaluationEvents: [],
    ...teamOver,
  };
  const { result } = renderHook(() =>
    usePlayerCrud({
      teamDataRef: { current: teamData },
      updateTeamArrays,
      toast,
      confirm,
      ...handles,
    }),
  );
  return { result, teamData, updateTeamArrays, toast, confirm };
};

describe("usePlayerCrud", () => {
  it("addPlayer emits an append (concurrency-safe) with defaults and returns the id", () => {
    const { result, updateTeamArrays } = setup();
    let id = "";
    act(() => {
      id = result.current.addPlayer({ name: " Ava " });
    });
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "players" });
    expect(op.entries).toHaveLength(1);
    expect(op.entries[0]).toMatchObject({
      id,
      name: "Ava",
      bats: "R",
      throws: "R",
      present: true,
    });
    expect(op.entries[0].pitching).toEqual({
      recentPitches: 0,
      lastPitchDate: null,
    });
  });

  it("updatePlayer merges shallow updates via mapEntries", () => {
    const { result, teamData, updateTeamArrays } = setup({
      players: [{ id: "p1", name: "Ava", number: "1" }],
    });
    act(() => result.current.updatePlayer("p1", { number: "9" }));
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "players" });
    expect(applyTeamOps(teamData, op).players[0]).toMatchObject({
      id: "p1",
      name: "Ava",
      number: "9",
    });
  });

  it("updatePlayerNested merges into a nested key", () => {
    const { result, teamData, updateTeamArrays } = setup({
      players: [
        {
          id: "p1",
          name: "Ava",
          pitching: { recentPitches: 0, lastPitchDate: null },
        },
      ],
    });
    act(() =>
      result.current.updatePlayerNested("p1", "pitching", {
        recentPitches: 30,
      }),
    );
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.players[0].pitching).toEqual({
      recentPitches: 30,
      lastPitchDate: null,
    });
  });

  describe("removePlayer", () => {
    const team = {
      players: [
        { id: "p1", name: "Ava" },
        { id: "p2", name: "Mia" },
      ],
      games: [
        {
          id: "g1",
          lineup: [{ P: { id: "p1" }, BENCH: [{ id: "p2" }] }],
          battingLineup: [{ id: "p1" }, { id: "p2" }],
          attendance: { p1: true, p2: false },
          pitchCounts: { p1: 20 },
        },
      ],
      evaluationEvents: [
        { id: "e1", grades: { p1: { hit: 3 }, p2: { hit: 4 } } },
      ],
    };

    it("does nothing when the confirm is declined", async () => {
      const { result, updateTeamArrays, confirm } = setup(team);
      confirm.mockResolvedValueOnce(false);
      await act(async () => result.current.removePlayer("p1"));
      expect(updateTeamArrays).not.toHaveBeenCalled();
    });

    it("emits ONE atomic op list — removeById + games mapEntries, and NEVER an evaluationEvents array op", async () => {
      // Eval rounds live per-doc in the evalRounds subcollection; writing the
      // subcollection-derived rounds back to the shared doc would resurrect
      // scoped data onto it (and recreate the dropped legacy field, which the
      // rules reject).
      const { result, teamData, updateTeamArrays } = setup(team);
      await act(async () => result.current.removePlayer("p1"));
      expect(updateTeamArrays).toHaveBeenCalledTimes(1);
      const ops = updateTeamArrays.mock.calls[0][0];
      expect(ops.map((u: any) => [u.op, u.key])).toEqual([
        ["removeById", "players"],
        ["mapEntries", "games"],
      ]);
      const next = applyTeamOps(teamData, ops);
      expect(next.players.map((p: any) => p.id)).toEqual(["p2"]);
      expect(next.games[0].lineup[0].P).toBeNull();
      expect(next.games[0].battingLineup.map((p: any) => p.id)).toEqual(["p2"]);
      expect(next.games[0].attendance).toEqual({ p2: false });
      expect(next.games[0].pitchCounts).toEqual({});
    });

    it("Undo restores the roster and games snapshots", async () => {
      const { result, teamData, updateTeamArrays, toast } = setup(team);
      await act(async () => result.current.removePlayer("p1"));
      const undo = (toast.push as jest.Mock).mock.calls[0][0].action;
      expect(undo.label).toBe("Undo");
      const afterDelete = applyTeamOps(
        teamData,
        updateTeamArrays.mock.calls[0][0],
      );
      act(() => undo.onClick());
      const restored = applyTeamOps(
        afterDelete,
        updateTeamArrays.mock.calls[1][0],
      );
      expect(restored.players.map((p: any) => p.id)).toEqual(["p1", "p2"]);
      // Restored games pass through the same slimming as any stored write.
      expect(restored.games[0].lineup[0].P).toMatchObject({ id: "p1" });
    });

    it("strips the removed player from tournament pitch plans in the same write, and Undo restores them", async () => {
      const tournaments = [
        {
          id: "t1",
          name: "Bash",
          gameIds: ["g1", "g2"],
          pitchPlan: {
            g1: [
              { playerId: "p1", role: "start" },
              { playerId: "p2", role: "relief" },
            ],
            g2: [{ playerId: "p1", role: "start", plannedPitches: 40 }],
          },
        },
      ];
      const withTournaments = { ...team, tournaments };
      const { result, teamData, updateTeamArrays, toast } =
        setup(withTournaments);
      await act(async () => result.current.removePlayer("p1"));
      const ops = updateTeamArrays.mock.calls[0][0];
      expect(ops.map((u: any) => [u.op, u.key])).toEqual([
        ["removeById", "players"],
        ["mapEntries", "games"],
        ["mapEntries", "tournaments"],
      ]);
      const next = applyTeamOps(teamData, ops);
      // p1 gone from g1's plan; g2's plan (p1 only) drops its key entirely.
      expect(next.tournaments[0].pitchPlan).toEqual({
        g1: [{ playerId: "p2", role: "relief" }],
      });

      const undo = (toast.push as jest.Mock).mock.calls[0][0].action;
      act(() => undo.onClick());
      const restored = applyTeamOps(next, updateTeamArrays.mock.calls[1][0]);
      expect(restored.tournaments).toEqual(tournaments);
    });

    it("emits no tournaments op when the player is in no pitch plan", async () => {
      const withTournaments = {
        ...team,
        tournaments: [
          {
            id: "t1",
            name: "Bash",
            gameIds: ["g1"],
            pitchPlan: { g1: [{ playerId: "p2", role: "start" }] },
          },
        ],
      };
      const { result, updateTeamArrays } = setup(withTournaments);
      await act(async () => result.current.removePlayer("p1"));
      const ops = updateTeamArrays.mock.calls[0][0];
      expect(ops.map((u: any) => u.key)).toEqual(["players", "games"]);
    });

    describe("per-doc eval-grade strip (with Firestore handles)", () => {
      const handles = { db: {} as never, appId: "app1", teamId: "team1" };

      beforeEach(() => (saveEvalRound as any).mockClear());

      it("skips the strip entirely when the handles are absent", async () => {
        const { result } = setup(team);
        await act(async () => result.current.removePlayer("p1"));
        expect(saveEvalRound).not.toHaveBeenCalled();
      });

      it("strips the removed player's grades per-doc, only touching rounds that graded them", async () => {
        const twoRounds = {
          ...team,
          evaluationEvents: [
            { id: "e1", grades: { p1: { hit: 3 }, p2: { hit: 4 } } },
            { id: "e2", grades: { p2: { hit: 5 } } }, // never graded p1 → untouched
          ],
        };
        const { result } = setup(twoRounds, handles);
        await act(async () => result.current.removePlayer("p1"));
        expect(saveEvalRound).toHaveBeenCalledTimes(1);
        const [, appId, teamId, round] = (saveEvalRound as any).mock.calls[0];
        expect([appId, teamId]).toEqual(["app1", "team1"]);
        expect(round).toEqual({ id: "e1", grades: { p2: { hit: 4 } } });
      });

      it("Undo re-saves the pre-delete rounds per-doc", async () => {
        const { result, toast } = setup(team, handles);
        await act(async () => result.current.removePlayer("p1"));
        (saveEvalRound as any).mockClear();
        const undo = (toast.push as jest.Mock).mock.calls[0][0].action;
        act(() => undo.onClick());
        expect(saveEvalRound).toHaveBeenCalledTimes(1);
        const round = (saveEvalRound as any).mock.calls[0][3];
        expect(round.grades.p1).toEqual({ hit: 3 });
      });
    });
  });
});
