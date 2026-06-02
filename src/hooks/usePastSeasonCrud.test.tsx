import { renderHook, act } from "@testing-library/react";
import { usePastSeasonCrud } from "./usePastSeasonCrud";

const setup = (players: any[]) => {
  const updateTeam = jest.fn();
  const { result } = renderHook(() =>
    usePastSeasonCrud({ teamData: { players }, updateTeam })
  );
  return { result, updateTeam };
};

describe("usePastSeasonCrud", () => {
  it("addPastSeason appends an entry to the matching player", () => {
    const { result, updateTeam } = setup([{ id: "p1", name: "Ava" }]);
    act(() => result.current.addPastSeason("p1", { season: "Fall 2025", ageGroup: "9U" }));
    const ps = updateTeam.mock.calls[0][0].players[0].pastSeasons;
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ season: "Fall 2025", ageGroup: "9U" });
    expect(ps[0].id).toMatch(/^ps-/);
  });

  it("updatePastSeason merges stats field-by-field and replaces other keys", () => {
    const { result, updateTeam } = setup([
      { id: "p1", pastSeasons: [{ id: "ps1", season: "Old", stats: { avg: 0.3, hr: 1 } }] },
    ]);
    act(() => result.current.updatePastSeason("p1", "ps1", { season: "New", stats: { avg: 0.4 } }));
    const e = updateTeam.mock.calls[0][0].players[0].pastSeasons[0];
    expect(e.season).toBe("New");
    expect(e.stats).toMatchObject({ avg: 0.4, hr: 1 });
  });

  it("removePastSeason filters the entry when confirmed", () => {
    const { result, updateTeam } = setup([
      { id: "p1", pastSeasons: [{ id: "ps1" }, { id: "ps2" }] },
    ]);
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    act(() => result.current.removePastSeason("p1", "ps1"));
    expect(updateTeam.mock.calls[0][0].players[0].pastSeasons.map((e: any) => e.id)).toEqual(["ps2"]);
    confirmSpy.mockReturnValue(false);
    updateTeam.mockClear();
    act(() => result.current.removePastSeason("p1", "ps2"));
    expect(updateTeam).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("bulkAddPastSeasons adds one entry per assignment to each player", () => {
    const { result, updateTeam } = setup([{ id: "p1" }, { id: "p2" }]);
    act(() =>
      result.current.bulkAddPastSeasons([
        { playerId: "p1", season: "S1" },
        { playerId: "p2", season: "S2" },
        { playerId: "missing", season: "S3" },
      ])
    );
    const players = updateTeam.mock.calls[0][0].players;
    expect(players[0].pastSeasons[0].season).toBe("S1");
    expect(players[1].pastSeasons[0].season).toBe("S2");
  });
});
