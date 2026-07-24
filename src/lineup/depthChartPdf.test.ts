// Covers the pure board builder only — the jspdf rendering path is exercised
// manually and mocked at module level in the screen test, same as the stats
// report and roster directory.

import { buildDepthChartBoard } from "./depthChartPdf";

describe("buildDepthChartBoard", () => {
  it("returns null with no board, and with positions but no players", () => {
    expect(buildDepthChartBoard(null)).toBeNull();
    expect(buildDepthChartBoard([])).toBeNull();
    expect(
      buildDepthChartBoard([
        { pos: "P", ranked: [] },
        { pos: "C", ranked: [] },
      ]),
    ).toBeNull();
  });

  it("keeps the screen's order and labels each position", () => {
    const data = buildDepthChartBoard([
      {
        pos: "SS",
        ranked: [
          { id: "b", name: "Bortz", number: 7, primaryPosition: "SS" },
          { id: "a", name: "Apple", number: "2" },
        ],
        customized: true,
      },
    ]);
    expect(data).not.toBeNull();
    const row = data!.rows[0];
    expect(row.label).toBe("Shortstop");
    expect(row.customized).toBe(true);
    expect(row.slots.map((s) => s.name)).toEqual(["Bortz", "Apple"]);
    expect(row.slots[0]).toEqual(
      expect.objectContaining({ number: "7", primary: true }),
    );
    // Apple's primary is unset, so he isn't starred at SS.
    expect(row.slots[1].primary).toBe(false);
    expect(data!.customizedCount).toBe(1);
  });

  it("counts a player once across every position they rank at", () => {
    const data = buildDepthChartBoard([
      { pos: "2B", ranked: [{ id: "a", name: "Apple" }] },
      { pos: "SS", ranked: [{ id: "a", name: "Apple" }] },
      { pos: "LF", ranked: [] },
    ]);
    expect(data!.playerCount).toBe(1);
    expect(data!.emptyCount).toBe(1);
    // Empty positions are kept — the hole is the point of printing the board.
    expect(data!.rows.map((r) => r.pos)).toEqual(["2B", "SS", "LF"]);
  });

  it("caps the printed depth at six columns", () => {
    const ranked = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
    }));
    const data = buildDepthChartBoard([{ pos: "P", ranked }]);
    expect(data!.depth).toBe(6);
    // The overflow players stay on the row so the renderer can total them.
    expect(data!.rows[0].slots).toHaveLength(8);
  });

  it("falls back to the raw position code and a placeholder name", () => {
    const data = buildDepthChartBoard([{ pos: "DH", ranked: [{ id: "x" }] }]);
    expect(data!.rows[0].label).toBe("DH");
    expect(data!.rows[0].slots[0].name).toBe("Unnamed");
    expect(data!.rows[0].slots[0].number).toBe("");
  });
});
