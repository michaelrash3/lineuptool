import { vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { useTryoutFlows } from "./useTryoutFlows";
import { makeToast } from "../test-utils";

// Signups now live in subcollections, so the hook imports firebase. Stub it so
// no real app initializes, and encode doc paths for source-routing assertions.
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

const setup = (teamOver: any = {}, user: any = { uid: "u1" }) => {
  const updateTeam = jest.fn();
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
    useTryoutFlows({ teamData, updateTeam, toast, user, activeTeamId: "team-1" })
  );
  return { result, updateTeam, toast };
};

beforeEach(() => {
  mockSetDoc.mockClear();
  mockUpdateDoc.mockClear();
  mockDeleteDoc.mockClear();
});

describe("useTryoutFlows", () => {
  it("generateTryoutShareId opens tryouts and returns an id", () => {
    const { result, updateTeam } = setup();
    let id = "";
    act(() => { id = result.current.generateTryoutShareId(); });
    expect(id).toBeTruthy();
    expect(updateTeam).toHaveBeenCalledWith(
      expect.objectContaining({ tryoutShareId: id, tryoutsOpen: true, tryoutsPhase: "open" })
    );
  });

  it("generateTryoutDateLink pins each generated slug to its own date", () => {
    // First date.
    const { result, updateTeam } = setup({ tryoutDates: [], tryoutDateLinks: [] });
    let slugA = "";
    act(() => { slugA = result.current.generateTryoutDateLink("2026-04-10")!; });
    const patchA = updateTeam.mock.calls[0][0];
    expect(slugA).toContain("2026-04-10");
    expect(patchA.tryoutDateSlug).toBe(slugA);
    expect(patchA.tryoutDates).toEqual(["2026-04-10"]);
    expect(patchA.tryoutDateLinks).toEqual([{ slug: slugA, date: "2026-04-10" }]);

    // Second date on a team that already carries the first link — the mapping
    // must ACCUMULATE so the first slug keeps resolving to its original date.
    const { result: r2, updateTeam: u2 } = setup({
      tryoutDates: ["2026-04-10"],
      tryoutDateLinks: [{ slug: slugA, date: "2026-04-10" }],
    });
    let slugB = "";
    act(() => { slugB = r2.current.generateTryoutDateLink("2026-05-22")!; });
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
    expect(updateTeam).toHaveBeenCalledWith({ tryoutsOpen: false, tryoutsPhase: "intake_closed" });
    act(() => result.current.completeTryouts());
    expect(updateTeam).toHaveBeenLastCalledWith({ tryoutsOpen: false, tryoutsPhase: "completed" });
  });

  it("updateTryoutSignup patches the matching signup", () => {
    const { result, updateTeam } = setup({ tryoutSignups: [{ id: "s1", status: "tryout" }] });
    act(() => result.current.updateTryoutSignup("s1", { status: "reviewed" }));
    expect(updateTeam.mock.calls[0][0].tryoutSignups[0]).toMatchObject({ id: "s1", status: "reviewed" });
  });

  it("acceptTryout adds an accepted player and flips signup status", () => {
    const { result, updateTeam, toast } = setup({
      tryoutSignups: [{ id: "s1", firstName: "Ava", lastName: "Rivera", isCatcher: true }],
    });
    act(() => result.current.acceptTryout("s1"));
    const patch = updateTeam.mock.calls[0][0];
    expect(patch.tryoutSignups[0].status).toBe("accepted");
    expect(patch.players[0]).toMatchObject({ name: "Ava Rivera", playerStatus: "accepted" });
    expect(patch.players[0].comfortablePositions).toContain("C");
    expect(toast.push).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
  });

  it("saveTryoutEvaluation writes a tryout eval round to the evaluationEvents subcollection", () => {
    const { result } = setup();
    act(() => result.current.saveTryoutEvaluation("s1", { fielding: 4 }, "Head"));
    const [ref, ev] = mockSetDoc.mock.calls[0];
    expect(ref.path).toContain("/evaluationEvents/");
    expect(ev).toMatchObject({ tryoutSignupId: "s1", evaluatorId: "u1", coachRole: "Head" });
    expect(ev.grades.signup).toEqual({ fielding: 4 });
  });

  it("convertInterestToTryout writes the new tryout signup to the subcollection and drops the legacy lead", () => {
    const { result, updateTeam } = setup({
      interestSignups: [{ id: "i1", firstName: "Mia", lastName: "Stone" }],
    });
    act(() => result.current.convertInterestToTryout("i1"));
    // New tryout signup created as a subcollection doc.
    const [ref, signup] = mockSetDoc.mock.calls[0];
    expect(ref.path).toContain("/tryoutSignups/");
    expect(signup).toMatchObject({ firstName: "Mia", lastName: "Stone", status: "tryout" });
    // Legacy interest lead removed via the array path.
    expect(updateTeam).toHaveBeenCalledWith({ interestSignups: [] });
  });

  it("deleteTryoutSignup removes a single signup", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    act(() => result.current.deleteTryoutSignup("b"));
    expect(updateTeam).toHaveBeenCalledWith({
      tryoutSignups: [{ id: "a" }, { id: "c" }],
    });
  });

  it("deleteTryoutSignups removes ALL given ids in a single write", () => {
    // Regression guard: looping deleteTryoutSignup over no-shows only removed
    // the last one (each call filtered the same stale array, and the optimistic
    // merge kept the last write). The bulk helper must drop every id at once.
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    });
    let removed = 0;
    act(() => {
      removed = result.current.deleteTryoutSignups(["b", "d"]);
    });
    expect(removed).toBe(2);
    expect(updateTeam).toHaveBeenCalledTimes(1);
    expect(updateTeam).toHaveBeenCalledWith({
      tryoutSignups: [{ id: "a" }, { id: "c" }],
    });
  });

  it("deleteTryoutSignups is a no-op (no write) when nothing matches", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "a" }],
    });
    let removed = -1;
    act(() => {
      removed = result.current.deleteTryoutSignups(["zzz"]);
    });
    expect(removed).toBe(0);
    expect(updateTeam).not.toHaveBeenCalled();
  });

  // ---- subcollection routing (Phase 1 signup migration) -------------------

  it("deletes a subcollection signup via deleteDoc, not the root array", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "sub1", _sub: "tryoutSignups" }],
    });
    act(() => result.current.deleteTryoutSignup("sub1"));
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect(mockDeleteDoc.mock.calls[0][0].path).toContain("/tryoutSignups/sub1");
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("updates a subcollection signup via updateDoc, not the root array", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "sub1", _sub: "tryoutSignups", status: "tryout" }],
    });
    act(() => result.current.updateTryoutSignup("sub1", { status: "reviewed" }));
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("/tryoutSignups/sub1") }),
      { status: "reviewed" }
    );
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("acceptTryout flips a subcollection signup's status on its own doc and adds the player", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [{ id: "sub1", _sub: "tryoutSignups", firstName: "Ava", lastName: "Rivera" }],
    });
    act(() => result.current.acceptTryout("sub1"));
    // Player added to the root roster…
    expect(updateTeam).toHaveBeenCalledWith(
      expect.objectContaining({ players: expect.any(Array) })
    );
    expect(updateTeam.mock.calls[0][0].tryoutSignups).toBeUndefined();
    // …and the signup status flips on its subcollection doc.
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("/tryoutSignups/sub1") }),
      { status: "accepted" }
    );
  });

  it("bulk delete splits subcollection deletes from a single legacy-array rewrite", () => {
    const { result, updateTeam } = setup({
      tryoutSignups: [
        { id: "a" },
        { id: "sub1", _sub: "tryoutSignups" },
        { id: "c" },
      ],
    });
    let removed = 0;
    act(() => {
      removed = result.current.deleteTryoutSignups(["a", "sub1"]);
    });
    expect(removed).toBe(2);
    // The subcollection entry is deleted as a doc.
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect(mockDeleteDoc.mock.calls[0][0].path).toContain("/tryoutSignups/sub1");
    // The legacy array is rewritten ONCE, without the subcollection entry.
    expect(updateTeam).toHaveBeenCalledTimes(1);
    expect(updateTeam).toHaveBeenCalledWith({ tryoutSignups: [{ id: "c" }] });
  });

  it("appendTryoutSignup writes to the subcollection", () => {
    const { result, updateTeam } = setup();
    act(() => {
      result.current.appendTryoutSignup({ firstName: "Sam" });
    });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, doc] = mockSetDoc.mock.calls[0];
    expect(ref.path).toContain("/tryoutSignups/");
    expect(doc).toMatchObject({ firstName: "Sam", status: "tryout" });
    expect(updateTeam).not.toHaveBeenCalled();
  });
});
