import { vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { getDocs, setDoc } from "firebase/firestore";
import { useInviteFlows } from "./useInviteFlows";
import { makeToast } from "../test-utils";

// Stub the Firebase module so importing the hook doesn't initialize a real
// app, and stub firestore so each test controls getDoc/getDocs/setDoc.
// vi.mock is hoisted above the imports above (Vitest transform), so these run
// before useInviteFlows pulls in the real modules.
vi.mock("../firebase", () => ({ appId: "lineup-app", db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(() => ({})),
  setDoc: vi.fn(() => Promise.resolve()),
  where: vi.fn(() => ({})),
}));

const mockGetDocs = getDocs as jest.Mock;
const mockSetDoc = setDoc as jest.Mock;

const setup = (over: Partial<Parameters<typeof useInviteFlows>[0]> = {}) => {
  const toast = makeToast();
  const switchTeam = jest.fn();
  const updateTeam = jest.fn();
  const args = {
    user: { uid: "u1" },
    teams: [],
    updateTeam,
    switchTeam,
    toast,
    ...over,
  };
  const { result } = renderHook(() => useInviteFlows(args as any));
  return { result, toast, switchTeam, updateTeam };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
});

describe("regenerateJoinCode", () => {
  it("returns a 6-char code from the unambiguous alphabet and persists it", () => {
    const { result, updateTeam } = setup();
    let code = "";
    act(() => {
      code = result.current.regenerateJoinCode();
    });
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(updateTeam).toHaveBeenCalledWith({ joinCode: code });
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
      expect.objectContaining({ kind: "error", title: "Invalid code" })
    );
    expect(mockGetDocs).not.toHaveBeenCalled();
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

  it("joins a team, writes membership, and switches to it", async () => {
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: "team-9",
          data: () => ({ name: "Hawks", members: ["owner"], coachRoles: {} }),
        },
      ],
    });
    const { result, toast, switchTeam } = setup();
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("abcd28"); // lowercased on purpose
    });
    expect(res).toEqual({ ok: true });
    // Team membership write + user-settings write.
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    const membershipPatch = mockSetDoc.mock.calls[0][1];
    expect(membershipPatch.members).toContain("u1");
    expect(membershipPatch.coachRoles.u1).toBe("assistant");
    expect(switchTeam).toHaveBeenCalledWith("team-9");
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" })
    );
  });

  it("reports an unrecognized code", async () => {
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
    const { result, toast } = setup();
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("ZZZZ22");
    });
    expect(res).toEqual({ ok: false, retryable: false });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Code not recognized" })
    );
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("treats permission-denied as non-retryable", async () => {
    mockGetDocs.mockRejectedValue({ code: "permission-denied" });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const { result, toast } = setup();
    let res: any;
    await act(async () => {
      res = await result.current.joinTeamByCode("ABCD28");
    });
    expect(res).toEqual({ ok: false, retryable: false });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error", title: "Couldn't join" })
    );
  });
});
