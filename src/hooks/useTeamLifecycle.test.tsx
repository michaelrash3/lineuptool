import { vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setDoc, getDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { downloadTeamBackup } from "../utils/teamBackup";
import { saveEvalRound, deleteEvalRound } from "../utils/evalRounds";
import { downscaleImageToDataURL } from "../components/shared";
import { blankStats } from "../utils/helpers";
import { useTeamLifecycle } from "./useTeamLifecycle";
import { makeToast, makeConfirm } from "../test-utils";

// Team bootstrap commands (switch / create / advance-season / upload-logo /
// delete / leave). Firestore and the side-effecting utilities (backup
// download, evalRounds subcollection writes, image downscale) are mocked;
// the pure season-rollover helpers (computeNextSeason, isReturning,
// blankStats, opponent aggregates, preseason seeding, ...) run for real so
// the advance-season assertions exercise the actual archive math.

vi.mock("../firebase", () => ({ auth: {}, db: {}, appId: "test-app" }));
vi.mock("firebase/firestore", () => ({
  // Encode the path so assertions can tell the team doc from the settings doc.
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  setDoc: vi.fn(() => Promise.resolve()),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  arrayRemove: vi.fn((v) => ({ __arrayRemove: v })),
}));
vi.mock("../utils/teamBackup", () => ({ downloadTeamBackup: vi.fn() }));
vi.mock("../utils/evalRounds", () => ({
  saveEvalRound: vi.fn(() => Promise.resolve()),
  deleteEvalRound: vi.fn(() => Promise.resolve()),
}));
vi.mock("../components/shared", () => ({
  downscaleImageToDataURL: vi.fn(() =>
    Promise.resolve("data:image/webp;base64,tiny"),
  ),
}));

const mockSetDoc = setDoc as unknown as ReturnType<typeof vi.fn>;
const mockGetDoc = getDoc as unknown as ReturnType<typeof vi.fn>;
const mockDeleteDoc = deleteDoc as unknown as ReturnType<typeof vi.fn>;
const mockUpdateDoc = updateDoc as unknown as ReturnType<typeof vi.fn>;
const mockBackup = downloadTeamBackup as unknown as ReturnType<typeof vi.fn>;
const mockSaveRound = saveEvalRound as unknown as ReturnType<typeof vi.fn>;
const mockDeleteRound = deleteEvalRound as unknown as ReturnType<typeof vi.fn>;
const mockDownscale = downscaleImageToDataURL as unknown as ReturnType<
  typeof vi.fn
>;

const SETTINGS_PATH = "artifacts/test-app/users/u1/settings/teams";

// A season mid-flight: one final game, one eval round, a returning and a
// non-returning player, and a running ledger. Fall → Spring keeps the age
// tier AND leaves the finances untouched (the season YEAR is Fall–Spring).
const makeFixture = () => ({
  name: "Hawks",
  currentSeason: "Fall 2025",
  teamAge: "10U",
  pitchingFormat: "Kid Pitch",
  leagueRuleSet: "USSSA",
  players: [
    {
      id: "p1",
      name: "Returning Ray",
      playerStatus: "returning",
      health: { status: "out" },
      stats: { ...blankStats(), ab: 10, h: 5 },
      pastSeasons: [],
    },
    {
      id: "p2",
      name: "Leaving Lee",
      returning: false,
      stats: { ...blankStats() },
      pastSeasons: [],
    },
  ],
  games: [
    {
      id: "g1",
      opponent: "Cubs",
      status: "final",
      teamScore: 5,
      opponentScore: 3,
    },
  ],
  practices: [{ id: "pr1", date: "2025-10-01" }],
  tournaments: [{ id: "trn1", name: "Fall Classic" }],
  tryoutSessions: [],
  tryoutSignups: [],
  evaluationEvents: [
    {
      id: "ev1",
      date: "2025-09-15",
      createdAt: 1,
      coachRole: "Head",
      evaluatorId: "u1",
      grades: { p1: { approach: 4 } },
    },
  ],
  finances: {
    clubFee: 500,
    payments: [{ id: "pay1", playerId: "p1", date: "2025-08-01", amount: 100 }],
    incomes: [],
    expenses: [],
  },
  opponentArchive: [],
});

type Args = Parameters<typeof useTeamLifecycle>[0];

const setup = (over: Partial<Args> = {}) => {
  const toast = makeToast();
  const confirm = makeConfirm();
  const setActiveTeamId = jest.fn();
  const setSyncStatus = jest.fn();
  const updateTeam = jest.fn();
  const args: Args = {
    user: { uid: "u1" } as Args["user"],
    teams: [
      { id: "t1", name: "Hawks" },
      { id: "t2", name: "Owls" },
    ],
    activeTeamId: "t1",
    setActiveTeamId,
    setSyncStatus,
    teamDataRef: { current: makeFixture() },
    updateTeam,
    toast,
    confirm,
    ...over,
  };
  const view = renderHook((p: Args) => useTeamLifecycle(p), {
    initialProps: args,
  });
  return {
    ...view,
    args,
    toast,
    confirm,
    setActiveTeamId,
    setSyncStatus,
    updateTeam,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("switchTeam", () => {
  it("selects the team locally and persists activeTeamId to the settings doc (merge)", async () => {
    const { result, setActiveTeamId } = setup();
    await act(async () => {
      await result.current.switchTeam("t2");
    });
    expect(setActiveTeamId).toHaveBeenCalledWith("t2");
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = mockSetDoc.mock.calls[0];
    expect(ref.path).toBe(SETTINGS_PATH);
    expect(payload).toEqual({ activeTeamId: "t2" });
    expect(opts).toEqual({ merge: true });
  });
});

describe("createTeam", () => {
  it("writes the new team doc and the merged settings list, then reports success", async () => {
    const { result, toast, setSyncStatus } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.createTeam("  Sluggers  ", "NKB");
    });
    expect(ok).toBe(true);
    // First write: the team doc itself.
    const [teamRef, teamPayload] = mockSetDoc.mock.calls[0];
    expect(teamRef.path).toMatch(/^artifacts\/test-app\/public\/data\/teams\//);
    const newId = teamRef.path.split("/").pop();
    expect(teamPayload).toMatchObject({
      name: "Sluggers", // trimmed
      ownerId: "u1",
      members: ["u1"],
      leagueRuleSet: "NKB",
    });
    // NEW_TEAM_DOC deliberately omits the legacy evaluationEvents array —
    // the rules reject any team-doc write that would (re)create it.
    expect("evaluationEvents" in teamPayload).toBe(false);
    // Second write: the settings doc, merged with the current team list.
    const [settingsRef, settingsPayload, settingsOpts] =
      mockSetDoc.mock.calls[1];
    expect(settingsRef.path).toBe(SETTINGS_PATH);
    expect(settingsPayload.teams).toEqual([
      { id: "t1", name: "Hawks" },
      { id: "t2", name: "Owls" },
      { id: newId, name: "Sluggers" },
    ]);
    expect(settingsPayload.activeTeamId).toBe(newId);
    expect(settingsOpts).toEqual({ merge: true });
    expect(toast.push).toHaveBeenCalledWith({
      kind: "success",
      title: "Team created",
    });
    expect(setSyncStatus).toHaveBeenNthCalledWith(1, "Creating");
    expect(setSyncStatus).toHaveBeenLastCalledWith("");
  });

  it("preserves teams already on the SERVER settings doc when local state is empty", async () => {
    // Regression guard: a create reached through a wrongly-shown welcome page
    // (local teams transiently []) must merge with the server list, not
    // overwrite it and orphan the coach's existing team.
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ teams: [{ id: "t-old", name: "Existing" }] }),
    });
    const { result } = setup({ teams: [] });
    await act(async () => {
      await result.current.createTeam("Sluggers");
    });
    const [, settingsPayload] = mockSetDoc.mock.calls[1];
    expect(settingsPayload.teams.map((t: { id: string }) => t.id)).toEqual([
      "t-old",
      settingsPayload.activeTeamId,
    ]);
  });

  it("returns false with an error toast when the write fails, and rejects blank names outright", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("boom"));
    const { result, toast, setSyncStatus } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.createTeam("Sluggers");
    });
    expect(ok).toBe(false);
    expect(toast.push).toHaveBeenCalledWith({
      kind: "error",
      title: "Could not create team",
      message: "boom",
    });
    expect(setSyncStatus).toHaveBeenLastCalledWith("");
    // Blank name: refused before any Firestore traffic.
    mockSetDoc.mockClear();
    await act(async () => {
      ok = await result.current.createTeam("   ");
    });
    expect(ok).toBe(false);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe("deleteTeamCmd", () => {
  it("confirms, downloads a snapshot, deletes the team doc, and repoints settings", async () => {
    const { result, args, confirm, toast } = setup();
    await act(async () => {
      await result.current.deleteTeamCmd();
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Permanently delete this team?",
        danger: true,
      }),
    );
    expect(mockBackup).toHaveBeenCalledWith(
      args.teamDataRef.current,
      "t1",
      "snapshot",
    );
    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "artifacts/test-app/public/data/teams/t1",
      }),
    );
    const [ref, payload, opts] = mockSetDoc.mock.calls[0];
    expect(ref.path).toBe(SETTINGS_PATH);
    expect(payload).toEqual({
      teams: [{ id: "t2", name: "Owls" }],
      activeTeamId: "t2",
    });
    expect(opts).toEqual({ merge: true });
    expect(toast.push).toHaveBeenCalledWith({
      kind: "success",
      title: "Team deleted",
    });
  });

  it("does nothing when declined, and never even asks for the last team", async () => {
    const { result, confirm } = setup();
    confirm.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.deleteTeamCmd();
    });
    expect(mockBackup).not.toHaveBeenCalled();
    expect(mockDeleteDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
    // Only one team left: guarded before the confirm dialog.
    const single = setup({ teams: [{ id: "t1", name: "Hawks" }] });
    await act(async () => {
      await single.result.current.deleteTeamCmd();
    });
    expect(single.confirm).not.toHaveBeenCalled();
  });
});

