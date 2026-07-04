import { renderHook, act } from "@testing-library/react";
import { usePastSeasonCrud } from "./usePastSeasonCrud";
import { applyTeamOps, makeConfirm } from "../test-utils";

const setup = (players: any[]) => {
  const updateTeamArrays = jest.fn();
  const confirm = makeConfirm();
  const { result } = renderHook(() =>
    usePastSeasonCrud({ updateTeamArrays, confirm }),
  );
  // The hook maps against LATEST provider state; tests replay the emitted op
  // over the fixture roster to observe the outcome.
  const applied = () =>
    applyTeamOps({ players }, updateTeamArrays.mock.calls[0][0]);
  return { result, updateTeamArrays, confirm, applied };
};

describe("usePastSeasonCrud", () => {
  it("addPastSeason appends an entry to the matching player", () => {
    const { result, updateTeamArrays, applied } = setup([
      { id: "p1", name: "Ava" },
    ]);
    act(() =>
      result.current.addPastSeason("p1", {
        season: "Fall 2025",
        ageGroup: "9U",
      }),
    );
    expect(updateTeamArrays.mock.calls[0][0]).toMatchObject({
      op: "mapEntries",
      key: "players",
    });
    const ps = applied().players[0].pastSeasons;
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ season: "Fall 2025", ageGroup: "9U" });
    expect(ps[0].id).toMatch(/^ps-/);
  });

  it("addPastSeason mints the entry id ONCE — replaying the map can't change it", () => {
    // The provider may evaluate a map against fresher state than the screen
    // rendered; a genId() inside the map would mint a different id per run
    // and desync optimistic state from storage.
    const { result, updateTeamArrays } = setup([{ id: "p1" }]);
    act(() => result.current.addPastSeason("p1", { season: "S" }));
    const op = updateTeamArrays.mock.calls[0][0];
    const run1 = applyTeamOps({ players: [{ id: "p1" }] }, op);
    const run2 = applyTeamOps({ players: [{ id: "p1" }] }, op);
    expect(run1.players[0].pastSeasons[0].id).toBe(
      run2.players[0].pastSeasons[0].id,
    );
  });

  it("updatePastSeason merges stats field-by-field and replaces other keys", () => {
    const { result, applied } = setup([
      {
        id: "p1",
        pastSeasons: [{ id: "ps1", season: "Old", stats: { avg: 0.3, hr: 1 } }],
      },
    ]);
    act(() =>
      result.current.updatePastSeason("p1", "ps1", {
        season: "New",
        stats: { avg: 0.4 },
      }),
    );
    const e = applied().players[0].pastSeasons[0];
    expect(e.season).toBe("New");
    expect(e.stats).toMatchObject({ avg: 0.4, hr: 1 });
  });

  it("removePastSeason filters the entry when confirmed", async () => {
    const { result, updateTeamArrays, confirm, applied } = setup([
      { id: "p1", pastSeasons: [{ id: "ps1" }, { id: "ps2" }] },
    ]);
    await act(async () => result.current.removePastSeason("p1", "ps1"));
    expect(applied().players[0].pastSeasons.map((e: any) => e.id)).toEqual([
      "ps2",
    ]);
    confirm.mockResolvedValueOnce(false);
    updateTeamArrays.mockClear();
    await act(async () => result.current.removePastSeason("p1", "ps2"));
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });

  it("bulkAddPastSeasons adds one entry per assignment to each player", () => {
    const { result, applied } = setup([{ id: "p1" }, { id: "p2" }]);
    act(() =>
      result.current.bulkAddPastSeasons([
        { playerId: "p1", season: "S1" },
        { playerId: "p2", season: "S2" },
        { playerId: "missing", season: "S3" },
      ]),
    );
    const players = applied().players;
    expect(players[0].pastSeasons[0].season).toBe("S1");
    expect(players[1].pastSeasons[0].season).toBe("S2");
  });
});
