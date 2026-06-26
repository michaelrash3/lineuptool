import { describe, expect, it } from "vitest";
import { buildRosterDirectoryRows } from "./rosterDirectoryPdf";
import type { Player } from "../types";

const player = (p: Partial<Player>): Player => ({ id: "x", name: "X", ...p });

describe("buildRosterDirectoryRows", () => {
  it("drops released players but keeps everyone else", () => {
    const rows = buildRosterDirectoryRows([
      player({ id: "1", name: "Active", number: "1" }),
      player({ id: "2", name: "Gone", playerStatus: "released" }),
      player({ id: "3", name: "Tryout", playerStatus: "tryout", number: "3" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("sorts numbered players numerically, then unnumbered by name", () => {
    const rows = buildRosterDirectoryRows([
      player({ id: "a", name: "Zane", number: "10" }),
      player({ id: "b", name: "Abe" }),
      player({ id: "c", name: "Bo", number: "2" }),
      player({ id: "d", name: "Cal" }),
    ]);
    // #2, #10, then unnumbered Abe, Cal alphabetically.
    expect(rows.map((r) => r.name)).toEqual(["Bo", "Zane", "Abe", "Cal"]);
  });

  it("maps parent + emergency contact fields onto the row", () => {
    const [row] = buildRosterDirectoryRows([
      player({
        id: "1",
        name: "Sam Smith",
        number: "7",
        parentName: "Pat Smith",
        phone: "555-1000",
        email: "pat@example.com",
        parent2Name: "Jo Smith",
        parent2Phone: "555-2000",
      }),
    ]);
    expect(row).toMatchObject({
      number: "7",
      name: "Sam Smith",
      guardian: "Pat Smith",
      phone: "555-1000",
      email: "pat@example.com",
      emergencyName: "Jo Smith",
      emergencyPhone: "555-2000",
    });
  });

  it("summarizes positions (deduped, primary first, catcher, max 3)", () => {
    const [row] = buildRosterDirectoryRows([
      player({
        id: "1",
        name: "P",
        primaryPosition: "ss",
        secondaryPosition: "2B",
        comfortablePositions: ["SS", "3B", "RF"],
        isCatcher: true,
      }),
    ]);
    // SS (primary), 2B (secondary), 3B (next comfortable); SS deduped, capped at 3.
    expect(row.positions).toBe("SS/2B/3B");
  });

  it("falls back gracefully for missing name/number/contact", () => {
    const [row] = buildRosterDirectoryRows([player({ id: "1", name: "" })]);
    expect(row.name).toBe("Unnamed");
    expect(row.number).toBe("");
    expect(row.guardian).toBe("");
    expect(row.positions).toBe("");
  });
});