describe("leaveTeamCmd", () => {
  it("confirms, removes only this uid via arrayRemove, and repoints settings", async () => {
    const { result, confirm, toast } = setup();
    await act(async () => {
      await result.current.leaveTeamCmd();
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Leave this team?", danger: true }),
    );
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [teamRef, patch] = mockUpdateDoc.mock.calls[0];
    expect(teamRef.path).toBe("artifacts/test-app/public/data/teams/t1");
    expect(patch).toEqual({ members: { __arrayRemove: "u1" } });
    const [settingsRef, payload] = mockSetDoc.mock.calls[0];
    expect(settingsRef.path).toBe(SETTINGS_PATH);
    expect(payload).toEqual({
      teams: [{ id: "t2", name: "Owls" }],
      activeTeamId: "t2",
    });
    expect(toast.push).toHaveBeenCalledWith({
      kind: "success",
      title: "Left team",
    });
  });
});

describe("advanceSeason", () => {
  it("archives the season: wipes schedule state, blanks + archives stats, drops non-returners, reseeds evals", async () => {
    const { result, args, confirm, updateTeam, toast } = setup();
    const fixture = args.teamDataRef.current;
    await act(async () => {
      await result.current.advanceSeason();
    });

    // The duplicate-gate confirm for direct callers.
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Archive Fall 2025?", danger: true }),
    );

    // Safety snapshot downloads BEFORE the irreversible mutation.
    expect(mockBackup).toHaveBeenCalledWith(fixture, "t1", "snapshot");
    expect(mockBackup.mock.invocationCallOrder[0]).toBeLessThan(
      updateTeam.mock.invocationCallOrder[0],
    );

    // One big patch, with the empty-roster wipe guard explicitly waived.
    expect(updateTeam).toHaveBeenCalledTimes(1);
    const [patch, opts] = updateTeam.mock.calls[0];
    expect(opts).toEqual({ allowEmptyPlayers: true });
    expect(patch).toMatchObject({
      currentSeason: "Spring 2026", // Fall → Spring: same season YEAR
      teamAge: "10U", // no age bump on the mid-year advance
      games: [],
      tournaments: [],
      practices: [],
      tryoutSessions: [],
      tryoutSignups: [],
      tryoutsOpen: false,
      gcCalendarUrl: "",
    });
    expect(typeof patch.lastSeasonAdvanceAt).toBe("string");
    // Kid Pitch is still legal at 10U — no self-heal key in the patch.
    expect("pitchingFormat" in patch).toBe(false);
    // Fall → Spring leaves the ledger running (fees cover the Fall–Spring
    // year), so the patch carries no finances at all.
    expect("finances" in patch).toBe(false);
    // The legacy evaluationEvents array key must NEVER reappear in a write.
    expect("evaluationEvents" in patch).toBe(false);

    // Roster: the non-returner is dropped; the returner survives with
    // blanked stats, reset status/pitching, and no stale injury status.
    expect(patch.players.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    const ray = patch.players[0];
    expect(ray.playerStatus).toBe("returning");
    expect(ray.stats).toEqual(blankStats());
    expect(ray.pitching).toEqual({ recentPitches: 0, lastPitchDate: null });
    expect("health" in ray).toBe(false);
    // Old stat line archived into pastSeasons with the team context + record.
    expect(ray.pastSeasons).toHaveLength(1);
    expect(ray.pastSeasons[0]).toMatchObject({
      season: "Fall 2025",
      ageGroup: "10U",
      pitchingFormat: "Kid Pitch",
      record: { wins: 1, losses: 0, ties: 0, runsScored: 5, runsAllowed: 3 },
      stats: { ...blankStats(), ab: 10, h: 5 },
    });

    // Head-to-head survives the games wipe as a per-opponent aggregate.
    expect(patch.opponentArchive).toEqual([
      {
        season: "Fall 2025",
        opponent: "Cubs",
        wins: 1,
        losses: 0,
        ties: 0,
        runsFor: 5,
        runsAgainst: 3,
      },
    ]);

    // Eval rounds: the closing season's subcollection docs are deleted and a
    // Preseason seed (carrying Ray's latest grades) is written fresh.
    expect(mockDeleteRound).toHaveBeenCalledWith(
      expect.anything(),
      "test-app",
      "t1",
      "ev1",
    );
    expect(mockSaveRound).toHaveBeenCalledTimes(1);
    expect(mockSaveRound.mock.calls[0][2]).toBe("t1");
    expect(mockSaveRound.mock.calls[0][3]).toMatchObject({
      label: "Preseason",
      seededFromAdvance: true,
      grades: { p1: { approach: 4 } },
    });

    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "success",
        title: "Advanced to Spring 2026",
      }),
    );
  });

  it("bumps the age tier on Spring → Fall and self-heals a now-illegal pitching format (skipConfirm path)", async () => {
    const { result, confirm, updateTeam } = setup({
      teamDataRef: {
        current: {
          currentSeason: "Spring 2025",
          teamAge: "8U",
          pitchingFormat: "Coach Pitch",
          leagueRuleSet: "USSSA",
          players: [{ id: "p1", name: "Ray" }],
          games: [],
          practices: [],
          tournaments: [],
          tryoutSessions: [],
          tryoutSignups: [],
          evaluationEvents: [],
        },
      },
    });
    await act(async () => {
      await result.current.advanceSeason({ skipConfirm: true });
    });
    expect(confirm).not.toHaveBeenCalled(); // wizard already gated it
    expect(mockBackup).toHaveBeenCalledTimes(1); // snapshot still fires
    const [patch] = updateTeam.mock.calls[0];
    expect(patch.currentSeason).toBe("Fall 2025");
    expect(patch.teamAge).toBe("9U"); // Spring → Fall bumps the tier
    expect(patch.pitchingFormat).toBe("Kid Pitch"); // 9U is always Kid Pitch
    // Nothing meaningful to archive (blank stats, no games/evals): no
    // pastSeasons row is minted, and no eval rounds are touched or seeded.
    expect(patch.players[0].pastSeasons).toEqual([]);
    expect(mockDeleteRound).not.toHaveBeenCalled();
    expect(mockSaveRound).not.toHaveBeenCalled();
  });

  it("bails entirely when the confirm is declined", async () => {
    const { result, confirm, updateTeam, toast } = setup();
    confirm.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.advanceSeason();
    });
    expect(updateTeam).not.toHaveBeenCalled();
    expect(mockBackup).not.toHaveBeenCalled();
    expect(mockDeleteRound).not.toHaveBeenCalled();
    expect(mockSaveRound).not.toHaveBeenCalled();
    expect(toast.push).not.toHaveBeenCalled();
  });

  it("warns and mutates nothing when the season label is unparseable", async () => {
    const fixture = makeFixture();
    fixture.currentSeason = "Winter 2026"; // only Spring/Fall parse
    const { result, confirm, updateTeam, toast } = setup({
      teamDataRef: { current: fixture },
    });
    await act(async () => {
      await result.current.advanceSeason();
    });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warn",
        title: "Cannot determine next season",
      }),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(updateTeam).not.toHaveBeenCalled();
    expect(mockBackup).not.toHaveBeenCalled();
  });
});

