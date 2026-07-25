import { vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { writeBatch } from "firebase/firestore";
import { useTryoutFlows } from "./useTryoutFlows";
import { applyTeamOps, makeToast } from "../test-utils";
import {
  deleteSignupDoc,
  newSignupId,
  removeLegacySignupEntries,
  upsertSignupDoc,
} from "../utils/tryoutSignupDocs";

// The per-doc signup writes are this hook's collaborators, not its subject —
// mock the whole module and assert on the calls. signupDocRef encodes its
// arguments into a path string so batch assertions can tell WHICH doc a
// set/delete targeted.
vi.mock("../utils/tryoutSignupDocs", () => ({
  newSignupId: vi.fn(() => "auto-id"),
  signupDocRef: vi.fn(
    (_db: unknown, appId: string, teamId: string, key: string, id: string) => ({
      path: `artifacts/${appId}/public/data/teams/${teamId}/${key}/${id}`,
    }),
  ),
  upsertSignupDoc: vi.fn(() => Promise.resolve()),
  deleteSignupDoc: vi.fn(() => Promise.resolve()),
  // Pure, and reimplemented here because the module is fully mocked — the
  // legacy-cleanup tests below assert the hook hands the arrayRemove write the
  // EXACT object off the raw team-doc array, so this lookup has to preserve
  // identity the way the real one does (its own tests live in
  // utils/tryoutSignupDocs.test.ts).
  findLegacySignupEntries: vi.fn(
    (raw: { id?: string }[] | null, ids: Iterable<string>) => {
      const wanted = new Set(ids);
      return (raw || []).filter((e) => e && e.id && wanted.has(e.id));
    },
  ),
  removeLegacySignupEntries: vi.fn(() => Promise.resolve()),
}));
// Only writeBatch is imported from the SDK here; each call mints a fresh
// batch recorder so a test can inspect the set/delete/commit sequence.
vi.mock("firebase/firestore", () => ({
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  })),
}));

const mockUpsert = upsertSignupDoc as unknown as ReturnType<typeof vi.fn>;
const mockDeleteSignup = deleteSignupDoc as unknown as ReturnType<typeof vi.fn>;
const mockNewSignupId = newSignupId as unknown as ReturnType<typeof vi.fn>;
const mockRemoveLegacy = removeLegacySignupEntries as unknown as ReturnType<
  typeof vi.fn
>;
const mockWriteBatch = writeBatch as unknown as ReturnType<typeof vi.fn>;
// The raw legacy entries handed to the arrayRemove write for `key`, or null
// when the hook decided there was no legacy twin to clear.
const legacyRemoved = (key: string) => {
  const call = mockRemoveLegacy.mock.calls.find((c) => c[3] === key);
  return call ? (call[4] as { id?: string }[]) : null;
};
const lastBatch = () =>
  mockWriteBatch.mock.results[mockWriteBatch.mock.results.length - 1]?.value;

const db = { __db: true };

const setup = (
  teamOver: any = {},
  user: any = { uid: "u1" },
  // Raw LEGACY team-doc arrays (default: fully migrated, arrays empty) —
  // distinct from teamData.<key>, which is the assembled union.
  raw: { tryout?: any[]; interest?: any[] } = {},
) => {
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
  const rawTryoutSignupsRef = { current: raw.tryout ?? [] };
  const rawInterestSignupsRef = { current: raw.interest ?? [] };
  const { result } = renderHook(() =>
    useTryoutFlows({
      teamDataRef: { current: teamData },
      rawTryoutSignupsRef,
      rawInterestSignupsRef,
      updateTeam,
      updateTeamArrays,
      toast,
      user,
      activeTeamId: "team-1",
      db: db as never,
      appId: "test-app",
      teamId: "team-1",
    }),
  );
  return { result, teamData, updateTeam, updateTeamArrays, toast };
};

