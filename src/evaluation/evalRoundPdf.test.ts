import { describe, it, expect } from "vitest";
import { buildEvalGradeGrid } from "./evalRoundPdf";

const players = [
  { id: "p1", name: "Ava Rivera", number: "3" },
  { id: "p2", name: "Ben Stone", number: 7 },
];
const categories = [
  { id: "contact", label: "Contact" },
  { id: "power", label: "Power" },
];

describe("buildEvalGradeGrid", () => {
  it("maps categories to columns and preserves roster order", () => {
    const round = {
      grades: {
        p1: { contact: 5, power: 3, notes: "quick bat" },
        p2: { contact: 2, power: 4 },
      },
    };
    const grid = buildEvalGradeGrid(round, players, categories)!;
    expect(grid.columns).toEqual([
      { id: "contact", label: "Contact" },
      { id: "power", label: "Power" },
    ]);
    expect(grid.rows.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(grid.rows[0]).toMatchObject({
      name: "Ava Rivera",
      number: "3",
      grades: [5, 3],
      notes: "quick bat",
      graded: true,
    });
    // Numeric number is stringified; missing notes become "".
    expect(grid.rows[1]).toMatchObject({
      number: "7",
      grades: [2, 4],
      notes: "",
    });
    expect(grid.gradedCount).toBe(2);
  });

  it("uses null (not 0) for an ungraded category", () => {
    const round = { grades: { p1: { power: 4 } } };
    const grid = buildEvalGradeGrid(round, [players[0]], categories)!;
    expect(grid.rows[0].grades).toEqual([null, 4]);
    expect(grid.rows[0].graded).toBe(true);
  });

  it("ignores non-numeric grade values", () => {
    const round = { grades: { p1: { contact: "bad" as any, power: 4 } } };
    const grid = buildEvalGradeGrid(round, [players[0]], categories)!;
    expect(grid.rows[0].grades).toEqual([null, 4]);
  });

  it("counts a player graded by notes alone as graded", () => {
    const round = { grades: { p1: { notes: "late arrival" } } };
    const grid = buildEvalGradeGrid(round, [players[0]], categories)!;
    expect(grid.rows[0].grades).toEqual([null, null]);
    expect(grid.rows[0].graded).toBe(true);
    expect(grid.gradedCount).toBe(1);
  });

  it("treats a null round as fully ungraded", () => {
    const grid = buildEvalGradeGrid(null, players, categories)!;
    expect(grid.rows.every((r) => !r.graded)).toBe(true);
    expect(grid.rows[0].grades).toEqual([null, null]);
    expect(grid.gradedCount).toBe(0);
  });

  it("blanks the number when a player has none", () => {
    const grid = buildEvalGradeGrid(
      { grades: {} },
      [{ id: "p1", name: "Ava" }],
      categories,
    )!;
    expect(grid.rows[0].number).toBe("");
  });

  it("returns null when there is no roster to render", () => {
    expect(buildEvalGradeGrid({ grades: {} }, [], categories)).toBeNull();
    expect(buildEvalGradeGrid({ grades: {} }, null, categories)).toBeNull();
  });

  it("tolerates a missing category set (no grade columns)", () => {
    const grid = buildEvalGradeGrid({ grades: {} }, [players[0]], null)!;
    expect(grid.columns).toEqual([]);
    expect(grid.rows[0].grades).toEqual([]);
  });
});