describe("uploadLogo", () => {
  it("downscales the image, saves the data URL, and toasts", async () => {
    const { result, updateTeam, toast } = setup();
    const file = new File(["a".repeat(500)], "logo.png", {
      type: "image/png",
    });
    await act(async () => {
      result.current.uploadLogo({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockDownscale).toHaveBeenCalledWith(file, {
      maxDim: 512,
      targetBytes: 200_000,
    });
    expect(updateTeam).toHaveBeenCalledWith({
      logoUrl: "data:image/webp;base64,tiny",
    });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "success",
        title: "Logo resized & saved",
      }),
    );
  });
});

describe("callback identity across snapshots (the teamDataRef refactor)", () => {
  it("keeps stable identities when only teamDataRef.current changes, yet reads the fresh data", async () => {
    const { result, rerender, args, updateTeam } = setup();
    const first = { ...result.current };
    // A new Firestore snapshot lands: the ref's CONTENT is replaced, the ref
    // object itself (and every other injected dependency) stays the same.
    const fresh = makeFixture();
    fresh.currentSeason = "Spring 2026";
    args.teamDataRef.current = fresh;
    rerender(args);
    expect(result.current.advanceSeason).toBe(first.advanceSeason);
    expect(result.current.switchTeam).toBe(first.switchTeam);
    expect(result.current.createTeam).toBe(first.createTeam);
    expect(result.current.uploadLogo).toBe(first.uploadLogo);
    expect(result.current.deleteTeamCmd).toBe(first.deleteTeamCmd);
    expect(result.current.leaveTeamCmd).toBe(first.leaveTeamCmd);
    // And the STALE-closure trap is actually avoided: the same advanceSeason
    // instance sees the swapped-in season.
    await act(async () => {
      await result.current.advanceSeason({ skipConfirm: true });
    });
    expect(updateTeam.mock.calls[0][0].currentSeason).toBe("Fall 2026");
  });
});
