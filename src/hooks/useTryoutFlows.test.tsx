import { renderHook, act } from "@testing-library/react";
import { useTryoutFlows } from "./useTryoutFlows";
import { applyTeamOps, makeToast } from "../test-utils";

const setup = (teamOver: any = {}, user: any = { uid: "u1" }) => {
  const updateTeam = jest.fn();
  const updateTeamArrays = jest.fn();
  const toast = makeToast();
  const teamData = {
    tryoutSignups: [],
    interestSignups: [],
    evaluationEvents: [],
    players: [],
    tryoutDates: [],
    ...teamOver,
  };
  const { result } = renderHook(() =>
    useTryoutFlows({
      teamData,
      updateTeam,
      updateTeamArrays,
      toast,
      user,
      activeTeamId: "team-1",
    }),
  );
  return { result, teamData, updateTeam, updateTeamArrays, toast };
};

describe("useTryoutFlows", () => {
  it("generateTryoutShareId opens tryouts and returns an id", () => {
    const { result, updateTeam } = setup();
    let id = "";
    act(() => {
      id = result.current.generateTryoutShareId();
    });
    expect(id).toBeTruthy();
    expect(updateTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        tryoutShareId: id,
        tryoutsOpen: true,
        tryoutsPhase: "open",
      }),
    );
  });

  it("generateTryoutDateLink pins each generated slug to its own date", () => {
    // First date.
    const { result, updateTeam } = setup({
      tryoutDates: [],
      tryoutDateLinks: [],
    });
    let slugA = "";
    act(() => {
      slugA = result.current.generateTryoutDateLink("2026-04-10")!;
    });
    const patchA = updateTeam.mock.calls[0][0];
    expect(slugA).toContain("2026-04-10");
    expect(patchA.tryoutDateSlug).toBe(slugA);
    expect(patchA.tryoutDates).toEqual(["2026-04-10"]);
    expect(patchA.tryoutDateLinks).toEqual([
      { slug: slugA, date: "2026-04-10" },
    ]);

    // Second date on a team that already carries the first link — the mapping
    // must ACCUMULATE so the first slug keeps resolving to its original date.
    const { result: r2, updateTeam: u2 } = setup({
      tryoutDates: ["2026-04-10"],
      tryoutDateLinks: [{ slug: slugA, date: "2026-04-10" }],
    });
    let slugB = "";
    act(() => {
      slugB = r2.current.generateTryoutDateLink("2026-05-22")!;
    });
    const patchB = u2.mock.calls[0][0];
    expect(slugB).not.toBe(slugA);
    expect(patchB.tryoutDates).toEqual(["2026-04-10", "2026-05-22"]);
    expect(patchB.tryoutDateLinks).toEqual([
      { slug: slugA, date: "2026-04-10" },
      { slug: slugB, date: "2026-05-22" },
    ]);
  });

  it("setTryoutsOpen / completeTryouts toggle phase", () => {
    const { result, updateTeam } = setup();
    act(() => result.current.setTryoutsOpen(false));
    expect(updateTeam).toHaveBeenCalledWith({
      tryoutsOpen: false,
      tryoutsPhase: "intake_closed",
    });
    act(() => result.current.completeTryouts());
    expect(updateTeam).toHaveBeenLastCalledWith({
      tryoutsOpen: false,
      tryoutsPhase: "completed",
    });
  });

  it("appendTryoutSignup emits an append (concurrency-safe with the portal lane)", () => {
    const { result, updateTeamArrays } = setup();
    let entry: any;
    act(() => {
      entry = result.current.appendTryoutSignup({ firstName: "Ava" });
    });
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "tryoutSignups" });
    expect(op.entries[0]).toMatchObject({
      id: entry.id,
      firstName: "Ava",
      status: "tryout",
    });
  });

  it("updateTryoutSignup patches the matching signup via mapEntries", () => {
    const { result, teamData, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "s1", status: "tryout" }],
    });
    act(() => result.current.updateTryoutSignup("s1", { status: "reviewed" }));
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "tryoutSignups" });
    expect(applyTeamOps(teamData, op).tryoutSignups[0]).toMatchObject({
      id: "s1",
      status: "reviewed",
    });
  });

  it("acceptTryout (default) holds the signup for next season without adding a player", () => {
    const { result, teamData, updateTeamArrays, toast } = setup({
      tryoutSignups: [
        { id: "s1", firstName: "Ava", lastName: "Rivera", isCatcher: true },
      ],
    });
    act(() => result.current.acceptTryout("s1"));
    const op = updateTeamArrays.mock.calls[0][0];
    // Single tryoutSignups op — no current-season player is created; they
    // join on Advance Season.
    expect(op).toMatchObject({ op: "mapEntries", key: "tryoutSignups" });
    expect(applyTeamOps(teamData, op).tryoutSignups[0].status).toBe("accepted");
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" }),
    );
  });

  it("acceptTryout('current') emits ONE atomic op list: consume signup + append player", () => {
    const { result, teamData, updateTeamArrays } = setup({
      tryoutSignups: [
        { id: "s1", firstName: "Ava", lastName: "Rivera", isCatcher: true },
      ],
      players: [],
    });
    act(() => result.current.acceptTryout("s1", "current"));
    expect(updateTeamArrays).toHaveBeenCalledTimes(1);
    const ops = updateTeamArrays.mock.calls[0][0];
    expect(ops.map((u: any) => [u.op, u.key])).toEqual([
      ["removeById", "tryoutSignups"],
      ["append", "players"],
    ]);
    const next = applyTeamOps(teamData, ops);
    expect(next.tryoutSignups).toEqual([]);
    expect(next.players[0]).toMatchObject({
      name: "Ava Rivera",
      playerStatus: "returning",
    });
    expect(next.players[0].comfortablePositions).toContain("C");
  });

  it("saveTryoutEvaluation records a date-grouped tryout session", () => {
    const { result, teamData, updateTeamArrays } = setup({
      tryoutSignups: [
        { id: "s1", tryoutDate: "2026-06-18" },
        { id: "s2", tryoutDate: "2026-06-18" },
      ],
    });
    act(() =>
      result.current.saveTryoutEvaluation("s1", { fielding: 4 }, "Head"),
    );
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "tryoutSessions" });
    const session = applyTeamOps(teamData, op).tryoutSessions[0];
    expect(session).toMatchObject({
      id: "tryout-2026-06-18",
      date: "2026-06-18",
    });
    expect(session.gradesByEvaluator.u1).toMatchObject({
      evaluatorId: "u1",
      coachRole: "Head",
    });
    expect(session.gradesByEvaluator.u1.grades.s1).toEqual({ fielding: 4 });
  });

  it("saveTryoutEvaluation upserts against the LATEST sessions — a concurrent evaluator's session survives", () => {
    // The map re-runs against fresh state: another coach's session (created
    // after this screen rendered) must ride through the rewrite.
    const { result, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "s1", tryoutDate: "2026-06-18" }],
      tryoutSessions: [],
    });
    act(() =>
      result.current.saveTryoutEvaluation("s1", { fielding: 4 }, "Head"),
    );
    const op = updateTeamArrays.mock.calls[0][0];
    const concurrent = {
      id: "tryout-2026-06-25",
      date: "2026-06-25",
      label: "Tryout · 2026-06-25",
      signupIds: ["s9"],
      gradesByEvaluator: {},
    };
    const next = applyTeamOps({ tryoutSessions: [concurrent] }, op);
    expect(next.tryoutSessions.map((s: any) => s.id).sort()).toEqual([
      "tryout-2026-06-18",
      "tryout-2026-06-25",
    ]);
  });

  it("saveTryoutEvaluations saves multiple kids into one date session in one write", () => {
    const { result, teamData, updateTeamArrays } = setup({
      tryoutSignups: [
        { id: "s1", tryoutDate: "2026-06-18" },
        { id: "s2", tryoutDate: "2026-06-18" },
      ],
    });
    act(() =>
      result.current.saveTryoutEvaluations(
        [
          { signupId: "s1", date: "2026-06-18", grades: { fielding: 4 } },
          { signupId: "s2", date: "2026-06-18", grades: { fielding: 5 } },
        ],
        "Head",
      ),
    );
    expect(updateTeamArrays).toHaveBeenCalledTimes(1);
    const session = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0])
      .tryoutSessions[0];
    expect(session.signupIds).toEqual(["s1", "s2"]);
    expect(session.gradesByEvaluator.u1.grades).toMatchObject({
      s1: { fielding: 4 },
      s2: { fielding: 5 },
    });
  });

  it("convertInterestToTryout emits ONE atomic op list: append signup + remove lead", () => {
    const { result, teamData, updateTeamArrays } = setup({
      interestSignups: [{ id: "i1", firstName: "Mia", lastName: "Stone" }],
    });
    act(() => result.current.convertInterestToTryout("i1"));
    expect(updateTeamArrays).toHaveBeenCalledTimes(1);
    const ops = updateTeamArrays.mock.calls[0][0];
    expect(ops.map((u: any) => [u.op, u.key])).toEqual([
      ["append", "tryoutSignups"],
      ["removeById", "interestSignups"],
    ]);
    const next = applyTeamOps(teamData, ops);
    expect(next.interestSignups).toEqual([]);
    expect(next.tryoutSignups[0]).toMatchObject({
      firstName: "Mia",
      lastName: "Stone",
    });
  });

  it("deleteTryoutSignup emits removeById", () => {
    const { result, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    act(() => result.current.deleteTryoutSignup("b"));
    expect(updateTeamArrays).toHaveBeenCalledWith({
      op: "removeById",
      key: "tryoutSignups",
      id: "b",
    });
  });

  it("a parent signup that landed AFTER the coach's snapshot survives a coach delete", () => {
    // THE race this migration exists to close: tryouts are open, a parent's
    // portal submission (arrayUnion, not in the coach's rendered list) lands,
    // then the coach deletes a different signup. The old whole-array write
    // rebuilt tryoutSignups from the stale snapshot and silently erased the
    // parent's kid. removeById only touches the targeted entry.
    const { result, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "a" }, { id: "b" }], // what the coach sees
    });
    act(() => result.current.deleteTryoutSignup("b"));
    const op = updateTeamArrays.mock.calls[0][0];
    // Actual server state includes the parent's fresh signup the coach
    // never saw.
    const serverState = {
      tryoutSignups: [
        { id: "a" },
        { id: "b" },
        { id: "parent-new", firstName: "Sam" },
      ],
    };
    const next = applyTeamOps(serverState, op);
    expect(next.tryoutSignups.map((s: any) => s.id)).toEqual([
      "a",
      "parent-new",
    ]);
  });

  it("deleteTryoutSignups removes ALL given ids in a single write", () => {
    // Regression guard: looping deleteTryoutSignup over no-shows only removed
    // the last one (each call filtered the same stale array, and the optimistic
    // merge kept the last write). The bulk helper must drop every id at once.
    const { result, teamData, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    });
    let removed = 0;
    act(() => {
      removed = result.current.deleteTryoutSignups(["b", "d"]);
    });
    expect(removed).toBe(2);
    expect(updateTeamArrays).toHaveBeenCalledTimes(1);
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "tryoutSignups" });
    expect(applyTeamOps(teamData, op).tryoutSignups).toEqual([
      { id: "a" },
      { id: "c" },
    ]);
  });

  it("deleteTryoutSignups is a no-op (no write) when nothing matches", () => {
    const { result, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "a" }],
    });
    let removed = -1;
    act(() => {
      removed = result.current.deleteTryoutSignups(["zzz"]);
    });
    expect(removed).toBe(0);
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("applyAvailabilityToPlayer unions against the LATEST roster record", () => {
    const { result, updateTeamArrays } = setup({
      players: [{ id: "p1", name: "Ava", absences: ["2026-07-01"] }],
      availabilitySubmissions: [
        { id: "sub1", firstName: "Ava", dates: ["2026-07-04"] },
      ],
    });
    act(() => result.current.applyAvailabilityToPlayer("sub1", "p1"));
    expect(updateTeamArrays).toHaveBeenCalledTimes(1);
    const ops = updateTeamArrays.mock.calls[0][0];
    expect(ops.map((u: any) => [u.op, u.key])).toEqual([
      ["mapEntries", "players"],
      ["mapEntries", "availabilitySubmissions"],
    ]);
    // Another coach added an absence AFTER this screen rendered — the union
    // runs over the latest record, so both survive alongside the submission.
    const serverState = {
      players: [
        { id: "p1", name: "Ava", absences: ["2026-07-01", "2026-07-02"] },
      ],
      availabilitySubmissions: [
        { id: "sub1", firstName: "Ava", dates: ["2026-07-04"] },
      ],
    };
    const next = applyTeamOps(serverState, ops);
    expect(next.players[0].absences).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-04",
    ]);
    expect(next.availabilitySubmissions[0]).toMatchObject({
      appliedToPlayerId: "p1",
    });
  });

  it("autoApplyAvailability applies confident matches in one atomic write", () => {
    const { result, teamData, updateTeamArrays } = setup({
      players: [
        { id: "p1", name: "Ava Rivera", dob: "2017-04-01" },
        { id: "p2", name: "Mia Stone" },
      ],
      availabilitySubmissions: [
        {
          id: "sub1",
          firstName: "Ava",
          lastName: "Rivera",
          dob: "2017-04-01",
          dates: ["2026-07-10"],
        },
        // No DOB + no unique name match → left for manual handling.
        { id: "sub2", firstName: "Zoe", lastName: "Nguyen", dates: [] },
      ],
    });
    let applied = 0;
    act(() => {
      applied = result.current.autoApplyAvailability();
    });
    expect(applied).toBe(1);
    expect(updateTeamArrays).toHaveBeenCalledTimes(1);
    const next = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    expect(next.players[0].absences).toEqual(["2026-07-10"]);
    expect(next.availabilitySubmissions[0]).toMatchObject({
      appliedToPlayerId: "p1",
    });
    expect(next.availabilitySubmissions[1].appliedToPlayerId).toBeUndefined();
  });

  it("applyPlayerInfoToPlayer fills gaps against the LATEST roster record", () => {
    const { result, updateTeamArrays } = setup({
      players: [{ id: "p1", name: "Ava" }], // no dob in the snapshot
      playerInfoSubmissions: [
        {
          id: "sub1",
          firstName: "Ava",
          dob: "2017-04-01",
          shirtSize: "YM",
          submittedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    act(() => result.current.applyPlayerInfoToPlayer("sub1", "p1"));
    const ops = updateTeamArrays.mock.calls[0][0];
    expect(ops.map((u: any) => [u.op, u.key])).toEqual([
      ["mapEntries", "players"],
      ["mapEntries", "playerInfoSubmissions"],
    ]);
    // The coach set a DOB after the screen rendered — the gap-fill check runs
    // against the latest record, so the curated DOB wins over the submission.
    const serverState = {
      players: [{ id: "p1", name: "Ava", dob: "2017-04-02" }],
      playerInfoSubmissions: [
        { id: "sub1", firstName: "Ava", dob: "2017-04-01", shirtSize: "YM" },
      ],
    };
    const next = applyTeamOps(serverState, ops);
    expect(next.players[0].dob).toBe("2017-04-02"); // not clobbered
    expect(next.players[0].shirtSize).toBe("YM"); // always-set field applied
    expect(next.playerInfoSubmissions[0]).toMatchObject({
      appliedToPlayerId: "p1",
    });
  });
});
