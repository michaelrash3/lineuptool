import { renderHook, act } from "@testing-library/react";
import { usePracticeCrud } from "./usePracticeCrud";
import { makeConfirm, makeToast } from "../test-utils";
import { DEFAULT_DRILL_LIBRARY } from "../constants/ui";

const setup = (teamOver: any = {}) => {
  const updateTeam = jest.fn();
  const toast = makeToast();
  const confirm = makeConfirm();
  const teamData = {
    practices: [],
    players: [],
    ...teamOver,
  };
  const { result } = renderHook(() =>
    usePracticeCrud({ teamData, updateTeam, toast, confirm }),
  );
  return { result, updateTeam, toast, confirm };
};

describe("usePracticeCrud — practices", () => {
  it("addPractice appends a scheduled practice with an empty agenda", () => {
    const { result, updateTeam } = setup();
    act(() =>
      result.current.addPractice({
        date: "2026-05-01",
        location: " Cage ",
        environment: "indoor",
      }),
    );
    const practices = updateTeam.mock.calls[0][0].practices;
    expect(practices).toHaveLength(1);
    expect(practices[0]).toMatchObject({
      date: "2026-05-01",
      location: "Cage",
      environment: "indoor",
      status: "scheduled",
      drills: [],
    });
  });

  it("addPractice warns and does not persist without a date", () => {
    const { result, updateTeam, toast } = setup();
    act(() => result.current.addPractice({ date: "" }));
    expect(updateTeam).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn" }),
    );
  });

  it("removePractice deletes and offers undo, gated by confirm", async () => {
    const { result, updateTeam, confirm } = setup({
      practices: [{ id: "p1", date: "2026-05-01" }],
    });
    confirm.mockResolvedValueOnce(false);
    await act(async () => result.current.removePractice("p1"));
    expect(updateTeam).not.toHaveBeenCalled(); // declined

    await act(async () => result.current.removePractice("p1"));
    expect(updateTeam.mock.calls[0][0].practices).toEqual([]);
  });
});

describe("usePracticeCrud — drill library", () => {
  it("addDrillToLibrary appends to the seed library on first edit", () => {
    const { result, updateTeam } = setup(); // no stored library
    act(() =>
      result.current.addDrillToLibrary({
        name: " Bunt defense ",
        category: "Fielding",
        defaultMinutes: 12,
        environment: "outdoor",
      }),
    );
    const lib = updateTeam.mock.calls[0][0].drillLibrary;
    // Seed is preserved, the new drill is appended (trimmed, with an id).
    expect(lib).toHaveLength(DEFAULT_DRILL_LIBRARY.length + 1);
    expect(lib[lib.length - 1]).toMatchObject({
      name: "Bunt defense",
      category: "Fielding",
      defaultMinutes: 12,
      environment: "outdoor",
    });
    expect(lib[lib.length - 1].id).toEqual(expect.any(String));
  });

  it("addDrillToLibrary warns and does not persist without a name", () => {
    const { result, updateTeam, toast } = setup();
    act(() =>
      result.current.addDrillToLibrary({ name: "  ", category: "Hitting" }),
    );
    expect(updateTeam).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn" }),
    );
  });

  it("removeDrillFromLibrary drops the matching drill, keeping the rest", () => {
    const library = [
      { id: "d1", name: "Tee", category: "Hitting" },
      { id: "d2", name: "Relays", category: "Fielding" },
    ];
    const { result, updateTeam } = setup({ drillLibrary: library });
    act(() => result.current.removeDrillFromLibrary("d1"));
    expect(updateTeam.mock.calls[0][0].drillLibrary).toEqual([
      { id: "d2", name: "Relays", category: "Fielding" },
    ]);
  });

  it("updateDrillInLibrary patches a single drill in place", () => {
    const library = [
      { id: "d1", name: "Tee", category: "Hitting", defaultMinutes: 10 },
    ];
    const { result, updateTeam } = setup({ drillLibrary: library });
    act(() =>
      result.current.updateDrillInLibrary("d1", { defaultMinutes: 20 }),
    );
    expect(updateTeam.mock.calls[0][0].drillLibrary[0]).toMatchObject({
      id: "d1",
      name: "Tee",
      defaultMinutes: 20,
    });
  });
});
