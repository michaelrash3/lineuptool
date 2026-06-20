import { vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { useInviteFlows } from "./useInviteFlows";
import { makeToast } from "../test-utils";

// Stub the Firebase module so importing the hook doesn't initialize a real
// app, and stub firestore so each test controls getDoc/setDoc/updateDoc.
// vi.mock is hoisted above the imports above (Vitest transform), so these run
// before useInviteFlows pulls in the real modules.
vi.mock("../firebase", () => ({ appId: "lineup-app", db: {} }));
vi.mock("../utils/errorReporter", () => ({ reportError: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  // Encode the path so assertions can tell the invite doc from the team doc.
  doc: vi.fn((_db: any, ...path: string[]) => ({ path: path.join("/") })),
  getDoc: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  arrayUnion: vi.fn((v) => ({ __arrayUnion: v })),
}));

const mockGetDoc = getDoc as unknown as ReturnType<typeof vi.fn>;
const mockSetDoc = setDoc as unknown as ReturnType<typeof vi.fn>;
const mockUpdateDoc = updateDoc as unknown as ReturnType<typeof vi.fn>;
const mockDeleteDoc = deleteDoc as unknown as ReturnType<typeof vi.fn>;

const setup = (over: Partial<Parameters<typeof useInviteFlows>[0]> = {}) => {
  const toast = makeToast();
  const switchTeam = jest.fn();
  const updateTeam = jest.fn();
  const args = {
    user: { uid: "u1" },
    teams: [],
    activeTeamId: "team-1",
    teamData: { name: "My Team", joinCode: "" },
    updateTeam,
    switchTeam,
    toast,
    ...over,
  };
  const { result } = renderHook(() => useInviteFlows(args as any));
  return { result, toast, switchTeam, updateTeam };
};

const inviteDoc = (teamId: string, teamName = "Hawks") => ({
  exists: () => true,
  data: () => ({ teamId, teamName, updatedAt: 1 }),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDoc.mockResolvedValue({ exists: () => false });
});

describe("regenerateJoinCode", () => {
  it("returns a 6-char code from the unambiguous alphabet and persists it", () => {
    const { result, updateTeam } = setup({ activeTeamId: null });
    let code = "";
    act(() => {
      code = result.current.regenerateJoinCode();
    });
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(updateTeam).toHaveBeenCalledWith({ joinCode: code });
  });

  it("writes a sanitized invite doc and invalidates the previous code", async () => {
    const { result } = setup({
      activeTeamId: "team-1",
      teamData: { name: "Hawks", joinCode: "OLD222" },
    });
    let code = "";
    await act(async () => {
      code = result.current.regenerateJoinCode();
      // let the fire-and-forget invite maintenance settle
      await Promise.resolve();
      await Promise.resolve();
    });
    // Invite doc carries ONLY teamId/teamName/updatedAt — no private fields.
    const invitePath = `artifacts/lineup-app/public/data/teamInvites/${code}`;
    const inviteCall = mockSetDoc.mock.calls.find(
      (c: any) => c[0]?.path === invitePath,
    );
    expect(inviteCall).toBeTruthy();
    expect(Object.keys(inviteCall![1]).sort()).toEqual([
      "teamId",
      "teamName",
      "updatedAt",
    ]);
    expect(inviteCall![1]).toMatchObject({
      teamId: "team-1",
      teamName: "Hawks",
    });
    // The stale code's lookup is deleted.
    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "artifacts/lineup-app/public/data/teamInvites/OLD222",
      }),
    );
  });
});

describe("joinTeamByCode", () => {
  it("rejects a malformed code before touching Firestore", async () => {
    const { result, toast } = setup();
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("abc");
    });
    expect(res).toEqual({ ok: false, retryable: false });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error", title: "Invalid code" }),
    );
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("returns a retryable failure when there is no signed-in user", async () => {
    const { result, toast } = setup({ user: null });
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("ABCD28");
    });
    expect(res).toEqual({ ok: false, retryable: true });
    expect(toast.push).not.toHaveBeenCalled();
  });

  it("resolves the sanitized invite and adds the current user as an assistant", async () => {
    // Invite lookup resolves to team-9; no full-team query is ever issued.
    mockGetDoc.mockResolvedValue(inviteDoc("team-9", "Hawks"));
    const { result, toast, switchTeam } = setup();
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("abcd28"); // lowercased on purpose
    });
    expect(res).toEqual({ ok: true });
    // Membership is an atomic arrayUnion + dotted coachRoles update.
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, patch] = mockUpdateDoc.mock.calls[0];
    expect(ref.path).toBe("artifacts/lineup-app/public/data/teams/team-9");
    expect(patch.members).toEqual({ __arrayUnion: "u1" });
    expect(patch["coachRoles.u1"]).toBe("assistant");
    // User-settings write persists the joined team.
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(switchTeam).toHaveBeenCalledWith("team-9");
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" }),
    );
  });

  it("preserves teams already on the server settings doc when local state is empty", async () => {
    // Regression guard for the data-loss report: with local `teams` state
    // transiently empty, the settings write must merge with the SERVER list,
    // not replace it — otherwise the coach's existing team is orphaned.
    mockGetDoc
      .mockResolvedValueOnce(inviteDoc("team-9", "Hawks")) // invite lookup
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ teams: [{ id: "team-old", name: "Existing Team" }] }),
      }); // settings doc read
    const { result } = setup({ teams: [] });
    await act(async () => {
      await result.current.joinTeamByCode("ABCD28");
    });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [, payload] = mockSetDoc.mock.calls[0];
    expect(payload.teams).toEqual([
      { id: "team-old", name: "Existing Team" },
      { id: "team-9", name: "Hawks" },
    ]);
    expect(payload.activeTeamId).toBe("team-9");
  });

  it("still records the joined team when the settings read fails", async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => false }) // already-a-member check on team-local
      .mockResolvedValueOnce(inviteDoc("team-9", "Hawks")) // invite lookup
      .mockRejectedValueOnce({ code: "unavailable" }); // settings doc read fails
    const { result } = setup({ teams: [{ id: "team-local", name: "Local" }] });
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("ABCD28");
    });
    expect(res).toEqual({ ok: true });
    const [, payload] = mockSetDoc.mock.calls[0];
    expect(payload.teams).toEqual([
      { id: "team-local", name: "Local" },
      { id: "team-9", name: "Hawks" },
    ]);
  });

  it("reports an unrecognized code without writing", async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    const { result, toast } = setup();
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("ZZZZ22");
    });
    expect(res).toEqual({ ok: false, retryable: false });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Code not recognized" }),
    );
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("treats permission-denied as non-retryable", async () => {
    mockGetDoc.mockRejectedValue({ code: "permission-denied" });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const { result, toast } = setup();
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("ABCD28");
    });
    expect(res).toEqual({ ok: false, retryable: false });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error", title: "Couldn't join" }),
    );
  });
});