beforeEach(() => {
  jest.clearAllMocks();
});

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

  it("appendTryoutSignup writes a full subcollection doc under a Firestore auto-id", () => {
    const { result, updateTeamArrays } = setup();
    let entry: any;
    act(() => {
      entry = result.current.appendTryoutSignup({ firstName: "Ava" });
    });
    // The id comes from the collision-SAFE auto-id mint, not genId.
    expect(mockNewSignupId).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
    );
    expect(entry).toMatchObject({
      id: "auto-id",
      firstName: "Ava",
      status: "tryout",
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
      entry,
    );
    expect(typeof mockUpsert.mock.calls[0][4].submittedAt).toBe("string");
    // No legacy array append anymore — the doc IS the signup.
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("appendTryoutSignup keeps a caller-provided id (restore/import path)", () => {
    const { result } = setup();
    act(() => {
      result.current.appendTryoutSignup({ id: "keep-me", firstName: "Ava" });
    });
    expect(mockNewSignupId).not.toHaveBeenCalled();
    expect(mockUpsert.mock.calls[0][4].id).toBe("keep-me");
  });

  it("updateTryoutSignup upserts the FULL patched entry from the union", () => {
    const { result } = setup({
      tryoutSignups: [{ id: "s1", firstName: "Ava", status: "tryout" }],
    });
    act(() => result.current.updateTryoutSignup("s1", { status: "offered" }));
    // Full entry, not a partial patch: setDoc replaces the whole doc.
    expect(mockUpsert).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
      { id: "s1", firstName: "Ava", status: "offered" },
    );
  });

  it("updateTryoutSignup is a silent no-op for an unknown id", () => {
    const { result, toast } = setup({ tryoutSignups: [{ id: "s1" }] });
    act(() => result.current.updateTryoutSignup("ghost", { status: "x" }));
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(toast.push).not.toHaveBeenCalled();
  });

  it("saveTryoutMeasurements merges the station patch into the signup's SHARED record", () => {
    const { result } = setup({
      tryoutSignups: [
        { id: "s1", firstName: "Ava", measurements: { exitVeloMph: 50 } },
        { id: "s2" },
      ],
    });
    act(() =>
      result.current.saveTryoutMeasurements("s1", {
        runToFirstSec: 4.2,
      }),
    );
    // Existing stations survive; the new one merges in; only s1's doc is
    // written (other signups untouched by construction — per-doc writes).
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
      {
        id: "s1",
        firstName: "Ava",
        measurements: { exitVeloMph: 50, runToFirstSec: 4.2 },
      },
    );
  });

  it("assignTryoutNumbers batches full-entry sets for ONLY the signups whose number changed", () => {
    const { result } = setup({
      tryoutSignups: [
        {
          id: "s1",
          firstName: "Ava",
          tryoutDate: "2026-08-01",
          tryoutNumber: "1",
          submittedAt: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "s2",
          firstName: "Mia",
          tryoutDate: "2026-08-01",
          submittedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          id: "s3",
          firstName: "Zoe",
          tryoutDate: "2026-08-02",
          submittedAt: "2026-07-03T00:00:00.000Z",
        },
      ],
    });
    act(() => result.current.assignTryoutNumbers());
    const batch = lastBatch();
    // s1 already numbered → untouched. s2 takes the next free number in its
    // date pool; s3 starts its own pool at 1. Full entries, one batch.
    expect(batch.set.mock.calls).toHaveLength(2);
    const written = batch.set.mock.calls.map(
      ([ref, data]: [{ path: string }, any]) => [
        ref.path.split("/").slice(-2).join("/"),
        data.tryoutNumber,
        data.firstName,
      ],
    );
    expect(written).toEqual([
      ["tryoutSignups/s2", "2", "Mia"],
      ["tryoutSignups/s3", "1", "Zoe"],
    ]);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it("assignTryoutNumbers is a no-op (no batch) when every signup is numbered", () => {
    const { result } = setup({
      tryoutSignups: [
        { id: "s1", tryoutDate: "2026-08-01", tryoutNumber: "1" },
      ],
    });
    act(() => result.current.assignTryoutNumbers());
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it("acceptTryout (default) stamps status:'accepted' on the signup's own doc", () => {
    const { result, updateTeamArrays, toast } = setup({
      tryoutSignups: [
        { id: "s1", firstName: "Ava", lastName: "Rivera", isCatcher: true },
      ],
    });
    act(() => result.current.acceptTryout("s1"));
    // No current-season player is created; they join on Advance Season.
    expect(updateTeamArrays).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
      expect.objectContaining({ id: "s1", status: "accepted" }),
    );
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" }),
    );
  });

  it("acceptTryout('current') appends the player, deletes the signup doc, and arrayRemoves the exact legacy copy", () => {
    // The stored legacy element predates the coach's curation (the union shows
    // status 'offered'); resolving the remove against the union would match
    // nothing and leave the kid on the roster AND still in Tryouts.
    const storedLegacy = { id: "s1", firstName: "Ava", status: "tryout" };
    const { result, teamData, updateTeamArrays } = setup(
      {
        tryoutSignups: [
          {
            id: "s1",
            firstName: "Ava",
            lastName: "Rivera",
            isCatcher: true,
            status: "offered",
          },
        ],
        players: [],
      },
      undefined,
      { tryout: [storedLegacy] },
    );
    act(() => result.current.acceptTryout("s1", "current"));
    // Only the players append rides the team-doc array lane now.
    expect(updateTeamArrays).toHaveBeenCalledTimes(1);
    const op = updateTeamArrays.mock.calls[0][0];
    expect([op.op, op.key]).toEqual(["append", "players"]);
    const next = applyTeamOps(teamData, op);
    expect(next.players[0]).toMatchObject({
      name: "Ava Rivera",
      playerStatus: "returning",
    });
    expect(next.players[0].comfortablePositions).toContain("C");
    expect(mockDeleteSignup).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
      "s1",
    );
    expect(legacyRemoved("tryoutSignups")![0]).toBe(storedLegacy);
  });

  it("acceptTryout('current') issues no legacy remove for a subcollection-only signup", () => {
    const { result, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "s1", firstName: "Ava", lastName: "Rivera" }],
      players: [],
    });
    act(() => result.current.acceptTryout("s1", "current"));
    const op = updateTeamArrays.mock.calls[0][0];
    expect([op.op, op.key]).toEqual(["append", "players"]);
    expect(mockDeleteSignup).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
      "s1",
    );
    expect(legacyRemoved("tryoutSignups")).toEqual([]);
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
      // Denormalized display name for the shared coach-evals panel; a bare
      // uid-only auth user falls back to "Coach".
      evaluatorName: "Coach",
    });
    expect(session.gradesByEvaluator.u1.grades.s1).toEqual({ fielding: 4 });
  });

  it("saveTryoutEvaluation stamps the coach's display last name for the staff panel", () => {
    const { result, teamData, updateTeamArrays } = setup(
      { tryoutSignups: [{ id: "s1", tryoutDate: "2026-06-18" }] },
      { uid: "u1", displayName: "Mike Rash" },
    );
    act(() =>
      result.current.saveTryoutEvaluation("s1", { approach: 4 }, "Head"),
    );
    const session = applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0])
      .tryoutSessions[0];
    expect(session.gradesByEvaluator.u1.evaluatorName).toBe("Rash");
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

  it("convertInterestToTryout batches the new tryout doc + lead delete atomically", () => {
    const { result, updateTeamArrays, toast } = setup({
      interestSignups: [
        {
          id: "i1",
          firstName: "Mia",
          lastName: "Stone",
          canCatch: true,
          comfortablePositions: ["C", "SS"],
        },
      ],
    });
    act(() => result.current.convertInterestToTryout("i1"));
    const batch = lastBatch();
    expect(batch.set).toHaveBeenCalledTimes(1);
    const [setRef, setData] = batch.set.mock.calls[0];
    expect(setRef.path).toContain("/tryoutSignups/auto-id");
    expect(setData).toMatchObject({
      id: "auto-id",
      firstName: "Mia",
      lastName: "Stone",
      status: "tryout",
      canCatch: true,
      isCatcher: true, // canCatch normalization carried over
    });
    // 'C' de-duped out of the copied list, re-appended for the catcher flag.
    expect(setData.comfortablePositions).toEqual(["SS", "C"]);
    expect(batch.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/interestSignups/i1"),
      }),
    );
    expect(batch.commit).toHaveBeenCalledTimes(1);
    // The lead lives only in the subcollection — no legacy write needed.
    expect(updateTeamArrays).not.toHaveBeenCalled();
    expect(legacyRemoved("interestSignups")).toEqual([]);
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", title: "Moved to tryouts" }),
    );
  });

  it("convertInterestToTryout arrayRemoves the exact legacy-resident lead", () => {
    // A consumed lead that survives in the array comes back un-converted next
    // to the tryout signup this just created.
    const storedLead = { id: "i1", firstName: "Mia" };
    const { result, updateTeamArrays } = setup(
      { interestSignups: [{ id: "i1", firstName: "Mia", lastName: "Stone" }] },
      undefined,
      { interest: [storedLead] },
    );
    act(() => result.current.convertInterestToTryout("i1"));
    expect(mockRemoveLegacy).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "interestSignups",
      [storedLead],
    );
    expect(legacyRemoved("interestSignups")![0]).toBe(storedLead);
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("deleteTryoutSignup deletes the subdoc AND arrayRemoves the EXACT stored legacy entry", () => {
    // The resurrect hazard: the union re-admits any legacy entry whose id has
    // no subcollection doc, so deleting only the subdoc would bring the
    // signup back on the next assembly.
    //
    // The stored legacy element here is PRE-EDIT (a portal submission) while
    // the union shows the coach's edited subdoc — the exact divergence that
    // made the old updateTeamArrays({op:'removeById'}) path match nothing and
    // resurrect the family with stale data. The cleanup must resolve against
    // the RAW array.
    const storedLegacy = { id: "b", firstName: "Ava", status: "tryout" };
    const { result, updateTeamArrays } = setup(
      { tryoutSignups: [{ id: "b", firstName: "Ava", status: "accepted" }] },
      undefined,
      { tryout: [storedLegacy] },
    );
    act(() => result.current.deleteTryoutSignup("b"));
    expect(mockDeleteSignup).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
      "b",
    );
    expect(mockRemoveLegacy).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "tryoutSignups",
      [storedLegacy],
    );
    // Identity, not just shape: only the stored object can match arrayRemove.
    expect(legacyRemoved("tryoutSignups")![0]).toBe(storedLegacy);
    // The union-resolving array lane is never used for these keys anymore.
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("deleteTryoutSignup issues no legacy write for a subcollection-only signup", () => {
    const { result, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "b" }],
    });
    act(() => result.current.deleteTryoutSignup("b"));
    expect(mockDeleteSignup).toHaveBeenCalledTimes(1);
    expect(legacyRemoved("tryoutSignups")).toEqual([]);
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("deleteTryoutSignups batch-deletes every id and clears legacy residents in ONE arrayRemove", () => {
    const legacyB = { id: "b" };
    const { result, updateTeamArrays } = setup(
      {
        tryoutSignups: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      },
      undefined,
      // Only b is still legacy-resident; d is subcollection-only.
      { tryout: [{ id: "a" }, legacyB] },
    );
    let removed = 0;
    act(() => {
      removed = result.current.deleteTryoutSignups(["b", "d"]);
    });
    expect(removed).toBe(2);
    const batch = lastBatch();
    expect(
      batch.delete.mock.calls.map(([ref]: [{ path: string }]) =>
        ref.path.split("/").pop(),
      ),
    ).toEqual(["b", "d"]);
    expect(batch.commit).toHaveBeenCalledTimes(1);
    // ONE variadic arrayRemove of the exact stored elements, carrying only the
    // TARGETED legacy residents: `a` stays in the array, `d` was never there.
    expect(mockRemoveLegacy).toHaveBeenCalledTimes(1);
    expect(legacyRemoved("tryoutSignups")).toEqual([legacyB]);
    expect(legacyRemoved("tryoutSignups")![0]).toBe(legacyB);
  });

  it("deleteTryoutSignups never writes the assembled union back into the team doc", () => {
    // The re-inflation bug: a mapEntries filter writes the WHOLE resolved
    // array, and for this key the resolved array is the union — so it pushed
    // subcollection-only signups INTO the legacy team-doc array, growing the
    // doc this migration shrinks and resurrecting them as legacy entries.
    const { result, updateTeamArrays } = setup(
      {
        // c and d exist ONLY as subdocs; b is the lone legacy resident.
        tryoutSignups: [{ id: "b" }, { id: "c" }, { id: "d" }],
      },
      undefined,
      { tryout: [{ id: "b" }] },
    );
    act(() => {
      result.current.deleteTryoutSignups(["b"]);
    });
    expect(updateTeamArrays).not.toHaveBeenCalled();
    const payload = legacyRemoved("tryoutSignups")!;
    expect(payload.map((s) => s.id)).toEqual(["b"]);
    expect(payload.some((s) => s.id === "c" || s.id === "d")).toBe(false);
  });

  it("deleteTryoutSignups issues no legacy write when no target is legacy-resident", () => {
    const { result, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "a" }, { id: "b" }],
    });
    let removed = 0;
    act(() => {
      removed = result.current.deleteTryoutSignups(["b"]);
    });
    expect(removed).toBe(1);
    expect(lastBatch().commit).toHaveBeenCalledTimes(1);
    expect(legacyRemoved("tryoutSignups")).toEqual([]);
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("deleteTryoutSignups is a no-op (no writes) when nothing matches", () => {
    const { result, updateTeamArrays } = setup({
      tryoutSignups: [{ id: "a" }],
    });
    let removed = -1;
    act(() => {
      removed = result.current.deleteTryoutSignups(["zzz"]);
    });
    expect(removed).toBe(0);
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockRemoveLegacy).not.toHaveBeenCalled();
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("deleteInterestSignup deletes the subdoc, plus the exact legacy copy only when one exists", () => {
    const storedLead = { id: "i1", firstName: "Mia" };
    const { result, updateTeamArrays } = setup(
      { interestSignups: [{ id: "i1", firstName: "Mia", notes: "edited" }] },
      undefined,
      { interest: [storedLead] },
    );
    act(() => result.current.deleteInterestSignup("i1"));
    expect(mockDeleteSignup).toHaveBeenCalledWith(
      db,
      "test-app",
      "team-1",
      "interestSignups",
      "i1",
    );
    expect(legacyRemoved("interestSignups")![0]).toBe(storedLead);
    expect(updateTeamArrays).not.toHaveBeenCalled();

    // Subcollection-only lead: nothing to arrayRemove.
    mockRemoveLegacy.mockClear();
    const { result: r2, updateTeamArrays: u2 } = setup({
      interestSignups: [{ id: "i2" }],
    });
    act(() => r2.current.deleteInterestSignup("i2"));
    expect(legacyRemoved("interestSignups")).toEqual([]);
    expect(u2).not.toHaveBeenCalled();
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
