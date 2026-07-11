import {
  DEV_CHECKINS_CAP,
  capCheckIns,
  drillAssignmentIndex,
  focusAreaDeltas,
  rolloverDevPlan,
  suggestDrillsForFocus,
  suggestFocusAreas,
} from "./developmentPlan";
import { isPlayerHealthOut, isPlayerUnavailable } from "./availability";
import type { EvalCategory } from "../constants/ui";
import type { DevCheckIn, DrillDefinition, Player } from "../types";

const CATS: EvalCategory[] = [
  { id: "approach", label: "Approach", group: "Hitting", weight: 2.5 },
  { id: "contact", label: "Contact", group: "Hitting", weight: 2.0 },
  { id: "glove", label: "Fielding", group: "Fielding", weight: 2.0 },
  { id: "speed", label: "Speed", group: "Baserunning", weight: 1.0 },
  { id: "baseballIQ", label: "Baseball IQ", group: "Intangibles", weight: 1.0 },
  // Zero-weight radar reading — never suggested.
  { id: "pitchMph", label: "Velocity", group: "Pitching", weight: 0 },
];

describe("suggestFocusAreas", () => {
  it("returns the weakest graded categories, catalog order breaking ties", () => {
    const grades = {
      approach: 4,
      contact: 2,
      glove: 2,
      speed: 3,
      baseballIQ: 5,
    };
    expect(suggestFocusAreas(grades, CATS)).toEqual([
      "contact",
      "glove",
      "speed",
    ]);
  });

  it("ignores ungraded (0/absent) and zero-weight categories", () => {
    const grades = { approach: 3, pitchMph: 1, contact: 0 };
    expect(suggestFocusAreas(grades, CATS)).toEqual(["approach"]);
  });

  it("returns nothing without grades", () => {
    expect(suggestFocusAreas(null, CATS)).toEqual([]);
    expect(suggestFocusAreas({}, CATS)).toEqual([]);
  });
});

describe("suggestDrillsForFocus", () => {
  const library: DrillDefinition[] = [
    { id: "d1", name: "Tee ladder", category: "Hitting" },
    {
      id: "d2",
      name: "Two-strike battles",
      category: "Hitting",
      evalCategory: "contact",
    },
    { id: "d3", name: "Ground-ball funnels", category: "Fielding" },
    { id: "d4", name: "Pole sprints", category: "Conditioning" },
    { id: "d5", name: "Situational scrimmage", category: "Team" },
  ];

  it("puts exact evalCategory matches first, then group fallbacks", () => {
    const out = suggestDrillsForFocus(library, ["contact"], CATS);
    expect(out.map((d) => d.id)).toEqual(["d2", "d1"]);
  });

  it("maps Intangibles focus onto Team drills and never suggests Conditioning", () => {
    const out = suggestDrillsForFocus(library, ["baseballIQ"], CATS);
    expect(out.map((d) => d.id)).toEqual(["d5"]);
  });

  it("returns nothing with no focus areas", () => {
    expect(suggestDrillsForFocus(library, [], CATS)).toEqual([]);
  });
});

describe("focusAreaDeltas", () => {
  const round = (
    date: string,
    grades: Record<string, Record<string, number>>,
    over: any = {},
  ) => ({ id: date, date, coachRole: "Head", grades, ...over });

  it("returns first→last per focus area from head rounds, oldest first", () => {
    const rounds = [
      // Deliberately unsorted: recency ordering must handle it.
      round("2026-06-01", { p1: { approach: 4, speed: 3 } }),
      round("2026-04-01", { p1: { approach: 2, speed: 3 } }),
      round("2026-05-01", { p1: { approach: 3 } }),
    ];
    expect(focusAreaDeltas(rounds, "p1", ["approach", "speed"])).toEqual({
      approach: { first: 2, last: 4 },
      speed: { first: 3, last: 3 },
    });
  });

  it("needs two graded rounds and ignores assistant rounds", () => {
    const rounds = [
      round("2026-04-01", { p1: { approach: 2 } }),
      round("2026-05-01", { p1: { approach: 5 } }, { coachRole: "Assistant" }),
    ];
    expect(focusAreaDeltas(rounds, "p1", ["approach"])).toEqual({});
    expect(focusAreaDeltas(rounds, "p1", [])).toEqual({});
    expect(focusAreaDeltas(null, "p1", ["approach"])).toEqual({});
  });
});

