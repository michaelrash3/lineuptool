import { describe, it, expect } from "vitest";
import {
  parseAgeCap,
  normalizeJersey,
  jerseyConflicts,
  playersWithJersey,
  ageIneligiblePlayers,
  openJerseyNumbers,
  activeRosterCount,
  isActiveRosterPlayer,
} from "./rosterIntegrity";

describe("parseAgeCap", () => {
  it("reads the number out of a U-tier", () => {
    expect(parseAgeCap("10U")).toBe(10);
    expect(parseAgeCap("8u")).toBe(8);
    expect(parseAgeCap("12U")).toBe(12);
  });
  it("is null for a cap-less or empty tier", () => {
    expect(parseAgeCap("Open")).toBeNull();
    expect(parseAgeCap("")).toBeNull();
    expect(parseAgeCap(null)).toBeNull();
  });
});

describe("normalizeJersey / isActiveRosterPlayer", () => {
  it("stringifies and trims, empty for nullish", () => {
    expect(normalizeJersey(7)).toBe("7");
    expect(normalizeJersey(" 12 ")).toBe("12");
    expect(normalizeJersey(null)).toBe("");
  });
  it("treats only rosterStatus 'departed' as inactive", () => {
    expect(isActiveRosterPlayer({})).toBe(true);
    expect(isActiveRosterPlayer({ rosterStatus: "active" })).toBe(true);
    expect(isActiveRosterPlayer({ rosterStatus: "departed" })).toBe(false);
  });
});

describe("jerseyConflicts / playersWithJersey", () => {
  const players = [
    { id: "a", name: "Alex", number: "7" },
    { id: "b", name: "Sam", number: "7" },
    { id: "c", name: "Jo", number: "9" },
    { id: "d", name: "Departed Dave", number: "7", rosterStatus: "departed" },
    { id: "e", name: "No Number", number: "" },
  ];
  it("flags a number shared by 2+ active players (ignoring departed/blank)", () => {
    const conflicts = jerseyConflicts(players);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].number).toBe("7");
    expect(conflicts[0].players.map((p) => p.name)).toEqual(["Alex", "Sam"]);
  });
  it("playersWithJersey excludes the given id and departed players", () => {
    expect(playersWithJersey(players, "7").map((p) => p.name)).toEqual([
      "Alex",
      "Sam",
    ]);
    expect(playersWithJersey(players, "7", "a").map((p) => p.name)).toEqual([
      "Sam",
    ]);
    expect(playersWithJersey(players, "")).toEqual([]);
  });
});

describe("ageIneligiblePlayers", () => {
  const season = "Spring 2026";
  // May-1 cutoff: born after Apr 30 subtracts a year. A 2015-06-01 kid is
  // league-age 10 in 2026; a 2014-06-01 kid is 11.
  const players = [
    { id: "ok", name: "OnAge", dob: "2015-06-01" },
    { id: "old", name: "TooOld", dob: "2014-06-01" },
    { id: "nodob", name: "Unknown", dob: "" },
    {
      id: "gone",
      name: "Old But Gone",
      dob: "2010-06-01",
      rosterStatus: "departed",
    },
  ];
  it("flags active players over the division cap only", () => {
    const over = ageIneligiblePlayers(players, "10U", season);
    expect(over.map((p) => p.name)).toEqual(["TooOld"]);
    expect(over[0].age).toBe(11);
    expect(over[0].cap).toBe(10);
  });
  it("returns [] when the division has no numeric cap", () => {
    expect(ageIneligiblePlayers(players, "Open", season)).toEqual([]);
  });
});

describe("openJerseyNumbers / activeRosterCount", () => {
  it("lists the lowest unused whole numbers among active players", () => {
    const players = [
      { id: "a", number: "0" },
      { id: "b", number: "1" },
      { id: "c", number: "3" },
      { id: "d", number: "2", rosterStatus: "departed" }, // frees up 2
    ];
    expect(openJerseyNumbers(players, 3)).toEqual(["2", "4", "5"]);
  });
  it("counts only active players toward the cap", () => {
    expect(
      activeRosterCount([
        { id: "a" },
        { id: "b", rosterStatus: "departed" },
        { id: "c", rosterStatus: "active" },
      ]),
    ).toBe(2);
  });
});
