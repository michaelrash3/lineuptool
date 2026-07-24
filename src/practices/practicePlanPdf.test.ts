// Covers the pure handout builder only — the jspdf rendering path is exercised
// manually and mocked at module level in the screen test, same as the stats
// report and roster directory.

import { buildPracticePlanHandout } from "./practicePlanPdf";

const plan = [
  { name: "Laps", minutes: 10, category: "Conditioning", libraryId: "cond" },
  { name: "Tee work", minutes: 25, category: "Hitting", libraryId: "tee" },
  { name: "Situations", minutes: 25, category: "Team" },
];

const library = [
  { id: "cond", description: "Two laps, then dynamic stretch." },
  {
    id: "tee",
    description: "Three rounds off the tee.",
    equipment: "Tees, nets",
  },
];

describe("buildPracticePlanHandout", () => {
  it("returns null for an empty plan", () => {
    expect(buildPracticePlanHandout([])).toBeNull();
    expect(buildPracticePlanHandout(null)).toBeNull();
  });

  it("runs the wall clock across the blocks from the practice start time", () => {
    const data = buildPracticePlanHandout(plan, { startTime: "17:45" });
    expect(data!.clocked).toBe(true);
    expect(data!.blocks.map((b) => [b.startLabel, b.endLabel])).toEqual([
      ["5:45 PM", "5:55 PM"],
      ["5:55 PM", "6:20 PM"],
      ["6:20 PM", "6:45 PM"],
    ]);
    expect(data!.totalMinutes).toBe(60);
  });

  it("falls back to elapsed time when there's no (or a bogus) start time", () => {
    for (const startTime of [undefined, "", "later", "25:00"]) {
      const data = buildPracticePlanHandout(plan, { startTime });
      expect(data!.clocked).toBe(false);
      expect(data!.blocks.map((b) => b.startLabel)).toEqual([
        "0:00",
        "0:10",
        "0:35",
      ]);
      expect(data!.blocks[2].endLabel).toBe("1:00");
    }
  });

  it("crosses midnight without going negative", () => {
    const data = buildPracticePlanHandout([{ name: "Late", minutes: 45 }], {
      startTime: "23:30",
    });
    expect(data!.blocks[0].startLabel).toBe("11:30 PM");
    expect(data!.blocks[0].endLabel).toBe("12:15 AM");
  });

  it("pulls description and gear from the library, tolerating misses", () => {
    const data = buildPracticePlanHandout(plan, { library });
    expect(data!.blocks[1].description).toBe("Three rounds off the tee.");
    expect(data!.blocks[1].equipment).toBe("Tees, nets");
    // Free-typed block with no libraryId — no lookup, no crash.
    expect(data!.blocks[2].description).toBe("");
    expect(data!.blocks[2].equipment).toBe("");
  });

  it("numbers blocks and names an unnamed one", () => {
    const data = buildPracticePlanHandout([{ minutes: 15 }]);
    expect(data!.blocks[0]).toEqual(
      expect.objectContaining({ index: 1, name: "Drill", minutes: 15 }),
    );
  });

  it("formats the practice meta for the letterhead", () => {
    const data = buildPracticePlanHandout(plan, {
      date: "2026-07-05",
      location: "Field 3",
      environment: "outdoor",
      emphasis: "Weighted toward Hitting.",
    });
    expect(data!.dateLabel).toBe("07/05/2026");
    expect(data!.environmentLabel).toBe("Outdoor");
    expect(data!.location).toBe("Field 3");
    expect(data!.emphasis).toBe("Weighted toward Hitting.");
  });
});