describe("rolloverDevPlan", () => {
  it("carries focus areas, drills, and active goals; drops the rest", () => {
    const carried = rolloverDevPlan({
      focusAreas: ["approach"],
      drillIds: ["d1"],
      goals: [
        { id: "g1", text: "keep", status: "active", createdAt: "2026-04-01" },
        { id: "g2", text: "won", status: "achieved", createdAt: "2026-04-01" },
        { id: "g3", text: "meh", status: "dropped", createdAt: "2026-04-01" },
      ],
      checkIns: [{ id: "c1", date: "2026-05-01", note: "old season" }],
      updatedAt: "2026-05-01T00:00:00Z",
    });
    expect(carried).toEqual({
      focusAreas: ["approach"],
      drillIds: ["d1"],
      goals: [
        { id: "g1", text: "keep", status: "active", createdAt: "2026-04-01" },
      ],
    });
  });

  it("returns undefined when nothing carries", () => {
    expect(rolloverDevPlan(undefined)).toBeUndefined();
    expect(
      rolloverDevPlan({
        goals: [{ id: "g1", text: "won", status: "achieved", createdAt: "x" }],
        checkIns: [{ id: "c1", date: "2026-05-01", note: "n" }],
      }),
    ).toBeUndefined();
  });
});

describe("capCheckIns", () => {
  it("keeps the newest entries up to the cap", () => {
    const list: DevCheckIn[] = Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      note: "n",
    }));
    const capped = capCheckIns(list);
    expect(capped).toHaveLength(DEV_CHECKINS_CAP);
    expect(capped[0].date).toBe("2026-05-25"); // newest first
    expect(capped[capped.length - 1].date).toBe("2026-05-06"); // oldest kept
  });
});

describe("drillAssignmentIndex", () => {
  it("maps drill ids to the names of players assigned them", () => {
    const players = [
      { id: "p1", name: "Ava", devPlan: { drillIds: ["d1", "d2"] } },
      { id: "p2", name: "Sam", devPlan: { drillIds: ["d1"] } },
      { id: "p3", name: "NoPlan" },
    ] as Player[];
    expect(drillAssignmentIndex(players)).toEqual({
      d1: ["Ava", "Sam"],
      d2: ["Ava"],
    });
  });
});

describe("isPlayerHealthOut", () => {
  it("gates only for status 'out'", () => {
    expect(isPlayerHealthOut({ health: { status: "out" } }, "2026-06-01")).toBe(
      true,
    );
    expect(
      isPlayerHealthOut({ health: { status: "limited" } }, "2026-06-01"),
    ).toBe(false);
    expect(
      isPlayerHealthOut({ health: { status: "healthy" } }, "2026-06-01"),
    ).toBe(false);
    expect(isPlayerHealthOut({}, "2026-06-01")).toBe(false);
    expect(isPlayerHealthOut(null, "2026-06-01")).toBe(false);
  });

  it("is open-ended without an expected return date", () => {
    const p = { health: { status: "out" } };
    expect(isPlayerHealthOut(p, "2026-06-01")).toBe(true);
    expect(isPlayerHealthOut(p, "2027-01-01")).toBe(true);
  });

  it("clears on the expected return day itself", () => {
    const p = { health: { status: "out", expectedReturn: "2026-06-10" } };
    expect(isPlayerHealthOut(p, "2026-06-09")).toBe(true);
    expect(isPlayerHealthOut(p, "2026-06-10")).toBe(false);
    expect(isPlayerHealthOut(p, "2026-06-11")).toBe(false);
  });
});

describe("isPlayerUnavailable", () => {
  it("combines the scheduled-absence and injury gates", () => {
    const scheduled = { absences: ["2026-06-01"] };
    const injured = { health: { status: "out" } };
    const healthy = { absences: [] };
    expect(isPlayerUnavailable(scheduled, "2026-06-01")).toBe(true);
    expect(isPlayerUnavailable(scheduled, "2026-06-02")).toBe(false);
    expect(isPlayerUnavailable(injured, "2026-06-02")).toBe(true);
    expect(isPlayerUnavailable(healthy, "2026-06-01")).toBe(false);
  });
});
