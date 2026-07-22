// Covers the pure data builder only — the jspdf rendering path is exercised
// manually and mocked at module level in screen tests, same as the treasurer
// report and roster directory.

import { buildStatsReportData } from "./statsReportPdf";
import type { StatRow } from "./statColumns";

const row = (over: Partial<StatRow>): StatRow => ({
  id: "p1",
  name: "Player",
  stats: {},
  total: 0,
  ...over,
});

describe("buildStatsReportData", () => {
  it("returns null when no player has any stat", () => {
    expect(buildStatsReportData([])).toBeNull();
    expect(buildStatsReportData(null)).toBeNull();
    // An eval score alone isn't a stats report.
    expect(buildStatsReportData([row({ total: 80 })])).toBeNull();
  });

  it("builds a sorted section per category with display-formatted cells", () => {
    const data = buildStatsReportData([
      row({
        id: "a",
        name: "Apex",
        number: "1",
        total: 72,
        stats: { avg: 0.4, ops: 1.2, pEra: 2.5 },
      }),
      row({
        id: "b",
        name: "Bolt",
        number: "2",
        stats: { avg: 0.25, ops: 0.6, pEra: 6 },
      }),
    ]);
    expect(data).not.toBeNull();
    expect(data!.sections.map((s) => s.id)).toEqual(["batting", "pitching"]);

    const batting = data!.sections[0];
    // OPS descending → Apex first.
    expect(batting.rows.map((r) => r.name)).toEqual(["Apex", "Bolt"]);
    expect(batting.rows[0].cells[0]).toBe("72"); // Overall
    const avgIdx = batting.columns.findIndex((c) => c.key === "avg");
    expect(batting.rows[0].cells[avgIdx]).toBe(".400");
    // No eval score → em-dash Overall.
    expect(batting.rows[1].cells[0]).toBe("—");

    const pitching = data!.sections[1];
    // ERA ascending → Apex (2.50) first.
    expect(pitching.rows.map((r) => r.name)).toEqual(["Apex", "Bolt"]);
    const eraIdx = pitching.columns.findIndex((c) => c.key === "era");
    expect(pitching.rows[0].cells[eraIdx]).toBe("2.50");

    expect(data!.playerCount).toBe(2);
  });

  it("drops a player from sections where they have no data, counting them once", () => {
    const data = buildStatsReportData([
      row({ id: "a", name: "Apex", stats: { avg: 0.3 } }),
      row({ id: "b", name: "Bolt", stats: { pEra: 3 } }),
    ]);
    const byId = Object.fromEntries(
      data!.sections.map((s) => [s.id, s.rows.map((r) => r.name)]),
    );
    expect(byId.batting).toEqual(["Apex"]);
    expect(byId.pitching).toEqual(["Bolt"]);
    expect(data!.sections.find((s) => s.id === "fielding")).toBeUndefined();
    expect(data!.playerCount).toBe(2);
  });

  it("ranks leaders in the stat's own direction and caps at three", () => {
    const data = buildStatsReportData([
      row({ id: "a", name: "A", stats: { pEra: 4 } }),
      row({ id: "b", name: "B", stats: { pEra: 1.5 } }),
      row({ id: "c", name: "C", stats: { pEra: 3 } }),
      row({ id: "d", name: "D", stats: { pEra: 2 } }),
    ]);
    const era = data!.leaders.find((l) => l.stat === "ERA");
    expect(era).toBeDefined();
    expect(era!.entries.map((e) => e.name)).toEqual(["B", "D", "C"]);
    expect(era!.entries[0].value).toBe("1.50");
    expect(era!.category).toBe("Pitching");
  });

  it("defaults and passes through the scope label", () => {
    const rows = [row({ stats: { ab: 1 } })];
    expect(buildStatsReportData(rows)!.scopeLabel).toBe("All Formats");
    expect(
      buildStatsReportData(rows, { scopeLabel: "Kid Pitch" })!.scopeLabel,
    ).toBe("Kid Pitch");
  });
});
